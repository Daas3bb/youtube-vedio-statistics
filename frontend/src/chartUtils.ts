import type { CallbackDataParams } from "echarts/types/dist/shared";

export type AnalyticsMetricKind = "views" | "likes" | "comments";

export function formatNum(n: number) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(3) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(3) + "K";
  return n.toFixed(3);
}

export function formatDeltaNum(n: number) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "K";
  return n.toFixed(1);
}

/** 分析看板：完整整数 + 千分位（原始值） */
export function formatAnalyticsFull(n: number): string {
  return Math.round(n).toLocaleString("zh-CN");
}

/** 分析看板：大额 K/M 缩写，保留 3 位小数 */
export function formatAnalyticsCompact(n: number): string {
  const v = Math.round(n);
  if (v >= 1_000_000) return (v / 1_000_000).toFixed(3) + "M";
  if (v >= 1_000) return (v / 1_000).toFixed(3) + "K";
  return String(v);
}

export function canToggleAnalyticsValue(n: number): boolean {
  return Math.round(n) >= 1_000;
}

export function trendAxisBounds(values: number[]) {
  if (!values.length) return {};
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || Math.max(max * 0.01, 1);
  const pad = range * 0.08;
  return {
    min: Math.max(0, min - pad),
    max: max + pad,
  };
}

export type AnalyticsAxisKind = "cumulative" | "incremental";

export interface AnalyticsAxisBounds {
  min?: number;
  max?: number;
  useScale: boolean;
}

/** 所选区间内是否无任何有效监测数据（全为 0） */
export function hasNoAnalyticsData(values: number[]): boolean {
  return !values.length || values.every((v) => v === 0);
}

/**
 * 增量趋势 Y 轴用值：排除首日冷启动等极端尖峰，避免拉高坐标轴。
 * 图表仍展示完整序列，仅缩放计算使用过滤后的值。
 */
function incrementalAxisScaleValues(values: number[]): number[] {
  if (values.length <= 1) return values;

  const [first, ...rest] = values;
  const restPeak = Math.max(0, ...rest);

  // 首日刚采集：无前日基线，增量≈累计总量，通常远高于后续日增量
  if (first > 0 && (restPeak === 0 || first >= restPeak * 2)) {
    const meaningful = rest.filter((v) => v > 0);
    return meaningful.length ? meaningful : rest;
  }

  // 其他单日极端尖峰（> 次高值 3 倍）
  const sorted = [...values].sort((a, b) => b - a);
  if (sorted.length >= 2 && sorted[0] > Math.max(sorted[1] * 3, 1)) {
    let removed = false;
    const trimmed = values.filter((v) => {
      if (!removed && v === sorted[0]) {
        removed = true;
        return false;
      }
      return true;
    });
    return trimmed.length ? trimmed : values;
  }

  return values;
}

/** 按数据量级计算 Y 轴动态最小跨度 */
function analyticsDynamicMinSpan(values: number[], kind: AnalyticsAxisKind): number {
  const peak = values.length ? Math.max(0, ...values) : 0;

  if (peak === 0) {
    return kind === "incremental" ? 10 : 50;
  }
  if (peak >= 1_000_000) return Math.max(2_000, peak * 0.0004);
  if (peak >= 100_000) return Math.max(500, peak * 0.001);
  if (peak >= 10_000) return Math.max(50, peak * 0.005);
  if (peak >= 1_000) return Math.max(10, peak * 0.02);
  return Math.max(2, peak * 0.15);
}

/**
 * 总体趋势看板 Y 轴：动态最小跨度，无数据时收紧范围，有数据时保证微小波动可见。
 */
export function analyticsTrendAxisBounds(
  values: number[],
  kind: AnalyticsAxisKind
): AnalyticsAxisBounds {
  if (!values.length) return { useScale: false };

  const scaleValues =
    kind === "incremental" ? incrementalAxisScaleValues(values) : values;

  if (!scaleValues.length || hasNoAnalyticsData(scaleValues)) {
    return { min: 0, max: analyticsDynamicMinSpan(scaleValues, kind), useScale: false };
  }

  const min = Math.min(...scaleValues);
  const max = Math.max(...scaleValues);

  const dataRange = max - min;
  const minSpan = analyticsDynamicMinSpan(scaleValues, kind);
  const effectiveRange = Math.max(dataRange, minSpan);
  const center = (min + max) / 2;
  const pad = effectiveRange * 0.1;

  const axisMax = center + effectiveRange / 2 + pad;
  let axisMin = center - effectiveRange / 2 - pad;

  if (kind === "cumulative") {
    axisMin = Math.max(0, axisMin);
    return { min: axisMin, max: axisMax, useScale: dataRange > 0 };
  }

  return { min: Math.max(0, axisMin), max: axisMax, useScale: false };
}

export const CHART_GRID = {
  left: 24,
  right: 24,
  top: 52,
  bottom: 56,
  containLabel: true,
};

export const CHART_FONT_SIZE = 14;

export function axisTooltipFormatter(
  params: CallbackDataParams | CallbackDataParams[],
  useDeltaFormat = false
) {
  const items = Array.isArray(params) ? params : [params];
  const time = String(items[0]?.name ?? "");
  let html = `时间：${time}<br/>`;
  for (const p of items) {
    const fmt = useDeltaFormat ? formatDeltaNum : formatNum;
    html += `${p.marker}${String(p.seriesName ?? "")}：${fmt(Number(p.value))}<br/>`;
  }
  return html;
}

export function analyticsTooltipFormatter(
  params: CallbackDataParams | CallbackDataParams[],
  _metric?: AnalyticsMetricKind,
  _useDeltaFormat = false
) {
  const items = Array.isArray(params) ? params : [params];
  const time = String(items[0]?.name ?? "");
  let html = `时间：${time}<br/>`;
  for (const p of items) {
    const value = Number(p.value);
    html += `${p.marker}${String(p.seriesName ?? "")}：${formatAnalyticsFull(value)}<br/>`;
  }
  return html;
}

export function formatDayLabel(day: string): string {
  return day.length >= 10 ? day.slice(5) : day;
}
