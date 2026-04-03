# app.py —— 只读 CSV 的 Streamlit 看板（无外部 API 调用）
import os
from datetime import date
import csv
import altair as alt
import pandas as pd
import streamlit as st

st.set_page_config(page_title="YouTube Tracker", layout="wide")

# 可选：页面自动刷新（若未安装则自动跳过）
try:
    from streamlit_autorefresh import st_autorefresh
    st_autorefresh(interval=5 * 60 * 1000, key="auto-refresh")  # 每5分钟刷新一次页面
except Exception:
    pass

# ---- 小样式：让左侧缩略图垂直居中 ----
st.markdown(
    """
<style>
.thumb-cell { display: flex; align-items: center; height: 100%; }
.thumb-cell img { max-width: 100%; }
</style>
""",
    unsafe_allow_html=True,
)

# 每5分钟重新读一次 CSV（线上自动拿到最新数据）
@st.cache_data(ttl=300)
def load_data():
    df = pd.read_csv("data/history.csv")
    df["date"] = pd.to_datetime(df["date"], errors="coerce", utc=True)
    # published_at 可能自带/不带时区，这里统一解析为带 tz 的时间
    df["published_at"] = pd.to_datetime(df["published_at"], errors="coerce", utc=True)
    return df


def days_since(d):
    """返回从发布时间到现在的天数；兼容 tz-naive / tz-aware。"""
    if pd.isna(d):
        return None
    if getattr(d, "tzinfo", None) is None:
        d_utc = d.tz_localize("UTC")
    else:
        d_utc = d.tz_convert("UTC")
    now_utc = pd.Timestamp.now(tz="UTC")
    return (now_utc - d_utc).days


df = load_data()

# ✅ 新增一列，取纯日期（方便和 date_input 的值对齐）
df["day"] = df["date"].dt.date

st.title("📈 YouTube 视频追踪")

if df.empty:
    st.info("暂无数据，请先确保仓库中的 data/history.csv 已有内容。")
    st.stop()

# ==== 数据最后更新时间（基于 CSV 内容 + 文件写入时间）====
csv_last_ts = pd.to_datetime(df["date"], errors="coerce").max()
last_file_time_la = None
try:
    mtime = os.path.getmtime("data/history.csv")
    last_file_time_la = (
        pd.to_datetime(mtime, unit="s", utc=True)
        .tz_convert("America/Los_Angeles")
        .strftime("%Y-%m-%d %H:%M:%S %Z")
    )
except Exception:
    pass

msg_left = (
    f"CSV 最新日期：**{csv_last_ts.tz_convert('UTC').date().isoformat()}**"
    if pd.notna(csv_last_ts)
    else "CSV 最新日期：**未知**"
)
msg_right = f"｜ 文件更新时间（LA）：**{last_file_time_la}**" if last_file_time_la else ""
st.info(f"🕒 {msg_left} {msg_right}")

# 每个视频最新一行（总计信息）
latest = df.sort_values("date").groupby("video_id").tail(1).copy()
# 默认按发布日期倒序（新→旧）
latest = latest.sort_values("published_at", ascending=False, na_position="last")

# -------- 侧边筛选 --------
with st.sidebar:
    st.write("---")

    # ===== 新增视频 =====
    st.subheader("➕ 新增监控视频")

    new_url = st.text_input("输入 YouTube URL 或 Video ID")

    if st.button("添加视频"):
        if not new_url.strip():
            st.warning("请输入有效内容")
        else:
            file_path = "inputs/videos.csv"

            file_exists = os.path.exists(file_path)

            existing = set()
            if file_exists:
                try:
                    df_exist = pd.read_csv(file_path)
                    if "video" in df_exist.columns:
                        existing = set(df_exist["video"].dropna().astype(str))
                except Exception:
                    pass

            if new_url in existing:
                st.warning("该视频已存在，无需重复添加")
            else:
                import csv
                with open(file_path, "a", newline="", encoding="utf-8") as f:
                    writer = csv.writer(f)

                    if not file_exists:
                        writer.writerow(["video"])

                    writer.writerow([new_url])

                st.success("✅ 添加成功！请运行 fetch_stats.py 更新数据")

    st.write("---")
    st.header("筛选 & 工具")

    # 频道筛选（含 All）
    channels = sorted(latest["channel_title"].dropna().unique().tolist())
    channel_options = ["All"] + channels
    sel_channel = st.selectbox("按频道筛选", channel_options, index=0)

    # 指标与数值模式
    metric_label = st.selectbox(
        "折线图指标", ["播放量 (Views)", "点赞数 (Likes)", "评论数 (Comments)"], index=0
    )
    metric_map = {
        "播放量 (Views)": ("views", "播放量"),
        "点赞数 (Likes)": ("likes", "点赞数"),
        "评论数 (Comments)": ("comments", "评论数"),
    }
    metric_col, metric_cn = metric_map[metric_label]

    mode = st.radio("数值模式", ["累计", "每日增量"], index=0, horizontal=True)

    # 日期范围（影响：折线图、顶部区间增量KPI）
    min_d = df["day"].min()
    max_d = df["day"].max()
    picked = st.date_input("折线图日期范围", value=(min_d, max_d), key="range")
    if isinstance(picked, (list, tuple)) and len(picked) == 2:
        start_day, end_day = picked
    else:
        start_day, end_day = (min_d, max_d)

    # 排序依据（含“按发布日期（新→旧）”）
    sort_label = st.selectbox(
        "排序依据", ["按播放量", "按点赞数", "按评论数", "按发布日期（新→旧）"], index=3
    )
    sort_map = {"按播放量": "views", "按点赞数": "likes", "按评论数": "comments"}

    st.write("---")
    # 手动刷新按钮（清缓存并重跑）
    if st.button("🔄 刷新数据（清缓存）", key="refresh"):
        st.cache_data.clear()
        st.rerun()

# 根据频道筛选
filtered_latest = (
    latest if sel_channel == "All" else latest[latest["channel_title"] == sel_channel]
)

# 应用排序
if sort_label == "按发布日期（新→旧）":
    filtered_latest = filtered_latest.sort_values(
        "published_at", ascending=False, na_position="last"
    )
else:
    sort_col = sort_map[sort_label]
    filtered_latest = filtered_latest.sort_values(sort_col, ascending=False)

selected_ids = set(filtered_latest["video_id"].tolist())

# ====== 用“自然日 day”做统一过滤（折线图 & KPI） ======
hist_df = df[df["video_id"].isin(selected_ids)].copy()
show_df_for_chart = hist_df[(hist_df["day"] >= start_day) & (hist_df["day"] <= end_day)].copy()

# 🔍 Debug：直观看到日期是否生效
st.info(f"当前区间：{start_day} → {end_day} ｜ 过滤后行数：{show_df_for_chart.shape[0]}")

# 如果选择的结束日期 > 数据最新日期，提示
data_max_day = df["day"].max()
if data_max_day and end_day > data_max_day:
    st.warning(
        f"所选结束日期 **{end_day}** 超过当前数据最新日期 **{data_max_day}**，图表只显示到 {data_max_day}。"
    )

st.caption(f"数据按天记录；频道：{sel_channel} ｜ 视频数：{filtered_latest.shape[0]}")

# 全局 KPI（总量/率）：针对当前频道筛选（各视频“最新一行”加总），与日期无关
kpi_scope = filtered_latest.copy()
total_views = int(kpi_scope["views"].sum())
total_likes = int(kpi_scope["likes"].sum())
total_comments = int(kpi_scope["comments"].sum())
like_rate = (total_likes / total_views * 100) if total_views > 0 else 0.0
comment_rate = (total_comments / total_views * 100) if total_views > 0 else 0.0

k1, k2, k3, k4, k5 = st.columns(5)
k1.metric("总播放量（截至最新）", f"{total_views:,}")
k2.metric("总点赞数（截至最新）", f"{total_likes:,}")
k3.metric("总评论数（截至最新）", f"{total_comments:,}")
k4.metric("Like Rate（点赞率）", f"{like_rate:.2f}%")
k5.metric("Comment Rate（评论率）", f"{comment_rate:.2f}%")

# 顶部 KPI 汇总（按当前日期筛选后的“区间增量”，全体视频）
# 关键：在“全量历史”上先计算每日增量，再按所选日期范围过滤
base = df[df["video_id"].isin(selected_ids)].sort_values(["video_id", "date"]).copy()
for col in ["views", "likes", "comments"]:
    inc_col = f"{col}_inc"
    base[inc_col] = base.groupby("video_id")[col].diff().fillna(0)
    base.loc[base[inc_col] < 0, inc_col] = 0  # 防抖：出现回退时不计负增量

interval_df = base[(base["day"] >= start_day) & (base["day"] <= end_day)].copy()

iv_views = int(interval_df["views_inc"].sum()) if not interval_df.empty else 0
iv_likes = int(interval_df["likes_inc"].sum()) if not interval_df.empty else 0
iv_comments = int(interval_df["comments_inc"].sum()) if not interval_df.empty else 0

i1, i2, i3 = st.columns(3)
i1.metric("本期总增量 · 播放量", f"{iv_views:,}")
i2.metric("本期总增量 · 点赞数", f"{iv_likes:,}")
i3.metric("本期总增量 · 评论数", f"{iv_comments:,}")

# ====== 各视频单卡片 + 折线（带点与数值标签） ======
for _, row in filtered_latest.iterrows():
    vid = row["video_id"]
    col1, col2 = st.columns([1, 3])

    with col1:
        thumb = row.get("thumbnail_url", None)
        st.markdown("<div class='thumb-cell'>", unsafe_allow_html=True)
        if pd.notna(thumb) and thumb:
            st.image(thumb, use_container_width=True)
        st.markdown("</div>", unsafe_allow_html=True)
        st.markdown(f"[▶️ 打开视频]({row['video_url']})")

    with col2:
        st.subheader(f"{row['title']}")
        st.write(f"**频道**：{row['channel_title']}")
        pub = row["published_at"]
        dcount = days_since(pub)
        pub_text = (
            pub.tz_convert("UTC").date().isoformat() if pd.notna(pub) else "未知"
        )
        st.write(f"**发布日期**：{pub_text}  ｜  **已发布**：{dcount} 天")
        c1, c2, c3 = st.columns(3)
        c1.metric("总播放量", f"{int(row['views']):,}")
        c2.metric("总点赞数", f"{int(row['likes']):,}")
        c3.metric("总评论数", f"{int(row['comments']):,}")

        vhist = (
            show_df_for_chart[show_df_for_chart["video_id"] == vid]
            .sort_values("date")
            .copy()
        )
        if vhist.empty:
            st.info("当前日期范围内无数据")
            continue

        if mode == "每日增量":
            vhist["value"] = vhist[metric_col].diff().fillna(0)
            vhist.loc[vhist["value"] < 0, "value"] = 0
            y_title = f"{metric_cn}（每日增量）"
        else:
            vhist["value"] = vhist[metric_col]
            y_title = f"{metric_cn}（累计）"

        base_chart = alt.Chart(vhist).encode(
            # ✅ 用 day 画 X 轴，和选择器一致
            x=alt.X("day:T", title="日期"),
            y=alt.Y("value:Q", title=y_title),
            tooltip=[
                alt.Tooltip("day:T", title="日期"),
                alt.Tooltip("value:Q", title=y_title, format=","),
            ],
        )
        line = base_chart.mark_line()
        points = base_chart.mark_point(size=40)
        labels = base_chart.mark_text(dy=-8).encode(text=alt.Text("value:Q", format=","))

        chart = (line + points + labels).properties(height=220)
        st.altair_chart(chart, use_container_width=True)

st.write("---")
st.caption("数据来源：data/history.csv（由定时任务更新）。时区：America/Los_Angeles。")
