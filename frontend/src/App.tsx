import { useCallback, useEffect, useState } from "react";
import ReactECharts from "echarts-for-react";
import type { CallbackDataParams } from "echarts/types/dist/shared";
import {
  addVideo,
  addVideosBatch,
  collectAll,
  deleteVideo,
  fetchDashboard,
  fetchHealth,
  fetchVideoDetail,
  fetchVideos,
  type DashboardData,
  type Video,
  type VideoDetail,
} from "./api";

function formatNum(n: number) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(3) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(3) + "K";
  return n.toFixed(3);
}

/** 根据数据范围计算 Y 轴上下界，放大趋势变化 */
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
  const [videos, setVideos] = useState<Video[]>([]);
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [detail, setDetail] = useState<VideoDetail | null>(null);
  const [selectedId, setSelectedId] = useState("");
  const [input, setInput] = useState("");
  const [batchInput, setBatchInput] = useState("");
  const [showBatchForm, setShowBatchForm] = useState(false);
  const [batchAdding, setBatchAdding] = useState(false);
  const [loading, setLoading] = useState(false);
  const [collecting, setCollecting] = useState(false);
  const [apiOk, setApiOk] = useState<boolean | null>(null);
  const [dbOk, setDbOk] = useState<boolean | null>(null);
  const [toast, setToast] = useState("");

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(""), 3500);
  };

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [health, vList, dash] = await Promise.all([
        fetchHealth(),
        fetchVideos(),
        fetchDashboard(),
      ]);
      setApiOk(health.api_key_configured);
      setDbOk(health.db_connected);
      setVideos(vList);
      setDashboard(dash);
      if (!selectedId && vList.length) setSelectedId(vList[0].video_id);
    } catch (e) {
      showToast("加载失败，请确认后端已启动 (uvicorn)");
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 60_000);
    return () => clearInterval(t);
  }, [refresh]);

  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      return;
    }
    fetchVideoDetail(selectedId)
      .then(setDetail)
      .catch(() => setDetail(null));
  }, [selectedId, dashboard]);

  const handleAdd = async () => {
    const v = input.trim();
    if (!v) return;
    try {
      const res = await addVideo(v);
      setInput("");
      showToast(res.message);
      await refresh();
      setSelectedId(res.video.video_id);
    } catch (e: unknown) {
      const msg =
        axiosMessage(e) || "添加失败";
      showToast(msg);
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
      const res = await addVideosBatch(lines);
      setBatchInput("");
      setShowBatchForm(false);
      const dupMsg =
        res.duplicate_input > 0 ? `，输入重复 ${res.duplicate_input} 个` : "";
      showToast(`${res.message}${dupMsg}`);
      await refresh();
      if (res.videos.length) setSelectedId(res.videos[0].video_id);
    } catch (e: unknown) {
      showToast(axiosMessage(e) || "批量添加失败");
    } finally {
      setBatchAdding(false);
    }
  };

  const handleCollect = async () => {
    setCollecting(true);
    try {
      const res = await collectAll();
      showToast(
        `采集完成：写入 ${res.written}，跳过 ${res.skipped}，失败 ${res.failed}`
      );
      await refresh();
    } catch (e: unknown) {
      showToast(axiosMessage(e) || "采集失败，请检查 YOUTUBE_API_KEY");
    } finally {
      setCollecting(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("确定删除该视频？")) return;
    await deleteVideo(id);
    showToast("已删除");
    await refresh();
  };

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

  const detailViewsOption = detail
    ? (() => {
        const viewValues = detail.history.map((h) => h.views);
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
          data: detail.history.map((h) => h.time?.slice(5, 16) || ""),
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
            data: [0, ...detail.view_deltas.map((d) => d.delta_views)],
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
          KOL <span>YouTube</span> 数据监控 MVP
        </h1>
        <div className="header-actions">
          <span className={`badge ${apiOk ? "ok" : "warn"}`}>
            {apiOk === null ? "…" : apiOk ? "API Key 已配置" : "未配置 API Key"}
          </span>
          <span className={`badge ${dbOk ? "ok" : "warn"}`}>
            {dbOk === null ? "…" : dbOk ? "数据库已连接" : "数据库未连接"}
          </span>
          <button
            className="btn btn-primary"
            onClick={handleCollect}
            disabled={collecting || !apiOk}
          >
            {collecting ? "采集中…" : "手动采集数据"}
          </button>
          <button className="btn" onClick={refresh} disabled={loading}>
            刷新看板
          </button>
        </div>
      </header>

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
              <p className="empty">暂无历史数据，请先添加视频并采集</p>
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
              placeholder="批量添加：每行一个 YouTube 链接或 Video ID"
              value={batchInput}
              onChange={(e) => setBatchInput(e.target.value)}
              rows={4}
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
              return (
                <tr key={v.video_id}>
                  <td>
                    {v.thumbnail_url ? (
                      <img className="thumb" src={v.thumbnail_url} alt="" />
                    ) : (
                      <div className="thumb" />
                    )}
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
                    {rank && (
                      <div className="rank-meta">
                        {formatNum(rank.view_count)} 播放 · {formatNum(rank.like_count)}{" "}
                        赞
                      </div>
                    )}
                  </td>
                  <td>{v.channel_title || "—"}</td>
                  <td>{v.status}</td>
                  <td>
                    <button
                      className="btn"
                      style={{ padding: "4px 10px", fontSize: "0.8rem" }}
                      onClick={() => setSelectedId(v.video_id)}
                    >
                      详情
                    </button>{" "}
                    <button
                      className="btn"
                      style={{ padding: "4px 10px", fontSize: "0.8rem" }}
                      onClick={() => handleDelete(v.video_id)}
                    >
                      删除
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
                {r.thumbnail_url && (
                  <img className="thumb" src={r.thumbnail_url} alt="" />
                )}
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
          {detail?.latest && (
            <div className="kpi-grid" style={{ marginBottom: 16 }}>
              <div className="kpi-card">
                <div className="label">当前播放</div>
                <div className="value">{formatNum(detail.latest.view_count)}</div>
              </div>
              <div className="kpi-card">
                <div className="label">点赞</div>
                <div className="value">{formatNum(detail.latest.like_count)}</div>
              </div>
              <div className="kpi-card">
                <div className="label">评论</div>
                <div className="value">
                  {formatNum(detail.latest.comment_count)}
                </div>
              </div>
            </div>
          )}
          <div className="chart-box">
            {detail?.history.length ? (
              <ReactECharts option={detailViewsOption} style={{ height: "100%" }} />
            ) : (
              <p className="empty">选择视频并采集后查看趋势</p>
            )}
          </div>
        </section>
      </div>

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}

function axiosMessage(e: unknown): string | undefined {
  if (typeof e === "object" && e !== null && "response" in e) {
    const resp = (e as { response?: { data?: { detail?: string } } }).response;
    const d = resp?.data?.detail;
    if (typeof d === "string") return d;
  }
  return undefined;
}
