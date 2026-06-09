"""
Standalone collector for CLI and GitHub Actions.
Reads videos from data/store.json, fetches YouTube stats, appends history snapshots.
"""
import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from analytics import build_dashboard  # noqa: E402
from config import ROOT, VIDEOS_CSV, YOUTUBE_API_KEY, collect_now  # noqa: E402
from storage import append_snapshot, import_from_csv, list_videos, upsert_video  # noqa: E402
from youtube_client import fetch_video_stats  # noqa: E402


def sync_inputs() -> None:
    import_from_csv(VIDEOS_CSV)


async def collect_all() -> dict:
    sync_inputs()
    videos = list_videos(active_only=True)
    if not videos:
        print("No active videos in store.json (add URLs to inputs/videos.csv)")
        return {"total": 0, "written": 0, "skipped": 0, "failed": 0}

    ids = [v["video_id"] for v in videos if v.get("video_id")]
    print(f"Collecting {len(ids)} videos...")
    try:
        stats_map = await fetch_video_stats(ids, YOUTUBE_API_KEY)
    except Exception as e:
        print(f"Fetch failed: {e}")
        return {"total": len(ids), "written": 0, "skipped": 0, "failed": len(ids)}

    written = skipped = failed = 0
    for vid in ids:
        data = stats_map.get(vid)
        if not data:
            print(f"  FAIL: no API data for {vid}")
            failed += 1
            continue

        upsert_video(
            {
                "video_id": vid,
                "title": data["title"],
                "video_url": f"https://www.youtube.com/watch?v={vid}",
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
            snapshot_time=collect_now(),
        )
        if ok:
            written += 1
            print(f"  OK {vid}: {data['view_count']:,} views")
        else:
            skipped += 1
            print(f"  SKIP {vid}: {msg}")

    print(f"Done: written={written}, skipped={skipped}, failed={failed}")
    return {"total": len(ids), "written": written, "skipped": skipped, "failed": failed}


def main():
    result = asyncio.run(collect_all())
    dash = build_dashboard()
    print(
        f"Dashboard: {dash['kpi']['video_count']} videos, "
        f"{dash['kpi']['total_views']:,} total views"
    )
    sys.exit(0 if result["failed"] == 0 else 1)


if __name__ == "__main__":
    main()
