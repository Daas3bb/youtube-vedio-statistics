"""
将看板已采集的快照写入 data/store.json，并重建 frontend/public/data/site.json。
供本地 npm run dev 的 /api/persist-snapshots 调用。
"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from build_static import main as build_static_main  # noqa: E402
from storage import append_snapshot_exact, upsert_video  # noqa: E402


def persist_payload(payload: dict) -> dict:
    snapshots = payload.get("snapshots") or []
    written = skipped = 0
    errors: list[str] = []

    for row in snapshots:
        vid = str(row.get("video_id", "")).strip()
        snap_time = str(row.get("snapshot_time", "")).strip()
        if not vid or not snap_time:
            skipped += 1
            continue

        upsert_video(
            {
                "video_id": vid,
                "title": row.get("title", ""),
                "video_url": row.get("video_url") or f"https://www.youtube.com/watch?v={vid}",
                "thumbnail_url": row.get("thumbnail_url", ""),
                "publish_time": row.get("publish_time", ""),
                "channel_title": row.get("channel_title", ""),
                "status": "active",
            }
        )

        ok, msg = append_snapshot_exact(
            vid,
            int(row.get("view_count") or 0),
            int(row.get("like_count") or 0),
            int(row.get("comment_count") or 0),
            snap_time,
        )
        if ok:
            written += 1
            print(f"  OK {vid} @ {snap_time}")
        else:
            skipped += 1
            print(f"  SKIP {vid}: {msg}")

    build_static_main()
    return {"written": written, "skipped": skipped, "errors": errors}


def main() -> int:
    if len(sys.argv) < 2:
        print("Usage: python persist_snapshots.py <payload.json>")
        return 1

    payload_path = Path(sys.argv[1])
    payload = json.loads(payload_path.read_text(encoding="utf-8"))
    result = persist_payload(payload)
    print(f"Done: written={result['written']}, skipped={result['skipped']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
