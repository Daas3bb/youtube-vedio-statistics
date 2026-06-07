import os
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parent.parent
load_dotenv(ROOT / ".env")

DATA_DIR = ROOT / "data"
STORE_PATH = DATA_DIR / "store.json"
STATIC_OUTPUT = ROOT / "frontend" / "public" / "data" / "site.json"
INPUTS_DIR = ROOT / "inputs"
VIDEOS_CSV = INPUTS_DIR / "videos.csv"

YOUTUBE_API_KEY = os.environ.get("YOUTUBE_API_KEY", "")
DEDUP_GRANULARITY = os.environ.get("DEDUP_GRANULARITY", "hour")
