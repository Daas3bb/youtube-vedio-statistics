import type { VideoDetail } from "./api";
import { snapshotTimeNow } from "./collectTimezone";
import type { HistoryPoint } from "./detailFilter";
import { computeDeltas, normalizeCumulativeHistory } from "./detailFilter";
import type { YoutubeVideoStats } from "./youtubeCollect";

export { snapshotTimeNow } from "./collectTimezone";

const LS_KEY = "kol-local-snapshots";

export interface LocalSnapshot {
  video_id: string;
  snapshot_time: string;
  view_count: number;
  like_count: number;
  comment_count: number;
}

function loadAll(): LocalSnapshot[] {
  try {
    const raw = localStorage.getItem(LS_KEY);
    return raw ? (JSON.parse(raw) as LocalSnapshot[]) : [];
  } catch {
    return [];
  }
}

function saveAll(rows: LocalSnapshot[]): void {
  localStorage.setItem(LS_KEY, JSON.stringify(rows));
}

export function appendLocalSnapshot(stats: YoutubeVideoStats): LocalSnapshot {
  const snap: LocalSnapshot = {
    video_id: stats.video_id,
    snapshot_time: snapshotTimeNow(),
    view_count: stats.view_count,
    like_count: stats.like_count,
    comment_count: stats.comment_count,
  };

  const rows = loadAll().filter(
    (row) => !(row.video_id === snap.video_id && row.snapshot_time === snap.snapshot_time)
  );
  rows.push(snap);
  rows.sort((a, b) => a.snapshot_time.localeCompare(b.snapshot_time));
  saveAll(rows);
  return snap;
}

export function getLocalSnapshots(videoId: string): LocalSnapshot[] {
  return loadAll()
    .filter((row) => row.video_id === videoId)
    .sort((a, b) => a.snapshot_time.localeCompare(b.snapshot_time));
}

export function removeLocalSnapshotsByVideoIds(videoIds: string[]): void {
  if (!videoIds.length) return;
  const drop = new Set(videoIds);
  const next = loadAll().filter((row) => !drop.has(row.video_id));
  saveAll(next);
}

function toHistoryPoints(rows: LocalSnapshot[]): HistoryPoint[] {
  return rows.map((row) => ({
    time: row.snapshot_time,
    views: row.view_count,
    likes: row.like_count,
    comments: row.comment_count,
  }));
}

function mergeHistory(server: HistoryPoint[], local: HistoryPoint[]): HistoryPoint[] {
  const map = new Map<string, HistoryPoint>();
  for (const point of server) map.set(point.time, point);
  for (const point of local) map.set(point.time, point);
  return [...map.values()].sort((a, b) => a.time.localeCompare(b.time));
}

export function buildMergedDetail(
  videoId: string,
  serverDetail: VideoDetail | null,
  videoMeta: VideoDetail["video"],
  stats?: YoutubeVideoStats
): VideoDetail {
  const video = {
    ...videoMeta,
    ...(stats
      ? {
          title: stats.title || videoMeta.title,
          channel_title: stats.channel_title || videoMeta.channel_title,
          thumbnail_url: stats.thumbnail_url || videoMeta.thumbnail_url,
          publish_time: stats.publish_time || videoMeta.publish_time,
          status: videoMeta.status === "pending" ? "active" : videoMeta.status,
        }
      : {}),
  };

  const serverHistory = serverDetail?.history ?? [];
  const localHistory = toHistoryPoints(getLocalSnapshots(videoId));
  const history = normalizeCumulativeHistory(mergeHistory(serverHistory, localHistory));
  const latestPoint = history[history.length - 1];

  return {
    video,
    latest: latestPoint
      ? {
          view_count: latestPoint.views,
          like_count: latestPoint.likes,
          comment_count: latestPoint.comments,
          snapshot_time: latestPoint.time,
        }
      : serverDetail?.latest,
    history,
    view_deltas: computeDeltas(history),
  };
}
