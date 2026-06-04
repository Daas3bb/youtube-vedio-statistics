import os
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parent.parent
load_dotenv(ROOT / ".env")
INPUTS_DIR = ROOT / "inputs"
DATA_DIR = ROOT / "data"
VIDEOS_CSV = INPUTS_DIR / "videos.csv"
HISTORY_CSV = DATA_DIR / "history.csv"

YOUTUBE_API_KEY = os.environ.get("YOUTUBE_API_KEY", "")
DEDUP_GRANULARITY = os.environ.get("DEDUP_GRANULARITY", "hour")  # hour | minute
