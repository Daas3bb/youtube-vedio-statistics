/** 与 Python scripts/config.py 一致：采集与看板日期筛选使用 UTC+8 */
export const COLLECT_TIMEZONE = "Asia/Shanghai";

export function formatCollectDate(date = new Date()): string {
  return date.toLocaleDateString("en-CA", { timeZone: COLLECT_TIMEZONE });
}

export function formatCollectDateTime(date = new Date()): string {
  return date.toLocaleString("sv-SE", { timeZone: COLLECT_TIMEZONE });
}

export function snapshotTimeNow(date = new Date()): string {
  return formatCollectDateTime(date);
}

export function todayCollect(): string {
  return formatCollectDate();
}

export function daysAgoCollect(n: number): string {
  return formatCollectDate(new Date(Date.now() - n * 86_400_000));
}

export function generatedAtNow(): string {
  return formatCollectDateTime().replace(" ", "T");
}
