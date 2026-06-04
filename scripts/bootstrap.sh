#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [[ ! -f .env ]]; then
  cp .env.example .env
  echo "已创建 .env，请编辑并填入 YOUTUBE_API_KEY"
fi

pip install -r backend/requirements.txt
(cd frontend && npm install)
python scripts/verify_api.py
echo "完成。启动方式见 README.md"
