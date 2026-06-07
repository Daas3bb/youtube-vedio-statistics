import os
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parent.parent
load_dotenv(ROOT / ".env")


def _apply_proxy_env() -> None:
    """PROXY_PORT=7897 → HTTPS_PROXY，供 httpx / 本地脚本使用。"""
    if os.environ.get("HTTPS_PROXY") or os.environ.get("HTTP_PROXY"):
        return
    port = (os.environ.get("PROXY_PORT") or "").strip()
    if port:
        proxy = f"http://127.0.0.1:{port}"
        os.environ["HTTPS_PROXY"] = proxy
        os.environ["HTTP_PROXY"] = proxy


_apply_proxy_env()

DATA_DIR = ROOT / "data"
STORE_PATH = DATA_DIR / "store.json"
STATIC_OUTPUT = ROOT / "frontend" / "public" / "data" / "site.json"
INPUTS_DIR = ROOT / "inputs"
VIDEOS_CSV = INPUTS_DIR / "videos.csv"

YOUTUBE_API_KEY = os.environ.get("YOUTUBE_API_KEY", "")
DEDUP_GRANULARITY = os.environ.get("DEDUP_GRANULARITY", "hour")
