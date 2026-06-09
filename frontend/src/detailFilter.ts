import { daysAgoCollect, todayCollect } from "./collectTimezone";

export interface HistoryPoint {
  time: string;
  views: number;
  likes: number;
  comments: number;
}

export function dayOf(time: string): string {
  return time?.slice(0, 10) || "";
}

export function filterHistory(
  history: HistoryPoint[],
  from: string,
  to: string
): HistoryPoint[] {
  return history.filter((h) => {
    const d = dayOf(h.time);
    if (!d) return false;
    if (from && d < from) return false;
    if (to && d > to) return false;
    return true;
  });
}

function sortByTime(history: HistoryPoint[]): HistoryPoint[] {
  return [...history].sort((a, b) => a.time.localeCompare(b.time));
}

export function isTodayOnlyFilter(from: string, to: string): boolean {
  const today = todayCollect();
  return from === today && to === today;
}

/** 起止日期 inclusive 天数；无完整区间时视为长区间 */
export function dateRangeDayCount(from: string, to: string): number {
  if (!from && !to) return Number.POSITIVE_INFINITY;
  if (!from || !to) return Number.POSITIVE_INFINITY;
  const [sy, sm, sd] = from.split("-").map(Number);
  const [ey, em, ed] = to.split("-").map(Number);
  const startUtc = Date.UTC(sy, sm - 1, sd);
  const endUtc = Date.UTC(ey, em - 1, ed);
  if (!Number.isFinite(startUtc) || !Number.isFinite(endUtc) || endUtc < startUtc) {
    return Number.POSITIVE_INFINITY;
  }
  return Math.floor((endUtc - startUtc) / 86_400_000) + 1;
}

/** 区间 < 7 天：保留同日各采集时点；≥ 7 天或「全部」：每日取最晚一条 */
export function shouldCollapseDailySnapshots(from: string, to: string): boolean {
  return dateRangeDayCount(from, to) >= 7;
}

/** 今天或起止为同一天：KPI 展示当前累计值，否则展示区间增量 */
export function isSingleDayDetailFilter(from: string, to: string): boolean {
  return dateRangeDayCount(from, to) === 1;
}

/** 播放量等为累计值：用运行最大值抹平 API 偶发回退 */
export function normalizeCumulativeHistory(history: HistoryPoint[]): HistoryPoint[] {
  let maxViews = 0;
  let maxLikes = 0;
  let maxComments = 0;
  return sortByTime(history).map((point) => {
    maxViews = Math.max(maxViews, point.views);
    maxLikes = Math.max(maxLikes, point.likes);
    maxComments = Math.max(maxComments, point.comments);
    return {
      ...point,
      views: maxViews,
      likes: maxLikes,
      comments: maxComments,
    };
  });
}

function isBetterDailySnapshot(candidate: HistoryPoint, existing: HistoryPoint): boolean {
  if (candidate.views !== existing.views) {
    return candidate.views > existing.views;
  }
  if (candidate.likes !== existing.likes) {
    return candidate.likes > existing.likes;
  }
  if (candidate.comments !== existing.comments) {
    return candidate.comments > existing.comments;
  }
  return candidate.time.localeCompare(existing.time) > 0;
}

/** 非「今天」筛选时，每个日期保留当天累计值最高的一条（同值取更晚时间） */
export function collapseDailySnapshots(history: HistoryPoint[]): HistoryPoint[] {
  const byDay = new Map<string, HistoryPoint>();
  for (const point of sortByTime(history)) {
    const d = dayOf(point.time);
    if (!d) continue;
    const existing = byDay.get(d);
    if (!existing || isBetterDailySnapshot(point, existing)) {
      byDay.set(d, point);
    }
  }
  return [...byDay.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, point]) => point);
}

export function filterHistoryForDetail(
  history: HistoryPoint[],
  from: string,
  to: string
): HistoryPoint[] {
  const ranged = normalizeCumulativeHistory(filterHistory(history, from, to));
  if (!shouldCollapseDailySnapshots(from, to)) return ranged;
  return normalizeCumulativeHistory(collapseDailySnapshots(ranged));
}

export interface HistoryDeltas {
  time: string;
  delta_views: number;
  delta_likes: number;
  delta_comments: number;
}

export function computeDeltas(history: HistoryPoint[]): HistoryDeltas[] {
  const deltas: HistoryDeltas[] = [];
  for (let i = 1; i < history.length; i++) {
    deltas.push({
      time: history[i].time,
      delta_views: Math.max(0, history[i].views - history[i - 1].views),
      delta_likes: Math.max(0, history[i].likes - history[i - 1].likes),
      delta_comments: Math.max(0, history[i].comments - history[i - 1].comments),
    });
  }
  return deltas;
}

export function rangeStats(history: HistoryPoint[]) {
  if (!history.length) return null;
  const first = history[0];
  const last = history[history.length - 1];
  return {
    view_count: last.views,
    like_count: last.likes,
    comment_count: last.comments,
    snapshot_time: last.time,
    delta_views: Math.max(0, last.views - first.views),
    delta_likes: Math.max(0, last.likes - first.likes),
    delta_comments: Math.max(0, last.comments - first.comments),
  };
}

export function availableDateRange(history: HistoryPoint[]): {
  min: string;
  max: string;
} {
  const days = history.map((h) => dayOf(h.time)).filter(Boolean).sort();
  return { min: days[0] || "", max: days[days.length - 1] || "" };
}

/** @deprecated 使用 todayCollect；保留别名以兼容旧引用 */
export function todayLocal(): string {
  return todayCollect();
}

/** @deprecated 使用 daysAgoCollect；保留别名以兼容旧引用 */
export function daysAgoLocal(n: number): string {
  return daysAgoCollect(n);
}

export type DetailDatePreset = "today" | "last7" | "last30" | "all" | "custom";

const DETAIL_SELECTED_KEY = "kol-detail-selected-id";
const DETAIL_DATE_FROM_KEY = "kol-detail-date-from";
const DETAIL_DATE_TO_KEY = "kol-detail-date-to";

export function detectDetailDatePreset(from: string, to: string): DetailDatePreset {
  if (!from && !to) return "all";
  const today = todayCollect();
  if (from === today && to === today) return "today";
  if (from === daysAgoCollect(6) && to === today) return "last7";
  if (from === daysAgoCollect(29) && to === today) return "last30";
  return "custom";
}

export function dateRangeForPreset(preset: Exclude<DetailDatePreset, "custom" | "all">): {
  from: string;
  to: string;
} {
  const today = todayCollect();
  if (preset === "today") return { from: today, to: today };
  if (preset === "last7") return { from: daysAgoCollect(6), to: today };
  return { from: daysAgoCollect(29), to: today };
}

export function loadDetailSelectedId(): string {
  try {
    return localStorage.getItem(DETAIL_SELECTED_KEY) || "";
  } catch {
    return "";
  }
}

export function saveDetailSelectedId(videoId: string): void {
  try {
    if (videoId) {
      localStorage.setItem(DETAIL_SELECTED_KEY, videoId);
    } else {
      localStorage.removeItem(DETAIL_SELECTED_KEY);
    }
  } catch {
    // ignore
  }
}

export function loadDetailDateFilter(): { from: string; to: string } {
  try {
    return {
      from: localStorage.getItem(DETAIL_DATE_FROM_KEY) || "",
      to: localStorage.getItem(DETAIL_DATE_TO_KEY) || "",
    };
  } catch {
    return { from: "", to: "" };
  }
}

export function saveDetailDateFilter(from: string, to: string): void {
  try {
    if (from) localStorage.setItem(DETAIL_DATE_FROM_KEY, from);
    else localStorage.removeItem(DETAIL_DATE_FROM_KEY);
    if (to) localStorage.setItem(DETAIL_DATE_TO_KEY, to);
    else localStorage.removeItem(DETAIL_DATE_TO_KEY);
  } catch {
    // ignore
  }
}
