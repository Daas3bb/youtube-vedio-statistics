import { lazy, Suspense, type CSSProperties } from "react";
import type { EChartsOption } from "echarts";

type ChartOption = EChartsOption | Record<string, unknown>;

const ReactECharts = lazy(() => import("echarts-for-react"));

interface LazyChartProps {
  option: ChartOption;
  style?: CSSProperties;
}

export function LazyChart({ option, style }: LazyChartProps) {
  return (
    <Suspense fallback={<p className="empty">图表加载中…</p>}>
      <ReactECharts option={option} style={style} notMerge lazyUpdate />
    </Suspense>
  );
}
