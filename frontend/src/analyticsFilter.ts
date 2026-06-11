import { daysAgoCollect, todayCollect } from "./collectTimezone";

export type AnalyticsDatePreset = "last7" | "last30" | "last90" | "custom";

const ANALYTICS_DATE_FROM_KEY = "kol-analytics-date-from";
const ANALYTICS_DATE_TO_KEY = "kol-analytics-date-to";

export function dateRangeForAnalyticsPreset(
  preset: Exclude<AnalyticsDatePreset, "custom">
): { from: string; to: string } {
  const today = todayCollect();
  if (preset === "last7") return { from: daysAgoCollect(6), to: today };
  if (preset === "last30") return { from: daysAgoCollect(29), to: today };
  return { from: daysAgoCollect(89), to: today };
}

export function defaultAnalyticsDateRange(): { from: string; to: string } {
  return dateRangeForAnalyticsPreset("last30");
}

export function detectAnalyticsDatePreset(from: string, to: string): AnalyticsDatePreset {
  if (from === daysAgoCollect(6) && to === todayCollect()) return "last7";
  if (from === daysAgoCollect(29) && to === todayCollect()) return "last30";
  if (from === daysAgoCollect(89) && to === todayCollect()) return "last90";
  return "custom";
}

export function loadAnalyticsDateFilter(): { from: string; to: string } {
  try {
    const from = localStorage.getItem(ANALYTICS_DATE_FROM_KEY) || "";
    const to = localStorage.getItem(ANALYTICS_DATE_TO_KEY) || "";
    if (from && to) return { from, to };
  } catch {
    // ignore
  }
  return defaultAnalyticsDateRange();
}

export function saveAnalyticsDateFilter(from: string, to: string): void {
  try {
    if (from) localStorage.setItem(ANALYTICS_DATE_FROM_KEY, from);
    else localStorage.removeItem(ANALYTICS_DATE_FROM_KEY);
    if (to) localStorage.setItem(ANALYTICS_DATE_TO_KEY, to);
    else localStorage.removeItem(ANALYTICS_DATE_TO_KEY);
  } catch {
    // ignore
  }
}
