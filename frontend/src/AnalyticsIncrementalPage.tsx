import { useMemo, useState } from "react";
import type { Video, VideoDetail } from "./api";
import {
  aggregateIncrementalTrend,
  incrementalKpi,
} from "./analyticsAggregate";
import { LazyChart } from "./LazyChart";
import { AnalyticsKpiValue } from "./AnalyticsKpiValue";
import {
  analyticsTooltipFormatter,
  analyticsTrendAxisBounds,
  CHART_FONT_SIZE,
  CHART_GRID,
  formatAnalyticsCompact,
  formatDayLabel,
} from "./chartUtils";
import { readChartCssColors, type Theme } from "./theme";

type MetricMode = "views" | "likes" | "comments";

const METRIC_CONFIG: Record<MetricMode, { seriesName: string; color: string }> = {
  views: {
    seriesName: "新增播放量",
    color: "#6FCF97",
  },
  likes: {
    seriesName: "新增点赞量",
    color: "#60a5fa",
  },
  comments: {
    seriesName: "新增评论量",
    color: "#fbbf24",
  },
};

interface IncrementalTrendSectionProps {
  videos: Video[];
  serverDetails: Record<string, VideoDetail | null | undefined>;
  dateFrom: string;
  dateTo: string;
  theme: Theme;
  hasAnyData: boolean;
}

export function IncrementalTrendSection({
  videos,
  serverDetails,
  dateFrom,
  dateTo,
  theme,
  hasAnyData,
}: IncrementalTrendSectionProps) {
  const [metricMode, setMetricMode] = useState<MetricMode>("views");

  const trendPoints = useMemo(
    () => aggregateIncrementalTrend(videos, serverDetails, dateFrom, dateTo),
    [videos, serverDetails, dateFrom, dateTo]
  );

  const kpi = useMemo(() => incrementalKpi(trendPoints), [trendPoints]);

  const chartOption = useMemo(() => {
    if (!trendPoints.length) return {};
    const chartColors = readChartCssColors();
    const config = METRIC_CONFIG[metricMode];
    const values = trendPoints.map((p) =>
      metricMode === "views"
        ? p.delta_views
        : metricMode === "likes"
          ? p.delta_likes
          : p.delta_comments
    );
    const { useScale, ...axis } = analyticsTrendAxisBounds(values, "incremental");

    return {
      backgroundColor: "transparent",
      tooltip: {
        trigger: "axis",
        formatter: (params: Parameters<typeof analyticsTooltipFormatter>[0]) =>
          analyticsTooltipFormatter(params, metricMode, true),
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
          type: "bar",
          data: values,
          barMaxWidth: 30,
          itemStyle: {
            color: config.color,
            opacity: 0.85,
            borderRadius: [2, 2, 0, 0],
          },
        },
      ],
    };
  }, [trendPoints, metricMode, theme]);

  return (
    <div className="analytics-trend-section">
      <h3 className="analytics-section-title">增量数据趋势</h3>
      <p className="analytics-section-desc">
        每日新增播放、点赞、评论（当日累计总量减前一日累计总量后汇总）。
      </p>

      {trendPoints.length > 0 && (
        <div className="kpi-grid" style={{ marginBottom: 16 }}>
          <div className="kpi-card">
            <div className="label">累计新增播放量</div>
            <AnalyticsKpiValue value={kpi.views} />
          </div>
          <div className="kpi-card">
            <div className="label">累计新增点赞量</div>
            <AnalyticsKpiValue value={kpi.likes} />
          </div>
          <div className="kpi-card">
            <div className="label">累计新增评论量</div>
            <AnalyticsKpiValue value={kpi.comments} />
          </div>
        </div>
      )}

      <div className="detail-chart-block">
        <div className="detail-chart-head">
          <h4>增量趋势</h4>
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
            <p className="empty">所选日期范围内暂无快照数据</p>
          ) : (
            <p className="empty">暂无监测视频，请先在视频管理中添加视频</p>
          )}
        </div>
      </div>
    </div>
  );
}
