import json
from datetime import datetime
from pathlib import Path
from typing import Any

from config import DEDUP_GRANULARITY, STORE_PATH

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


def _empty_store() -> dict[str, list]:
    return {"videos": [], "history": []}


def _load_store() -> dict[str, list]:
    if not STORE_PATH.exists():
        return _empty_store()
    with STORE_PATH.open(encoding="utf-8") as f:
        data = json.load(f)
    data.setdefault("videos", [])
    data.setdefault("history", [])
    return data


def _save_store(data: dict[str, list]) -> None:
    STORE_PATH.parent.mkdir(parents=True, exist_ok=True)
    with STORE_PATH.open("w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


def bucket_time(dt: datetime, granularity: str | None = None) -> str:
    g = (granularity or DEDUP_GRANULARITY).lower()
    if g == "minute":
        return dt.strftime("%Y-%m-%d %H:%M:00")
    return dt.strftime("%Y-%m-%d %H:00:00")


def list_videos(active_only: bool = False) -> list[dict[str, str]]:
    videos = _load_store()["videos"]
    if active_only:
        videos = [v for v in videos if (v.get("status") or "active") != "inactive"]
    return [dict(v) for v in videos]


def get_video(video_id: str) -> dict[str, str] | None:
    for video in _load_store()["videos"]:
        if video.get("video_id") == video_id:
            return dict(video)
    return None


def upsert_video(video: dict[str, Any]) -> dict[str, str]:
    data = _load_store()
    vid = video["video_id"]
    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    updated: dict[str, str] | None = None

    for row in data["videos"]:
        if row.get("video_id") == vid:
            for key in VIDEO_FIELDS:
                if key in ("video_id", "created_at"):
                    continue
                if key in video:
                    row[key] = str(video[key])
            updated = dict(row)
            break

    if updated is None:
        updated = {
            "video_id": vid,
            "title": str(video.get("title", "")),
            "video_url": str(video.get("video_url", "")),
            "thumbnail_url": str(video.get("thumbnail_url", "")),
            "publish_time": str(video.get("publish_time", "")),
            "channel_title": str(video.get("channel_title", "")),
            "status": str(video.get("status", "active")),
            "created_at": now,
        }
        data["videos"].append(updated)

    _save_store(data)
    return updated


def delete_video(video_id: str) -> bool:
    return delete_videos([video_id]) > 0


def delete_videos(video_ids: list[str]) -> int:
    drop = {vid.strip() for vid in video_ids if vid and vid.strip()}
    if not drop:
        return 0

    data = _load_store()
    before_videos = len(data["videos"])
    before_history = len(data["history"])
    data["videos"] = [v for v in data["videos"] if v.get("video_id") not in drop]
    data["history"] = [row for row in data["history"] if row.get("video_id") not in drop]
    removed = (before_videos - len(data["videos"])) + (before_history - len(data["history"]))
    if not removed:
        return 0
    _save_store(data)
    return before_videos - len(data["videos"])


def list_history(video_id: str | None = None) -> list[dict[str, str]]:
    history = _load_store()["history"]
    if video_id:
        history = [row for row in history if row.get("video_id") == video_id]
    return [dict(row) for row in history]


def history_dedup_keys() -> set[tuple[str, str]]:
    keys: set[tuple[str, str]] = set()
    for row in _load_store()["history"]:
        bucket = row.get("snapshot_bucket") or bucket_time(
            datetime.strptime(row["snapshot_time"], "%Y-%m-%d %H:%M:%S")
        )
        keys.add((row["video_id"], bucket))
    return keys


def append_snapshot(
    video_id: str,
    view_count: int,
    like_count: int,
    comment_count: int,
    snapshot_time: datetime | None = None,
) -> tuple[bool, str]:
    dt = snapshot_time or datetime.now()
    bucket = bucket_time(dt)
    snap_str = dt.strftime("%Y-%m-%d %H:%M:%S")
    created = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    data = _load_store()
    for row in data["history"]:
        existing_bucket = row.get("snapshot_bucket") or bucket_time(
            datetime.strptime(row["snapshot_time"], "%Y-%m-%d %H:%M:%S")
        )
        if row.get("video_id") == video_id and existing_bucket == bucket:
            return False, f"已存在 {video_id} 在 {bucket} 的快照，跳过重复写入"

    data["history"].append(
        {
            "video_id": video_id,
            "snapshot_time": snap_str,
            "snapshot_bucket": bucket,
            "view_count": str(view_count),
            "like_count": str(like_count),
            "comment_count": str(comment_count),
            "created_at": created,
        }
    )
    _save_store(data)
    return True, f"已写入快照 {snap_str}"


def import_from_csv(videos_csv: Path, history_csv: Path | None = None) -> None:
    import csv

    data = _load_store()
    existing_ids = {v["video_id"] for v in data["videos"]}

    if videos_csv.exists():
        with videos_csv.open(encoding="utf-8", newline="") as f:
            for row in csv.DictReader(f):
                vid = row.get("video_id", "").strip()
                if not vid or vid in existing_ids:
                    continue
                data["videos"].append({k: row.get(k, "") for k in VIDEO_FIELDS})
                existing_ids.add(vid)

    if history_csv and history_csv.exists():
        existing_keys = history_dedup_keys()
        with history_csv.open(encoding="utf-8", newline="") as f:
            for row in csv.DictReader(f):
                vid = row.get("video_id", "").strip()
                snap = row.get("snapshot_time", "").strip()
                if not vid or not snap:
                    continue
                dt = datetime.strptime(snap, "%Y-%m-%d %H:%M:%S")
                bucket = bucket_time(dt)
                if (vid, bucket) in existing_keys:
                    continue
                data["history"].append(
                    {
                        "video_id": vid,
                        "snapshot_time": snap,
                        "snapshot_bucket": bucket,
                        "view_count": row.get("view_count", "0"),
                        "like_count": row.get("like_count", "0"),
                        "comment_count": row.get("comment_count", "0"),
                        "created_at": row.get("created_at", snap),
                    }
                )
                existing_keys.add((vid, bucket))

    _save_store(data)
