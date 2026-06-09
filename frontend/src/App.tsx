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
import { matchVideo, VideoSelect } from "./VideoSelect";
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
  videoSyncBadge,
} from "./localVideos";
import {
  appendVideosToGithubCsv,
  downloadVideosCsv,
  formatGithubSyncError,
  isGithubSyncReady,
  removeVideosFromGithub,
} from "./githubCsvSync";
import {
  persistCollectedSnapshots,
  statsToSnapshotInput,
  type SnapshotPersistInput,
} from "./persistSnapshots";
import {
  GithubActionsPanel,
  type GithubActionsPanelHandle,
} from "./GithubActionsPanel";
import { GithubSyncPanel } from "./GithubSyncPanel";
import { YoutubeApiPanel } from "./YoutubeApiPanel";
import { LazyChart } from "./LazyChart";
import {
  appendLocalSnapshot,
  buildMergedDetail,
  removeLocalSnapshotsByVideoIds,
} from "./localSnapshots";
import { fetchYoutubeVideoStats, type YoutubeVideoStats } from "./youtubeCollect";
import { isYoutubeApiReady, loadYoutubeApiKey } from "./youtubeSettings";
import {
  loadVideoListPageSize,
  navigateToPage,
  pageFromHash,
  pageLabel,
  saveVideoListPageSize,
  type PanelId,
} from "./dashboardLayout";
import {
  availableDateRange,
  computeDeltas,
  dateRangeForPreset,
  detectDetailDatePreset,
  filterHistoryForDetail,
  isSingleDayDetailFilter,
  shouldCollapseDailySnapshots,
  loadDetailDateFilter,
  loadDetailSelectedId,
  rangeStats,
  saveDetailDateFilter,
  saveDetailSelectedId,
  type DetailDatePreset,
  type HistoryPoint,
} from "./detailFilter";

function formatNum(n: number) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(3) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(3) + "K";
  return n.toFixed(3);
}

/** 新增播放 / 新增点赞 / 新增评论等增量数据 */
function formatDeltaNum(n: number) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "K";
  return n.toFixed(1);
}

function isDeltaSeriesName(name: string) {
  return name.startsWith("新增");
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
type VideoListSortKey = "created_at" | "publish_time";
type VideoListSortOrder = "asc" | "desc";

const DEFAULT_VIDEO_LIST_PAGE_SIZE = 5;
const MAX_VIDEO_LIST_PAGE_SIZE = 100;
const RANK_LIST_PAGE_SIZE = 10;

function createdAtTimestamp(createdAt: string): number {
  const t = Date.parse((createdAt || "").replace(" ", "T"));
  return Number.isNaN(t) ? 0 : t;
}

function publishTimeTimestamp(publishTime: string): number {
  const t = Date.parse((publishTime || "").trim());
  return Number.isNaN(t) ? 0 : t;
}

function formatPublishDate(publishTime: string): string {
  if (!publishTime) return "—";
  return publishTime.slice(0, 10);
}

function formatAddedDate(createdAt: string): string {
  if (!createdAt) return "—";
  const t = Date.parse(createdAt.replace(" ", "T"));
  if (Number.isNaN(t)) return createdAt;
  return new Date(t).toLocaleString("zh-CN", { hour12: false });
}

function buildPaginationItems(current: number, total: number): Array<number | "ellipsis"> {
  if (total <= 1) return [1];
  if (total <= 7) {
    return Array.from({ length: total }, (_, index) => index + 1);
  }

  const pages = new Set<number>([1, total, current, current - 1, current + 1]);
  const sorted = [...pages].filter((page) => page >= 1 && page <= total).sort((a, b) => a - b);
  const items: Array<number | "ellipsis"> = [];

  sorted.forEach((page, index) => {
    if (index > 0 && page - sorted[index - 1] > 1) {
      items.push("ellipsis");
    }
    items.push(page);
  });

  return items;
}

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

type EngagementChartMode = "likes" | "comments";

export default function App() {
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [detail, setDetail] = useState<VideoDetail | null>(null);
  const [selectedId, setSelectedId] = useState(() => loadDetailSelectedId());
  const [loading, setLoading] = useState(false);
  const [generatedAt, setGeneratedAt] = useState("");
  const [toast, setToast] = useState("");
  const [detailDateFrom, setDetailDateFrom] = useState(() => loadDetailDateFilter().from);
  const [detailDateTo, setDetailDateTo] = useState(() => loadDetailDateFilter().to);
  const [engagementChartMode, setEngagementChartMode] = useState<EngagementChartMode>("likes");
  const [input, setInput] = useState("");
  const [batchInput, setBatchInput] = useState("");
  const [showBatchForm, setShowBatchForm] = useState(false);
  const [batchAdding, setBatchAdding] = useState(false);
  const [adding, setAdding] = useState(false);
  const [collecting, setCollecting] = useState(false);
  const [collectingAll, setCollectingAll] = useState(false);
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
  const [videoListSearch, setVideoListSearch] = useState("");
  const [videoListSortBy, setVideoListSortBy] = useState<VideoListSortKey>("created_at");
  const [videoListSortOrder, setVideoListSortOrder] = useState<VideoListSortOrder>("desc");
  const [videoListPage, setVideoListPage] = useState(1);
  const [videoListPageSize, setVideoListPageSize] = useState(() =>
    loadVideoListPageSize(DEFAULT_VIDEO_LIST_PAGE_SIZE, MAX_VIDEO_LIST_PAGE_SIZE)
  );
  const [videoListPageSizeInput, setVideoListPageSizeInput] = useState(() =>
    String(loadVideoListPageSize(DEFAULT_VIDEO_LIST_PAGE_SIZE, MAX_VIDEO_LIST_PAGE_SIZE))
  );
  const [videoListJumpInput, setVideoListJumpInput] = useState("");
  const [rankListPage, setRankListPage] = useState(1);
  const [rankListJumpInput, setRankListJumpInput] = useState("");
  const [activePage, setActivePage] = useState<PanelId>(() => pageFromHash());
  const serverDetailRef = useRef<Record<string, VideoDetail | null>>({});
  const lastSelectedIdRef = useRef("");
  const actionsPanelRef = useRef<GithubActionsPanelHandle>(null);

  const videos = mergeVideos(serverVideos, localVideos).filter(
    (video) => !hiddenVideoIds.has(video.video_id)
  );

  const videosSortedByNewest = useMemo(
    () =>
      [...videos].sort(
        (a, b) => createdAtTimestamp(b.created_at) - createdAtTimestamp(a.created_at)
      ),
    [videos]
  );

  const videosSortedForList = useMemo(() => {
    const sorted = [...videos];
    sorted.sort((a, b) => {
      const aVal =
        videoListSortBy === "created_at"
          ? createdAtTimestamp(a.created_at)
          : publishTimeTimestamp(a.publish_time);
      const bVal =
        videoListSortBy === "created_at"
          ? createdAtTimestamp(b.created_at)
          : publishTimeTimestamp(b.publish_time);
      const diff = aVal - bVal;
      return videoListSortOrder === "asc" ? diff : -diff;
    });
    return sorted;
  }, [videos, videoListSortBy, videoListSortOrder]);

  const videosForList = useMemo(() => {
    const query = videoListSearch.trim();
    if (!query) return videosSortedForList;
    return videosSortedForList.filter((video) => matchVideo(video, query));
  }, [videosSortedForList, videoListSearch]);

  const videoListTotalPages = Math.max(
    1,
    Math.ceil(videosForList.length / videoListPageSize)
  );

  const pagedVideos = useMemo(() => {
    const start = (videoListPage - 1) * videoListPageSize;
    return videosForList.slice(start, start + videoListPageSize);
  }, [videosForList, videoListPage, videoListPageSize]);

  useEffect(() => {
    setVideoListPage(1);
  }, [videoListSearch]);

  useEffect(() => {
    setVideoListPage(1);
  }, [videoListSortBy, videoListSortOrder]);

  useEffect(() => {
    if (videoListPage > videoListTotalPages) {
      setVideoListPage(videoListTotalPages);
    }
  }, [videoListPage, videoListTotalPages]);

  const videoListPageItems = useMemo(
    () => buildPaginationItems(videoListPage, videoListTotalPages),
    [videoListPage, videoListTotalPages]
  );

  const showToast = (msg: string, durationMs = 3500) => {
    setToast(msg);
    setTimeout(() => setToast(""), durationMs);
  };

  const handleVideoListJump = () => {
    const page = Number.parseInt(videoListJumpInput.trim(), 10);
    if (!Number.isFinite(page) || page < 1 || page > videoListTotalPages) {
      showToast(`请输入 1–${videoListTotalPages} 之间的页码`);
      return;
    }
    setVideoListPage(page);
    setVideoListJumpInput("");
  };

  const applyVideoListPageSize = () => {
    const size = Number.parseInt(videoListPageSizeInput.trim(), 10);
    if (!Number.isFinite(size) || size < 1 || size > MAX_VIDEO_LIST_PAGE_SIZE) {
      showToast(`每页条数请输入 1–${MAX_VIDEO_LIST_PAGE_SIZE} 之间的整数`);
      setVideoListPageSizeInput(String(videoListPageSize));
      return;
    }
    if (size !== videoListPageSize) {
      setVideoListPageSize(size);
      setVideoListPage(1);
    }
    saveVideoListPageSize(size);
    setVideoListPageSizeInput(String(size));
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
      const visible = mergeVideos(list, loadLocalVideos()).filter(
        (v) => !loadHiddenVideoIds().has(v.video_id)
      );
      const newest = [...visible].sort(
        (a, b) => createdAtTimestamp(b.created_at) - createdAtTimestamp(a.created_at)
      )[0];
      const currentSelectedExists = selectedId
        ? visible.some((video) => video.video_id === selectedId)
        : false;
      if (!currentSelectedExists && newest) {
        setSelectedId(newest.video_id);
      }
    } catch (e) {
      showToast("数据未加载，请先运行 python scripts/build_static.py");
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [selectedId]);

  const applyDetailDatePreset = useCallback((preset: DetailDatePreset) => {
    if (preset === "all") {
      setDetailDateFrom("");
      setDetailDateTo("");
      return;
    }
    if (preset === "custom") return;
    const range = dateRangeForPreset(preset);
    setDetailDateFrom(range.from);
    setDetailDateTo(range.to);
  }, []);

  const normalizeVideoDetail = (d: VideoDetail | null): VideoDetail | null => {
    if (!d || typeof d !== "object") return null;
    return {
      ...d,
      history: Array.isArray(d.history) ? d.history : [],
      view_deltas: Array.isArray(d.view_deltas) ? d.view_deltas : [],
    };
  };

  const rebuildDetailForVideo = useCallback(
    (videoId: string, stats?: YoutubeVideoStats) => {
      const videoMeta =
        loadLocalVideos().find((item) => item.video_id === videoId) ??
        serverVideos.find((item) => item.video_id === videoId);
      if (!videoMeta) return;
      setDetail(
        buildMergedDetail(videoId, serverDetailRef.current[videoId] ?? null, videoMeta, stats)
      );
    },
    [serverVideos]
  );

  const refreshDetailForVideo = async (videoId: string) => {
    clearSiteCache();
    try {
      const normalized = normalizeVideoDetail(await fetchVideoDetail(videoId));
      serverDetailRef.current[videoId] = normalized;

      const videoMeta =
        loadLocalVideos().find((item) => item.video_id === videoId) ??
        serverVideos.find((item) => item.video_id === videoId);

      if (videoMeta) {
        setDetail(buildMergedDetail(videoId, normalized, videoMeta));
      } else if (normalized) {
        setDetail(normalized);
      }
    } catch {
      // 保留当前详情与日期筛选
    }
  };

  const refreshDashboardMeta = async () => {
    clearSiteCache();
    try {
      const [health, dash] = await Promise.all([fetchHealth(), fetchDashboard()]);
      setGeneratedAt(health.generated_at || "");
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
    } catch {
      // 忽略看板元数据刷新失败
    }
  };

  const syncVideosToGithub = async (
    ids: string[],
    options?: { quiet?: boolean; createdAtById?: Record<string, string> }
  ): Promise<"ok" | "no_token" | "failed" | "skipped"> => {
    if (!ids.length) return "skipped";

    if (!githubSyncReady) {
      if (!options?.quiet) {
        showToast("请先点击「GitHub 同步」配置 Token 并保存", 6000);
      }
      return "no_token";
    }

    const sync = await appendVideosToGithubCsv(ids, undefined, options?.createdAtById);

    if (sync.ok) {
      markGithubPendingIds(ids);
      setGithubPendingIds(loadGithubPendingIds());
      if (!options?.quiet) {
        if (sync.added > 0) {
          showToast(`已写入 inputs/videos.csv（${sync.added} 个）`, 5000);
        } else {
          showToast("视频已在 videos.csv 中", 5000);
        }
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

  const clearLiveStatsForIds = (videoIds: string[]) => {
    if (!videoIds.length) return;
    const drop = new Set(videoIds);
    setLiveStats((prev) => {
      const next = { ...prev };
      for (const id of drop) delete next[id];
      return next;
    });
  };

  const persistCollectedStatsToFile = async (
    snapshots: SnapshotPersistInput[],
    onProgress?: (message: string) => void
  ): Promise<{ ok: true } | { ok: false; error: string }> => {
    return persistCollectedSnapshots(snapshots, {
      githubSyncReady,
      onProgress,
    });
  };

  const applyFetchedYoutubeStats = (stats: YoutubeVideoStats) => {
    const snap = appendLocalSnapshot(stats);
    updateLocalVideoMetadata(stats.video_id, {
      title: stats.title,
      channel_title: stats.channel_title,
      thumbnail_url: stats.thumbnail_url,
      publish_time: stats.publish_time,
      status: "active",
    });
    return {
      view_count: stats.view_count,
      like_count: stats.like_count,
      comment_count: stats.comment_count,
      time: snap.snapshot_time,
      snapshot: statsToSnapshotInput(stats, snap.snapshot_time),
    };
  };

  const collectStatsForVideoIds = async (
    videoIds: string[],
    source: "import" | "manual" | "batch" = "import",
    options?: { skipPersist?: boolean }
  ) => {
    const uniqueIds = [...new Set(videoIds.filter(Boolean))];
    if (!uniqueIds.length) return;

    const apiKey = loadYoutubeApiKey();
    if (!apiKey) {
      if (source === "manual") {
        showToast("请先点击「配置 YouTube 即时采集」并保存 API Key（AIzaSy…）", 6000);
      } else if (source === "batch") {
        showToast("请先配置 YouTube API Key 后再使用「立即采集」", 6000);
      } else {
        showToast("视频已添加。配置 API Key 后可自动拉取播放数据", 5000);
      }
      return;
    }

    try {
      if (source === "batch") {
        showToast(`正在采集全部 ${uniqueIds.length} 个视频的播放数据…`, 8000);
      } else if (source === "manual") {
        showToast("正在请求 YouTube API…", 5000);
      } else if (uniqueIds.length === 1) {
        showToast("正在拉取播放数据…", 4000);
      } else {
        showToast(`正在拉取 ${uniqueIds.length} 个视频的播放数据…`, 5000);
      }

      const statsMap = await fetchYoutubeVideoStats(uniqueIds, apiKey);
      const statsList = uniqueIds
        .map((id) => statsMap[id])
        .filter((stats): stats is YoutubeVideoStats => Boolean(stats));

      if (!statsList.length) {
        showToast(
          source === "manual" && uniqueIds.length === 1
            ? "YouTube 未返回该视频数据，请检查 Video ID 是否有效"
            : "YouTube 未返回视频数据",
          6000
        );
        return;
      }

      const livePatch: Record<
        string,
        { view_count: number; like_count: number; comment_count: number; time: string }
      > = {};
      const persistSnapshots: SnapshotPersistInput[] = [];
      for (const stats of statsList) {
        const applied = applyFetchedYoutubeStats(stats);
        livePatch[stats.video_id] = applied;
        persistSnapshots.push(applied.snapshot);
      }
      setLiveStats((prev) => ({ ...prev, ...livePatch }));
      setLocalVideos(loadLocalVideos());

      const missed = uniqueIds.length - statsList.length;
      const isSingleManual = source === "manual" && uniqueIds.length === 1;
      const firstStats = statsList[0];

      if (isSingleManual) {
        rebuildDetailForVideo(uniqueIds[0], firstStats);
      }
      const collectedIds = statsList.map((stats) => stats.video_id);
      const canPersistToFile =
        !options?.skipPersist && (import.meta.env.DEV || githubSyncReady);

      let persistResult: { ok: true } | { ok: false; error: string } | null = null;
      if (canPersistToFile) {
        persistResult = await persistCollectedStatsToFile(persistSnapshots, (msg) =>
          showToast(msg, 6000)
        );
        if (persistResult.ok) {
          clearLiveStatsForIds(collectedIds);
          if (isSingleManual) {
            await refreshDetailForVideo(uniqueIds[0]);
            await refreshDashboardMeta();
          } else {
            clearSiteCache();
            await refresh();
          }
        }
      }

      const wroteToFile = persistResult?.ok === true;

      if (isSingleManual) {
        if (wroteToFile) {
          showToast(
            import.meta.env.DEV
              ? `已写入 store.json：${formatNum(firstStats.view_count)} 播放 · ${formatNum(firstStats.like_count)} 赞`
              : `已写入数据文件：${formatNum(firstStats.view_count)} 播放 · ${formatNum(firstStats.like_count)} 赞`,
            6000
          );
        } else if (canPersistToFile) {
          showToast(
            `采集成功，但写入数据文件失败：${persistResult && !persistResult.ok ? persistResult.error : "未知错误"}（列表仍显示「即时」）`,
            8000
          );
        } else {
          showToast(
            `已采集：${formatNum(firstStats.view_count)} 播放 · ${formatNum(firstStats.like_count)} 赞（未写入数据文件，显示「即时」）`,
            6000
          );
        }
        return;
      }

      if (wroteToFile) {
        showToast(
          source === "batch"
            ? missed > 0
              ? `已全部采集 ${statsList.length} 个视频并写入数据文件（${missed} 个未返回）`
              : `已全部采集 ${statsList.length} 个视频并写入数据文件`
            : missed > 0
              ? `已拉取 ${statsList.length} 个视频并写入数据文件（${missed} 个未返回）`
              : `已拉取 ${statsList.length} 个视频的播放数据并写入数据文件`,
          6000
        );
      } else if (canPersistToFile) {
        const persistError =
          persistResult && !persistResult.ok ? persistResult.error : "未知错误";
        showToast(
          `已采集 ${statsList.length} 个视频，但写入数据文件失败：${persistError}（列表仍显示「即时」）`,
          7000
        );
      } else {
        showToast(
          source === "batch"
            ? missed > 0
              ? `已采集 ${statsList.length} 个视频（${missed} 个未返回，未写入数据文件，显示「即时」）`
              : `已采集 ${statsList.length} 个视频（未写入数据文件，显示「即时」）`
            : missed > 0
              ? `已采集 ${statsList.length} 个视频（${missed} 个未返回，未写入数据文件，显示「即时」）`
              : `已采集 ${statsList.length} 个视频（未写入数据文件，显示「即时」）`,
          5000
        );
      }
    } catch (error) {
      showToast(error instanceof Error ? error.message : "采集失败", 8000);
    }
  };

  const persistAddedVideos = async (added: Video[]) => {
    const ids = added.map((v) => v.video_id);
    const createdAtById = Object.fromEntries(added.map((v) => [v.video_id, v.created_at]));
    if (!githubSyncReady) {
      downloadVideosCsv(ids, serverVideoIds, createdAtById);
      showToast("已添加（仅本机）。配置 GitHub 同步后将自动写入 CSV 并触发 Actions", 6000);
      await collectStatsForVideoIds(ids, "import", { skipPersist: true });
      return;
    }

    const syncResult = await syncVideosToGithub(ids, { quiet: true, createdAtById });
    if (syncResult !== "ok") {
      await collectStatsForVideoIds(ids, "import", { skipPersist: true });
      return;
    }

    showToast("已写入 CSV，正在触发 GitHub Actions 采集…", 6000);
    await collectStatsForVideoIds(ids, "import", {
      skipPersist: !import.meta.env.DEV,
    });

    if (import.meta.env.DEV) {
      showToast("本地开发：已写入 store.json", 5000);
      return;
    }

    const workflow = await actionsPanelRef.current?.triggerAndWatch({
      onProgress: (msg) => showToast(msg, 6000),
    });
    if (workflow?.ok) {
      clearGithubPendingIds(ids);
      setGithubPendingIds(loadGithubPendingIds());
      showToast("GitHub Actions 已完成，视频已同步至云端", 6000);
    } else if (workflow) {
      showToast(
        `Actions 未成功完成：${formatGithubSyncError(workflow.reason)}，可在 Actions 面板查看`,
        8000
      );
    }
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
      setVideoListPage(1);
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
      setVideoListPage(1);
      setSelectedId(result.added[0].video_id);

      await persistAddedVideos(result.added);
    } finally {
      setBatchAdding(false);
    }
  };

  const handleCollectNow = async () => {
    if (!selectedId || collecting || collectingAll) return;

    setCollecting(true);
    try {
      await collectStatsForVideoIds([selectedId], "manual");
    } finally {
      setCollecting(false);
    }
  };

  const handleCollectAllVideos = async () => {
    if (collectingAll || collecting || !videos.length) return;

    setCollectingAll(true);
    try {
      await collectStatsForVideoIds(
        videos.map((video) => video.video_id),
        "batch"
      );
    } finally {
      setCollectingAll(false);
    }
  };

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    const onHashChange = () => setActivePage(pageFromHash());
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  useEffect(() => {
    saveDetailSelectedId(selectedId);
  }, [selectedId]);

  useEffect(() => {
    saveDetailDateFilter(detailDateFrom, detailDateTo);
  }, [detailDateFrom, detailDateTo]);

  useEffect(() => {
    if (!selectedId && videosSortedByNewest.length) {
      setSelectedId(videosSortedByNewest[0].video_id);
    }
  }, [selectedId, videosSortedByNewest]);

  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      lastSelectedIdRef.current = "";
      return;
    }

    const videoMeta =
      localVideos.find((item) => item.video_id === selectedId) ??
      serverVideos.find((item) => item.video_id === selectedId);

    const selectionChanged = lastSelectedIdRef.current !== selectedId;
    if (selectionChanged) {
      lastSelectedIdRef.current = selectedId;

      fetchVideoDetail(selectedId)
        .then((d) => {
          const normalized = normalizeVideoDetail(d);
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
  const detailDatePreset = detectDetailDatePreset(detailDateFrom, detailDateTo);
  const isDailyCollapsedView =
    hasDateFilter && shouldCollapseDailySnapshots(detailDateFrom, detailDateTo);
  const isPointLevelView = hasDateFilter && !isDailyCollapsedView;
  const showCurrentDetailKpi = isSingleDayDetailFilter(detailDateFrom, detailDateTo);

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

  const rankListTotalPages = Math.max(1, Math.ceil(sortedRankings.length / RANK_LIST_PAGE_SIZE));

  const pagedRankings = useMemo(() => {
    const start = (rankListPage - 1) * RANK_LIST_PAGE_SIZE;
    return sortedRankings.slice(start, start + RANK_LIST_PAGE_SIZE);
  }, [sortedRankings, rankListPage]);

  const rankListPageItems = useMemo(
    () => buildPaginationItems(rankListPage, rankListTotalPages),
    [rankListPage, rankListTotalPages]
  );

  useEffect(() => {
    if (rankListPage > rankListTotalPages) {
      setRankListPage(rankListTotalPages);
    }
  }, [rankListPage, rankListTotalPages]);

  useEffect(() => {
    setRankListPage(1);
  }, [rankSortBy, rankSortOrder]);

  const handleRankListJump = () => {
    const page = Number.parseInt(rankListJumpInput.trim(), 10);
    if (!Number.isFinite(page) || page < 1 || page > rankListTotalPages) {
      showToast(`请输入 1–${rankListTotalPages} 之间的页码`);
      return;
    }
    setRankListPage(page);
    setRankListJumpInput("");
  };

  const openVideoDetail = (videoId: string) => {
    setSelectedId(videoId);
    navigateToPage("detail");
    setActivePage("detail");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const handleNavigate = (page: PanelId) => {
    navigateToPage(page);
    setActivePage(page);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

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
                const label = String(p.seriesName ?? "");
                const fmt = isDeltaSeriesName(label) ? formatDeltaNum : formatNum;
                html += `${p.marker}${label}：${fmt(Number(p.value))}<br/>`;
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
                formatter: (v: number) => formatDeltaNum(v),
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

  const detailEngagementOption = useMemo(() => {
    if (!detailHistoryFiltered.length) return {};

    const isLikes = engagementChartMode === "likes";
    const mainValues = detailHistoryFiltered.map((h) => (isLikes ? h.likes : h.comments));
    const deltaValues = [
      0,
      ...detailDeltasFiltered.map((d) => (isLikes ? d.delta_likes : d.delta_comments)),
    ];
    const mainName = isLikes ? "点赞" : "评论";
    const deltaName = isLikes ? "新增点赞" : "新增评论";
    const mainColor = isLikes ? "#3b82f6" : "#f59e0b";
    const areaColor = isLikes ? "rgba(59, 130, 246, 0.1)" : "rgba(245, 158, 11, 0.1)";
    const barColor = isLikes ? "#60a5fa" : "#fbbf24";
    const mainAxis = trendAxisBounds(mainValues);
    const deltaAxis = trendAxisBounds(deltaValues);
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
            const label = String(p.seriesName ?? "");
            const fmt = isDeltaSeriesName(label) ? formatDeltaNum : formatNum;
            html += `${p.marker}${label}：${fmt(Number(p.value))}<br/>`;
          }
          return html;
        },
      },
      legend: { data: [mainName, deltaName], textStyle: { color: "#8b9cb3" } },
      grid: detailChartGrid,
      xAxis: {
        type: "category",
        data: timeLabels,
        axisLabel: { color: "#8b9cb3", margin: 10 },
      },
      yAxis: [
        {
          type: "value",
          name: mainName,
          position: "left",
          nameGap: 12,
          ...mainAxis,
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
          name: deltaName,
          position: "right",
          nameGap: 12,
          ...deltaAxis,
          scale: true,
          axisLabel: {
            color: "#8b9cb3",
            formatter: (v: number) => formatDeltaNum(v),
            margin: 12,
          },
          splitLine: { show: false },
        },
      ],
      series: [
        {
          name: mainName,
          type: "line",
          smooth: true,
          yAxisIndex: 0,
          data: mainValues,
          lineStyle: { color: mainColor, width: 2 },
          itemStyle: { color: mainColor },
          areaStyle: { color: areaColor },
        },
        {
          name: deltaName,
          type: "bar",
          yAxisIndex: 1,
          barMaxWidth: 20,
          data: deltaValues,
          itemStyle: { color: barColor, opacity: 0.85, borderRadius: [3, 3, 0, 0] },
        },
      ],
    };
  }, [detailHistoryFiltered, detailDeltasFiltered, engagementChartMode]);

  const kpi = visibleDashboard?.kpi;

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
        <GithubActionsPanel
          ref={actionsPanelRef}
          githubSyncReady={githubSyncReady}
          onCollectCompleted={() => {
            clearSiteCache();
            refresh();
          }}
        />
      </div>

      <div className="app-layout">
        <aside className="app-sidebar">
          <nav className="app-sidebar-nav" aria-label="主导航">
            {(["detail", "videos", "rankings"] as PanelId[]).map((page) => (
              <button
                key={page}
                type="button"
                className={`app-nav-item${activePage === page ? " active" : ""}`}
                aria-current={activePage === page ? "page" : undefined}
                onClick={() => handleNavigate(page)}
              >
                {pageLabel(page)}
              </button>
            ))}
          </nav>
        </aside>

        <main className="app-main">
          {activePage === "detail" && (
          <section className="section app-page" id="panel-detail">
          <h2>视频详情</h2>
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
                disabled={!selectedId || collecting || collectingAll}
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
                className={`btn detail-date-preset-btn${detailDatePreset === "today" ? " active" : ""}`}
                onClick={() => applyDetailDatePreset("today")}
              >
                今天
              </button>
              <button
                type="button"
                className={`btn detail-date-preset-btn${detailDatePreset === "last7" ? " active" : ""}`}
                onClick={() => applyDetailDatePreset("last7")}
              >
                近7天
              </button>
              <button
                type="button"
                className={`btn detail-date-preset-btn${detailDatePreset === "last30" ? " active" : ""}`}
                onClick={() => applyDetailDatePreset("last30")}
              >
                近30天
              </button>
              <button
                type="button"
                className={`btn detail-date-preset-btn${detailDatePreset === "all" ? " active" : ""}`}
                onClick={() => applyDetailDatePreset("all")}
              >
                全部
              </button>
              <span className="detail-date-hint">
                {hasDateFilter ? (
                  <>
                    已筛选 {detailDateFrom || "…"} ~ {detailDateTo || "…"} ·{" "}
                    {detailHistoryFiltered.length} 条快照
                    {isDailyCollapsedView
                      ? "（每日取最晚）"
                      : isPointLevelView
                        ? "（按采集时点）"
                        : ""}
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
                  {showCurrentDetailKpi ? "当前播放" : "新增播放"}
                </div>
                <div className="value">
                  {showCurrentDetailKpi
                    ? formatNum(detailRangeKpi.view_count)
                    : formatDeltaNum(detailRangeKpi.delta_views)}
                </div>
                {showCurrentDetailKpi && detailRangeKpi.snapshot_time && (
                  <div className="kpi-sub">{detailRangeKpi.snapshot_time.slice(5, 16)}</div>
                )}
              </div>
              <div className="kpi-card">
                <div className="label">{showCurrentDetailKpi ? "当前点赞" : "新增点赞"}</div>
                <div className="value">
                  {showCurrentDetailKpi
                    ? formatNum(detailRangeKpi.like_count)
                    : formatDeltaNum(detailRangeKpi.delta_likes)}
                </div>
              </div>
              <div className="kpi-card">
                <div className="label">{showCurrentDetailKpi ? "当前评论" : "新增评论"}</div>
                <div className="value">
                  {showCurrentDetailKpi
                    ? formatNum(detailRangeKpi.comment_count)
                    : formatDeltaNum(detailRangeKpi.delta_comments)}
                </div>
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
              <div className="detail-chart-head">
                <h3>互动趋势</h3>
                <div className="detail-chart-toggle">
                  <button
                    type="button"
                    className={`btn detail-chart-toggle-btn${engagementChartMode === "likes" ? " active" : ""}`}
                    onClick={() => setEngagementChartMode("likes")}
                  >
                    点赞
                  </button>
                  <button
                    type="button"
                    className={`btn detail-chart-toggle-btn${engagementChartMode === "comments" ? " active" : ""}`}
                    onClick={() => setEngagementChartMode("comments")}
                  >
                    评论
                  </button>
                </div>
              </div>
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
          </section>
          )}

          {activePage === "videos" && (
          <section className="section app-page" id="panel-videos">
        <div className="section-head">
          <h2>视频列表管理</h2>
          <div className="section-head-actions">
            <button
              type="button"
              className="btn btn-primary"
              onClick={handleCollectAllVideos}
              disabled={collectingAll || collecting || !videos.length}
              title={
                youtubeApiReady
                  ? "请求 YouTube API 采集全部视频当前播放数据"
                  : "需先配置 YouTube API Key"
              }
            >
              {collectingAll ? "采集中…" : "立即采集"}
            </button>
            <div className="summary-kpi">
              <span className="summary-kpi-label">监控视频数</span>
              <span className="summary-kpi-value">{kpi?.video_count ?? videos.length}</span>
            </div>
          </div>
        </div>
        <p className="detail-collect-hint">
          当 GitHub 每 2 小时定时采集失败时，可点此手动采集全部视频的当前播放数据。
          {import.meta.env.DEV
            ? " 本地开发会写入 store.json；线上版会触发 GitHub Actions。"
            : githubSyncReady
              ? " 采集后会触发 GitHub Actions 写入云端数据。"
              : " 配置 GitHub 同步后可写入云端 store.json。"}
        </p>
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
        {videos.length > 0 && (
          <>
          <div className="video-list-toolbar">
            <input
              type="search"
              className="video-search-input"
              placeholder="搜索标题、频道或视频 ID"
              value={videoListSearch}
              onChange={(e) => setVideoListSearch(e.target.value)}
              aria-label="搜索视频"
            />
            {videoListSearch.trim() && (
              <button
                type="button"
                className="btn"
                onClick={() => setVideoListSearch("")}
              >
                清除
              </button>
            )}
          </div>
          <div className="video-list-sort-bar">
            <span className="rank-sort-label">排序</span>
            <button
              type="button"
              className={`btn rank-sort-btn${videoListSortBy === "created_at" ? " active" : ""}`}
              onClick={() => setVideoListSortBy("created_at")}
            >
              添加时间
            </button>
            <button
              type="button"
              className={`btn rank-sort-btn${videoListSortBy === "publish_time" ? " active" : ""}`}
              onClick={() => setVideoListSortBy("publish_time")}
            >
              发布时间
            </button>
            <button
              type="button"
              className={`rank-order-badge ${videoListSortOrder === "desc" ? "desc" : "asc"}`}
              onClick={() =>
                setVideoListSortOrder((order) => (order === "desc" ? "asc" : "desc"))
              }
              title="点击切换升序 / 降序"
            >
              {videoListSortOrder === "desc" ? "降序 ↓" : "升序 ↑"}
            </button>
          </div>
          </>
        )}
        <div className="table-scroll">
        <table className="video-table">
          <thead>
            <tr>
              <th>缩略图</th>
              <th>标题</th>
              <th className="col-middle">频道</th>
              <th className="col-middle col-date">发布时间</th>
              <th className="col-middle col-date">添加时间</th>
              <th className="col-middle">状态</th>
              <th className="col-middle">操作</th>
            </tr>
          </thead>
          <tbody>
            {!pagedVideos.length ? (
              <tr>
                <td colSpan={7} className="empty">
                  {videoListSearch.trim() ? "无匹配视频" : "暂无视频"}
                </td>
              </tr>
            ) : (
            pagedVideos.map((v) => {
              const rank = visibleDashboard?.rankings.find((r) => r.video_id === v.video_id);
              const live = liveStats[v.video_id];
              const syncBadge = videoSyncBadge(v.video_id, serverVideoIds, githubPendingIds);
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
                    {(live || rank) && (
                      <div className="rank-meta">
                        {formatNum(live?.view_count ?? rank?.view_count ?? 0)} 播放 ·{" "}
                        {formatNum(live?.like_count ?? rank?.like_count ?? 0)} 赞
                        {live && (
                          <span className="live-tag" title="尚未写入 store.json / site.json">
                            {" "}
                            · 即时
                          </span>
                        )}
                      </div>
                    )}
                  </td>
                  <td className="col-middle">{v.channel_title || "—"}</td>
                  <td className="col-middle col-date">{formatPublishDate(v.publish_time)}</td>
                  <td className="col-middle col-date">{formatAddedDate(v.created_at)}</td>
                  <td className="col-middle">
                    {syncBadge && (
                      <span className={`sync-badge sync-badge-${syncBadge.kind}`}>
                        {syncBadge.text}
                      </span>
                    )}
                    <div className={`video-status-meta${syncBadge ? "" : " video-status-meta-only"}`}>
                      {!serverVideoIds.has(v.video_id) ? "pending" : v.status}
                    </div>
                  </td>
                  <td className="col-middle video-actions-cell">
                    <div className="video-actions">
                      <button
                        className="btn"
                        style={{ padding: "4px 10px", fontSize: "0.8rem" }}
                        onClick={() => openVideoDetail(v.video_id)}
                      >
                        详情
                      </button>
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
            })
            )}
          </tbody>
        </table>
        </div>
        {videos.length > 0 && (
          <div className="video-list-pagination">
            <div className="video-list-pagination-meta">
              <span className="video-list-pagination-info">
                共 {videosForList.length} 条
                {videoListSearch.trim() ? `（已筛选，总计 ${videos.length} 条）` : ""}
                {" · "}第 {videoListPage} / {videoListTotalPages} 页
              </span>
              <div className="video-list-pagination-size">
                <span className="video-list-pagination-jump-label">每页</span>
                <input
                  type="number"
                  className="video-list-pagination-jump-input"
                  min={1}
                  max={MAX_VIDEO_LIST_PAGE_SIZE}
                  value={videoListPageSizeInput}
                  onChange={(e) => setVideoListPageSizeInput(e.target.value)}
                  onBlur={applyVideoListPageSize}
                  onKeyDown={(e) => e.key === "Enter" && applyVideoListPageSize()}
                  aria-label="每页显示条数"
                />
                <span className="video-list-pagination-jump-label">条</span>
              </div>
            </div>
            <div className="video-list-pagination-controls">
              <button
                type="button"
                className="btn"
                disabled={videoListPage <= 1}
                onClick={() => setVideoListPage((page) => Math.max(1, page - 1))}
              >
                上一页
              </button>
              {videoListTotalPages > 1 && (
                <div className="video-list-pagination-pages" role="navigation" aria-label="视频列表分页">
                  {videoListPageItems.map((item, index) =>
                    item === "ellipsis" ? (
                      <span key={`ellipsis-${index}`} className="video-list-page-ellipsis">
                        …
                      </span>
                    ) : (
                      <button
                        key={item}
                        type="button"
                        className={`btn video-list-page-btn${videoListPage === item ? " active" : ""}`}
                        onClick={() => setVideoListPage(item)}
                        aria-current={videoListPage === item ? "page" : undefined}
                      >
                        {item}
                      </button>
                    )
                  )}
                </div>
              )}
              <button
                type="button"
                className="btn"
                disabled={videoListPage >= videoListTotalPages}
                onClick={() =>
                  setVideoListPage((page) => Math.min(videoListTotalPages, page + 1))
                }
              >
                下一页
              </button>
            </div>
            {videoListTotalPages > 1 && (
              <div className="video-list-pagination-jump">
                <span className="video-list-pagination-jump-label">跳至</span>
                <input
                  type="number"
                  className="video-list-pagination-jump-input"
                  min={1}
                  max={videoListTotalPages}
                  value={videoListJumpInput}
                  placeholder={String(videoListPage)}
                  onChange={(e) => setVideoListJumpInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleVideoListJump()}
                  aria-label="跳转页码"
                />
                <span className="video-list-pagination-jump-label">页</span>
                <button type="button" className="btn" onClick={handleVideoListJump}>
                  跳转
                </button>
              </div>
            )}
          </div>
        )}
        {!videos.length && (
          <p className="empty">暂无视频，请添加 YouTube 链接开始监控</p>
        )}
          </section>
          )}

          {activePage === "rankings" && (
          <section className="section app-page" id="panel-rankings">
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
          {pagedRankings.map((r, i) => {
            const rankIndex = (rankListPage - 1) * RANK_LIST_PAGE_SIZE + i + 1;
            const rates = engagementRates(r.view_count, r.like_count, r.comment_count);
            return (
              <li key={r.video_id} className="rank-item">
                <span className={`rank-num ${rankIndex <= 3 ? "top" : ""}`}>{rankIndex}</span>
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
        {sortedRankings.length > 0 && (
          <div className="video-list-pagination">
            <span className="video-list-pagination-info">
              共 {sortedRankings.length} 条 · 第 {rankListPage} / {rankListTotalPages} 页
            </span>
            <div className="video-list-pagination-controls">
              <button
                type="button"
                className="btn"
                disabled={rankListPage <= 1}
                onClick={() => setRankListPage((page) => Math.max(1, page - 1))}
              >
                上一页
              </button>
              {rankListTotalPages > 1 && (
                <div className="video-list-pagination-pages" role="navigation" aria-label="排行榜分页">
                  {rankListPageItems.map((item, index) =>
                    item === "ellipsis" ? (
                      <span key={`rank-ellipsis-${index}`} className="video-list-page-ellipsis">
                        …
                      </span>
                    ) : (
                      <button
                        key={item}
                        type="button"
                        className={`btn video-list-page-btn${rankListPage === item ? " active" : ""}`}
                        onClick={() => setRankListPage(item)}
                        aria-current={rankListPage === item ? "page" : undefined}
                      >
                        {item}
                      </button>
                    )
                  )}
                </div>
              )}
              <button
                type="button"
                className="btn"
                disabled={rankListPage >= rankListTotalPages}
                onClick={() =>
                  setRankListPage((page) => Math.min(rankListTotalPages, page + 1))
                }
              >
                下一页
              </button>
            </div>
            {rankListTotalPages > 1 && (
              <div className="video-list-pagination-jump">
                <span className="video-list-pagination-jump-label">跳至</span>
                <input
                  type="number"
                  className="video-list-pagination-jump-input"
                  min={1}
                  max={rankListTotalPages}
                  value={rankListJumpInput}
                  placeholder={String(rankListPage)}
                  onChange={(e) => setRankListJumpInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleRankListJump()}
                  aria-label="排行榜跳转页码"
                />
                <span className="video-list-pagination-jump-label">页</span>
                <button type="button" className="btn" onClick={handleRankListJump}>
                  跳转
                </button>
              </div>
            )}
          </div>
        )}
        {!sortedRankings.length && (
          <p className="empty">采集数据后将显示排行</p>
        )}
          </section>
          )}
        </main>
      </div>

      </div>

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
