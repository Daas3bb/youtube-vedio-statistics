import csv
from datetime import datetime
from pathlib import Path
from typing import Any

from config import DEDUP_GRANULARITY, HISTORY_CSV, VIDEOS_CSV

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


def _ensure_file(path: Path, fields: list[str]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    if not path.exists() or path.stat().st_size == 0:
        with path.open("w", encoding="utf-8", newline="") as f:
            writer = csv.DictWriter(f, fieldnames=fields)
            writer.writeheader()


def _read_csv(path: Path, fields: list[str]) -> list[dict[str, str]]:
    _ensure_file(path, fields)
    with path.open("r", encoding="utf-8", newline="") as f:
        rows = list(csv.DictReader(f))
    return [r for r in rows if any((v or "").strip() for v in r.values())]


def _write_csv(path: Path, fields: list[str], rows: list[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fields)
        writer.writeheader()
        for row in rows:
            writer.writerow({k: row.get(k, "") for k in fields})


def bucket_time(dt: datetime, granularity: str | None = None) -> str:
    g = (granularity or DEDUP_GRANULARITY).lower()
    if g == "minute":
        return dt.strftime("%Y-%m-%d %H:%M:00")
    return dt.strftime("%Y-%m-%d %H:00:00")


def list_videos(active_only: bool = False) -> list[dict[str, str]]:
    rows = _read_csv(VIDEOS_CSV, VIDEO_FIELDS)
    if active_only:
        rows = [r for r in rows if (r.get("status") or "active").lower() != "inactive"]
    return rows


def get_video(video_id: str) -> dict[str, str] | None:
    for row in list_videos():
        if row.get("video_id") == video_id:
            return row
    return None


def upsert_video(video: dict[str, Any]) -> dict[str, str]:
    rows = list_videos()
    vid = video["video_id"]
    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    updated = False
    for i, row in enumerate(rows):
        if row.get("video_id") == vid:
            rows[i] = {
                **row,
                **{k: str(v) for k, v in video.items() if k in VIDEO_FIELDS},
                "created_at": row.get("created_at") or now,
            }
            updated = True
            break
    if not updated:
        rows.append(
            {
                "video_id": vid,
                "title": video.get("title", ""),
                "video_url": video.get("video_url", ""),
                "thumbnail_url": video.get("thumbnail_url", ""),
                "publish_time": video.get("publish_time", ""),
                "channel_title": video.get("channel_title", ""),
                "status": video.get("status", "active"),
                "created_at": now,
            }
        )
    _write_csv(VIDEOS_CSV, VIDEO_FIELDS, rows)
    return get_video(vid) or {}


def delete_video(video_id: str) -> bool:
    rows = list_videos()
    new_rows = [r for r in rows if r.get("video_id") != video_id]
    if len(new_rows) == len(rows):
        return False
    _write_csv(VIDEOS_CSV, VIDEO_FIELDS, new_rows)
    return True


def list_history(video_id: str | None = None) -> list[dict[str, str]]:
    rows = _read_csv(HISTORY_CSV, HISTORY_FIELDS)
    if video_id:
        rows = [r for r in rows if r.get("video_id") == video_id]
    return rows


def history_dedup_keys() -> set[tuple[str, str]]:
    keys: set[tuple[str, str]] = set()
    for row in list_history():
        vid = row.get("video_id", "")
        snap = row.get("snapshot_time", "")
        if not vid or not snap:
            continue
        try:
            dt = datetime.strptime(snap, "%Y-%m-%d %H:%M:%S")
        except ValueError:
            continue
        keys.add((vid, bucket_time(dt)))
    return keys


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
    keys = history_dedup_keys()
    if (video_id, bucket) in keys:
        return False, f"已存在 {video_id} 在 {bucket} 的快照，跳过重复写入"

    snap_str = dt.strftime("%Y-%m-%d %H:%M:%S")
    created = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    rows = list_history()
    rows.append(
        {
            "video_id": video_id,
            "snapshot_time": snap_str,
            "view_count": str(view_count),
            "like_count": str(like_count),
            "comment_count": str(comment_count),
            "created_at": created,
        }
    )
    _write_csv(HISTORY_CSV, HISTORY_FIELDS, rows)
    return True, f"已写入快照 {snap_str}"
