"""
Export data/store.json to frontend/public/data/site.json for static deployment.
"""
import json
import sys
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from analytics import build_dashboard, video_detail  # noqa: E402
from config import ROOT, STATIC_OUTPUT, STORE_PATH, VIDEOS_CSV  # noqa: E402
from storage import import_from_csv, list_videos  # noqa: E402
from thumbnails import download_thumbnail, local_thumbnail_path  # noqa: E402

THUMB_DIR = ROOT / "frontend" / "public" / "thumbnails"


def _apply_local_thumbnails(payload: dict) -> int:
    downloaded = 0

    def patch_item(item: dict) -> None:
        nonlocal downloaded
        vid = item.get("video_id")
        if not vid:
            return
        remote = item.get("thumbnail_url", "")
        if download_thumbnail(vid, THUMB_DIR, remote):
            item["thumbnail_url"] = local_thumbnail_path(vid)
            downloaded += 1

    for video in payload["dashboard"].get("videos", []):
        patch_item(video)

    for item in payload["dashboard"].get("rankings", []):
        patch_item(item)

    for detail in payload.get("details", {}).values():
        video = detail.get("video", {})
        vid = video.get("video_id")
        if not vid:
            continue
        remote = video.get("thumbnail_url", "")
        if download_thumbnail(vid, THUMB_DIR, remote):
            video["thumbnail_url"] = local_thumbnail_path(vid)

    return downloaded


def build_site_json() -> dict:
    if not STORE_PATH.exists():
        import_from_csv(VIDEOS_CSV)

    dashboard = build_dashboard()
    details: dict[str, dict] = {}
    for video in list_videos():
        vid = video.get("video_id")
        if not vid:
            continue
        detail = video_detail(vid)
        if detail:
            details[vid] = detail

    return {
        "generated_at": datetime.now().strftime("%Y-%m-%dT%H:%M:%S"),
        "mode": "static",
        "dashboard": dashboard,
        "details": details,
    }


def main() -> int:
    payload = build_site_json()
    thumb_count = _apply_local_thumbnails(payload)
    STATIC_OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    with STATIC_OUTPUT.open("w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, separators=(",", ":"))

    kpi = payload["dashboard"]["kpi"]
    print(
        f"Built {STATIC_OUTPUT} "
        f"({kpi['video_count']} videos, {kpi['total_views']:,} views, "
        f"{thumb_count} thumbnails)"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
