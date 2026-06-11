import { useMemo } from "react";
import type { Video, VideoDetail } from "./api";
import { AnalyticsDateFilter } from "./AnalyticsDateFilter";
import { AnalyticsPageTitle, type AnalyticsPageHint } from "./AnalyticsPageTitle";
import {
  aggregateIncrementalTrend,
  availableAnalyticsDateRange,
  summarizeIncrementalContributors,
} from "./analyticsAggregate";
import { IncrementalTrendSection } from "./AnalyticsIncrementalPage";
import { AnalyticsSnapshotDetail } from "./AnalyticsSnapshotDetail";
import { formatAnalyticsFullDay } from "./chartUtils";
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

  const trendPoints = useMemo(
    () => aggregateIncrementalTrend(videos, serverDetails, dateFrom, dateTo),
    [videos, serverDetails, dateFrom, dateTo]
  );

  const contributorSummary = useMemo(
    () => summarizeIncrementalContributors(trendPoints),
    [trendPoints]
  );

  const hasAnyData = videos.length > 0 && Boolean(dateBounds.min || dateBounds.max);

  const titleHints = useMemo((): AnalyticsPageHint[] => {
    const hints: AnalyticsPageHint[] = [
      "每个视频每个自然日取一条代表快照，计算相对上一条代表快照的新增播放、点赞、评论后按日汇总。",
      "视频首次采集日仅作基线，不计入增量。",
      "悬停图表可查看每日贡献视频数；含首次采集的视频会以高亮标注。",
      "下方可查看所选日期范围内的快照明细与异常检测。",
    ];

    if (contributorSummary) {
      hints.push({
        parts: [
          { text: "贡献视频数（已监测 ≥2 天）：每日 " },
          {
            text: `${contributorSummary.min}–${contributorSummary.max} 个`,
            tone: "highlight",
          },
          { text: "。" },
        ],
      });

      if (contributorSummary.coldStartDays.length > 0) {
        hints.push({
          parts: [
            { text: `${contributorSummary.coldStartDays.length} 天`, tone: "highlight" },
            { text: "含首次采集视频（" },
            {
              text: contributorSummary.coldStartDays
                .map((p) => formatAnalyticsFullDay(p.day))
                .join("、"),
              tone: "highlight",
            },
            { text: "）。" },
          ],
        });
      }
    }

    return hints;
  }, [contributorSummary]);

  return (
    <section className="section app-page" id="panel-analytics-incremental">
      <AnalyticsPageTitle title="增量数据趋势" hints={titleHints} />

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
