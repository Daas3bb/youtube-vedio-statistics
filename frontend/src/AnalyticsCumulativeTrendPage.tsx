import { useMemo } from "react";
import type { Video, VideoDetail } from "./api";
import { availableAnalyticsDateRange } from "./analyticsAggregate";
import { CumulativeTrendSection } from "./AnalyticsCumulativePage";
import type { Theme } from "./theme";

interface AnalyticsCumulativeTrendPageProps {
  videos: Video[];
  serverDetails: Record<string, VideoDetail | null | undefined>;
  theme: Theme;
}

export function AnalyticsCumulativeTrendPage({
  videos,
  serverDetails,
  theme,
}: AnalyticsCumulativeTrendPageProps) {
  const dateBounds = useMemo(
    () => availableAnalyticsDateRange(videos, serverDetails),
    [videos, serverDetails]
  );

  const hasAnyData = videos.length > 0 && Boolean(dateBounds.min || dateBounds.max);

  return (
    <section className="section app-page" id="panel-analytics-cumulative">
      <h2>累计数据趋势</h2>
      <p className="analytics-page-desc">
        汇总全部监测视频的历史累计播放、点赞、评论总量趋势，展示当前可用的全部快照数据；悬停图表可查看每日贡献视频数及增减。
      </p>

      <CumulativeTrendSection
        videos={videos}
        serverDetails={serverDetails}
        dateFrom={dateBounds.min}
        dateTo={dateBounds.max}
        theme={theme}
        hasAnyData={hasAnyData}
        showHeader={false}
      />
    </section>
  );
}
