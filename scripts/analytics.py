from collections import defaultdict
from datetime import datetime, timedelta
from typing import Any

from storage import list_history, list_videos


def _parse_int(value: str | int | None) -> int:
    try:
        return int(value or 0)
    except (TypeError, ValueError):
        return 0


def _parse_dt(value: str) -> datetime | None:
    for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d"):
        try:
            return datetime.strptime(value, fmt)
        except ValueError:
            continue
    return None


def latest_snapshots() -> dict[str, dict[str, Any]]:
    history = list_history()
    latest: dict[str, dict[str, Any]] = {}
    for row in history:
        vid = row.get("video_id", "")
        snap = row.get("snapshot_time", "")
        if not vid:
            continue
        dt = _parse_dt(snap)
        prev = latest.get(vid)
        if not prev or (dt and _parse_dt(prev["snapshot_time"]) and dt > _parse_dt(prev["snapshot_time"])):
            latest[vid] = {
                "video_id": vid,
                "snapshot_time": snap,
                "view_count": _parse_int(row.get("view_count")),
                "like_count": _parse_int(row.get("like_count")),
                "comment_count": _parse_int(row.get("comment_count")),
            }
    return latest


def compute_daily_delta_views() -> int:
    history = list_history()
    per_video_day: dict[str, dict[str, int]] = defaultdict(dict)
    per_video_dt: dict[str, dict[str, datetime]] = defaultdict(dict)

    for row in history:
        vid = row.get("video_id", "")
        dt = _parse_dt(row.get("snapshot_time", ""))
        if not vid or not dt:
            continue
        day = dt.strftime("%Y-%m-%d")
        views = _parse_int(row.get("view_count"))
        prev_dt = per_video_dt[vid].get(day)
        if prev_dt is None or dt >= prev_dt:
            per_video_day[vid][day] = views
            per_video_dt[vid][day] = dt

    today = datetime.now().strftime("%Y-%m-%d")
    yesterday = (datetime.now() - timedelta(days=1)).strftime("%Y-%m-%d")
    total_delta = 0
    for days in per_video_day.values():
        t_views = days.get(today)
        y_views = days.get(yesterday)
        if t_views is not None and y_views is not None:
            total_delta += max(0, t_views - y_views)
    return total_delta


def build_dashboard() -> dict[str, Any]:
    videos = [v for v in list_videos() if (v.get("status") or "active") != "inactive"]
    latest = latest_snapshots()
    total_views = sum(s["view_count"] for s in latest.values())
    total_likes = sum(s["like_count"] for s in latest.values())
    total_comments = sum(s["comment_count"] for s in latest.values())
    like_rate = round(total_likes / total_views * 100, 2) if total_views else 0
    comment_rate = round(total_comments / total_views * 100, 2) if total_views else 0

    video_meta = {v["video_id"]: v for v in videos}
    rankings = []
    for vid, snap in latest.items():
        meta = video_meta.get(vid, {})
        rankings.append(
            {
                "video_id": vid,
                "title": meta.get("title") or vid,
                "thumbnail_url": meta.get("thumbnail_url", ""),
                "channel_title": meta.get("channel_title", ""),
                "view_count": snap["view_count"],
                "like_count": snap["like_count"],
                "comment_count": snap["comment_count"],
                "snapshot_time": snap["snapshot_time"],
            }
        )
    rankings.sort(key=lambda x: x["view_count"], reverse=True)

    trend_map: dict[str, int] = defaultdict(int)
    for row in list_history():
        dt = _parse_dt(row.get("snapshot_time", ""))
        if not dt:
            continue
        bucket = dt.strftime("%Y-%m-%d %H:%M")
        trend_map[bucket] += _parse_int(row.get("view_count"))

    trend = [{"time": k, "total_views": trend_map[k]} for k in sorted(trend_map.keys())]

    daily_new: list[dict[str, Any]] = []
    per_vid_days: dict[str, dict[str, int]] = defaultdict(dict)
    per_vid_dt: dict[str, dict[str, datetime]] = defaultdict(dict)
    for row in list_history():
        vid = row.get("video_id", "")
        dt = _parse_dt(row.get("snapshot_time", ""))
        if not vid or not dt:
            continue
        day = dt.strftime("%Y-%m-%d")
        views = _parse_int(row.get("view_count"))
        if per_vid_dt[vid].get(day) is None or dt >= per_vid_dt[vid][day]:
            per_vid_days[vid][day] = views
            per_vid_dt[vid][day] = dt

    today = datetime.now().strftime("%Y-%m-%d")
    yesterday = (datetime.now() - timedelta(days=1)).strftime("%Y-%m-%d")
    for vid, days in per_vid_days.items():
        t, y = days.get(today), days.get(yesterday)
        if t is not None and y is not None:
            meta = video_meta.get(vid, {})
            daily_new.append(
                {
                    "video_id": vid,
                    "title": meta.get("title") or vid,
                    "delta_views": max(0, t - y),
                }
            )
    daily_new.sort(key=lambda x: x["delta_views"], reverse=True)

    return {
        "kpi": {
            "video_count": len(videos),
            "monitored_with_data": len(latest),
            "total_views": total_views,
            "total_likes": total_likes,
            "total_comments": total_comments,
            "daily_new_views": compute_daily_delta_views(),
            "like_rate": like_rate,
            "comment_rate": comment_rate,
        },
        "rankings": rankings[:20],
        "trend": trend[-48:],
        "daily_new_by_video": daily_new[:15],
        "videos": videos,
    }


def video_detail(video_id: str) -> dict[str, Any] | None:
    videos = list_videos()
    meta = next((v for v in videos if v.get("video_id") == video_id), None)
    if not meta:
        return None
    history = sorted(
        list_history(video_id),
        key=lambda r: r.get("snapshot_time", ""),
    )
    points = []
    for row in history:
        points.append(
            {
                "time": row.get("snapshot_time"),
                "views": _parse_int(row.get("view_count")),
                "likes": _parse_int(row.get("like_count")),
                "comments": _parse_int(row.get("comment_count")),
            }
        )
    deltas = []
    for i in range(1, len(points)):
        prev, cur = points[i - 1], points[i]
        deltas.append(
            {
                "time": cur["time"],
                "delta_views": max(0, cur["views"] - prev["views"]),
            }
        )
    latest = latest_snapshots().get(video_id)
    return {
        "video": meta,
        "latest": latest,
        "history": points,
        "view_deltas": deltas,
    }
