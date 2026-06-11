import { useMemo } from "react";
import type { Video, VideoDetail } from "./api";
import { AnalyticsDateFilter } from "./AnalyticsDateFilter";
import { AnalyticsPageTitle, type AnalyticsPageHint } from "./AnalyticsPageTitle";
import {
  aggregateCumulativeTrend,
  availableAnalyticsDateRange,
  summarizeCumulativeContributors,
} from "./analyticsAggregate";
import { CumulativeTrendSection } from "./AnalyticsCumulativePage";
import { formatAnalyticsFullDay } from "./chartUtils";
import type { Theme } from "./theme";

interface AnalyticsCumulativeTrendPageProps {
  videos: Video[];
  serverDetails: Record<string, VideoDetail | null | undefined>;
  dateFrom: string;
  dateTo: string;
  onDateFromChange: (value: string) => void;
  onDateToChange: (value: string) => void;
  theme: Theme;
}

export function AnalyticsCumulativeTrendPage({
  videos,
  serverDetails,
  dateFrom,
  dateTo,
  onDateFromChange,
  onDateToChange,
  theme,
}: AnalyticsCumulativeTrendPageProps) {
  const dateBounds = useMemo(
    () => availableAnalyticsDateRange(videos, serverDetails),
    [videos, serverDetails]
  );

  const trendPoints = useMemo(
    () => aggregateCumulativeTrend(videos, serverDetails, dateFrom, dateTo),
    [videos, serverDetails, dateFrom, dateTo]
  );

  const contributorSummary = useMemo(
    () => summarizeCumulativeContributors(trendPoints),
    [trendPoints]
  );

  const hasAnyData = videos.length > 0 && Boolean(dateBounds.min || dateBounds.max);

  const titleHints = useMemo((): AnalyticsPageHint[] => {
    const hints: AnalyticsPageHint[] = [
      "汇总全部监测视频的历史累计播放、点赞、评论总量趋势。",
      "可通过上方日期筛选框限定展示区间，便于聚焦含新增视频的时段。",
      "悬停图表可查看每日贡献视频数及增减；含首次采集的视频会以高亮标注。",
    ];

    if (contributorSummary) {
      hints.push({
        parts: [
          { text: "数据区间：" },
          {
            text: `${formatAnalyticsFullDay(contributorSummary.dateFrom)}–${formatAnalyticsFullDay(contributorSummary.dateTo)}`,
            tone: "highlight",
          },
          { text: "。" },
        ],
      });

      hints.push({
        parts: [
          { text: "贡献视频数：每日 " },
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
    <section className="section app-page" id="panel-analytics-cumulative">
      <AnalyticsPageTitle title="累计数据趋势" hints={titleHints} />

      <AnalyticsDateFilter
        from={dateFrom}
        to={dateTo}
        min={dateBounds.min}
        max={dateBounds.max}
        videoCount={videos.length}
        onFromChange={onDateFromChange}
        onToChange={onDateToChange}
      />

      <CumulativeTrendSection
        videos={videos}
        serverDetails={serverDetails}
        dateFrom={dateFrom}
        dateTo={dateTo}
        theme={theme}
        hasAnyData={hasAnyData}
        showHeader={false}
      />
    </section>
  );
}
