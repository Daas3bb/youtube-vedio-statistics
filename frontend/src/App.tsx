import { useCallback, useEffect, useState } from "react";
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
import {
  addLocalVideos,
  BATCH_INPUT_PLACEHOLDER,
  createVideoFromInput,
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
} from "./githubCsvSync";
import { GithubSyncPanel } from "./GithubSyncPanel";
import { YoutubeApiPanel } from "./YoutubeApiPanel";
import { LazyChart } from "./LazyChart";
import { appendLocalSnapshot, buildMergedDetail } from "./localSnapshots";
import { fetchYoutubeVideoStats } from "./youtubeCollect";
import { isYoutubeApiReady, loadYoutubeApiKey } from "./youtubeSettings";
import {
  availableDateRange,
  computeDeltas,
  daysAgoLocal,
  filterHistory,
  rangeStats,
  todayLocal,
  type HistoryPoint,
} from "./detailFilter";

function formatNum(n: number) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(3) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(3) + "K";
  return n.toFixed(3);
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

export default function App() {
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [detail, setDetail] = useState<VideoDetail | null>(null);
  const [selectedId, setSelectedId] = useState("");
  const [loading, setLoading] = useState(false);
  const [dataOk, setDataOk] = useState<boolean | null>(null);
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
  const [localVideos, setLocalVideos] = useState<Video[]>(() => loadLocalVideos());
  const [serverVideos, setServerVideos] = useState<Video[]>([]);
  const [serverVideoIds, setServerVideoIds] = useState<Set<string>>(new Set());
  const [githubSyncReady, setGithubSyncReady] = useState(() => isGithubSyncReady());
  const [youtubeApiReady, setYoutubeApiReady] = useState(() => isYoutubeApiReady());
  const [githubPendingIds, setGithubPendingIds] = useState<Set<string>>(() => loadGithubPendingIds());
  const [liveStats, setLiveStats] = useState<
    Record<string, { view_count: number; like_count: number; comment_count: number; time: string }>
  >({});

  const videos = mergeVideos(serverVideos, localVideos);

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
      setDataOk(health.data_loaded);
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
      setServerVideos(list);
      setServerVideoIds(serverIdSet);
      setLocalVideos(loadLocalVideos());
      setDashboard(
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
          : null
      );
      if (!selectedId && list.length) setSelectedId(list[0].video_id);
    } catch (e) {
      setDataOk(false);
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

      appendLocalSnapshot(stats);
      updateLocalVideoMetadata(selectedId, {
        title: stats.title,
        channel_title: stats.channel_title,
        thumbnail_url: stats.thumbnail_url,
        publish_time: stats.publish_time,
        status: "active",
      });
      setLocalVideos(loadLocalVideos());
      setLiveStats((prev) => ({
        ...prev,
        [selectedId]: {
          view_count: stats.view_count,
          like_count: stats.like_count,
          comment_count: stats.comment_count,
          time: new Date().toISOString().slice(0, 16).replace("T", " "),
        },
      }));

      const videoMeta =
        videos.find((v) => v.video_id === selectedId) ??
        ({
          video_id: selectedId,
          title: stats.title,
          video_url: `https://www.youtube.com/watch?v=${selectedId}`,
          thumbnail_url: stats.thumbnail_url,
          publish_time: stats.publish_time,
          channel_title: stats.channel_title,
          status: "active",
          created_at: "",
        } as Video);

      const serverDetail = await fetchVideoDetail(selectedId).catch(() => null);
      setDetail(buildMergedDetail(selectedId, serverDetail, videoMeta, stats));
      showToast(
        `已更新：${formatNum(stats.view_count)} 播放 · ${formatNum(stats.like_count)} 赞（本机快照，Actions 每 2 小时同步云端）`,
        6000
      );
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
      return;
    }
    setDetailDateFrom("");
    setDetailDateTo("");
    fetchVideoDetail(selectedId)
      .then((d) => {
        const videoMeta =
          localVideos.find((item) => item.video_id === selectedId) ??
          serverVideos.find((item) => item.video_id === selectedId);
        if (videoMeta) {
          setDetail(
            buildMergedDetail(
              selectedId,
              d && typeof d === "object"
                ? {
                    ...d,
                    history: Array.isArray(d.history) ? d.history : [],
                    view_deltas: Array.isArray(d.view_deltas) ? d.view_deltas : [],
                  }
                : null,
              videoMeta
            )
          );
        } else if (d && typeof d === "object") {
          setDetail({
            ...d,
            history: Array.isArray(d.history) ? d.history : [],
            view_deltas: Array.isArray(d.view_deltas) ? d.view_deltas : [],
          });
        } else {
          setDetail(null);
        }
      })
      .catch(() => {
        const v =
          localVideos.find((item) => item.video_id === selectedId) ??
          serverVideos.find((item) => item.video_id === selectedId);
        if (v) {
          setDetail(buildMergedDetail(selectedId, null, v));
        } else {
          setDetail(null);
        }
      });
  }, [selectedId, localVideos, serverVideos]);

  const detailHistoryAll: HistoryPoint[] = detail?.history ?? [];
  const detailDateBounds = availableDateRange(detailHistoryAll);
  const detailHistoryFiltered = filterHistory(
    detailHistoryAll,
    detailDateFrom,
    detailDateTo
  );
  const detailDeltasFiltered = computeDeltas(detailHistoryFiltered);
  const detailRangeKpi = rangeStats(detailHistoryFiltered);
  const hasDateFilter = Boolean(detailDateFrom || detailDateTo);

  const trendOption = dashboard
    ? (() => {
        const trendValues = dashboard.trend.map((t) => t.total_views);
        const trendAxis = trendAxisBounds(trendValues);
        return {
          backgroundColor: "transparent",
          tooltip: { trigger: "axis" },
          grid: { left: 80, right: 24, top: 24, bottom: 48 },
          xAxis: {
            type: "category",
            data: dashboard.trend.map((t) => t.time),
            axisLabel: { color: "#8b9cb3", rotate: 35 },
          },
          yAxis: {
            type: "value",
            ...trendAxis,
            scale: true,
            axisLabel: { color: "#8b9cb3", formatter: (v: number) => formatNum(v) },
            splitLine: { lineStyle: { color: "#2d3a4f" } },
          },
          series: [
            {
              name: "累计播放量",
              type: "line",
              smooth: true,
              data: trendValues,
              areaStyle: { color: "rgba(255,68,68,0.15)" },
              lineStyle: { color: "#ff4444", width: 2 },
              itemStyle: { color: "#ff4444" },
            },
          ],
        };
      })()
    : {};

  const dailyNewOption = dashboard
    ? {
        backgroundColor: "transparent",
        tooltip: { trigger: "axis" },
        grid: { left: 80, right: 24, top: 24, bottom: 72 },
        xAxis: {
          type: "category",
          data: dashboard.daily_new_by_video.map((d) =>
            d.title.length > 18 ? d.title.slice(0, 18) + "…" : d.title
          ),
          axisLabel: { color: "#8b9cb3", rotate: 30 },
        },
        yAxis: {
          type: "value",
          axisLabel: { color: "#8b9cb3", formatter: (v: number) => formatNum(v) },
          splitLine: { lineStyle: { color: "#2d3a4f" } },
        },
        series: [
          {
            name: "今日新增播放",
            type: "bar",
            data: dashboard.daily_new_by_video.map((d) => d.delta_views),
            itemStyle: { color: "#3b82f6", borderRadius: [4, 4, 0, 0] },
          },
        ],
      }
    : {};

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
          grid: { left: 60, right: 64, top: 40, bottom: 48 },
          xAxis: {
            type: "category",
            data: detailHistoryFiltered.map((h) => h.time?.slice(5, 16) || ""),
            axisLabel: { color: "#8b9cb3" },
          },
          yAxis: [
            {
              type: "value",
              name: "播放量",
              position: "left",
              ...viewAxis,
              scale: true,
              axisLabel: { color: "#8b9cb3", formatter: (v: number) => formatNum(v) },
              splitLine: { lineStyle: { color: "#2d3a4f" } },
            },
            {
              type: "value",
              name: "新增播放",
              position: "right",
              axisLabel: { color: "#8b9cb3", formatter: (v: number) => formatNum(v) },
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

  const kpi = dashboard?.kpi;

  return (
    <div className="app">
      <header className="header">
        <h1>
          KOL <span>YouTube</span> 数据监控
        </h1>
        <div className="header-actions">
          <span className={`badge ${dataOk ? "ok" : "warn"}`}>
            {dataOk === null ? "…" : dataOk ? "静态数据已加载" : "数据未加载"}
          </span>
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
      </header>

      <div className="static-notice">
        「立刻采集」直接请求 YouTube API（需配置 API Key）；GitHub Actions 仅每 2 小时同步云端数据。
        {githubSyncReady
          ? " 已启用 GitHub 同步：添加视频会写入 inputs/videos.csv。"
          : " 添加视频请先配置 GitHub Token 以写入 videos.csv。"}
      </div>

      {kpi && (
        <div className="kpi-grid">
          <div className="kpi-card">
            <div className="label">监控视频数</div>
            <div className="value">{kpi.video_count}</div>
          </div>
          <div className="kpi-card">
            <div className="label">总播放量</div>
            <div className="value">{formatNum(kpi.total_views)}</div>
          </div>
          <div className="kpi-card">
            <div className="label">今日新增播放</div>
            <div className="value">{formatNum(kpi.daily_new_views)}</div>
          </div>
          <div className="kpi-card">
            <div className="label">总点赞</div>
            <div className="value">{formatNum(kpi.total_likes)}</div>
          </div>
          <div className="kpi-card">
            <div className="label">总评论</div>
            <div className="value">{formatNum(kpi.total_comments)}</div>
          </div>
          <div className="kpi-card">
            <div className="label">点赞率</div>
            <div className="value">{kpi.like_rate}%</div>
          </div>
        </div>
      )}

      <div className="grid-2">
        <section className="section">
          <h2>播放趋势（全站汇总）</h2>
          <div className="chart-box">
            {dashboard?.trend.length ? (
              <LazyChart option={trendOption} style={{ height: "100%" }} />
            ) : (
              <p className="empty">暂无历史数据</p>
            )}
          </div>
        </section>
        <section className="section">
          <h2>今日新增播放量（按视频）</h2>
          <div className="chart-box">
            {dashboard?.daily_new_by_video.length ? (
              <LazyChart option={dailyNewOption} style={{ height: "100%" }} />
            ) : (
              <p className="empty">需要至少两天的快照才能计算日增量</p>
            )}
          </div>
        </section>
      </div>

      <section className="section">
        <h2>视频列表管理</h2>
        <div className="config-panels-row">
          <GithubSyncPanel onSaved={() => setGithubSyncReady(isGithubSyncReady())} />
          <YoutubeApiPanel onSaved={() => setYoutubeApiReady(isYoutubeApiReady())} />
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
        <table className="video-table">
          <thead>
            <tr>
              <th>缩略图</th>
              <th>标题</th>
              <th>频道</th>
              <th>状态</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {videos.map((v) => {
              const rank = dashboard?.rankings.find((r) => r.video_id === v.video_id);
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
                  <td>{v.channel_title || "—"}</td>
                  <td>{isLocal ? "pending" : v.status}</td>
                  <td className="video-actions">
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
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!videos.length && (
          <p className="empty">暂无视频，请添加 YouTube 链接开始监控</p>
        )}
      </section>

      <div className="grid-2">
        <section className="section">
          <h2>播放量排行榜</h2>
          <ul className="rank-list">
            {(dashboard?.rankings || []).map((r, i) => (
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
              </li>
            ))}
          </ul>
          {!dashboard?.rankings.length && (
            <p className="empty">采集数据后将显示排行</p>
          )}
        </section>

        <section className="section">
          <h2>单视频详情</h2>
          <div className="detail-select">
            <select
              value={selectedId}
              onChange={(e) => setSelectedId(e.target.value)}
            >
              <option value="">选择视频</option>
              {videos.map((v) => (
                <option key={v.video_id} value={v.video_id}>
                  {v.title || v.video_id}
                </option>
              ))}
            </select>
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
          </div>
          {!youtubeApiReady && selectedId && (
            <p className="detail-collect-hint">
              「立刻采集」需先配置 YouTube API Key；GitHub Pages 线上版受 CORS 限制，请用本地 npm run dev。
            </p>
          )}

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
              {hasDateFilter && (
                <span className="detail-date-hint">
                  已筛选 {detailDateFrom || "…"} ~ {detailDateTo || "…"} ·{" "}
                  {detailHistoryFiltered.length} 条快照
                </span>
              )}
            </div>
          )}

          {detailRangeKpi && (
            <div className="kpi-grid" style={{ marginBottom: 16 }}>
              <div className="kpi-card">
                <div className="label">
                  {hasDateFilter ? "期末播放" : "当前播放"}
                </div>
                <div className="value">{formatNum(detailRangeKpi.view_count)}</div>
                {hasDateFilter && detailRangeKpi.delta_views > 0 && (
                  <div className="kpi-sub">+{formatNum(detailRangeKpi.delta_views)}</div>
                )}
              </div>
              <div className="kpi-card">
                <div className="label">{hasDateFilter ? "期末点赞" : "点赞"}</div>
                <div className="value">{formatNum(detailRangeKpi.like_count)}</div>
                {hasDateFilter && detailRangeKpi.delta_likes > 0 && (
                  <div className="kpi-sub">+{formatNum(detailRangeKpi.delta_likes)}</div>
                )}
              </div>
              <div className="kpi-card">
                <div className="label">{hasDateFilter ? "期末评论" : "评论"}</div>
                <div className="value">{formatNum(detailRangeKpi.comment_count)}</div>
                {hasDateFilter && detailRangeKpi.delta_comments > 0 && (
                  <div className="kpi-sub">+{formatNum(detailRangeKpi.delta_comments)}</div>
                )}
              </div>
            </div>
          )}
          <div className="chart-box">
            {detailHistoryFiltered.length ? (
              <LazyChart option={detailViewsOption} style={{ height: "100%" }} />
            ) : detailHistoryAll.length ? (
              <p className="empty">所选日期范围内暂无快照数据</p>
            ) : (
              <p className="empty">选择视频后查看趋势</p>
            )}
          </div>
        </section>
      </div>

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
