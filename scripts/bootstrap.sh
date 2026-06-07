#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [[ ! -f .env ]]; then
  cp .env.example .env
  echo "已创建 .env，请编辑并填入 YOUTUBE_API_KEY（本地采集时需要）"
fi

pip install -r scripts/requirements.txt
python scripts/build_static.py

cd frontend && npm install

echo ""
echo "完成。启动方式："
echo "  python scripts/build_static.py"
echo "  cd frontend && npm run dev"
