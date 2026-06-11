import { useEffect, useMemo, useState } from "react";
import type { Video, VideoDetail } from "./api";
import { AnalyticsKpiValue } from "./AnalyticsKpiValue";
import { Thumbnail } from "./Thumbnail";
import { VideoSelect } from "./VideoSelect";
import { enumerateDays } from "./analyticsAggregate";
import {
  ANOMALY_HINTS,
  ANOMALY_LABELS,
  buildSnapshotAnomalySummary,
  buildSnapshotDetailRows,
  buildSparseGapEntries,
  exportSnapshotRowsCsv,
  groupAnomalyRowsByVideo,
  groupSparseGapsByVideo,
  type AnomalyVideoSummary,
  type SnapshotAnomalyType,
  type SnapshotDetailRow,
} from "./analyticsSnapshots";

const PAGE_SIZE = 15;

type FilterMode = "all" | "anomaly";
type SortMode = "time_desc" | "time_asc" | "video";
type SummaryFilter = "all_anomaly" | "sparse_gap" | SnapshotAnomalyType;

interface AnalyticsSnapshotDetailProps {
  videos: Video[];
  serverDetails: Record<string, VideoDetail | null | undefined>;
  dateFrom: string;
  dateTo: string;
  onOpenVideoDetail: (videoId: string) => void;
}

function formatSnapshotTime(time: string): string {
  return time.length >= 16 ? time.slice(5, 16) : time;
}

function downloadCsv(filename: string, content: string) {
  const blob = new Blob(["\uFEFF" + content], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export function AnalyticsSnapshotDetail({
  videos,
  serverDetails,
  dateFrom,
  dateTo,
  onOpenVideoDetail,
}: AnalyticsSnapshotDetailProps) {
  const [expanded, setExpanded] = useState(false);
  const [filterMode, setFilterMode] = useState<FilterMode>("all");
  const [summaryFilter, setSummaryFilter] = useState<SummaryFilter | null>(null);
  const [anomalyTypeFilter, setAnomalyTypeFilter] = useState<SnapshotAnomalyType | null>(null);
  const [filterDay, setFilterDay] = useState("");
  const [filterVideoId, setFilterVideoId] = useState("");
  const [sortMode, setSortMode] = useState<SortMode>("time_desc");
  const [page, setPage] = useState(1);

  useEffect(() => {
    setPage(1);
    setFilterDay("");
    setFilterVideoId("");
    setSummaryFilter(null);
    setAnomalyTypeFilter(null);
    setFilterMode("all");
  }, [dateFrom, dateTo]);

  useEffect(() => {
    setPage(1);
  }, [filterMode, filterDay, filterVideoId, sortMode, anomalyTypeFilter, summaryFilter]);

  const allRows = useMemo(
    () => buildSnapshotDetailRows(videos, serverDetails, dateFrom, dateTo),
    [videos, serverDetails, dateFrom, dateTo]
  );

  const summary = useMemo(
    () => buildSnapshotAnomalySummary(videos, serverDetails, dateFrom, dateTo),
    [videos, serverDetails, dateFrom, dateTo]
  );

  const availableDays = useMemo(() => {
    const daysWithData = new Set(allRows.map((r) => r.day));
    return enumerateDays(dateFrom, dateTo).filter((day) => daysWithData.has(day));
  }, [allRows, dateFrom, dateTo]);

  const availableVideos = useMemo(() => {
    const ids = new Set(allRows.map((r) => r.video_id));
    return videos.filter((v) => ids.has(v.video_id));
  }, [allRows, videos]);

  const sparseGapEntries = useMemo(
    () => buildSparseGapEntries(videos, serverDetails, dateFrom, dateTo),
    [videos, serverDetails, dateFrom, dateTo]
  );

  const filteredRows = useMemo(() => {
    let rows = filterMode === "anomaly" ? allRows.filter((r) => r.anomalies.length > 0) : allRows;
    if (anomalyTypeFilter) {
      rows = rows.filter((r) => r.anomalies.includes(anomalyTypeFilter));
    }
    if (filterDay) rows = rows.filter((r) => r.day === filterDay);
    if (filterVideoId) rows = rows.filter((r) => r.video_id === filterVideoId);
    rows = [...rows];
    if (sortMode === "time_desc") {
      rows.sort((a, b) => b.snapshot_time.localeCompare(a.snapshot_time));
    } else if (sortMode === "time_asc") {
      rows.sort((a, b) => a.snapshot_time.localeCompare(b.snapshot_time));
    } else {
      rows.sort((a, b) => {
        const titleCmp = a.title.localeCompare(b.title, "zh-CN");
        return titleCmp !== 0 ? titleCmp : b.snapshot_time.localeCompare(a.snapshot_time);
      });
    }
    return rows;
  }, [allRows, filterMode, anomalyTypeFilter, filterDay, filterVideoId, sortMode]);

  const summaryVideoList = useMemo((): AnomalyVideoSummary[] => {
    if (!summaryFilter) return [];
    if (summaryFilter === "sparse_gap") {
      return groupSparseGapsByVideo(sparseGapEntries);
    }
    if (summaryFilter === "all_anomaly") {
      return groupAnomalyRowsByVideo(allRows);
    }
    return groupAnomalyRowsByVideo(allRows, summaryFilter);
  }, [summaryFilter, allRows, sparseGapEntries]);

  const hasRefineFilter = Boolean(filterDay || filterVideoId || summaryFilter);

  const totalPages = Math.max(1, Math.ceil(filteredRows.length / PAGE_SIZE));
  const pagedRows = filteredRows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const anomalyTypeCounts = (
    Object.entries(summary.byType) as Array<[SnapshotAnomalyType, number]>
  ).filter(([, count]) => count > 0);

  const handleFilterChange = (mode: FilterMode) => {
    setFilterMode(mode);
    if (mode === "all") {
      setSummaryFilter(null);
      setAnomalyTypeFilter(null);
    }
    setPage(1);
  };

  const applySummaryFilter = (next: SummaryFilter) => {
    if (summaryFilter === next) {
      setSummaryFilter(null);
      setAnomalyTypeFilter(null);
      setFilterMode("all");
      return;
    }

    setSummaryFilter(next);
    if (next === "sparse_gap") {
      setAnomalyTypeFilter(null);
      setFilterMode("all");
      return;
    }

    setFilterMode("anomaly");
    setAnomalyTypeFilter(next === "all_anomaly" ? null : next);
  };

  const summaryListTitle = useMemo(() => {
    if (!summaryFilter) return "";
    if (summaryFilter === "all_anomaly") return "全部快照异常";
    if (summaryFilter === "sparse_gap") return "采集缺失";
    return ANOMALY_LABELS[summaryFilter];
  }, [summaryFilter]);

  const handleSortChange = (mode: SortMode) => {
    setSortMode(mode);
    setPage(1);
  };

  const handleExport = () => {
    const stamp = `${dateFrom}_${dateTo}`.replace(/[^\d-]/g, "");
    downloadCsv(`snapshot-detail-${stamp || "export"}.csv`, exportSnapshotRowsCsv(filteredRows));
  };

  return (
    <div className="analytics-snapshot-panel">
      <button
        type="button"
        className="analytics-snapshot-toggle"
        aria-expanded={expanded}
        onClick={() => setExpanded((v) => !v)}
      >
        <span className="analytics-snapshot-toggle-title">快照明细 &amp; 异常检测</span>
        <span className={`app-nav-chevron${expanded ? " expanded" : ""}`} aria-hidden>
          ›
        </span>
      </button>

      {expanded && (
        <div className="analytics-snapshot-body">
          <div
            className={`analytics-anomaly-summary${summary.anomalyRows || summary.sparseGapDays ? " has-issue" : ""}`}
          >
            {summary.anomalyRows || summary.sparseGapDays ? (
              <>
                <span className="analytics-anomaly-summary-types">
                  {summary.anomalyRows > 0 && (
                    <button
                      type="button"
                      className={`analytics-anomaly-chip analytics-anomaly-chip-btn${summaryFilter === "all_anomaly" ? " active" : ""}`}
                      onClick={() => applySummaryFilter("all_anomaly")}
                    >
                      ⚠ {summary.anomalyRows} 条快照异常
                    </button>
                  )}
                  {summary.sparseGapDays > 0 && (
                    <button
                      type="button"
                      className={`analytics-anomaly-chip analytics-anomaly-chip-btn${summaryFilter === "sparse_gap" ? " active" : ""}`}
                      onClick={() => applySummaryFilter("sparse_gap")}
                    >
                      {summary.sparseGapDays} 个采集缺失日
                    </button>
                  )}
                  {anomalyTypeCounts
                    .filter(([type]) => type !== "sparse_gap")
                    .map(([type, count]) => (
                      <button
                        key={type}
                        type="button"
                        className={`analytics-anomaly-chip analytics-anomaly-chip-btn analytics-anomaly-${type}${summaryFilter === type ? " active" : ""}`}
                        title={ANOMALY_HINTS[type]}
                        onClick={() => applySummaryFilter(type)}
                      >
                        {ANOMALY_LABELS[type]} {count}
                      </button>
                    ))}
                </span>
              </>
            ) : (
              <span className="analytics-anomaly-summary-ok">所选区间内未检测到异常快照</span>
            )}
          </div>

          {summaryFilter && summaryVideoList.length > 0 && (
            <div className="analytics-anomaly-video-list">
              <div className="analytics-anomaly-video-list-head">
                <span>
                  {summaryListTitle} · 涉及 {summaryVideoList.length} 个视频
                </span>
                <button
                  type="button"
                  className="btn"
                  onClick={() => {
                    setSummaryFilter(null);
                    setAnomalyTypeFilter(null);
                    setFilterMode("all");
                  }}
                >
                  关闭
                </button>
              </div>
              <ul className="analytics-anomaly-video-items">
                {summaryVideoList.map((item) => (
                  <li key={item.video_id} className="analytics-anomaly-video-item">
                    <Thumbnail
                      videoId={item.video_id}
                      url={item.thumbnail_url}
                      className="thumb analytics-anomaly-video-thumb"
                    />
                    <div className="analytics-anomaly-video-info">
                      <span className="analytics-anomaly-video-title" title={item.title}>
                        {item.title}
                      </span>
                      <span
                        className="analytics-anomaly-video-meta"
                        title={item.days.join("、")}
                      >
                        {summaryFilter === "sparse_gap"
                          ? `缺失 ${item.rowCount} 天 · ${item.days.join("、")}`
                          : `${item.rowCount} 条记录 · ${item.days.join("、")}`}
                      </span>
                    </div>
                    <button
                      type="button"
                      className="btn"
                      onClick={() => onOpenVideoDetail(item.video_id)}
                    >
                      详情
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="analytics-snapshot-toolbar">
            <div className="analytics-snapshot-filters">
              <button
                type="button"
                className={`btn detail-chart-toggle-btn${filterMode === "all" ? " active" : ""}`}
                onClick={() => handleFilterChange("all")}
              >
                全部 ({allRows.length})
              </button>
              <button
                type="button"
                className={`btn detail-chart-toggle-btn${filterMode === "anomaly" ? " active" : ""}`}
                onClick={() => handleFilterChange("anomaly")}
              >
                仅异常 ({summary.anomalyRows})
              </button>
            </div>
            <div className="analytics-snapshot-actions">
              <label className="analytics-snapshot-sort">
                <span>排序</span>
                <select
                  value={sortMode}
                  onChange={(e) => handleSortChange(e.target.value as SortMode)}
                >
                  <option value="time_desc">采集时间 ↓</option>
                  <option value="time_asc">采集时间 ↑</option>
                  <option value="video">视频名称</option>
                </select>
              </label>
              <button
                type="button"
                className="btn"
                onClick={handleExport}
                disabled={!filteredRows.length}
              >
                导出 CSV
              </button>
            </div>
          </div>

          <div className="analytics-snapshot-refine">
            <label className="analytics-snapshot-refine-field">
              <span>筛选日期</span>
              <select
                value={filterDay}
                onChange={(e) => setFilterDay(e.target.value)}
              >
                <option value="">全部日期</option>
                {availableDays.map((day) => (
                  <option key={day} value={day}>
                    {day}
                  </option>
                ))}
              </select>
            </label>
            <label className="analytics-snapshot-refine-field analytics-snapshot-refine-video">
              <span>筛选视频</span>
              <VideoSelect
                videos={availableVideos}
                value={filterVideoId}
                onChange={setFilterVideoId}
                placeholder="全部视频"
                emptyLabel="全部视频"
                searchable
              />
            </label>
            {hasRefineFilter && (
              <button
                type="button"
                className="btn"
                onClick={() => {
                  setFilterDay("");
                  setFilterVideoId("");
                  setSummaryFilter(null);
                  setAnomalyTypeFilter(null);
                  setFilterMode("all");
                }}
              >
                清除筛选
              </button>
            )}
          </div>

          {filteredRows.length ? (
            <>
              <p className="analytics-snapshot-scroll-hint">
                仅展示与总体趋势一致的每日纳入快照（当日播放量最高的采集记录）；表格可在下方区域内横向、纵向滚动。
              </p>
              <div className="analytics-snapshot-table-wrap">
                <table className="video-table analytics-snapshot-table">
                  <thead>
                    <tr>
                      <th className="col-video">视频</th>
                      <th>日期</th>
                      <th>采集时间</th>
                      <th>播放量</th>
                      <th>点赞量</th>
                      <th>评论量</th>
                      <th>新增播放</th>
                      <th>新增点赞</th>
                      <th>新增评论</th>
                      <th>状态</th>
                      <th className="col-actions">操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pagedRows.map((row) => (
                      <SnapshotRow
                        key={`${row.video_id}-${row.snapshot_time}`}
                        row={row}
                        onOpenVideoDetail={onOpenVideoDetail}
                      />
                    ))}
                  </tbody>
                </table>
              </div>

              {totalPages > 1 && (
                <div className="video-list-pagination">
                  <span className="video-list-pagination-info">
                    共 {filteredRows.length} 条 · 第 {page} / {totalPages} 页
                  </span>
                  <div className="video-list-pagination-controls">
                    <button
                      type="button"
                      className="btn"
                      disabled={page <= 1}
                      onClick={() => setPage((p) => Math.max(1, p - 1))}
                    >
                      上一页
                    </button>
                    <button
                      type="button"
                      className="btn"
                      disabled={page >= totalPages}
                      onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    >
                      下一页
                    </button>
                  </div>
                </div>
              )}
            </>
          ) : (
            <p className="empty">
              {filterMode === "anomaly"
                ? hasRefineFilter
                  ? "当前筛选条件下暂无异常快照记录"
                  : "所选区间内暂无异常快照记录"
                : hasRefineFilter
                  ? "当前筛选条件下暂无快照数据"
                  : "所选日期范围内暂无快照数据"}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function SnapshotRow({
  row,
  onOpenVideoDetail,
}: {
  row: SnapshotDetailRow;
  onOpenVideoDetail: (videoId: string) => void;
}) {
  const hasAnomaly = row.anomalies.length > 0;

  return (
    <tr className={hasAnomaly ? "analytics-snapshot-row-anomaly" : undefined}>
      <td className="col-video">
        <div className="analytics-snapshot-video">
          <Thumbnail
            videoId={row.video_id}
            url={row.thumbnail_url}
            className="thumb analytics-snapshot-thumb"
          />
          <span className="analytics-snapshot-title" title={row.title}>
            {row.title}
          </span>
        </div>
      </td>
      <td>{row.day}</td>
      <td>{formatSnapshotTime(row.snapshot_time)}</td>
      <td>
        <span className="analytics-snapshot-metric">
          <AnalyticsKpiValue value={row.views} />
        </span>
      </td>
      <td>
        <span className="analytics-snapshot-metric">
          <AnalyticsKpiValue value={row.likes} />
        </span>
      </td>
      <td>
        <span className="analytics-snapshot-metric">
          <AnalyticsKpiValue value={row.comments} />
        </span>
      </td>
      <td>
        <span
          className={`analytics-snapshot-delta${row.delta_views < 0 ? " is-negative" : ""}`}
        >
          <AnalyticsKpiValue value={row.delta_views} />
        </span>
      </td>
      <td>
        <span
          className={`analytics-snapshot-delta${row.delta_likes < 0 ? " is-negative" : ""}`}
        >
          <AnalyticsKpiValue value={row.delta_likes} />
        </span>
      </td>
      <td>
        <span
          className={`analytics-snapshot-delta${row.delta_comments < 0 ? " is-negative" : ""}`}
        >
          <AnalyticsKpiValue value={row.delta_comments} />
        </span>
      </td>
      <td>
        {hasAnomaly ? (
          <div className="analytics-anomaly-badges">
            {row.anomalies.map((type) => (
              <span
                key={type}
                className={`analytics-anomaly-badge analytics-anomaly-${type}`}
                title={ANOMALY_HINTS[type]}
              >
                {ANOMALY_LABELS[type]}
              </span>
            ))}
          </div>
        ) : (
          <span className="analytics-anomaly-ok">正常</span>
        )}
      </td>
      <td className="col-actions">
        <button
          type="button"
          className="btn"
          onClick={() => onOpenVideoDetail(row.video_id)}
        >
          详情
        </button>
      </td>
    </tr>
  );
}
