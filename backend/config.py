import os
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parent.parent
load_dotenv(ROOT / ".env")
INPUTS_DIR = ROOT / "inputs"
DATA_DIR = ROOT / "data"
# 仅用于 CSV → MySQL 一次性迁移
VIDEOS_CSV = INPUTS_DIR / "videos.csv"
HISTORY_CSV = DATA_DIR / "history.csv"

YOUTUBE_API_KEY = os.environ.get("YOUTUBE_API_KEY", "")
DEDUP_GRANULARITY = os.environ.get("DEDUP_GRANULARITY", "hour")  # hour | minute

DATABASE_URL = os.environ.get(
    "DATABASE_URL",
    "mysql+pymysql://root:password@127.0.0.1:3306/kol_youtube?charset=utf8mb4",
)
