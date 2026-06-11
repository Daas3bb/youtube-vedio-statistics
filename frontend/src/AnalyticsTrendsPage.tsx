import { useMemo } from "react";
import type { Video, VideoDetail } from "./api";
import { AnalyticsDateFilter } from "./AnalyticsDateFilter";
import { availableAnalyticsDateRange } from "./analyticsAggregate";
import { CumulativeTrendSection } from "./AnalyticsCumulativePage";
import { IncrementalTrendSection } from "./AnalyticsIncrementalPage";
import { AnalyticsSnapshotDetail } from "./AnalyticsSnapshotDetail";
import type { Theme } from "./theme";

interface AnalyticsTrendsPageProps {
  videos: Video[];
  serverDetails: Record<string, VideoDetail | null | undefined>;
  dateFrom: string;
  dateTo: string;
  onDateFromChange: (value: string) => void;
  onDateToChange: (value: string) => void;
  onOpenVideoDetail: (videoId: string) => void;
  theme: Theme;
}

export function AnalyticsTrendsPage({
  videos,
  serverDetails,
  dateFrom,
  dateTo,
  onDateFromChange,
  onDateToChange,
  onOpenVideoDetail,
  theme,
}: AnalyticsTrendsPageProps) {
  const dateBounds = useMemo(
    () => availableAnalyticsDateRange(videos, serverDetails),
    [videos, serverDetails]
  );

  const hasAnyData = videos.length > 0 && Boolean(dateBounds.min || dateBounds.max);

  return (
    <section className="section app-page" id="panel-analytics-trends">
      <h2>总体趋势</h2>
      <p className="analytics-page-desc">
        汇总全部监测视频的累计与增量数据趋势，支持按日期区间筛选并切换播放、点赞、评论指标。
      </p>

      <AnalyticsDateFilter
        from={dateFrom}
        to={dateTo}
        min={dateBounds.min}
        max={dateBounds.max}
        videoCount={videos.length}
        onFromChange={onDateFromChange}
        onToChange={onDateToChange}
      />

      <div className="analytics-trends-sections">
        <CumulativeTrendSection
          videos={videos}
          serverDetails={serverDetails}
          dateFrom={dateFrom}
          dateTo={dateTo}
          theme={theme}
          hasAnyData={hasAnyData}
        />
        <IncrementalTrendSection
          videos={videos}
          serverDetails={serverDetails}
          dateFrom={dateFrom}
          dateTo={dateTo}
          theme={theme}
          hasAnyData={hasAnyData}
        />
      </div>

      <AnalyticsSnapshotDetail
        videos={videos}
        serverDetails={serverDetails}
        dateFrom={dateFrom}
        dateTo={dateTo}
        onOpenVideoDetail={onOpenVideoDetail}
      />
    </section>
  );
}
