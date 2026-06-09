import type { StaticSiteData, VideoDetail } from "./api";
import { generatedAtNow } from "./collectTimezone";
import { computeDeltas } from "./detailFilter";
import {
  formatGithubSyncError,
  isGithubSyncReady,
  loadGithubSettings,
  updateGithubJsonFile,
  type GithubSyncSettings,
} from "./githubCsvSync";
import { buildVideoUrl } from "./localVideos";
import type { YoutubeVideoStats } from "./youtubeCollect";

const STORE_PATH = "data/store.json";
const SITE_PATH = "frontend/public/data/site.json";

export interface SnapshotPersistInput {
  video_id: string;
  snapshot_time: string;
  view_count: number;
  like_count: number;
  comment_count: number;
  title?: string;
  channel_title?: string;
  thumbnail_url?: string;
  publish_time?: string;
  video_url?: string;
}

export function snapshotBucket(time: string): string {
  return `${time.slice(0, 10)} ${time.slice(11, 13)}:00:00`;
}

export function statsToSnapshotInput(
  stats: YoutubeVideoStats,
  snapshotTime: string
): SnapshotPersistInput {
  return {
    video_id: stats.video_id,
    snapshot_time: snapshotTime,
    view_count: stats.view_count,
    like_count: stats.like_count,
    comment_count: stats.comment_count,
    title: stats.title,
    channel_title: stats.channel_title,
    thumbnail_url: stats.thumbnail_url,
    publish_time: stats.publish_time,
    video_url: buildVideoUrl(stats.video_id),
  };
}

function storeHistoryRow(input: SnapshotPersistInput, createdAt: string) {
  return {
    video_id: input.video_id,
    snapshot_time: input.snapshot_time,
    snapshot_bucket: snapshotBucket(input.snapshot_time),
    view_count: String(input.view_count),
    like_count: String(input.like_count),
    comment_count: String(input.comment_count),
    created_at: createdAt,
  };
}

function appendHistoryPoint(
  detail: VideoDetail,
  input: SnapshotPersistInput
): VideoDetail {
  const point = {
    time: input.snapshot_time,
    views: input.view_count,
    likes: input.like_count,
    comments: input.comment_count,
  };
  const history = [...detail.history];
  if (!history.some((row) => row.time === point.time)) {
    history.push(point);
    history.sort((a, b) => a.time.localeCompare(b.time));
  }
  const latest = history[history.length - 1];
  return {
    ...detail,
    video: {
      ...detail.video,
      title: input.title || detail.video.title,
      channel_title: input.channel_title || detail.video.channel_title,
      thumbnail_url: input.thumbnail_url || detail.video.thumbnail_url,
      publish_time: input.publish_time || detail.video.publish_time,
      status: detail.video.status === "pending" ? "active" : detail.video.status,
    },
    latest: {
      view_count: latest.views,
      like_count: latest.likes,
      comment_count: latest.comments,
      snapshot_time: latest.time,
    },
    history,
    view_deltas: computeDeltas(history).map((row) => ({
      time: row.time,
      delta_views: row.delta_views,
    })),
  };
}

function patchSiteWithSnapshots(
  site: StaticSiteData,
  snapshots: SnapshotPersistInput[]
): StaticSiteData {
  const next: StaticSiteData = {
    ...site,
    generated_at: generatedAtNow(),
    dashboard: {
      ...site.dashboard,
      rankings: [...site.dashboard.rankings],
      videos: [...site.dashboard.videos],
    },
    details: { ...site.details },
  };

  for (const input of snapshots) {
    const existingDetail = next.details[input.video_id];
    const videoMeta =
      existingDetail?.video ??
      next.dashboard.videos.find((video) => video.video_id === input.video_id) ?? {
        video_id: input.video_id,
        title: input.title || input.video_id,
        video_url: input.video_url || buildVideoUrl(input.video_id),
        thumbnail_url: input.thumbnail_url || "",
        publish_time: input.publish_time || "",
        channel_title: input.channel_title || "",
        status: "active",
        created_at: input.snapshot_time,
      };

    const baseDetail: VideoDetail = existingDetail ?? {
      video: videoMeta,
      history: [],
      view_deltas: [],
    };
    next.details[input.video_id] = appendHistoryPoint(baseDetail, input);

    const rankingIndex = next.dashboard.rankings.findIndex(
      (row) => row.video_id === input.video_id
    );
    const rankingRow = {
      video_id: input.video_id,
      title: input.title || videoMeta.title || input.video_id,
      thumbnail_url: input.thumbnail_url || videoMeta.thumbnail_url || "",
      channel_title: input.channel_title || videoMeta.channel_title || "",
      view_count: input.view_count,
      like_count: input.like_count,
      comment_count: input.comment_count,
      snapshot_time: input.snapshot_time,
    };
    if (rankingIndex >= 0) {
      next.dashboard.rankings[rankingIndex] = rankingRow;
    } else {
      next.dashboard.rankings.push(rankingRow);
    }
    next.dashboard.rankings.sort((a, b) => b.view_count - a.view_count);
    next.dashboard.rankings = next.dashboard.rankings.slice(0, 20);
  }

  return next;
}

export async function persistSnapshotsToGithub(
  snapshots: SnapshotPersistInput[],
  settings: GithubSyncSettings = loadGithubSettings()
): Promise<{ ok: true; written: number } | { ok: false; reason: string }> {
  if (!snapshots.length) return { ok: false, reason: "empty" };
  if (!isGithubSyncReady(settings)) return { ok: false, reason: "no_token" };

  const createdAt = generatedAtNow().replace("T", " ");
  let written = 0;

  const storeResult = await updateGithubJsonFile<{
    videos: Array<Record<string, string>>;
    history: Array<Record<string, string>>;
  }>(
    STORE_PATH,
    (store) => {
      const videos = [...(store.videos ?? [])];
      const history = [...(store.history ?? [])];
      let changed = false;

      for (const input of snapshots) {
        const videoIndex = videos.findIndex((row) => row.video_id === input.video_id);
        const videoPatch = {
          video_id: input.video_id,
          title: input.title || "",
          video_url: input.video_url || buildVideoUrl(input.video_id),
          thumbnail_url: input.thumbnail_url || "",
          publish_time: input.publish_time || "",
          channel_title: input.channel_title || "",
          status: "active",
        };
        if (videoIndex >= 0) {
          const merged = { ...videos[videoIndex], ...videoPatch };
          if (JSON.stringify(merged) !== JSON.stringify(videos[videoIndex])) {
            videos[videoIndex] = merged;
            changed = true;
          }
        } else {
          videos.push({ ...videoPatch, created_at: createdAt });
          changed = true;
        }

        const exists = history.some(
          (row) =>
            row.video_id === input.video_id && row.snapshot_time === input.snapshot_time
        );
        if (!exists) {
          history.push(storeHistoryRow(input, createdAt));
          written += 1;
          changed = true;
        }
      }

      if (!changed) return null;
      return { videos, history };
    },
    `feat: persist ${snapshots.length} dashboard snapshot(s)`,
    settings
  );
  if (!storeResult.ok) return storeResult;

  const siteResult = await updateGithubJsonFile<StaticSiteData>(
    SITE_PATH,
    (site) => patchSiteWithSnapshots(site, snapshots),
    `feat: update site.json with ${snapshots.length} dashboard snapshot(s)`,
    settings
  );
  if (!siteResult.ok) return siteResult;

  return { ok: true, written: written || snapshots.length };
}

export async function persistSnapshotsToLocal(
  snapshots: SnapshotPersistInput[]
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!import.meta.env.DEV) {
    return { ok: false, error: "仅本地 npm run dev 环境可用" };
  }
  if (!snapshots.length) {
    return { ok: false, error: "无快照可写入" };
  }

  try {
    const res = await fetch("/api/persist-snapshots", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ snapshots }),
    });
    const data = (await res.json()) as { ok?: boolean; error?: string };
    if (!res.ok || !data.ok) {
      return { ok: false, error: data.error || `HTTP ${res.status}` };
    }
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "请求失败",
    };
  }
}

export async function persistCollectedSnapshots(
  snapshots: SnapshotPersistInput[],
  options?: {
    githubSyncReady?: boolean;
    onProgress?: (message: string) => void;
  }
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (import.meta.env.DEV) {
    options?.onProgress?.("正在写入云端...");
    const result = await persistSnapshotsToLocal(snapshots);
    if (result.ok) return { ok: true };
    return { ok: false, error: result.error };
  }

  if (options?.githubSyncReady) {
    options?.onProgress?.("正在写入云端...");
    const result = await persistSnapshotsToGithub(snapshots);
    if (result.ok) return { ok: true };
    return { ok: false, error: formatGithubSyncError(result.reason) };
  }

  return { ok: false, error: "未配置数据文件写入方式" };
}
