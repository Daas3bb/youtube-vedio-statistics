import axios, { type AxiosResponse } from "axios";

const client = axios.create({ baseURL: "/api" });

/**
 * Validate that the response is JSON, not HTML (SPA fallback).
 * If Cloudflare serves index.html for /api routes, this catches it.
 */
function validateJsonResponse(res: AxiosResponse): AxiosResponse {
  const ct = String(res.headers["content-type"] || "");
  if (!ct.includes("application/json")) {
    throw new Error(`后端未连接：收到 ${ct || "非 JSON"} 响应`);
  }
  return res;
}

client.interceptors.response.use(validateJsonResponse);

export interface Video {
  video_id: string;
  title: string;
  video_url: string;
  thumbnail_url: string;
  publish_time: string;
  channel_title: string;
  status: string;
  created_at: string;
}

export interface DashboardData {
  kpi: {
    video_count: number;
    monitored_with_data: number;
    total_views: number;
    total_likes: number;
    total_comments: number;
    daily_new_views: number;
    like_rate: number;
    comment_rate: number;
  };
  rankings: Array<{
    video_id: string;
    title: string;
    thumbnail_url: string;
    channel_title: string;
    view_count: number;
    like_count: number;
    comment_count: number;
    snapshot_time: string;
  }>;
  trend: Array<{ time: string; total_views: number }>;
  daily_new_by_video: Array<{
    video_id: string;
    title: string;
    delta_views: number;
  }>;
  videos: Video[];
}

export interface VideoDetail {
  video: Video;
  latest?: {
    view_count: number;
    like_count: number;
    comment_count: number;
    snapshot_time: string;
  };
  history: Array<{
    time: string;
    views: number;
    likes: number;
    comments: number;
  }>;
  view_deltas: Array<{ time: string; delta_views: number }>;
}

export async function fetchHealth() {
  const { data } = await client.get<{
    status: string;
    api_key_configured: boolean;
    db_connected: boolean;
  }>("/health");
  return data;
}

export async function fetchVideos() {
  const { data } = await client.get<{ videos: Video[] }>("/videos");
  return data.videos;
}

export async function addVideo(urlOrId: string) {
  const { data } = await client.post<{ video: Video; message: string }>("/videos", {
    url_or_id: urlOrId,
  });
  return data;
}

export interface BatchAddResult {
  added: number;
  existing: number;
  invalid: number;
  duplicate_input: number;
  message: string;
  videos: Video[];
  results: Array<{
    input: string;
    video_id?: string;
    status: "added" | "exists" | "invalid" | "duplicate_input";
    message?: string;
    video?: Video;
  }>;
}

export async function addVideosBatch(urlsOrIds: string[]) {
  const { data } = await client.post<BatchAddResult>("/videos/batch", {
    urls_or_ids: urlsOrIds,
  });
  return data;
}

export async function deleteVideo(videoId: string) {
  await client.delete(`/videos/${videoId}`);
}

export async function collectAll(videoId?: string) {
  const { data } = await client.post<{
    written: number;
    skipped: number;
    failed: number;
    results: unknown[];
  }>("/collect", videoId ? { video_id: videoId } : {});
  return data;
}

export async function fetchDashboard() {
  const { data } = await client.get<DashboardData>("/dashboard");
  return data;
}

export async function fetchVideoDetail(videoId: string) {
  const { data } = await client.get<VideoDetail>(`/videos/${videoId}/detail`);
  return data;
}
