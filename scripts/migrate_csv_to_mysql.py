"""
一次性将 inputs/videos.csv 与 data/history.csv 导入 MySQL。
用法（在项目根目录）:
  pip install -r backend/requirements.txt
  python scripts/migrate_csv_to_mysql.py
"""
import csv
import sys
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "backend"))

from config import DEDUP_GRANULARITY, HISTORY_CSV, VIDEOS_CSV  # noqa: E402
from database import HistoryRow, SessionLocal, VideoRow, init_db  # noqa: E402
from storage import bucket_time  # noqa: E402


def _read_csv(path: Path, fields: list[str]) -> list[dict[str, str]]:
    if not path.exists() or path.stat().st_size == 0:
        return []
    with path.open("r", encoding="utf-8", newline="") as f:
        rows = list(csv.DictReader(f))
    return [r for r in rows if any((v or "").strip() for v in r.values())]


def migrate_videos(session) -> tuple[int, int]:
    rows = _read_csv(VIDEOS_CSV, ["video_id", "title", "video_url", "thumbnail_url", "publish_time", "channel_title", "status", "created_at"])
    inserted = skipped = 0
    for row in rows:
        vid = row.get("video_id", "").strip()
        if not vid:
            continue
        if session.get(VideoRow, vid):
            skipped += 1
            continue
        session.add(
            VideoRow(
                video_id=vid,
                title=row.get("title", ""),
                video_url=row.get("video_url", ""),
                thumbnail_url=row.get("thumbnail_url", ""),
                publish_time=row.get("publish_time", ""),
                channel_title=row.get("channel_title", ""),
                status=row.get("status", "active") or "active",
                created_at=row.get("created_at") or datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            )
        )
        inserted += 1
    return inserted, skipped


def migrate_history(session) -> tuple[int, int]:
    rows = _read_csv(
        HISTORY_CSV,
        ["video_id", "snapshot_time", "view_count", "like_count", "comment_count", "created_at"],
    )
    inserted = skipped = 0
    seen: set[tuple[str, str]] = set()

    for row in rows:
        vid = row.get("video_id", "").strip()
        snap = row.get("snapshot_time", "").strip()
        if not vid or not snap:
            continue
        try:
            dt = datetime.strptime(snap, "%Y-%m-%d %H:%M:%S")
        except ValueError:
            continue
        bucket = bucket_time(dt, DEDUP_GRANULARITY)
        key = (vid, bucket)
        if key in seen:
            skipped += 1
            continue
        exists = (
            session.query(HistoryRow.id)
            .filter(HistoryRow.video_id == vid, HistoryRow.snapshot_bucket == bucket)
            .first()
        )
        if exists:
            skipped += 1
            seen.add(key)
            continue

        session.add(
            HistoryRow(
                video_id=vid,
                snapshot_time=snap,
                snapshot_bucket=bucket,
                view_count=int(row.get("view_count") or 0),
                like_count=int(row.get("like_count") or 0),
                comment_count=int(row.get("comment_count") or 0),
                created_at=row.get("created_at") or snap,
            )
        )
        seen.add(key)
        inserted += 1
    return inserted, skipped


def main():
    init_db()
    session = SessionLocal()
    try:
        v_ins, v_skip = migrate_videos(session)
        h_ins, h_skip = migrate_history(session)
        session.commit()
        print(f"Videos: inserted={v_ins}, skipped={v_skip}")
        print(f"History: inserted={h_ins}, skipped={h_skip}")
    except Exception as e:
        session.rollback()
        print(f"Migration failed: {e}")
        sys.exit(1)
    finally:
        session.close()


if __name__ == "__main__":
    main()
