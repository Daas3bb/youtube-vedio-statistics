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

export interface StaticSiteData {
  generated_at: string;
  mode: string;
  dashboard: DashboardData;
  details: Record<string, VideoDetail>;
}

let cachedSite: StaticSiteData | null = null;

async function loadSite(): Promise<StaticSiteData> {
  if (cachedSite) return cachedSite;
  const base = import.meta.env.BASE_URL.replace(/\/$/, "");
  const res = await fetch(`${base}/data/site.json`, { cache: "no-cache" });
  if (!res.ok) {
    throw new Error(`无法加载数据文件 (${res.status})`);
  }
  const ct = res.headers.get("content-type") || "";
  if (!ct.includes("application/json")) {
    throw new Error("数据文件格式错误，请先运行 python scripts/build_static.py");
  }
  cachedSite = (await res.json()) as StaticSiteData;
  return cachedSite;
}

export async function fetchHealth() {
  const site = await loadSite();
  return {
    status: "ok",
    data_loaded: true,
    generated_at: site.generated_at,
  };
}

export async function fetchVideos() {
  const site = await loadSite();
  return site.dashboard.videos;
}

export async function fetchDashboard() {
  const site = await loadSite();
  return site.dashboard;
}

export async function fetchVideoDetail(videoId: string) {
  const site = await loadSite();
  const detail = site.details[videoId];
  if (!detail) {
    throw new Error("视频不存在");
  }
  return detail;
}

export async function fetchAllDetails(): Promise<Record<string, VideoDetail>> {
  const site = await loadSite();
  return site.details ?? {};
}

export function clearSiteCache() {
  cachedSite = null;
}
