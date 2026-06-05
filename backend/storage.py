from contextlib import contextmanager
from datetime import datetime
from typing import Any, Iterator

from sqlalchemy.orm import Session

from config import DEDUP_GRANULARITY
from database import HistoryRow, SessionLocal, VideoRow

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
HISTORY_FIELDS = [
    "video_id",
    "snapshot_time",
    "view_count",
    "like_count",
    "comment_count",
    "created_at",
]


@contextmanager
def _session() -> Iterator[Session]:
    session = SessionLocal()
    try:
        yield session
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


def bucket_time(dt: datetime, granularity: str | None = None) -> str:
    g = (granularity or DEDUP_GRANULARITY).lower()
    if g == "minute":
        return dt.strftime("%Y-%m-%d %H:%M:00")
    return dt.strftime("%Y-%m-%d %H:00:00")


def _video_to_dict(row: VideoRow) -> dict[str, str]:
    return {
        "video_id": row.video_id,
        "title": row.title or "",
        "video_url": row.video_url or "",
        "thumbnail_url": row.thumbnail_url or "",
        "publish_time": row.publish_time or "",
        "channel_title": row.channel_title or "",
        "status": row.status or "active",
        "created_at": row.created_at or "",
    }


def _history_to_dict(row: HistoryRow) -> dict[str, str]:
    return {
        "video_id": row.video_id,
        "snapshot_time": row.snapshot_time,
        "view_count": str(row.view_count),
        "like_count": str(row.like_count),
        "comment_count": str(row.comment_count),
        "created_at": row.created_at or "",
    }


def list_videos(active_only: bool = False) -> list[dict[str, str]]:
    with _session() as session:
        query = session.query(VideoRow).order_by(VideoRow.created_at)
        if active_only:
            query = query.filter(VideoRow.status != "inactive")
        return [_video_to_dict(row) for row in query.all()]


def get_video(video_id: str) -> dict[str, str] | None:
    with _session() as session:
        row = session.get(VideoRow, video_id)
        return _video_to_dict(row) if row else None


def upsert_video(video: dict[str, Any]) -> dict[str, str]:
    vid = video["video_id"]
    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    with _session() as session:
        row = session.get(VideoRow, vid)
        if row:
            for key in VIDEO_FIELDS:
                if key in ("video_id", "created_at"):
                    continue
                if key in video:
                    setattr(row, key, str(video[key]))
        else:
            row = VideoRow(
                video_id=vid,
                title=str(video.get("title", "")),
                video_url=str(video.get("video_url", "")),
                thumbnail_url=str(video.get("thumbnail_url", "")),
                publish_time=str(video.get("publish_time", "")),
                channel_title=str(video.get("channel_title", "")),
                status=str(video.get("status", "active")),
                created_at=now,
            )
            session.add(row)
        session.flush()
        return _video_to_dict(row)


def delete_video(video_id: str) -> bool:
    with _session() as session:
        row = session.get(VideoRow, video_id)
        if not row:
            return False
        session.delete(row)
        return True


def list_history(video_id: str | None = None) -> list[dict[str, str]]:
    with _session() as session:
        query = session.query(HistoryRow).order_by(HistoryRow.snapshot_time)
        if video_id:
            query = query.filter(HistoryRow.video_id == video_id)
        return [_history_to_dict(row) for row in query.all()]


def history_dedup_keys() -> set[tuple[str, str]]:
    with _session() as session:
        rows = session.query(HistoryRow.video_id, HistoryRow.snapshot_bucket).all()
        return {(vid, bucket) for vid, bucket in rows}


def append_snapshot(
    video_id: str,
    view_count: int,
    like_count: int,
    comment_count: int,
    snapshot_time: datetime | None = None,
) -> tuple[bool, str]:
    """Returns (written, message). Skips if same video+bucket exists."""
    dt = snapshot_time or datetime.now()
    bucket = bucket_time(dt)
    snap_str = dt.strftime("%Y-%m-%d %H:%M:%S")
    created = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    with _session() as session:
        exists = (
            session.query(HistoryRow.id)
            .filter(HistoryRow.video_id == video_id, HistoryRow.snapshot_bucket == bucket)
            .first()
        )
        if exists:
            return False, f"已存在 {video_id} 在 {bucket} 的快照，跳过重复写入"

        session.add(
            HistoryRow(
                video_id=video_id,
                snapshot_time=snap_str,
                snapshot_bucket=bucket,
                view_count=view_count,
                like_count=like_count,
                comment_count=comment_count,
                created_at=created,
            )
        )
    return True, f"已写入快照 {snap_str}"
