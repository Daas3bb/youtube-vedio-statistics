import asyncio
import os
from datetime import datetime

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from analytics import build_dashboard, video_detail
from config import YOUTUBE_API_KEY
from database import check_db, init_db
from storage import append_snapshot, delete_video, list_videos, upsert_video
from youtube_client import build_video_url, extract_video_id, fetch_video_stats

load_dotenv()

# Configurable CORS origins via env var (comma-separated)
# e.g. CORS_ORIGINS=https://yourdomain.com,http://localhost:5173
CORS_ORIGINS = os.getenv("CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173")
ALLOWED_ORIGINS = [o.strip() for o in CORS_ORIGINS.split(",") if o.strip()]

app = FastAPI(title="KOL YouTube Monitor", version="1.0.0-mvp")
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def on_startup():
    init_db()


@app.get("/api/health")
def health():
    db_ok = check_db()
    return {
        "status": "ok" if db_ok else "degraded",
        "api_key_configured": bool(YOUTUBE_API_KEY),
        "db_connected": db_ok,
    }


@app.get("/api/videos")
def get_videos():
    return {"videos": list_videos()}


@app.post("/api/videos")
async def add_video(body: dict):
    url_or_id = (body or {}).get("url_or_id", "")
    video_id = extract_video_id(str(url_or_id))
    if not video_id:
        raise HTTPException(400, "无法解析 YouTube Video ID，请检查 URL 或 ID")

    existing = next((v for v in list_videos() if v.get("video_id") == video_id), None)
    if existing:
        return {"video": existing, "message": "视频已存在"}

    meta = {
        "video_id": video_id,
        "title": "",
        "video_url": build_video_url(video_id),
        "thumbnail_url": "",
        "publish_time": "",
        "channel_title": "",
        "status": "active",
    }

    if YOUTUBE_API_KEY:
        try:
            stats = await fetch_video_stats([video_id], YOUTUBE_API_KEY)
            if video_id in stats:
                s = stats[video_id]
                meta.update(
                    {
                        "title": s["title"],
                        "thumbnail_url": s["thumbnail_url"],
                        "publish_time": s["publish_time"],
                        "channel_title": s["channel_title"],
                    }
                )
        except Exception:
            pass

    video = upsert_video(meta)
    return {"video": video, "message": "视频已添加"}


@app.post("/api/videos/batch")
async def add_videos_batch(body: dict):
    raw_items = (body or {}).get("urls_or_ids", [])
    if not isinstance(raw_items, list):
        raise HTTPException(400, "urls_or_ids 应为数组")

    existing_ids = {v.get("video_id") for v in list_videos()}
    seen: set[str] = set()
    to_add: list[str] = []
    results: list[dict] = []

    for raw in raw_items:
        if not isinstance(raw, str):
            continue
        text = raw.strip()
        if not text:
            continue
        video_id = extract_video_id(text)
        if not video_id:
            results.append({"input": text, "status": "invalid", "message": "无法解析 Video ID"})
            continue
        if video_id in seen:
            results.append({"input": text, "video_id": video_id, "status": "duplicate_input"})
            continue
        seen.add(video_id)
        if video_id in existing_ids:
            results.append({"input": text, "video_id": video_id, "status": "exists"})
            continue
        to_add.append(video_id)

    stats_map: dict = {}
    if to_add and YOUTUBE_API_KEY:
        try:
            stats_map = await fetch_video_stats(to_add, YOUTUBE_API_KEY)
        except Exception:
            pass

    added_videos = []
    for video_id in to_add:
        meta = {
            "video_id": video_id,
            "title": "",
            "video_url": build_video_url(video_id),
            "thumbnail_url": "",
            "publish_time": "",
            "channel_title": "",
            "status": "active",
        }
        if video_id in stats_map:
            s = stats_map[video_id]
            meta.update(
                {
                    "title": s["title"],
                    "thumbnail_url": s["thumbnail_url"],
                    "publish_time": s["publish_time"],
                    "channel_title": s["channel_title"],
                }
            )
        video = upsert_video(meta)
        added_videos.append(video)
        existing_ids.add(video_id)
        results.append({"input": video_id, "video_id": video_id, "status": "added", "video": video})

    added = len(added_videos)
    existing = sum(1 for r in results if r["status"] == "exists")
    invalid = sum(1 for r in results if r["status"] == "invalid")
    duplicate = sum(1 for r in results if r["status"] == "duplicate_input")

    return {
        "added": added,
        "existing": existing,
        "invalid": invalid,
        "duplicate_input": duplicate,
        "results": results,
        "videos": added_videos,
        "message": f"成功添加 {added} 个，已存在 {existing} 个，无效 {invalid} 个",
    }


@app.delete("/api/videos/{video_id}")
def remove_video(video_id: str):
    if not delete_video(video_id):
        raise HTTPException(404, "视频不存在")
    return {"message": "已删除"}


@app.patch("/api/videos/{video_id}/status")
def set_status(video_id: str, status: str = "active"):
    video = next((v for v in list_videos() if v.get("video_id") == video_id), None)
    if not video:
        raise HTTPException(404, "视频不存在")
    upsert_video({**video, "status": status})
    return {"message": f"状态已更新为 {status}"}


@app.post("/api/collect")
async def collect(body: dict | None = None):
    if not YOUTUBE_API_KEY:
        raise HTTPException(500, "请配置环境变量 YOUTUBE_API_KEY")

    videos = list_videos(active_only=True)
    video_id_filter = (body or {}).get("video_id")
    if video_id_filter:
        videos = [v for v in videos if v.get("video_id") == video_id_filter]
        if not videos:
            raise HTTPException(404, "视频不存在或未启用监控")

    ids = [v["video_id"] for v in videos if v.get("video_id")]
    if not ids:
        return {"written": 0, "skipped": 0, "failed": 0, "results": []}

    stats_map = await fetch_video_stats(ids, YOUTUBE_API_KEY)
    results = []
    written = skipped = failed = 0

    for vid in ids:
        data = stats_map.get(vid)
        if not data:
            failed += 1
            results.append({"video_id": vid, "status": "failed"})
            continue

        upsert_video(
            {
                "video_id": vid,
                "title": data["title"],
                "video_url": build_video_url(vid),
                "thumbnail_url": data["thumbnail_url"],
                "publish_time": data["publish_time"],
                "channel_title": data["channel_title"],
                "status": "active",
            }
        )
        ok, msg = append_snapshot(
            vid,
            data["view_count"],
            data["like_count"],
            data["comment_count"],
            snapshot_time=datetime.now(),
        )
        if ok:
            written += 1
            results.append(
                {
                    "video_id": vid,
                    "status": "written",
                    "view_count": data["view_count"],
                    "like_count": data["like_count"],
                    "comment_count": data["comment_count"],
                }
            )
        else:
            skipped += 1
            results.append({"video_id": vid, "status": "skipped", "message": msg})

    return {"written": written, "skipped": skipped, "failed": failed, "results": results}


@app.get("/api/dashboard")
def dashboard():
    return build_dashboard()


@app.get("/api/videos/{video_id}/detail")
def get_video_detail(video_id: str):
    detail = video_detail(video_id)
    if not detail:
        raise HTTPException(404, "视频不存在")
    return detail


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
