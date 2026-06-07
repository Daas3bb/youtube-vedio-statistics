import { useCallback, useEffect, useState } from "react";
import ReactECharts from "echarts-for-react";
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
  isLocalOnlyVideo,
  loadLocalVideos,
  mergeVideos,
  removeLocalVideosByIds,
} from "./localVideos";
import {
  appendVideosToGithubCsv,
  downloadVideosCsv,
  isGithubSyncReady,
} from "./githubCsvSync";
import { GithubSyncPanel } from "./GithubSyncPanel";
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
  const [localVideos, setLocalVideos] = useState<Video[]>(() => loadLocalVideos());
  const [serverVideos, setServerVideos] = useState<Video[]>([]);
  const [serverVideoIds, setServerVideoIds] = useState<Set<string>>(new Set());
  const [githubSyncReady, setGithubSyncReady] = useState(() => isGithubSyncReady());

  const videos = mergeVideos(serverVideos, localVideos);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(""), 3500);
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
      setServerVideos(list);
      setServerVideoIds(new Set(list.map((v) => v.video_id)));
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

  const persistAddedVideos = async (added: Video[]) => {
    const ids = added.map((v) => v.video_id);
    const sync = await appendVideosToGithubCsv(ids);

    if (sync.ok) {
      removeLocalVideosByIds(ids);
      setLocalVideos(loadLocalVideos());
      if (sync.added > 0) {
        showToast(`已自动写入 inputs/videos.csv（${sync.added} 个），采集任务已触发`);
        await refresh();
      } else {
        showToast("视频已在仓库 videos.csv 中");
      }
      return;
    }

    if (sync.reason === "no_token") {
      downloadVideosCsv(ids, serverVideoIds);
      showToast("已添加（本地）。配置 GitHub Token 后可自动写入 videos.csv");
      return;
    }

    showToast(`本地已添加，自动写入失败：${sync.reason}`);
  };

  const handleAdd = async () => {
    const raw = input.trim();
    if (!raw) return;

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

    const result = addLocalVideos([raw], serverVideoIds);
    if (!result.added.length) {
      showToast("添加失败");
      return;
    }

    setLocalVideos(loadLocalVideos());
    setInput("");
    setSelectedId(video.video_id);
    await persistAddedVideos(result.added);
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
        if (d && typeof d === "object") {
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
        const v = videos.find((item) => item.video_id === selectedId);
        if (v) {
          setDetail({ video: v, history: [], view_deltas: [] });
        } else {
          setDetail(null);
        }
      });
  }, [selectedId, dashboard, videos]);

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
          <button className="btn" onClick={refresh} disabled={loading}>
            刷新看板
          </button>
        </div>
      </header>

      <div className="static-notice">
        {githubSyncReady ? (
          <>
            已启用 GitHub 自动同步：添加视频后将写入 <code>inputs/videos.csv</code> 并触发采集。
          </>
        ) : (
          <>
            添加视频后请先点击「配置 GitHub 自动写入」绑定 Token，即可自动更新{" "}
            <code>inputs/videos.csv</code>；未配置时仅保存在本机并下载 CSV 片段。
          </>
        )}
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
              <ReactECharts option={trendOption} style={{ height: "100%" }} />
            ) : (
              <p className="empty">暂无历史数据</p>
            )}
          </div>
        </section>
        <section className="section">
          <h2>今日新增播放量（按视频）</h2>
          <div className="chart-box">
            {dashboard?.daily_new_by_video.length ? (
              <ReactECharts option={dailyNewOption} style={{ height: "100%" }} />
            ) : (
              <p className="empty">需要至少两天的快照才能计算日增量</p>
            )}
          </div>
        </section>
      </div>

      <section className="section">
        <h2>视频列表管理</h2>
        <GithubSyncPanel onSaved={() => setGithubSyncReady(isGithubSyncReady())} />
        <div className="add-form">
          <input
            placeholder="粘贴 YouTube 链接或 11 位 Video ID"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleAdd()}
          />
          <button className="btn btn-primary" onClick={handleAdd}>
            添加视频
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
              const isLocal = isLocalOnlyVideo(v.video_id, serverVideoIds);
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
                    {isLocal && <span className="local-badge">本地待采集</span>}
                    {rank && (
                      <div className="rank-meta">
                        {formatNum(rank.view_count)} 播放 · {formatNum(rank.like_count)} 赞
                      </div>
                    )}
                  </td>
                  <td>{v.channel_title || "—"}</td>
                  <td>{isLocal ? "pending" : v.status}</td>
                  <td>
                    <button
                      className="btn"
                      style={{ padding: "4px 10px", fontSize: "0.8rem" }}
                      onClick={() => setSelectedId(v.video_id)}
                    >
                      详情
                    </button>
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
              <ReactECharts option={detailViewsOption} style={{ height: "100%" }} />
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
