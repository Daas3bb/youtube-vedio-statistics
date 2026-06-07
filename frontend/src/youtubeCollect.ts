import { loadYoutubeApiProxy } from "./youtubeSettings";

export interface YoutubeVideoStats {
  video_id: string;
  title: string;
  channel_title: string;
  thumbnail_url: string;
  publish_time: string;
  view_count: number;
  like_count: number;
  comment_count: number;
}

const NETWORK_ERROR_HINT =
  "无法连接 Google API。请在项目根目录 .env 设置 PROXY_PORT=7897（你的 Clash HTTP 端口），保存后重启 npm run dev";

function apiBaseUrl(): string {
  const custom = loadYoutubeApiProxy();
  if (custom) return custom.replace(/\/$/, "");

  const envProxy = (import.meta.env.VITE_YOUTUBE_API_PROXY as string | undefined)?.trim();
  if (envProxy) return envProxy.replace(/\/$/, "");

  if (import.meta.env.DEV) return "/yt-api";
  return "https://www.googleapis.com/youtube/v3";
}

function isLikelyNetworkError(error: unknown): boolean {
  if (!(error instanceof TypeError)) return false;
  const msg = error.message.toLowerCase();
  return msg.includes("failed to fetch") || msg.includes("networkerror");
}

export async function fetchYoutubeVideoStats(
  videoIds: string[],
  apiKey: string
): Promise<Record<string, YoutubeVideoStats>> {
  if (!apiKey) throw new Error("未配置 YouTube API Key");
  if (!videoIds.length) return {};

  const result: Record<string, YoutubeVideoStats> = {};
  const base = apiBaseUrl();

  try {
    for (let i = 0; i < videoIds.length; i += 50) {
      const batch = videoIds.slice(i, i + 50);
      const params = new URLSearchParams({
        part: "statistics,snippet",
        id: batch.join(","),
        key: apiKey,
      });
      const res = await fetch(`${base}/videos?${params.toString()}`);
      if (!res.ok) {
        if (import.meta.env.DEV && res.status >= 500) {
          throw new Error(NETWORK_ERROR_HINT);
        }
        const errText = await res.text();
        throw new Error(`YouTube API 错误 (${res.status}): ${errText.slice(0, 120)}`);
      }
      const payload = (await res.json()) as {
        items?: Array<{
          id: string;
          snippet?: {
            title?: string;
            channelTitle?: string;
            publishedAt?: string;
            thumbnails?: Record<string, { url?: string }>;
          };
          statistics?: {
            viewCount?: string;
            likeCount?: string;
            commentCount?: string;
          };
        }>;
      };

      for (const item of payload.items ?? []) {
        const thumbs = item.snippet?.thumbnails ?? {};
        const thumb =
          thumbs.medium?.url || thumbs.default?.url || thumbs.high?.url || "";
        const published = item.snippet?.publishedAt ?? "";
        const stats = item.statistics ?? {};
        result[item.id] = {
          video_id: item.id,
          title: item.snippet?.title ?? "",
          channel_title: item.snippet?.channelTitle ?? "",
          thumbnail_url: thumb,
          publish_time: published ? published.slice(0, 10) : "",
          view_count: Number(stats.viewCount ?? 0),
          like_count: Number(stats.likeCount ?? 0),
          comment_count: Number(stats.commentCount ?? 0),
        };
      }
    }
  } catch (error) {
    if (error instanceof Error && error.message === NETWORK_ERROR_HINT) throw error;
    if (isLikelyNetworkError(error)) {
      if (import.meta.env.DEV) throw new Error(NETWORK_ERROR_HINT);
      throw new Error(
        "浏览器无法直连 YouTube API（CORS/网络限制）。请等待每 2 小时 Actions 自动同步，或在本地 npm run dev 并配置代理"
      );
    }
    throw error;
  }

  return result;
}
