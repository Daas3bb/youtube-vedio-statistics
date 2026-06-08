"""从外部 KOL 监控 JSON 导出导入 YouTube 视频到 inputs/videos.csv 与 data/store.json。"""
from __future__ import annotations

import csv
import json
import re
import sys
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
IMPORT_PATH = ROOT / "data" / "external_export.json"
VIDEOS_CSV = ROOT / "inputs" / "videos.csv"
STORE_PATH = ROOT / "data" / "store.json"

YOUTUBE_ID_RE = re.compile(r"^[a-zA-Z0-9_-]{11}$")
URL_PATTERNS = [
    re.compile(r"youtu\.be/([a-zA-Z0-9_-]{11})"),
    re.compile(r"youtube\.com/watch\?(?:.*&)?v=([a-zA-Z0-9_-]{11})"),
    re.compile(r"youtube\.com/shorts/([a-zA-Z0-9_-]{11})"),
    re.compile(r"youtube\.com/embed/([a-zA-Z0-9_-]{11})"),
    re.compile(r"youtube\.com/live/([a-zA-Z0-9_-]{11})"),
]

VIDEO_FIELDS = [
    "video_id",
    "title",
    "video_url",
    "thumbnail_url",
    "publish_time",
    "channel_title",
    "status",
    "created_at",
]


def extract_video_id(url_or_id: str) -> str | None:
    text = (url_or_id or "").strip()
    if not text:
        return None
    if YOUTUBE_ID_RE.match(text):
        return text
    for pattern in URL_PATTERNS:
        match = pattern.search(text)
        if match:
            return match.group(1)
    return None


def load_export(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def read_csv_ids() -> set[str]:
    if not VIDEOS_CSV.exists():
        return set()
    with VIDEOS_CSV.open(encoding="utf-8", newline="") as f:
        return {row["video_id"].strip() for row in csv.DictReader(f) if row.get("video_id")}


def append_csv_rows(rows: list[dict[str, str]]) -> int:
    if not rows:
        return 0
    write_header = not VIDEOS_CSV.exists() or VIDEOS_CSV.stat().st_size == 0
    with VIDEOS_CSV.open("a", encoding="utf-8", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=VIDEO_FIELDS)
        if write_header:
            writer.writeheader()
        writer.writerows(rows)
    return len(rows)


def import_history(export: dict, id_map: dict[str, str]) -> int:
    """将 video_history 快照写入 store.json（按 YouTube video_id）。"""
    video_history = export.get("video_history") or {}
    if not video_history:
        return 0

    if STORE_PATH.exists():
        store = json.loads(STORE_PATH.read_text(encoding="utf-8"))
    else:
        store = {"videos": [], "history": []}
    store.setdefault("videos", [])
    store.setdefault("history", [])

    existing = set()
    for row in store["history"]:
        vid = row.get("video_id", "")
        bucket = row.get("snapshot_bucket") or row.get("snapshot_time", "")[:13] + ":00:00"
        existing.add((vid, bucket))

    added = 0
    for legacy_id, snaps in video_history.items():
        yt_id = id_map.get(legacy_id)
        if not yt_id:
            continue
        for snap in snaps:
            snap_at = (snap.get("snapshot_at") or "").strip()
            if not snap_at:
                continue
            try:
                dt = datetime.strptime(snap_at, "%Y-%m-%d %H:%M:%S")
            except ValueError:
                continue
            bucket = dt.strftime("%Y-%m-%d %H:00:00")
            if (yt_id, bucket) in existing:
                continue
            store["history"].append(
                {
                    "video_id": yt_id,
                    "snapshot_time": snap_at,
                    "snapshot_bucket": bucket,
                    "view_count": str(snap.get("views", 0)),
                    "like_count": str(snap.get("likes", 0)),
                    "comment_count": str(snap.get("comments", 0)),
                    "created_at": snap_at,
                }
            )
            existing.add((yt_id, bucket))
            added += 1

    STORE_PATH.parent.mkdir(parents=True, exist_ok=True)
    STORE_PATH.write_text(json.dumps(store, ensure_ascii=False, indent=2), encoding="utf-8")
    return added


def main() -> int:
    path = Path(sys.argv[1]) if len(sys.argv) > 1 else IMPORT_PATH
    if not path.exists():
        print(f"找不到导入文件: {path}")
        print("请将外部 JSON 保存为 data/external_export.json 后重试")
        return 1

    export = load_export(path)
    videos = export.get("videos") or []
    existing = read_csv_ids()
    id_map: dict[str, str] = {}
    rows: list[dict[str, str]] = []

    for item in videos:
        if item.get("platform") != "youtube":
            continue
        if item.get("fetch_status") not in ("ok", "pending", ""):
            continue
        legacy_id = item.get("id", "")
        yt_id = extract_video_id(item.get("url", ""))
        if not yt_id:
            continue
        if legacy_id:
            id_map[legacy_id] = yt_id
        if yt_id in existing:
            continue
        rows.append(
            {
                "video_id": yt_id,
                "title": item.get("title") or "",
                "video_url": item.get("url") or f"https://www.youtube.com/watch?v={yt_id}",
                "thumbnail_url": item.get("thumbnail") or f"https://i.ytimg.com/vi/{yt_id}/mqdefault.jpg",
                "publish_time": item.get("published_at") or "",
                "channel_title": item.get("channel") or "",
                "status": "active",
                "created_at": item.get("created_at") or datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            }
        )
        existing.add(yt_id)

    csv_added = append_csv_rows(rows)
    hist_added = import_history(export, id_map)

    print(f"CSV 新增 {csv_added} 个 YouTube 视频（跳过已存在项）")
    print(f"历史快照新增 {hist_added} 条到 store.json")
    print(f"未导入非 YouTube 平台（Instagram/TikTok/Facebook 本项目暂不支持采集）")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
