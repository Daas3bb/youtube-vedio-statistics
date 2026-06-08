import type { DashboardData, Video } from "./api";

const LS_KEY = "kol-local-videos";
const GITHUB_PENDING_KEY = "kol-github-pending-ids";
const HIDDEN_KEY = "kol-hidden-video-ids";

const YOUTUBE_ID_RE = /^[a-zA-Z0-9_-]{11}$/;
const URL_PATTERNS = [
  /youtu\.be\/([a-zA-Z0-9_-]{11})/,
  /youtube\.com\/watch\?(?:.*&)?v=([a-zA-Z0-9_-]{11})/,
  /youtube\.com\/shorts\/([a-zA-Z0-9_-]{11})/,
  /youtube\.com\/embed\/([a-zA-Z0-9_-]{11})/,
  /youtube\.com\/live\/([a-zA-Z0-9_-]{11})/,
];

export const BATCH_INPUT_PLACEHOLDER = `每行一个 YouTube 链接或 11 位 Video ID，例如：
https://www.youtube.com/watch?v=dQw4w9WgXcQ
https://youtu.be/dQw4w9WgXcQ
dQw4w9WgXcQ`;

export function extractVideoId(urlOrId: string): string | null {
  const text = (urlOrId || "").trim();
  if (!text) return null;
  if (YOUTUBE_ID_RE.test(text)) return text;
  for (const pattern of URL_PATTERNS) {
    const match = text.match(pattern);
    if (match) return match[1];
  }
  return null;
}

export function buildVideoUrl(videoId: string): string {
  return `https://www.youtube.com/watch?v=${videoId}`;
}

export function createVideoFromInput(raw: string): Video | null {
  const videoId = extractVideoId(raw);
  if (!videoId) return null;
  const now = new Date().toISOString().slice(0, 19).replace("T", " ");
  return {
    video_id: videoId,
    title: "",
    video_url: buildVideoUrl(videoId),
    thumbnail_url: "",
    publish_time: "",
    channel_title: "",
    status: "pending",
    created_at: now,
  };
}

export function loadLocalVideos(): Video[] {
  try {
    const raw = localStorage.getItem(LS_KEY);
    return raw ? (JSON.parse(raw) as Video[]) : [];
  } catch {
    return [];
  }
}

export function saveLocalVideos(videos: Video[]): void {
  localStorage.setItem(LS_KEY, JSON.stringify(videos));
}

export function mergeVideos(serverVideos: Video[], localVideos: Video[]): Video[] {
  const serverIds = new Set(serverVideos.map((v) => v.video_id));
  const uniqueLocal = localVideos.filter((v) => !serverIds.has(v.video_id));
  return [...serverVideos, ...uniqueLocal];
}

export function addLocalVideos(
  inputs: string[],
  excludeIds: Set<string> = new Set()
): {
  added: Video[];
  invalid: number;
  duplicate: number;
} {
  const existing = loadLocalVideos();
  const existingIds = new Set(existing.map((v) => v.video_id));
  const added: Video[] = [];
  let invalid = 0;
  let duplicate = 0;
  const seenInBatch = new Set<string>();

  for (const raw of inputs) {
    const trimmed = raw.trim();
    if (!trimmed) continue;

    const video = createVideoFromInput(trimmed);
    if (!video) {
      invalid++;
      continue;
    }

    if (existingIds.has(video.video_id) || excludeIds.has(video.video_id) || seenInBatch.has(video.video_id)) {
      duplicate++;
      continue;
    }

    seenInBatch.add(video.video_id);
    existingIds.add(video.video_id);
    added.push(video);
  }

  if (added.length) {
    saveLocalVideos([...existing, ...added]);
  }

  return { added, invalid, duplicate };
}

export function toCsvLine(videoId: string): string {
  const url = buildVideoUrl(videoId);
  return `${videoId},,${url},,,,active,`;
}

export function isLocalOnlyVideo(videoId: string, serverIds: Set<string>): boolean {
  return !serverIds.has(videoId);
}

export function removeLocalVideosByIds(videoIds: string[]): void {
  if (!videoIds.length) return;
  const drop = new Set(videoIds);
  const next = loadLocalVideos().filter((v) => !drop.has(v.video_id));
  saveLocalVideos(next);
  clearGithubPendingIds(videoIds);
}

export function loadHiddenVideoIds(): Set<string> {
  try {
    const raw = localStorage.getItem(HIDDEN_KEY);
    const ids = raw ? (JSON.parse(raw) as string[]) : [];
    return new Set(ids.filter(Boolean));
  } catch {
    return new Set();
  }
}

export function addHiddenVideoIds(videoIds: string[]): void {
  if (!videoIds.length) return;
  const hidden = loadHiddenVideoIds();
  videoIds.forEach((id) => hidden.add(id));
  localStorage.setItem(HIDDEN_KEY, JSON.stringify([...hidden]));
}

export function clearHiddenVideoIds(videoIds: string[]): void {
  if (!videoIds.length) return;
  const drop = new Set(videoIds);
  const next = [...loadHiddenVideoIds()].filter((id) => !drop.has(id));
  localStorage.setItem(HIDDEN_KEY, JSON.stringify(next));
}

export function applyDeletionToDashboard(
  dashboard: DashboardData,
  videoIds: Set<string>
): DashboardData {
  const rankings = dashboard.rankings.filter((row) => !videoIds.has(row.video_id));
  const videos = dashboard.videos.filter((row) => !videoIds.has(row.video_id));
  const daily_new_by_video = dashboard.daily_new_by_video.filter(
    (row) => !videoIds.has(row.video_id)
  );
  const total_views = rankings.reduce((sum, row) => sum + row.view_count, 0);
  const total_likes = rankings.reduce((sum, row) => sum + row.like_count, 0);
  const total_comments = rankings.reduce((sum, row) => sum + row.comment_count, 0);

  return {
    ...dashboard,
    videos,
    rankings,
    daily_new_by_video,
    kpi: {
      ...dashboard.kpi,
      video_count: videos.length,
      monitored_with_data: rankings.length,
      total_views,
      total_likes,
      total_comments,
      like_rate: total_views ? Math.round((total_likes / total_views) * 10000) / 100 : 0,
      comment_rate: total_views ? Math.round((total_comments / total_views) * 10000) / 100 : 0,
    },
  };
}

export function loadGithubPendingIds(): Set<string> {
  try {
    const raw = localStorage.getItem(GITHUB_PENDING_KEY);
    const ids = raw ? (JSON.parse(raw) as string[]) : [];
    return new Set(ids.filter(Boolean));
  } catch {
    return new Set();
  }
}

export function markGithubPendingIds(videoIds: string[]): void {
  if (!videoIds.length) return;
  const pending = loadGithubPendingIds();
  videoIds.forEach((id) => pending.add(id));
  localStorage.setItem(GITHUB_PENDING_KEY, JSON.stringify([...pending]));
}

export function clearGithubPendingIds(videoIds: string[]): void {
  if (!videoIds.length) return;
  const drop = new Set(videoIds);
  const next = [...loadGithubPendingIds()].filter((id) => !drop.has(id));
  localStorage.setItem(GITHUB_PENDING_KEY, JSON.stringify(next));
}

export function updateLocalVideoMetadata(videoId: string, patch: Partial<Video>): void {
  const videos = loadLocalVideos();
  const next = videos.map((video) =>
    video.video_id === videoId ? { ...video, ...patch } : video
  );
  if (next.some((video, index) => video !== videos[index])) {
    saveLocalVideos(next);
  }
}

export function videoSyncLabel(
  videoId: string,
  serverIds: Set<string>,
  pendingIds: Set<string>
): string | null {
  if (serverIds.has(videoId)) return null;
  if (pendingIds.has(videoId)) return "已写入 CSV，待 Actions 同步";
  return "仅本地，未同步 GitHub";
}
