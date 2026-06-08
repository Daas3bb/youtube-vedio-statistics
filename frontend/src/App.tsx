import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CallbackDataParams } from "echarts/types/dist/shared";
import {
  clearSiteCache,
  fetchDashboard,
  fetchHealth,
  fetchVideoDetail,
  fetchVideos,
  type DashboardData,
  type Video,
  type VideoDetail,
} from "./api";
import { Thumbnail } from "./Thumbnail";
import { VideoSelect } from "./VideoSelect";
import {
  addHiddenVideoIds,
  addLocalVideos,
  applyDeletionToDashboard,
  BATCH_INPUT_PLACEHOLDER,
  clearHiddenVideoIds,
  createVideoFromInput,
  loadHiddenVideoIds,
  loadLocalVideos,
  markGithubPendingIds,
  mergeVideos,
  removeLocalVideosByIds,
  loadGithubPendingIds,
  clearGithubPendingIds,
  updateLocalVideoMetadata,
  videoSyncLabel,
} from "./localVideos";
import {
  appendVideosToGithubCsv,
  downloadVideosCsv,
  formatGithubSyncError,
  isGithubSyncReady,
  removeVideosFromGithub,
  triggerCollectWorkflow,
} from "./githubCsvSync";
import { runLocalCollectScripts } from "./localCollect";
import { GithubSyncPanel } from "./GithubSyncPanel";
import { YoutubeApiPanel } from "./YoutubeApiPanel";
import { LazyChart } from "./LazyChart";
import {
  appendLocalSnapshot,
  buildMergedDetail,
  removeLocalSnapshotsByVideoIds,
} from "./localSnapshots";
import { fetchYoutubeVideoStats } from "./youtubeCollect";
import { isYoutubeApiReady, loadYoutubeApiKey } from "./youtubeSettings";
import { DraggablePanel } from "./DraggablePanel";
import {
  loadPanelOrder,
  reorderPanels,
  savePanelOrder,
  type PanelId,
} from "./dashboardLayout";
import {
  availableDateRange,
  computeDeltas,
  daysAgoLocal,
  filterHistoryForDetail,
  isTodayOnlyFilter,
  rangeStats,
  todayLocal,
  type HistoryPoint,
} from "./detailFilter";

function formatNum(n: number) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(3) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(3) + "K";
  return n.toFixed(3);
}

function engagementRates(views: number, likes: number, comments: number) {
  if (!views) return { likeRate: 0, commentRate: 0 };
  return {
    likeRate: Math.round((likes / views) * 10000) / 100,
    commentRate: Math.round((comments / views) * 10000) / 100,
  };
}

type RankSortKey = "view_count" | "like_count" | "comment_count";
type RankSortOrder = "asc" | "desc";

function trendAxisBounds(values: number[]) {
  if (!values.length) return {};
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || Math.max(max * 0.01, 1);
  const pad = range * 0.1;
  return {
    min: Math.max(0, Math.floor(min - pad)),
    max: Math.ceil(max + pad),
  };
}

const detailChartGrid = {
  left: 24,
  right: 24,
  top: 52,
  bottom: 56,
  containLabel: true,
};

const detailEngagementChartGrid = {
  left: 24,
  right: 24,
  top: 52,
  bottom: 56,
  containLabel: true,
};

export default function App() {
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [detail, setDetail] = useState<VideoDetail | null>(null);
  const [selectedId, setSelectedId] = useState("");
  const [loading, setLoading] = useState(false);
  const [generatedAt, setGeneratedAt] = useState("");
  const [toast, setToast] = useState("");
  const [detailDateFrom, setDetailDateFrom] = useState("");
  const [detailDateTo, setDetailDateTo] = useState("");
  const [input, setInput] = useState("");
  const [batchInput, setBatchInput] = useState("");
  const [showBatchForm, setShowBatchForm] = useState(false);
  const [batchAdding, setBatchAdding] = useState(false);
  const [adding, setAdding] = useState(false);
  const [collecting, setCollecting] = useState(false);
  const [syncingIds, setSyncingIds] = useState<Set<string>>(new Set());
  const [deletingIds, setDeletingIds] = useState<Set<string>>(new Set());
  const [hiddenVideoIds, setHiddenVideoIds] = useState<Set<string>>(() => loadHiddenVideoIds());
  const [localVideos, setLocalVideos] = useState<Video[]>(() => loadLocalVideos());
  const [serverVideos, setServerVideos] = useState<Video[]>([]);
  const [serverVideoIds, setServerVideoIds] = useState<Set<string>>(new Set());
  const [githubSyncReady, setGithubSyncReady] = useState(() => isGithubSyncReady());
  const [youtubeApiReady, setYoutubeApiReady] = useState(() => isYoutubeApiReady());
  const [githubPendingIds, setGithubPendingIds] = useState<Set<string>>(() => loadGithubPendingIds());
  const [liveStats, setLiveStats] = useState<
    Record<string, { view_count: number; like_count: number; comment_count: number; time: string }>
  >({});
  const [rankSortBy, setRankSortBy] = useState<RankSortKey>("view_count");
  const [rankSortOrder, setRankSortOrder] = useState<RankSortOrder>("desc");
  const [panelOrder, setPanelOrder] = useState<PanelId[]>(() => loadPanelOrder());
  const serverDetailRef = useRef<Record<string, VideoDetail | null>>({});
  const lastSelectedIdRef = useRef("");

  const videos = mergeVideos(serverVideos, localVideos).filter(
    (video) => !hiddenVideoIds.has(video.video_id)
  );

  const showToast = (msg: string, durationMs = 3500) => {
    setToast(msg);
    setTimeout(() => setToast(""), durationMs);
  };

  const refresh = useCallback(async () => {
    setLoading(true);
    clearSiteCache();
    try {
      const [health, vList, dash] = await Promise.all([
        fetchHealth(),
        fetchVideos(),
        fetchDashboard(),
      ]);
      setGeneratedAt(health.generated_at || "");
      const list = Array.isArray(vList) ? vList : [];
      const serverIdSet = new Set(list.map((v) => v.video_id));
      const syncedLocalIds = loadLocalVideos()
        .filter((v) => serverIdSet.has(v.video_id))
        .map((v) => v.video_id);
      if (syncedLocalIds.length) {
        removeLocalVideosByIds(syncedLocalIds);
      }
      const pendingCleared = [...loadGithubPendingIds()].filter((id) => serverIdSet.has(id));
      if (pendingCleared.length) clearGithubPendingIds(pendingCleared);
      setGithubPendingIds(loadGithubPendingIds());

      const hidden = loadHiddenVideoIds();
      const goneFromServer = [...hidden].filter((id) => !serverIdSet.has(id));
      if (goneFromServer.length) {
        clearHiddenVideoIds(goneFromServer);
      }
      setHiddenVideoIds(loadHiddenVideoIds());
      setServerVideos(list);
      setServerVideoIds(serverIdSet);
      setLocalVideos(loadLocalVideos());

      const hiddenIds = loadHiddenVideoIds();
      let dashData: DashboardData | null =
        dash && typeof dash === "object"
          ? {
              kpi: dash.kpi ?? {
                video_count: 0,
                monitored_with_data: 0,
                total_views: 0,
                total_likes: 0,
                total_comments: 0,
                daily_new_views: 0,
                like_rate: 0,
                comment_rate: 0,
              },
              rankings: Array.isArray(dash.rankings) ? dash.rankings : [],
              trend: Array.isArray(dash.trend) ? dash.trend : [],
              daily_new_by_video: Array.isArray(dash.daily_new_by_video)
                ? dash.daily_new_by_video
                : [],
              videos: Array.isArray(dash.videos) ? dash.videos : [],
            }
          : null;
      if (dashData && hiddenIds.size) {
        dashData = applyDeletionToDashboard(dashData, hiddenIds);
      }
      setDashboard(dashData);
      if (!selectedId && list.length) setSelectedId(list[0].video_id);
    } catch (e) {
      showToast("数据未加载，请先运行 python scripts/build_static.py");
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, []);

  const syncVideosToGithub = async (
    ids: string[]
  ): Promise<"ok" | "no_token" | "failed" | "skipped"> => {
    if (!ids.length) return "skipped";

    if (!githubSyncReady) {
      showToast("请先点击「GitHub 同步」配置 Token 并保存", 6000);
      return "no_token";
    }

    const sync = await appendVideosToGithubCsv(ids);

    if (sync.ok) {
      markGithubPendingIds(ids);
      setGithubPendingIds(loadGithubPendingIds());
      if (sync.added > 0) {
        showToast(`已写入 inputs/videos.csv（${sync.added} 个），Actions 每 2 小时自动同步`, 6000);
      } else {
        showToast("视频已在 videos.csv 中", 5000);
      }
      await refresh();
      return "ok";
    }

    if (sync.reason === "no_token") {
      showToast("未配置 GitHub Token，请先保存 GitHub 同步配置", 6000);
      return "no_token";
    }

    showToast(`同步失败：${formatGithubSyncError(sync.reason)}`, 6000);
    clearGithubPendingIds(ids);
    setGithubPendingIds(loadGithubPendingIds());
    return "failed";
  };

  const persistAddedVideos = async (added: Video[]) => {
    const ids = added.map((v) => v.video_id);
    if (!githubSyncReady) {
      downloadVideosCsv(ids, serverVideoIds);
      showToast("已添加（仅本机）。配置 GitHub 同步后点「同步 GitHub」", 6000);
      return;
    }
    await syncVideosToGithub(ids);
  };

  const handleDeleteVideo = async (video: Video) => {
    const videoId = video.video_id;
    if (deletingIds.has(videoId)) return;

    const title = video.title || videoId;
    const onServer = serverVideoIds.has(videoId);
    const confirmMessage = onServer
      ? githubSyncReady
        ? `确定删除「${title}」？\n将从 videos.csv、store.json、site.json 移除该视频及历史数据。`
        : `确定从本机移除「${title}」？\n未配置 GitHub 同步，云端数据需手动编辑仓库文件。`
      : `确定删除「${title}」？\n该视频仅存在于本机，将清理本地列表与快照。`;

    if (!window.confirm(confirmMessage)) return;

    setDeletingIds((prev) => new Set(prev).add(videoId));
    try {
      removeLocalVideosByIds([videoId]);
      removeLocalSnapshotsByVideoIds([videoId]);
      setLocalVideos(loadLocalVideos());
      setGithubPendingIds(loadGithubPendingIds());
      setLiveStats((prev) => {
        const next = { ...prev };
        delete next[videoId];
        return next;
      });

      addHiddenVideoIds([videoId]);
      setHiddenVideoIds(loadHiddenVideoIds());
      setDashboard((prev) =>
        prev ? applyDeletionToDashboard(prev, new Set([videoId])) : prev
      );

      if (onServer) {
        setServerVideos((prev) => prev.filter((item) => item.video_id !== videoId));
        setServerVideoIds((prev) => {
          const next = new Set(prev);
          next.delete(videoId);
          return next;
        });
        if (selectedId === videoId) {
          const remaining = videos.filter((item) => item.video_id !== videoId);
          setSelectedId(remaining[0]?.video_id ?? "");
          setDetail(null);
        }

        if (githubSyncReady) {
          const result = await removeVideosFromGithub([videoId]);
          if (!result.ok) {
            showToast(`云端删除失败：${formatGithubSyncError(result.reason)}`, 7000);
            return;
          }
          showToast(
            `已删除「${title}」：CSV ${result.csvRemoved > 0 ? "已更新" : "无变更"}，数据已清理`,
            6000
          );
          clearSiteCache();
          await refresh();
          return;
        }

        showToast(`已从本机移除「${title}」。配置 GitHub 同步后可同步删除云端数据`, 6000);
        return;
      }

      if (selectedId === videoId) {
        const remaining = videos.filter((item) => item.video_id !== videoId);
        setSelectedId(remaining[0]?.video_id ?? "");
        setDetail(null);
      }
      showToast(`已删除「${title}」`, 4000);
    } finally {
      setDeletingIds((prev) => {
        const next = new Set(prev);
        next.delete(videoId);
        return next;
      });
    }
  };

  const handleSyncToGithub = async (videoId: string) => {
    if (syncingIds.has(videoId)) return;
    setSyncingIds((prev) => new Set(prev).add(videoId));
    try {
      await syncVideosToGithub([videoId]);
    } finally {
      setSyncingIds((prev) => {
        const next = new Set(prev);
        next.delete(videoId);
        return next;
      });
    }
  };

  const handleAdd = async () => {
    const raw = input.trim();
    if (!raw || adding) return;

    const video = createVideoFromInput(raw);
    if (!video) {
      showToast("无法识别，请输入 YouTube 链接或 11 位 Video ID");
      return;
    }

    const allIds = new Set([
      ...serverVideos.map((v) => v.video_id),
      ...localVideos.map((v) => v.video_id),
    ]);
    if (allIds.has(video.video_id)) {
      showToast("该视频已在列表中");
      return;
    }

    setAdding(true);
    try {
      const result = addLocalVideos([raw], serverVideoIds);
      if (!result.added.length) {
        showToast("添加失败");
        return;
      }

      setLocalVideos(loadLocalVideos());
      setInput("");
      setSelectedId(video.video_id);
      await persistAddedVideos(result.added);
    } finally {
      setAdding(false);
    }
  };

  const handleBatchAdd = async () => {
    const lines = batchInput
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    if (!lines.length) return;

    setBatchAdding(true);
    try {
      const result = addLocalVideos(lines, serverVideoIds);
      setLocalVideos(loadLocalVideos());

      if (!result.added.length) {
        showToast(
          `未添加新视频：无效 ${result.invalid} 个，重复 ${result.duplicate} 个`
        );
        return;
      }

      setBatchInput("");
      setShowBatchForm(false);
      setSelectedId(result.added[0].video_id);

      await persistAddedVideos(result.added);
    } finally {
      setBatchAdding(false);
    }
  };

  const handleCollectNow = async () => {
    if (!selectedId || collecting) return;

    const apiKey = loadYoutubeApiKey();
    if (!apiKey) {
      showToast("请先点击「配置 YouTube 即时采集」并保存 API Key（AIzaSy…）", 6000);
      return;
    }

    setCollecting(true);
    try {
      showToast("正在请求 YouTube API…", 5000);
      const statsMap = await fetchYoutubeVideoStats([selectedId], apiKey);
      const stats = statsMap[selectedId];
      if (!stats) {
        showToast("YouTube 未返回该视频数据，请检查 Video ID 是否有效", 6000);
        return;
      }

      const snap = appendLocalSnapshot(stats);
      updateLocalVideoMetadata(selectedId, {
        title: stats.title,
        channel_title: stats.channel_title,
        thumbnail_url: stats.thumbnail_url,
        publish_time: stats.publish_time,
        status: "active",
      });
      setLiveStats((prev) => ({
        ...prev,
        [selectedId]: {
          view_count: stats.view_count,
          like_count: stats.like_count,
          comment_count: stats.comment_count,
          time: snap.snapshot_time.slice(0, 16),
        },
      }));

      setLocalVideos(loadLocalVideos());

      if (import.meta.env.DEV) {
        showToast("正在写入 store.json 并重建 site.json…", 8000);
        const persisted = await runLocalCollectScripts();
        if (persisted.ok) {
          showToast(
            `已写入 store.json：${formatNum(stats.view_count)} 播放 · ${formatNum(stats.like_count)} 赞`,
            6000
          );
        } else {
          showToast(
            `本机快照已保存，但写入 store.json 失败：${persisted.error}`,
            8000
          );
        }
      } else if (githubSyncReady) {
        const triggered = await triggerCollectWorkflow();
        if (triggered.ok) {
          showToast(
            `已更新本机显示，并触发 GitHub Actions 采集（约数分钟后云端同步）`,
            7000
          );
        } else {
          showToast(
            `本机已更新：${formatNum(stats.view_count)} 播放（触发云端采集失败：${formatGithubSyncError(triggered.reason)}）`,
            7000
          );
        }
      } else {
        showToast(
          `已更新：${formatNum(stats.view_count)} 播放 · ${formatNum(stats.like_count)} 赞（仅本机，未写入 store.json）`,
          6000
        );
      }
    } catch (error) {
      showToast(error instanceof Error ? error.message : "采集失败", 8000);
    } finally {
      setCollecting(false);
    }
  };

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      setDetailDateFrom("");
      setDetailDateTo("");
      lastSelectedIdRef.current = "";
      return;
    }

    const videoMeta =
      localVideos.find((item) => item.video_id === selectedId) ??
      serverVideos.find((item) => item.video_id === selectedId);

    const selectionChanged = lastSelectedIdRef.current !== selectedId;
    if (selectionChanged) {
      lastSelectedIdRef.current = selectedId;
      setDetailDateFrom("");
      setDetailDateTo("");

      fetchVideoDetail(selectedId)
        .then((d) => {
          const normalized =
            d && typeof d === "object"
              ? {
                  ...d,
                  history: Array.isArray(d.history) ? d.history : [],
                  view_deltas: Array.isArray(d.view_deltas) ? d.view_deltas : [],
                }
              : null;
          serverDetailRef.current[selectedId] = normalized;
          if (videoMeta) {
            setDetail(buildMergedDetail(selectedId, normalized, videoMeta));
          } else if (normalized) {
            setDetail(normalized);
          } else {
            setDetail(null);
          }
        })
        .catch(() => {
          serverDetailRef.current[selectedId] = null;
          if (videoMeta) {
            setDetail(buildMergedDetail(selectedId, null, videoMeta));
          } else {
            setDetail(null);
          }
        });
      return;
    }

    if (!videoMeta) return;
    setDetail(
      buildMergedDetail(selectedId, serverDetailRef.current[selectedId] ?? null, videoMeta)
    );
  }, [selectedId, localVideos, serverVideos]);

  const detailHistoryAll: HistoryPoint[] = detail?.history ?? [];
  const detailDateBounds = availableDateRange(detailHistoryAll);
  const detailHistoryFiltered = filterHistoryForDetail(
    detailHistoryAll,
    detailDateFrom,
    detailDateTo
  );
  const detailDeltasFiltered = computeDeltas(detailHistoryFiltered);
  const detailRangeKpi = rangeStats(detailHistoryFiltered);
  const hasDateFilter = Boolean(detailDateFrom || detailDateTo);
  const isTodayView = isTodayOnlyFilter(detailDateFrom, detailDateTo);
  const isDailyCollapsedView = hasDateFilter && !isTodayView;

  const visibleDashboard = useMemo(() => {
    if (!dashboard) return null;
    if (!hiddenVideoIds.size) return dashboard;
    return applyDeletionToDashboard(dashboard, hiddenVideoIds);
  }, [dashboard, hiddenVideoIds]);

  const sortedRankings = useMemo(() => {
    const list = visibleDashboard?.rankings ?? [];
    return [...list].sort((a, b) =>
      rankSortOrder === "desc" ? b[rankSortBy] - a[rankSortBy] : a[rankSortBy] - b[rankSortBy]
    );
  }, [visibleDashboard, rankSortBy, rankSortOrder]);

  const detailViewsOption = detailHistoryFiltered.length
    ? (() => {
        const viewValues = detailHistoryFiltered.map((h) => h.views);
        const viewAxis = trendAxisBounds(viewValues);
        return {
          backgroundColor: "transparent",
          tooltip: {
            trigger: "axis",
            formatter: (params: CallbackDataParams | CallbackDataParams[]) => {
              const items = Array.isArray(params) ? params : [params];
              const time = String(items[0]?.name ?? "");
              let html = `时间：${time}<br/>`;
              for (const p of items) {
                html += `${p.marker}${p.seriesName}：${formatNum(Number(p.value))}<br/>`;
              }
              return html;
            },
          },
          legend: { data: ["播放量", "新增播放"], textStyle: { color: "#8b9cb3" } },
          grid: detailChartGrid,
          xAxis: {
            type: "category",
            data: detailHistoryFiltered.map((h) => h.time?.slice(5, 16) || ""),
            axisLabel: { color: "#8b9cb3", margin: 10 },
          },
          yAxis: [
            {
              type: "value",
              name: "播放量",
              position: "left",
              nameGap: 12,
              ...viewAxis,
              scale: true,
              axisLabel: {
                color: "#8b9cb3",
                formatter: (v: number) => formatNum(v),
                margin: 12,
              },
              splitLine: { lineStyle: { color: "#2d3a4f" } },
            },
            {
              type: "value",
              name: "新增播放",
              position: "right",
              nameGap: 12,
              axisLabel: {
                color: "#8b9cb3",
                formatter: (v: number) => formatNum(v),
                margin: 12,
              },
              splitLine: { show: false },
            },
          ],
          series: [
            {
              name: "播放量",
              type: "line",
              smooth: true,
              yAxisIndex: 0,
              data: viewValues,
              lineStyle: { color: "#ff4444", width: 2 },
              itemStyle: { color: "#ff4444" },
              areaStyle: { color: "rgba(255, 68, 68, 0.1)" },
            },
            {
              name: "新增播放",
              type: "bar",
              yAxisIndex: 1,
              data: [0, ...detailDeltasFiltered.map((d) => d.delta_views)],
              itemStyle: { color: "#22c55e", opacity: 0.75, borderRadius: [3, 3, 0, 0] },
            },
          ],
        };
      })()
    : {};

  const detailEngagementOption = detailHistoryFiltered.length
    ? (() => {
        const likeValues = detailHistoryFiltered.map((h) => h.likes);
        const commentValues = detailHistoryFiltered.map((h) => h.comments);
        const deltaLikeValues = [0, ...detailDeltasFiltered.map((d) => d.delta_likes)];
        const deltaCommentValues = [0, ...detailDeltasFiltered.map((d) => d.delta_comments)];
        const likeAxis = trendAxisBounds(likeValues);
        const commentAxis = trendAxisBounds(commentValues);
        const deltaAxis = trendAxisBounds([...deltaLikeValues, ...deltaCommentValues]);
        const timeLabels = detailHistoryFiltered.map((h) => h.time?.slice(5, 16) || "");

        return {
          backgroundColor: "transparent",
          tooltip: {
            trigger: "axis",
            formatter: (params: CallbackDataParams | CallbackDataParams[]) => {
              const items = Array.isArray(params) ? params : [params];
              const time = String(items[0]?.name ?? "");
              let html = `时间：${time}<br/>`;
              for (const p of items) {
                html += `${p.marker}${p.seriesName}：${formatNum(Number(p.value))}<br/>`;
              }
              return html;
            },
          },
          legend: {
            data: ["点赞", "新增点赞", "评论", "新增评论"],
            textStyle: { color: "#8b9cb3" },
          },
          grid: detailEngagementChartGrid,
          xAxis: {
            type: "category",
            data: timeLabels,
            axisLabel: { color: "#8b9cb3", margin: 10 },
          },
          yAxis: [
            {
              type: "value",
              name: "点赞",
              position: "left",
              nameGap: 12,
              ...likeAxis,
              scale: true,
              axisLabel: {
                color: "#8b9cb3",
                formatter: (v: number) => formatNum(v),
                margin: 10,
                align: "right",
              },
              splitLine: { lineStyle: { color: "#2d3a4f" } },
            },
            {
              type: "value",
              name: "增量",
              position: "right",
              nameGap: 12,
              ...deltaAxis,
              scale: true,
              axisLabel: {
                color: "#8b9cb3",
                formatter: (v: number) => formatNum(v),
                margin: 10,
                align: "left",
              },
              splitLine: { show: false },
            },
            {
              type: "value",
              name: "评论",
              position: "right",
              offset: 64,
              nameGap: 12,
              ...commentAxis,
              scale: true,
              axisLabel: {
                color: "#f59e0b",
                formatter: (v: number) => formatNum(v),
                margin: 10,
                align: "left",
              },
              axisLine: { show: true, lineStyle: { color: "#f59e0b", opacity: 0.35 } },
              splitLine: { show: false },
            },
          ],
          series: [
            {
              name: "点赞",
              type: "line",
              smooth: true,
              yAxisIndex: 0,
              z: 1,
              data: likeValues,
              lineStyle: { color: "#3b82f6", width: 2 },
              itemStyle: { color: "#3b82f6" },
              areaStyle: { color: "rgba(59, 130, 246, 0.1)" },
            },
            {
              name: "新增点赞",
              type: "bar",
              yAxisIndex: 1,
              z: 2,
              barMaxWidth: 20,
              data: deltaLikeValues,
              itemStyle: { color: "#60a5fa", opacity: 0.85, borderRadius: [3, 3, 0, 0] },
            },
            {
              name: "评论",
              type: "line",
              smooth: true,
              yAxisIndex: 2,
              z: 1,
              data: commentValues,
              lineStyle: { color: "#f59e0b", width: 2 },
              itemStyle: { color: "#f59e0b" },
              areaStyle: { color: "rgba(245, 158, 11, 0.1)" },
            },
            {
              name: "新增评论",
              type: "bar",
              yAxisIndex: 1,
              z: 2,
              barMaxWidth: 20,
              data: deltaCommentValues,
              itemStyle: { color: "#fbbf24", opacity: 0.85, borderRadius: [3, 3, 0, 0] },
            },
          ],
        };
      })()
    : {};

  const kpi = visibleDashboard?.kpi;

  const handlePanelReorder = (fromId: PanelId, toId: PanelId) => {
    setPanelOrder((prev) => {
      const next = reorderPanels(prev, fromId, toId);
      savePanelOrder(next);
      return next;
    });
  };

  return (
    <div className="app">
      <div className="app-container">
      <header className="header">
        <div className="header-top">
          <div className="header-title-block">
            <h1>
              KOL <span>YouTube</span> 数据监控
            </h1>
            <p className="header-subtitle">每 2 小时同步一次云端数据</p>
          </div>
          <div className="header-actions">
            {generatedAt && (
              <span className="badge ok">更新于 {generatedAt.slice(0, 16)}</span>
            )}
            <button
              className="btn"
              onClick={refresh}
              disabled={loading}
              title="仅重新加载已发布的静态数据，不会触发 YouTube 采集"
            >
              刷新看板
            </button>
          </div>
        </div>
      </header>

      <div className="summary-bar">
        <GithubSyncPanel onSaved={() => setGithubSyncReady(isGithubSyncReady())} />
        <YoutubeApiPanel onSaved={() => setYoutubeApiReady(isYoutubeApiReady())} />
      </div>

      {panelOrder.map((panelId) => (
        <DraggablePanel key={panelId} id={panelId} onReorder={handlePanelReorder}>
          {panelId === "detail" && (
          <>
          <h2>单视频详情</h2>
          <div className="detail-select">
            <VideoSelect
              videos={videos}
              value={selectedId}
              onChange={setSelectedId}
              searchable
            />
            <div className="detail-collect-wrap">
              <button
                type="button"
                className="btn btn-primary"
                onClick={handleCollectNow}
                disabled={!selectedId || collecting}
                title={
                  youtubeApiReady
                    ? "直接请求 YouTube API 获取最新播放数据（本机快照）"
                    : "需先配置 YouTube API Key"
                }
              >
                {collecting ? "采集中…" : "立刻采集"}
              </button>
              <p className="detail-collect-hint">
                【立刻采集】：立刻获取该视频当前时刻的数据。
              </p>
              {!youtubeApiReady && selectedId && (
                <p className="detail-collect-hint warn">
                  需先配置 YouTube API Key；GitHub Pages 线上版受 CORS 限制，请用本地 npm run dev。
                </p>
              )}
            </div>
          </div>

          {detailHistoryAll.length > 0 && (
            <div className="detail-date-filter">
              <label>
                起始日期
                <input
                  type="date"
                  value={detailDateFrom}
                  min={detailDateBounds.min}
                  max={detailDateTo || detailDateBounds.max}
                  onChange={(e) => setDetailDateFrom(e.target.value)}
                />
              </label>
              <label>
                结束日期
                <input
                  type="date"
                  value={detailDateTo}
                  min={detailDateFrom || detailDateBounds.min}
                  max={detailDateBounds.max}
                  onChange={(e) => setDetailDateTo(e.target.value)}
                />
              </label>
              <button
                type="button"
                className="btn"
                onClick={() => {
                  const t = todayLocal();
                  setDetailDateFrom(t);
                  setDetailDateTo(t);
                }}
              >
                今天
              </button>
              <button
                type="button"
                className="btn"
                onClick={() => {
                  setDetailDateFrom(daysAgoLocal(6));
                  setDetailDateTo(todayLocal());
                }}
              >
                近7天
              </button>
              <button
                type="button"
                className="btn"
                disabled={!hasDateFilter}
                onClick={() => {
                  setDetailDateFrom("");
                  setDetailDateTo("");
                }}
              >
                全部
              </button>
              <span className="detail-date-hint">
                {hasDateFilter ? (
                  <>
                    已筛选 {detailDateFrom || "…"} ~ {detailDateTo || "…"} ·{" "}
                    {detailHistoryFiltered.length} 条快照
                    {isDailyCollapsedView ? "（每日取最晚）" : isTodayView ? "（按小时）" : ""}
                  </>
                ) : (
                  <>
                    全部 · {detailHistoryFiltered.length} 条快照（每日取最晚）
                  </>
                )}
              </span>
            </div>
          )}

          {detailRangeKpi && (
            <div className="kpi-grid" style={{ marginBottom: 16 }}>
              <div className="kpi-card">
                <div className="label">
                  {isTodayView || !hasDateFilter ? "当前播放" : "期末播放"}
                </div>
                <div className="value">{formatNum(detailRangeKpi.view_count)}</div>
                {isDailyCollapsedView && detailRangeKpi.delta_views > 0 && (
                  <div className="kpi-sub">+{formatNum(detailRangeKpi.delta_views)}</div>
                )}
                {isTodayView && detailRangeKpi.snapshot_time && (
                  <div className="kpi-sub">{detailRangeKpi.snapshot_time.slice(5, 16)}</div>
                )}
              </div>
              <div className="kpi-card">
                <div className="label">{isTodayView || !hasDateFilter ? "当前点赞" : "期末点赞"}</div>
                <div className="value">{formatNum(detailRangeKpi.like_count)}</div>
                {isDailyCollapsedView && detailRangeKpi.delta_likes > 0 && (
                  <div className="kpi-sub">+{formatNum(detailRangeKpi.delta_likes)}</div>
                )}
              </div>
              <div className="kpi-card">
                <div className="label">{isTodayView || !hasDateFilter ? "当前评论" : "期末评论"}</div>
                <div className="value">{formatNum(detailRangeKpi.comment_count)}</div>
                {isDailyCollapsedView && detailRangeKpi.delta_comments > 0 && (
                  <div className="kpi-sub">+{formatNum(detailRangeKpi.delta_comments)}</div>
                )}
              </div>
            </div>
          )}
          <div className="detail-charts">
            <div className="detail-chart-block">
              <h3>播放量趋势</h3>
              <div className="chart-box">
                {detailHistoryFiltered.length ? (
                  <LazyChart option={detailViewsOption} style={{ height: "100%" }} />
                ) : detailHistoryAll.length ? (
                  <p className="empty">所选日期范围内暂无快照数据</p>
                ) : (
                  <p className="empty">选择视频后查看趋势</p>
                )}
              </div>
            </div>
            <div className="detail-chart-block">
              <h3>点赞 / 评论趋势</h3>
              <div className="chart-box">
                {detailHistoryFiltered.length ? (
                  <LazyChart option={detailEngagementOption} style={{ height: "100%" }} />
                ) : detailHistoryAll.length ? (
                  <p className="empty">所选日期范围内暂无快照数据</p>
                ) : (
                  <p className="empty">选择视频后查看趋势</p>
                )}
              </div>
            </div>
          </div>
          </>
          )}

          {panelId === "videos" && (
          <>
        <div className="section-head">
          <h2>视频列表管理</h2>
          <div className="summary-kpi">
            <span className="summary-kpi-label">监控视频数</span>
            <span className="summary-kpi-value">{kpi?.video_count ?? videos.length}</span>
          </div>
        </div>
        <div className="add-form">
          <input
            placeholder="粘贴 YouTube 链接或 11 位 Video ID"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleAdd()}
          />
          <button className="btn btn-primary" onClick={handleAdd} disabled={adding}>
            {adding ? "添加中…" : "添加视频"}
          </button>
          {!showBatchForm && (
            <button className="btn" onClick={() => setShowBatchForm(true)}>
              批量添加
            </button>
          )}
        </div>
        {showBatchForm && (
          <div className="batch-add-form">
            <textarea
              placeholder={BATCH_INPUT_PLACEHOLDER}
              value={batchInput}
              onChange={(e) => setBatchInput(e.target.value)}
              rows={5}
              autoFocus
            />
            <div className="batch-add-actions">
              <button
                className="btn btn-primary"
                onClick={handleBatchAdd}
                disabled={batchAdding || !batchInput.trim()}
              >
                {batchAdding ? "添加中…" : "确认添加"}
              </button>
              <button
                className="btn"
                onClick={() => {
                  setShowBatchForm(false);
                  setBatchInput("");
                }}
                disabled={batchAdding}
              >
                取消
              </button>
            </div>
          </div>
        )}
        <div className="table-scroll">
        <table className="video-table">
          <thead>
            <tr>
              <th>缩略图</th>
              <th>标题</th>
              <th className="col-middle">频道</th>
              <th className="col-middle">状态</th>
              <th className="col-middle">操作</th>
            </tr>
          </thead>
          <tbody>
            {videos.map((v) => {
              const rank = visibleDashboard?.rankings.find((r) => r.video_id === v.video_id);
              const live = liveStats[v.video_id];
              const syncLabel = videoSyncLabel(v.video_id, serverVideoIds, githubPendingIds);
              const isLocal = Boolean(syncLabel);
              const needsGithubSync = !serverVideoIds.has(v.video_id);
              const isSyncing = syncingIds.has(v.video_id);
              return (
                <tr key={v.video_id}>
                  <td>
                    <Thumbnail videoId={v.video_id} url={v.thumbnail_url} />
                  </td>
                  <td>
                    <a
                      className="link"
                      href={v.video_url}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {v.title || v.video_id}
                    </a>
                    {syncLabel && <span className="local-badge">{syncLabel}</span>}
                    {(live || rank) && (
                      <div className="rank-meta">
                        {formatNum(live?.view_count ?? rank?.view_count ?? 0)} 播放 ·{" "}
                        {formatNum(live?.like_count ?? rank?.like_count ?? 0)} 赞
                        {live && <span className="live-tag"> · 即时</span>}
                      </div>
                    )}
                  </td>
                  <td className="col-middle">{v.channel_title || "—"}</td>
                  <td className="col-middle">{isLocal ? "pending" : v.status}</td>
                  <td className="col-middle video-actions-cell">
                    <div className="video-actions">
                      <button
                        className="btn"
                        style={{ padding: "4px 10px", fontSize: "0.8rem" }}
                        onClick={() => setSelectedId(v.video_id)}
                      >
                        详情
                      </button>
                      {needsGithubSync && (
                        <button
                          className="btn btn-primary"
                          style={{ padding: "4px 10px", fontSize: "0.8rem" }}
                          onClick={() => handleSyncToGithub(v.video_id)}
                          disabled={isSyncing}
                          title="写入 GitHub inputs/videos.csv"
                        >
                          {isSyncing ? "同步中…" : githubPendingIds.has(v.video_id) ? "重试同步" : "同步 GitHub"}
                        </button>
                      )}
                      <button
                        className="btn btn-danger"
                        style={{ padding: "4px 10px", fontSize: "0.8rem" }}
                        onClick={() => handleDeleteVideo(v)}
                        disabled={deletingIds.has(v.video_id)}
                        title="删除视频并清理相关数据"
                      >
                        {deletingIds.has(v.video_id) ? "删除中…" : "删除"}
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        </div>
        {!videos.length && (
          <p className="empty">暂无视频，请添加 YouTube 链接开始监控</p>
        )}
          </>
          )}

          {panelId === "rankings" && (
          <>
        <div className="section-head">
          <h2>播放量排行榜</h2>
          <div className="rank-sort-bar">
            <span className="rank-sort-label">排序</span>
            <button
              type="button"
              className={`btn rank-sort-btn${rankSortBy === "view_count" ? " active" : ""}`}
              onClick={() => setRankSortBy("view_count")}
            >
              播放量
            </button>
            <button
              type="button"
              className={`btn rank-sort-btn${rankSortBy === "like_count" ? " active" : ""}`}
              onClick={() => setRankSortBy("like_count")}
            >
              点赞量
            </button>
            <button
              type="button"
              className={`btn rank-sort-btn${rankSortBy === "comment_count" ? " active" : ""}`}
              onClick={() => setRankSortBy("comment_count")}
            >
              评论数
            </button>
            <button
              type="button"
              className={`rank-order-badge ${rankSortOrder === "desc" ? "desc" : "asc"}`}
              onClick={() => setRankSortOrder((order) => (order === "desc" ? "asc" : "desc"))}
              title="点击切换升序 / 降序"
            >
              {rankSortOrder === "desc" ? "降序 ↓" : "升序 ↑"}
            </button>
          </div>
        </div>
        <ul className="rank-list">
          {sortedRankings.map((r, i) => {
            const rates = engagementRates(r.view_count, r.like_count, r.comment_count);
            return (
              <li key={r.video_id} className="rank-item">
                <span className={`rank-num ${i < 3 ? "top" : ""}`}>{i + 1}</span>
                <Thumbnail videoId={r.video_id} url={r.thumbnail_url} />
                <div className="rank-info">
                  <div className="rank-title">{r.title}</div>
                  <div className="rank-meta">
                    {formatNum(r.view_count)} 播放 · {formatNum(r.like_count)} 赞 ·{" "}
                    {formatNum(r.comment_count)} 评论
                  </div>
                </div>
                <div className="rank-rates">
                  <span className="rank-rate-badge like">点赞率 {rates.likeRate}%</span>
                  <span className="rank-rate-badge comment">评论率 {rates.commentRate}%</span>
                </div>
              </li>
            );
          })}
        </ul>
        {!sortedRankings.length && (
          <p className="empty">采集数据后将显示排行</p>
        )}
          </>
          )}
        </DraggablePanel>
      ))}

      </div>

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
