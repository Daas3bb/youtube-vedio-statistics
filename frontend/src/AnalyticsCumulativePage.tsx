import { useMemo, useState } from "react";
import type { Video, VideoDetail } from "./api";
import {
  aggregateCumulativeTrend,
  cumulativeKpi,
} from "./analyticsAggregate";
import { LazyChart } from "./LazyChart";
import { AnalyticsKpiValue } from "./AnalyticsKpiValue";
import {
  analyticsTooltipFormatter,
  analyticsTrendAxisBounds,
  CHART_FONT_SIZE,
  CHART_GRID,
  formatAnalyticsCompact,
  formatAnalyticsFull,
  formatDayLabel,
} from "./chartUtils";
import { readChartCssColors, type Theme } from "./theme";

type MetricMode = "views" | "likes" | "comments";

const METRIC_CONFIG: Record<
  MetricMode,
  { seriesName: string; color: string; area: string }
> = {
  views: {
    seriesName: "播放量",
    color: "#ff4444",
    area: "rgba(255, 68, 68, 0.1)",
  },
  likes: {
    seriesName: "点赞量",
    color: "#3b82f6",
    area: "rgba(59, 130, 246, 0.1)",
  },
  comments: {
    seriesName: "评论量",
    color: "#f59e0b",
    area: "rgba(245, 158, 11, 0.1)",
  },
};

interface CumulativeTrendSectionProps {
  videos: Video[];
  serverDetails: Record<string, VideoDetail | null | undefined>;
  dateFrom: string;
  dateTo: string;
  theme: Theme;
  hasAnyData: boolean;
  showHeader?: boolean;
}

export function CumulativeTrendSection({
  videos,
  serverDetails,
  dateFrom,
  dateTo,
  theme,
  hasAnyData,
  showHeader = true,
}: CumulativeTrendSectionProps) {
  const [metricMode, setMetricMode] = useState<MetricMode>("views");

  const trendPoints = useMemo(
    () => aggregateCumulativeTrend(videos, serverDetails, dateFrom, dateTo),
    [videos, serverDetails, dateFrom, dateTo]
  );

  const kpi = useMemo(() => cumulativeKpi(trendPoints), [trendPoints]);

  const chartOption = useMemo(() => {
    if (!trendPoints.length) return {};
    const chartColors = readChartCssColors();
    const config = METRIC_CONFIG[metricMode];
    const values = trendPoints.map((p) =>
      metricMode === "views" ? p.views : metricMode === "likes" ? p.likes : p.comments
    );
    const { useScale, ...axis } = analyticsTrendAxisBounds(values, "cumulative");

    return {
      backgroundColor: "transparent",
      tooltip: {
        trigger: "axis",
        renderMode: "html",
        formatter: (params: Parameters<typeof analyticsTooltipFormatter>[0]) => {
          const items = Array.isArray(params) ? params : [params];
          const index = items[0]?.dataIndex;
          const point =
            typeof index === "number" && index >= 0 ? trendPoints[index] : undefined;
          const prevPoint =
            typeof index === "number" && index > 0 ? trendPoints[index - 1] : undefined;

          let html = `日期：${String(items[0]?.name ?? "")}<br/>`;
          for (const p of items) {
            html += `${p.marker}${String(p.seriesName ?? "")}：${formatAnalyticsFull(Number(p.value))}<br/>`;
          }

          if (point) {
            html += `贡献视频：${point.contributing_videos} 个`;

            if (prevPoint) {
              const delta = point.contributing_videos - prevPoint.contributing_videos;
              if (delta > 0) {
                html += `<br/><span style="color:${chartColors.success};font-weight:600;">较昨日新增 ${delta} 个</span>`;
              } else if (delta < 0) {
                html += `<br/><span style="color:${chartColors.danger};font-weight:600;">较昨日减少 ${Math.abs(delta)} 个</span>`;
              }
            }

            if (point.first_snapshot_videos > 0) {
              html += `<br/><span style="color:${chartColors.warning};font-weight:600;">${point.first_snapshot_videos} 个视频首次采集</span>`;
            }
          }

          return html;
        },
      },
      legend: {
        data: [config.seriesName],
        textStyle: { color: chartColors.muted, fontSize: CHART_FONT_SIZE },
      },
      grid: CHART_GRID,
      xAxis: {
        type: "category",
        data: trendPoints.map((p) => formatDayLabel(p.day)),
        axisLabel: { color: chartColors.muted, fontSize: CHART_FONT_SIZE, margin: 10 },
      },
      yAxis: {
        type: "value",
        name: config.seriesName,
        nameGap: 12,
        nameTextStyle: { fontSize: CHART_FONT_SIZE },
        ...axis,
        scale: useScale,
        axisLabel: {
          color: chartColors.muted,
          fontSize: CHART_FONT_SIZE,
          formatter: (v: number) => formatAnalyticsCompact(v),
          margin: 12,
        },
        splitLine: { lineStyle: { color: chartColors.grid } },
      },
      series: [
        {
          name: config.seriesName,
          type: "line",
          smooth: true,
          data: values,
          lineStyle: { color: config.color, width: 2 },
          itemStyle: { color: config.color },
          areaStyle: { color: config.area },
        },
      ],
    };
  }, [trendPoints, metricMode, theme]);

  return (
    <div className="analytics-trend-section">
      {showHeader && (
        <>
          <h3 className="analytics-section-title">累计数据趋势</h3>
          <p className="analytics-section-desc">
            每日汇总各视频当日快照的播放量、点赞量、评论量累计总和。
          </p>
        </>
      )}

      {kpi && (
        <div className="kpi-grid" style={{ marginBottom: 16 }}>
          <div className="kpi-card">
            <div className="label">总播放量</div>
            <AnalyticsKpiValue value={kpi.views} />
          </div>
          <div className="kpi-card">
            <div className="label">总点赞量</div>
            <AnalyticsKpiValue value={kpi.likes} />
          </div>
          <div className="kpi-card">
            <div className="label">总评论量</div>
            <AnalyticsKpiValue value={kpi.comments} />
          </div>
        </div>
      )}

      <div className="detail-chart-block">
        <div className="detail-chart-head">
          <h4>累计趋势</h4>
          <div className="detail-chart-toggle">
            {(Object.keys(METRIC_CONFIG) as MetricMode[]).map((mode) => (
              <button
                key={mode}
                type="button"
                className={`btn detail-chart-toggle-btn${metricMode === mode ? " active" : ""}`}
                onClick={() => setMetricMode(mode)}
              >
                {METRIC_CONFIG[mode].seriesName}
              </button>
            ))}
          </div>
        </div>
        <div className="chart-box">
          {trendPoints.length ? (
            <LazyChart option={chartOption} style={{ height: "100%" }} />
          ) : hasAnyData ? (
            <p className="empty">暂无快照数据</p>
          ) : (
            <p className="empty">暂无监测视频，请先在视频管理中添加视频</p>
          )}
        </div>
      </div>
    </div>
  );
}
