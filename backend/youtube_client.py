import re
from typing import Any

import httpx

YOUTUBE_ID_RE = re.compile(r"^[a-zA-Z0-9_-]{11}$")
URL_PATTERNS = [
    re.compile(r"youtu\.be/([a-zA-Z0-9_-]{11})"),
    re.compile(r"youtube\.com/watch\?(?:.*&)?v=([a-zA-Z0-9_-]{11})"),
    re.compile(r"youtube\.com/shorts/([a-zA-Z0-9_-]{11})"),
    re.compile(r"youtube\.com/embed/([a-zA-Z0-9_-]{11})"),
    re.compile(r"youtube\.com/live/([a-zA-Z0-9_-]{11})"),
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


def build_video_url(video_id: str) -> str:
    return f"https://www.youtube.com/watch?v={video_id}"


async def fetch_video_stats(video_ids: list[str], api_key: str) -> dict[str, dict[str, Any]]:
    if not api_key:
        raise ValueError("YOUTUBE_API_KEY 未配置")
    if not video_ids:
        return {}

    result: dict[str, dict[str, Any]] = {}
    async with httpx.AsyncClient(timeout=20.0) as client:
        for i in range(0, len(video_ids), 50):
            batch = video_ids[i : i + 50]
            params = {
                "part": "statistics,snippet",
                "id": ",".join(batch),
                "key": api_key,
            }
            resp = await client.get(
                "https://www.googleapis.com/youtube/v3/videos",
                params=params,
            )
            resp.raise_for_status()
            payload = resp.json()
            for item in payload.get("items", []):
                vid = item["id"]
                snippet = item.get("snippet", {})
                stats = item.get("statistics", {})
                thumbs = snippet.get("thumbnails", {})
                thumb = (
                    thumbs.get("medium", {}).get("url")
                    or thumbs.get("default", {}).get("url")
                    or thumbs.get("high", {}).get("url")
                    or ""
                )
                published = snippet.get("publishedAt", "")
                result[vid] = {
                    "video_id": vid,
                    "title": snippet.get("title", ""),
                    "channel_title": snippet.get("channelTitle", ""),
                    "thumbnail_url": thumb,
                    "publish_time": published[:10] if published else "",
                    "view_count": int(stats.get("viewCount", 0) or 0),
                    "like_count": int(stats.get("likeCount", 0) or 0),
                    "comment_count": int(stats.get("commentCount", 0) or 0),
                }
    return result
