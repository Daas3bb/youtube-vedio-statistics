"""Download YouTube thumbnails to frontend/public/thumbnails/."""
import urllib.error
import urllib.request
from pathlib import Path

USER_AGENT = "KOL-YouTube-Monitor/1.0"
THUMB_CANDIDATES = [
    "https://i.ytimg.com/vi/{id}/mqdefault.jpg",
    "https://i.ytimg.com/vi/{id}/hqdefault.jpg",
    "https://img.youtube.com/vi/{id}/mqdefault.jpg",
]


def _download(url: str, dest: Path) -> bool:
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            data = resp.read()
            if len(data) < 500:
                return False
            dest.write_bytes(data)
            return True
    except (urllib.error.URLError, OSError, TimeoutError):
        return False


def download_thumbnail(video_id: str, thumb_dir: Path, remote_url: str = "") -> bool:
    thumb_dir.mkdir(parents=True, exist_ok=True)
    dest = thumb_dir / f"{video_id}.jpg"
    if dest.exists() and dest.stat().st_size > 500:
        return True

    urls = []
    if remote_url and remote_url.startswith("http"):
        urls.append(remote_url)
    urls.extend(u.format(id=video_id) for u in THUMB_CANDIDATES)

    seen: set[str] = set()
    for url in urls:
        if url in seen:
            continue
        seen.add(url)
        if _download(url, dest):
            return True

    return dest.exists() and dest.stat().st_size > 500


def local_thumbnail_path(video_id: str) -> str:
    return f"thumbnails/{video_id}.jpg"
