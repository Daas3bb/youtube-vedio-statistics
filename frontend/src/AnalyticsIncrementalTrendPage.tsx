import { useMemo } from "react";
import type { Video, VideoDetail } from "./api";
import { AnalyticsDateFilter } from "./AnalyticsDateFilter";
import { availableAnalyticsDateRange } from "./analyticsAggregate";
import { IncrementalTrendSection } from "./AnalyticsIncrementalPage";
import { AnalyticsSnapshotDetail } from "./AnalyticsSnapshotDetail";
import type { Theme } from "./theme";

interface AnalyticsIncrementalTrendPageProps {
  videos: Video[];
  serverDetails: Record<string, VideoDetail | null | undefined>;
  dateFrom: string;
  dateTo: string;
  onDateFromChange: (value: string) => void;
  onDateToChange: (value: string) => void;
  onOpenVideoDetail: (videoId: string) => void;
  theme: Theme;
}

export function AnalyticsIncrementalTrendPage({
  videos,
  serverDetails,
  dateFrom,
  dateTo,
  onDateFromChange,
  onDateToChange,
  onOpenVideoDetail,
  theme,
}: AnalyticsIncrementalTrendPageProps) {
  const dateBounds = useMemo(
    () => availableAnalyticsDateRange(videos, serverDetails),
    [videos, serverDetails]
  );

  const hasAnyData = videos.length > 0 && Boolean(dateBounds.min || dateBounds.max);

  return (
    <section className="section app-page" id="panel-analytics-incremental">
      <h2>增量数据趋势</h2>
      <p className="analytics-page-desc">
        按日期区间汇总全部监测视频的每日新增播放、点赞、评论，并查看快照明细与异常检测。
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

      <IncrementalTrendSection
        videos={videos}
        serverDetails={serverDetails}
        dateFrom={dateFrom}
        dateTo={dateTo}
        theme={theme}
        hasAnyData={hasAnyData}
        showHeader={false}
      />

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
