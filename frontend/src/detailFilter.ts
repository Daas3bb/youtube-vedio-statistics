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
  const today = todayLocal();
  return from === today && to === today;
}

/** 非「今天」筛选时，每个日期只保留当天最后一条快照 */
export function collapseDailySnapshots(history: HistoryPoint[]): HistoryPoint[] {
  const byDay = new Map<string, HistoryPoint>();
  for (const point of sortByTime(history)) {
    const d = dayOf(point.time);
    if (!d) continue;
    const existing = byDay.get(d);
    if (!existing || point.time.localeCompare(existing.time) > 0) {
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
  const ranged = sortByTime(filterHistory(history, from, to));
  if (isTodayOnlyFilter(from, to)) return ranged;
  return collapseDailySnapshots(ranged);
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

export function todayLocal(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function daysAgoLocal(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
