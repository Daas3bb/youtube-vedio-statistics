import type { Video, VideoDetail } from "./api";
import { buildMergedDetail } from "./localSnapshots";
import {
  collapseDailySnapshots,
  dayOf,
  normalizeCumulativeHistory,
  type HistoryPoint,
} from "./detailFilter";

export interface DailyTotalPoint {
  day: string;
  views: number;
  likes: number;
  comments: number;
  /** 截至当日有快照（含向前填充）的监测视频数 */
  contributing_videos: number;
  /** 当日为首次代表快照日的视频数 */
  first_snapshot_videos: number;
}

export interface DailyIncrementalPoint {
  day: string;
  delta_views: number;
  delta_likes: number;
  delta_comments: number;
  /** 当日有代表快照的视频数 */
  snapshot_videos: number;
  /** 当日有有效增量（已监测 ≥2 天）的视频数 */
  contributing_videos: number;
}

interface VideoDayIncrement {
  delta_views: number;
  delta_likes: number;
  delta_comments: number;
  is_established: boolean;
}

function parseDay(day: string): number {
  const [y, m, d] = day.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

function formatDay(utcMs: number): string {
  const d = new Date(utcMs);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function enumerateDays(from: string, to: string): string[] {
  if (!from || !to) return [];
  const start = parseDay(from);
  const end = parseDay(to);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return [];
  const days: string[] = [];
  for (let t = start; t <= end; t += 86_400_000) {
    days.push(formatDay(t));
  }
  return days;
}

export function dayBefore(day: string): string {
  return formatDay(parseDay(day) - 86_400_000);
}

function videoToDailyMap(history: HistoryPoint[]): Map<string, HistoryPoint> {
  const daily = collapseDailySnapshots(normalizeCumulativeHistory(history));
  const map = new Map<string, HistoryPoint>();
  for (const point of daily) {
    const d = dayOf(point.time);
    if (d) map.set(d, point);
  }
  return map;
}

function carryForwardPoint(map: Map<string, HistoryPoint>, day: string): HistoryPoint | null {
  let bestDay = "";
  let best: HistoryPoint | null = null;
  for (const [d, point] of map) {
    if (d <= day && d > bestDay) {
      bestDay = d;
      best = point;
    }
  }
  return best;
}

function buildMergedDetails(
  videos: Video[],
  serverDetails: Record<string, VideoDetail | null | undefined>
): VideoDetail[] {
  return videos.map((video) =>
    buildMergedDetail(video.video_id, serverDetails[video.video_id] ?? null, video)
  );
}

export function aggregateCumulativeTrend(
  videos: Video[],
  serverDetails: Record<string, VideoDetail | null | undefined>,
  from: string,
  to: string
): DailyTotalPoint[] {
  const days = enumerateDays(from, to);
  if (!days.length) return [];

  const videoMaps = buildMergedDetails(videos, serverDetails).map((detail) =>
    videoToDailyMap(detail.history)
  );
  const firstSnapshotDays = videoMaps.map((map) => {
    const daysWithData = [...map.keys()].sort();
    return daysWithData[0] ?? "";
  });

  return days.map((day) => {
    let views = 0;
    let likes = 0;
    let comments = 0;
    let contributing_videos = 0;
    let first_snapshot_videos = 0;

    for (let i = 0; i < videoMaps.length; i++) {
      const map = videoMaps[i];
      const point = carryForwardPoint(map, day);
      if (point) {
        contributing_videos += 1;
        views += point.views;
        likes += point.likes;
        comments += point.comments;
      }
      if (firstSnapshotDays[i] === day) {
        first_snapshot_videos += 1;
      }
    }

    return {
      day,
      views,
      likes,
      comments,
      contributing_videos,
      first_snapshot_videos,
    };
  });
}

/** 每个自然日取代表快照后，计算该视频相对上一条代表快照的增量 */
function videoDailyIncrements(
  history: HistoryPoint[],
  from: string,
  to: string
): Map<string, VideoDayIncrement> {
  const daily = collapseDailySnapshots(normalizeCumulativeHistory(history));
  const increments = new Map<string, VideoDayIncrement>();

  for (let i = 0; i < daily.length; i++) {
    const point = daily[i];
    const day = dayOf(point.time);
    if (!day || day < from || day > to) continue;

    const prev = i > 0 ? daily[i - 1] : null;
    const is_established = Boolean(prev);
    // 首次代表快照仅建立基线，不计入增量（避免批量首次采集日虚高）
    increments.set(day, {
      delta_views: is_established ? point.views - prev!.views : 0,
      delta_likes: is_established ? point.likes - prev!.likes : 0,
      delta_comments: is_established ? point.comments - prev!.comments : 0,
      is_established,
    });
  }

  return increments;
}

export function aggregateIncrementalTrend(
  videos: Video[],
  serverDetails: Record<string, VideoDetail | null | undefined>,
  from: string,
  to: string
): DailyIncrementalPoint[] {
  const days = enumerateDays(from, to);
  if (!days.length) return [];

  const totals = new Map<string, DailyIncrementalPoint>(
    days.map((day) => [
      day,
      {
        day,
        delta_views: 0,
        delta_likes: 0,
        delta_comments: 0,
        snapshot_videos: 0,
        contributing_videos: 0,
      },
    ])
  );

  for (const detail of buildMergedDetails(videos, serverDetails)) {
    for (const [day, delta] of videoDailyIncrements(detail.history, from, to)) {
      const row = totals.get(day);
      if (!row) continue;

      row.snapshot_videos += 1;
      if (delta.is_established) {
        row.contributing_videos += 1;
      }

      row.delta_views += delta.delta_views;
      row.delta_likes += delta.delta_likes;
      row.delta_comments += delta.delta_comments;
    }
  }

  return days.map((day) => totals.get(day)!);
}

export function cumulativeKpi(points: DailyTotalPoint[]) {
  if (!points.length) return null;
  const last = points[points.length - 1];
  return {
    views: last.views,
    likes: last.likes,
    comments: last.comments,
  };
}

export function summarizeCumulativeContributors(points: DailyTotalPoint[]) {
  if (!points.length) return null;

  const contributing = points.map((p) => p.contributing_videos);
  return {
    min: Math.min(...contributing),
    max: Math.max(...contributing),
    coldStartDays: points.filter((p) => p.first_snapshot_videos > 0),
    dateFrom: points[0].day,
    dateTo: points[points.length - 1].day,
  };
}

export function summarizeIncrementalContributors(points: DailyIncrementalPoint[]) {
  if (!points.length) return null;

  const contributing = points.map((p) => p.contributing_videos);
  return {
    min: Math.min(...contributing),
    max: Math.max(...contributing),
    coldStartDays: points.filter((p) => p.snapshot_videos > p.contributing_videos),
  };
}

export function incrementalKpi(points: DailyIncrementalPoint[]) {
  return {
    views: points.reduce((sum, p) => sum + p.delta_views, 0),
    likes: points.reduce((sum, p) => sum + p.delta_likes, 0),
    comments: points.reduce((sum, p) => sum + p.delta_comments, 0),
  };
}

export function availableAnalyticsDateRange(
  videos: Video[],
  serverDetails: Record<string, VideoDetail | null | undefined>
): { min: string; max: string } {
  const days: string[] = [];
  for (const detail of buildMergedDetails(videos, serverDetails)) {
    for (const point of detail.history) {
      const d = dayOf(point.time);
      if (d) days.push(d);
    }
  }
  days.sort();
  return { min: days[0] || "", max: days[days.length - 1] || "" };
}
