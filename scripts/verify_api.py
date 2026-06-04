"""
验证 YouTube Data API Key 是否可用（不打印密钥内容）。
用法（在项目根目录）:
  python scripts/verify_api.py
"""
import asyncio
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "backend"))

from dotenv import load_dotenv

load_dotenv(ROOT / ".env")

# 公开测试视频（YouTube 官方示例类内容，仅用于连通性检测）
TEST_VIDEO_ID = "jNQXAC9IVRw"


async def main() -> int:
    api_key = os.environ.get("YOUTUBE_API_KEY", "").strip()
    if not api_key or api_key == "your_api_key_here":
        print("❌ 未配置 YOUTUBE_API_KEY")
        print("   请复制 .env.example 为 .env 并填入真实 API Key")
        return 1

    from youtube_client import fetch_video_stats

    try:
        data = await fetch_video_stats([TEST_VIDEO_ID], api_key)
    except Exception as e:
        print(f"❌ API 请求失败: {e}")
        return 1

    if TEST_VIDEO_ID not in data:
        print("❌ API 返回为空，请检查 Key 权限或配额")
        return 1

    item = data[TEST_VIDEO_ID]
    print("✅ YouTube Data API 连接成功")
    print(f"   测试视频: {item['title'][:60]}")
    print(f"   播放量: {item['view_count']:,}")
    print(f"   点赞: {item['like_count']:,}")
    print(f"   评论: {item['comment_count']:,}")
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
