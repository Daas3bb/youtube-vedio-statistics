import type { Video, VideoDetail } from "./api";
import { enumerateDays } from "./analyticsAggregate";
import {
  collapseDailySnapshots,
  dayOf,
  normalizeCumulativeHistory,
  type HistoryPoint,
} from "./detailFilter";
import { buildRawMergedHistory } from "./localSnapshots";

export type SnapshotAnomalyType =
  | "rollback"
  | "cold_start"
  | "site_spike"
  | "sparse_gap"
  | "zero_value"
  | "extreme_delta";

export const ANOMALY_LABELS: Record<SnapshotAnomalyType, string> = {
  rollback: "播放回退",
  cold_start: "冷启动",
  site_spike: "贡献异常",
  sparse_gap: "采集缺失",
  zero_value: "数值为零",
  extreme_delta: "极端增量",
};

export interface SnapshotDetailRow {
  video_id: string;
  title: string;
  thumbnail_url: string;
  day: string;
  snapshot_time: string;
  views: number;
  likes: number;
  comments: number;
  delta_views: number;
  delta_likes: number;
  delta_comments: number;
  anomalies: SnapshotAnomalyType[];
}

export interface SnapshotAnomalySummary {
  totalRows: number;
  anomalyRows: number;
  sparseGapDays: number;
  byType: Record<SnapshotAnomalyType, number>;
}

function inDateRange(day: string, from: string, to: string): boolean {
  if (!day) return false;
  if (from && day < from) return false;
  if (to && day > to) return false;
  return true;
}

function medianPositive(values: number[]): number {
  const positives = values.filter((v) => v > 0).sort((a, b) => a - b);
  if (!positives.length) return 0;
  const mid = Math.floor(positives.length / 2);
  return positives.length % 2 === 0
    ? (positives[mid - 1] + positives[mid]) / 2
    : positives[mid];
}

/** 与总体趋势一致：每日纳入播放量最高的那条快照 */
function videoDailyRepresentativeHistory(
  videoId: string,
  serverDetail: VideoDetail | null | undefined
): HistoryPoint[] {
  const raw = buildRawMergedHistory(videoId, serverDetail ?? null);
  return collapseDailySnapshots(normalizeCumulativeHistory(raw));
}

function buildVideoRows(
  video: Video,
  serverDetail: VideoDetail | null | undefined,
  from: string,
  to: string
): SnapshotDetailRow[] {
  const daily = videoDailyRepresentativeHistory(video.video_id, serverDetail);
  const rows: SnapshotDetailRow[] = [];

  for (let i = 0; i < daily.length; i++) {
    const point = daily[i];
    const day = dayOf(point.time);
    if (!inDateRange(day, from, to)) continue;

    const prev = i > 0 ? daily[i - 1] : null;
    const delta_views = prev ? point.views - prev.views : point.views;
    const delta_likes = prev ? point.likes - prev.likes : point.likes;
    const delta_comments = prev ? point.comments - prev.comments : point.comments;

    const anomalies: SnapshotAnomalyType[] = [];

    if (!prev) anomalies.push("cold_start");
    if (prev && point.views < prev.views) anomalies.push("rollback");
    if (point.views === 0 && point.likes === 0 && point.comments === 0) {
      anomalies.push("zero_value");
    }

    rows.push({
      video_id: video.video_id,
      title: video.title,
      thumbnail_url: video.thumbnail_url,
      day,
      snapshot_time: point.time,
      views: point.views,
      likes: point.likes,
      comments: point.comments,
      delta_views,
      delta_likes,
      delta_comments,
      anomalies,
    });
  }

  return rows;
}

function applyExtremeDeltaFlags(rows: SnapshotDetailRow[]): void {
  const byVideo = new Map<string, SnapshotDetailRow[]>();
  for (const row of rows) {
    const list = byVideo.get(row.video_id) ?? [];
    list.push(row);
    byVideo.set(row.video_id, list);
  }

  for (const videoRows of byVideo.values()) {
    const median = medianPositive(videoRows.map((r) => r.delta_views));
    if (median <= 0) continue;
    for (const row of videoRows) {
      if (row.delta_views > Math.max(median * 5, 10_000)) {
        if (!row.anomalies.includes("extreme_delta")) {
          row.anomalies.push("extreme_delta");
        }
      }
    }
  }
}

function applySiteSpikeFlags(rows: SnapshotDetailRow[]): void {
  const dayVideoDelta = new Map<string, Map<string, number>>();

  for (const row of rows) {
    if (row.delta_views <= 0) continue;
    const byVideo = dayVideoDelta.get(row.day) ?? new Map<string, number>();
    byVideo.set(row.video_id, (byVideo.get(row.video_id) ?? 0) + row.delta_views);
    dayVideoDelta.set(row.day, byVideo);
  }

  for (const [day, byVideo] of dayVideoDelta) {
    const total = [...byVideo.values()].reduce((sum, v) => sum + v, 0);
    if (total <= 0) continue;
    for (const [videoId, videoDelta] of byVideo) {
      if (videoDelta / total >= 0.8) {
        for (const row of rows) {
          if (row.day === day && row.video_id === videoId && row.delta_views > 0) {
            if (!row.anomalies.includes("site_spike")) {
              row.anomalies.push("site_spike");
            }
          }
        }
      }
    }
  }
}

export interface SparseGapEntry {
  video_id: string;
  title: string;
  thumbnail_url: string;
  day: string;
}

export interface AnomalyVideoSummary {
  video_id: string;
  title: string;
  thumbnail_url: string;
  rowCount: number;
  days: string[];
}

export function buildSparseGapEntries(
  videos: Video[],
  serverDetails: Record<string, VideoDetail | null | undefined>,
  from: string,
  to: string
): SparseGapEntry[] {
  const days = enumerateDays(from, to);
  if (!days.length) return [];

  const entries: SparseGapEntry[] = [];
  for (const video of videos) {
    const daily = videoDailyRepresentativeHistory(video.video_id, serverDetails[video.video_id]);
    if (!daily.length) continue;

    const snapshotDays = new Set(daily.map((p) => dayOf(p.time)).filter(Boolean));
    const firstDay = dayOf(daily[0].time);
    if (!firstDay) continue;

    for (const day of days) {
      if (day < firstDay) continue;
      if (!snapshotDays.has(day)) {
        entries.push({
          video_id: video.video_id,
          title: video.title,
          thumbnail_url: video.thumbnail_url,
          day,
        });
      }
    }
  }

  return entries.sort(
    (a, b) => a.day.localeCompare(b.day) || a.title.localeCompare(b.title, "zh-CN")
  );
}

function countSparseGapDays(
  videos: Video[],
  serverDetails: Record<string, VideoDetail | null | undefined>,
  from: string,
  to: string
): number {
  return buildSparseGapEntries(videos, serverDetails, from, to).length;
}

export function groupAnomalyRowsByVideo(
  rows: SnapshotDetailRow[],
  type?: SnapshotAnomalyType
): AnomalyVideoSummary[] {
  const matched = type
    ? rows.filter((row) => row.anomalies.includes(type))
    : rows.filter((row) => row.anomalies.length > 0);

  const byVideo = new Map<string, AnomalyVideoSummary>();
  for (const row of matched) {
    const existing = byVideo.get(row.video_id);
    if (!existing) {
      byVideo.set(row.video_id, {
        video_id: row.video_id,
        title: row.title,
        thumbnail_url: row.thumbnail_url,
        rowCount: 1,
        days: [row.day],
      });
      continue;
    }
    existing.rowCount += 1;
    if (!existing.days.includes(row.day)) existing.days.push(row.day);
  }

  return [...byVideo.values()]
    .map((item) => ({ ...item, days: [...item.days].sort() }))
    .sort((a, b) => a.title.localeCompare(b.title, "zh-CN"));
}

export function groupSparseGapsByVideo(entries: SparseGapEntry[]): AnomalyVideoSummary[] {
  const byVideo = new Map<string, AnomalyVideoSummary>();
  for (const entry of entries) {
    const existing = byVideo.get(entry.video_id);
    if (!existing) {
      byVideo.set(entry.video_id, {
        video_id: entry.video_id,
        title: entry.title,
        thumbnail_url: entry.thumbnail_url,
        rowCount: 1,
        days: [entry.day],
      });
      continue;
    }
    existing.rowCount += 1;
    if (!existing.days.includes(entry.day)) existing.days.push(entry.day);
  }

  return [...byVideo.values()]
    .map((item) => ({ ...item, days: [...item.days].sort() }))
    .sort((a, b) => a.title.localeCompare(b.title, "zh-CN"));
}

export function buildSnapshotDetailRows(
  videos: Video[],
  serverDetails: Record<string, VideoDetail | null | undefined>,
  from: string,
  to: string
): SnapshotDetailRow[] {
  const rows = videos.flatMap((video) =>
    buildVideoRows(video, serverDetails[video.video_id], from, to)
  );

  applyExtremeDeltaFlags(rows);
  applySiteSpikeFlags(rows);

  return rows.sort((a, b) => b.snapshot_time.localeCompare(a.snapshot_time));
}

export function summarizeSnapshotAnomalies(
  rows: SnapshotDetailRow[],
  sparseGapDays: number
): SnapshotAnomalySummary {
  const byType: Record<SnapshotAnomalyType, number> = {
    rollback: 0,
    cold_start: 0,
    site_spike: 0,
    sparse_gap: 0,
    zero_value: 0,
    extreme_delta: 0,
  };

  let anomalyRows = 0;
  for (const row of rows) {
    if (row.anomalies.length) {
      anomalyRows += 1;
      for (const type of row.anomalies) {
        byType[type] += 1;
      }
    }
  }

  byType.sparse_gap = sparseGapDays;

  return {
    totalRows: rows.length,
    anomalyRows,
    sparseGapDays,
    byType,
  };
}

export function buildSnapshotAnomalySummary(
  videos: Video[],
  serverDetails: Record<string, VideoDetail | null | undefined>,
  from: string,
  to: string
): SnapshotAnomalySummary {
  const rows = buildSnapshotDetailRows(videos, serverDetails, from, to);
  const sparseGapDays = countSparseGapDays(videos, serverDetails, from, to);
  return summarizeSnapshotAnomalies(rows, sparseGapDays);
}

export function exportSnapshotRowsCsv(rows: SnapshotDetailRow[]): string {
  const header = [
    "视频",
    "视频ID",
    "日期",
    "采集时间",
    "播放量",
    "点赞量",
    "评论量",
    "增量播放",
    "增量点赞",
    "增量评论",
    "异常",
  ];
  const lines = rows.map((row) => [
    `"${row.title.replace(/"/g, '""')}"`,
    row.video_id,
    row.day,
    row.snapshot_time,
    row.views,
    row.likes,
    row.comments,
    row.delta_views,
    row.delta_likes,
    row.delta_comments,
    `"${row.anomalies.map((t) => ANOMALY_LABELS[t]).join("、")}"`,
  ]);
  return [header.join(","), ...lines.map((line) => line.join(","))].join("\n");
}
