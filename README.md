# KOL YouTube 数据监控系统

> 面向 YouTube 合作视频的轻量级数据监控看板。**纯静态前端 + JSON 文件存储**，无需自建后端服务器；配合 GitHub Actions 定时采集，一键部署到 GitHub Pages 即可持续监测。

---

## 目录

- [项目背景](#项目背景)
- [目标用户](#目标用户)
- [实现目标](#实现目标)
- [主要功能](#主要功能)
- [项目技术栈](#项目技术栈)
- [系统架构](#系统架构)
- [使用前配置](#使用前配置)
- [快速开始](#快速开始)
- [生产部署（GitHub Pages）](#生产部署github-pages)
- [菜单说明](#菜单说明)
- [数据看板说明](#数据看板说明)
- [计算方式](#计算方式)
- [表格与字段说明](#表格与字段说明)
- [数据文件结构](#数据文件结构)
- [接口说明](#接口说明)
- [后期可扩展功能](#后期可扩展功能)
- [目录结构](#目录结构)
- [附录 A：GitHub Token 创建与看板配置（详细步骤）](#附录-a-github-token-创建与看板配置详细步骤)

---

## 项目背景

在 KOL / 品牌合作场景中，往往需要持续跟踪一批 YouTube 合作视频的播放、点赞、评论等核心指标，用于评估投放效果、对比视频表现、向客户汇报数据。

传统方案通常依赖数据库 + 后端服务 + 定时任务服务器，部署和维护成本较高。本项目采用 **「CSV 维护视频列表 → Python 定时采集 → JSON 持久化 → 静态站点展示」** 的极简架构：

- 数据以 `data/store.json` 为中心存储
- 构建时导出为 `frontend/public/data/site.json` 供前端读取
- 看板为纯 React 静态 SPA，可托管在 GitHub Pages 等任意静态平台
- 采集由 GitHub Actions 每 2 小时自动执行，**零服务器运维**

---

## 目标用户

| 用户类型 | 典型场景 |
|----------|----------|
| **KOL 运营 / 商务** | 维护监控视频列表；查看播放量增长趋势、日新增趋势，分析点赞 / 评论互动变化；对比单视频与全站累计 / 增量曲线，跟踪投放周期表现并评估效果 |
| **市场 / 运营** | 日常查看合作视频数据、导出汇报、对比排行 |
| **项目负责人** | 快速搭建零成本监控看板，无需专职运维 |
| **开发者** | 基于现有 JSON 数据层扩展告警、报表、多平台接入 |

---

## 实现目标

1. **开箱即用**：Fork 仓库 → 配置 YouTube API Key → 启用 GitHub Pages，即可开始监测
2. **零后端依赖**：生产环境不运行 Python / Node 服务，只看静态页面 + JSON
3. **自动化采集**：GitHub Actions 定时拉取 YouTube Data API，写入仓库并重新部署
4. **可视化分析**：单视频趋势、全站累计/增量趋势、排行榜、快照明细与异常检测
5. **便捷维护**：看板内添加/删除视频，可自动同步到 `inputs/videos.csv` 并触发采集

---

## 主要功能

### 数据展示

- 单视频详情：播放量 / 互动趋势图、日期区间筛选、KPI 卡片
- 累计数据趋势：全站监测视频的历史累计播放 / 点赞 / 评论总量曲线
- 增量数据趋势：按日汇总的新增播放 / 点赞 / 评论，含快照明细表与异常标记
- 排行榜：按播放量 / 点赞量 / 评论数排序，展示点赞率、评论率

### 视频管理

- 单条 / 批量添加 YouTube 链接或 Video ID
- 搜索、分页、删除视频（同步清理历史快照）
- 同步状态标识（已入库 / 待采集 / 仅本地等）

### 采集与同步

- **GitHub Actions 定时采集**（每 2 小时，可手动触发）
- **看板内 GitHub 同步**：添加视频自动写入 `inputs/videos.csv` 并触发 workflow
- **本地立刻采集**（`npm run dev`）：经 Vite 代理调用 YouTube API，写入 `store.json`
- **刷新看板**：重新加载已发布的 `site.json`，不触发采集

### 其他

- 明暗主题切换
- 缩略图本地化缓存（构建时下载到 `frontend/public/thumbnails/`）
- 采集时区统一为 **UTC+8（Asia/Shanghai）**，与「今天」「近 7 天」等筛选一致

---

## 项目技术栈

### 前端（看板）

| 类别 | 技术 | 说明 |
|------|------|------|
| 框架 | **React 18** | 函数组件 + Hooks |
| 语言 | **TypeScript 5.6** | 类型安全的看板逻辑与聚合计算 |
| 构建 | **Vite 6** | 开发服务器、HMR、生产构建 |
| 图表 | **ECharts 5** + echarts-for-react | 播放量 / 互动趋势、累计 / 增量分析图 |
| 路由 | **Hash 路由** | `#/videos`、`#/analytics/cumulative` 等，适配 GitHub Pages 静态托管 |
| 样式 | **原生 CSS** + CSS 变量 | 明暗主题、响应式布局，无 UI 组件库依赖 |
| 数据加载 | `fetch` + 静态 JSON | 生产环境仅请求 `site.json`，无运行时后端 |

### 采集与数据处理（Python）

| 类别 | 技术 | 说明 |
|------|------|------|
| 运行时 | **Python 3.11** | GitHub Actions 与本地脚本统一版本 |
| HTTP 客户端 | **httpx** | 异步调用 YouTube Data API v3 |
| 配置 | **python-dotenv** | 从 `.env` 加载 API Key、代理等 |
| 存储 | **JSON 文件** | `data/store.json`，无数据库 |
| 数据源 | **YouTube Data API v3** | `videos` 端点拉取 statistics / snippet |
| 时区 | **zoneinfo（Asia/Shanghai）** | 采集时间与看板日期筛选对齐 UTC+8 |

### CI/CD 与部署

| 类别 | 技术 | 说明 |
|------|------|------|
| 自动化 | **GitHub Actions** | 定时采集、构建、提交数据、部署 Pages |
| 托管 | **GitHub Pages** | 默认部署目标；亦兼容任意静态托管 |
| 容器（可选） | **Docker + Nginx** | `frontend/Dockerfile` 本地静态预览 |

### 本地开发辅助

| 类别 | 技术 | 说明 |
|------|------|------|
| Dev 代理 | **Vite 中间件** | `/yt-api` 代理 Google API；`/api/run-collect` 触发本地采集 |
| 网络代理 | **https-proxy-agent** | 国内开发时经 Clash 等 HTTP 代理访问 Google |
| 浏览器集成 | **GitHub REST API** | 看板内读写 CSV、触发 workflow（Token 存 localStorage） |

### 架构特点小结

```
┌─────────────────────────────────────────────────────────┐
│  生产环境：React SPA + site.json（纯静态，零后端进程）      │
├─────────────────────────────────────────────────────────┤
│  采集层：Python + YouTube API → store.json（Git 版本化）   │
├─────────────────────────────────────────────────────────┤
│  运维层：GitHub Actions cron + Pages 自动部署             │
└─────────────────────────────────────────────────────────┘
```

---

## 系统架构

```
inputs/videos.csv          GitHub Actions（每 2 小时 / 手动触发）
       │                            │
       ▼                            ▼
data/store.json  ◄──  scripts/collector.py（YouTube API 采集）
       │                            │
       ▼                            ▼
scripts/build_static.py  ──►  frontend/public/data/site.json
       │                            │
       ▼                            ▼
              npm run build  ──►  GitHub Pages（静态看板）
```

**数据流简述：**

1. 在 `inputs/videos.csv` 维护待监测视频 ID 列表
2. `collector.py` 读取列表，调用 YouTube Data API v3，向 `store.json` 追加历史快照
3. `build_static.py` 聚合计算 dashboard / details，输出 `site.json`
4. 前端构建后部署；用户浏览器 fetch 静态 JSON 渲染看板

---

## 使用前配置

### 1. YouTube Data API Key（采集必需）

1. 前往 [Google Cloud Console](https://console.cloud.google.com/) 创建项目
2. 启用 **YouTube Data API v3**
3. 创建 API Key

| 环境 | 配置方式 |
|------|----------|
| **GitHub Actions** | 仓库 Settings → Secrets → Actions，添加 `YOUTUBE_API_KEY` |
| **本地采集** | 复制 `.env.example` 为 `.env`，填入 `YOUTUBE_API_KEY` |

### 2. 本地代理（仅国内本地开发）

GitHub Actions 在海外运行，**不需要代理**。本地 `npm run dev` 访问 Google API 时需配置：

```env
PROXY_PORT=7897
# 或
HTTPS_PROXY=http://127.0.0.1:7897
```

### 3. GitHub 同步 Token（看板内添加视频时需要）

在看板「GitHub 同步」面板配置 Personal Access Token，用于：

- 读写 `inputs/videos.csv`（**Contents: Read and write**）
- 触发采集 workflow（**Actions: Read and write**，建议）

Token **仅保存在浏览器 localStorage**，不会写入仓库。

> 完整图文步骤（含界面示意图、看板配置、验证与常见问题）见 **[附录 A：GitHub Token 创建与看板配置](#附录-a-github-token-创建与看板配置详细步骤)**。

### 4. GitHub Pages

仓库 **Settings → Pages → Source** 选择 **GitHub Actions**。

### 5. 可选环境变量

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `YOUTUBE_API_KEY` | YouTube API 密钥 | — |
| `DEDUP_GRANULARITY` | 快照去重粒度：`hour` / `minute` | `hour` |
| `PROXY_PORT` | 本地 HTTP 代理端口 | — |
| `COLLECT_TIMEZONE` | 采集与日期筛选时区 | `Asia/Shanghai` |
| `PAGES_BASE` | 非根路径部署时的 base URL | `/`（Actions 自动设为 `/<仓库名>/`） |

---

## 快速开始

### 本地开发

```powershell
# 1. 配置 API Key（可选，本地采集时需要）
Copy-Item .env.example .env
# 编辑 .env 填入 YOUTUBE_API_KEY、PROXY_PORT

# 2. 构建静态数据
pip install -r scripts/requirements.txt
python scripts/build_static.py

# 3. 启动前端
cd frontend
npm install
npm run dev
```

浏览器访问：**http://localhost:3000**

### 本地手动采集

```powershell
python scripts/collector.py
python scripts/build_static.py
```

然后在看板点击「刷新看板」加载新数据。

### 添加监控视频

**方式 A：看板内添加（推荐）**  
配置 GitHub 同步后，粘贴 YouTube 链接 →「添加视频」，自动写入 CSV 并触发 Actions。

**方式 B：手动编辑 CSV**

```csv
video_id,title,video_url,thumbnail_url,publish_time,channel_title,status,created_at
YOUR_VIDEO_ID,,https://www.youtube.com/watch?v=YOUR_VIDEO_ID,,,,active,
```

title 等字段可留空，采集时会从 YouTube API 自动填充。

---

## 生产部署（GitHub Pages）

1. 推送代码到 GitHub
2. 配置 Secret：`YOUTUBE_API_KEY`
3. 启用 GitHub Pages（Source: GitHub Actions）
4. 等待或手动触发 **Actions → Collect and Deploy Static Site → Run workflow**

Workflow（`.github/workflows/collect.yml`）会自动：

1. 运行 `collector.py` 采集
2. 运行 `build_static.py` 生成 `site.json`
3. `npm run build` 构建前端
4. 提交 `data/store.json`、`site.json`、缩略图
5. 部署到 GitHub Pages

访问地址：`https://<用户名>.github.io/<仓库名>/`

### 其他静态平台

本项目为纯静态站点，也可部署到 Cloudflare Pages、Vercel、Netlify、对象存储 + CDN 等。构建命令：`cd frontend && npm run build`，输出目录：`frontend/dist`。

非根路径部署时需设置 `PAGES_BASE`：

```powershell
$env:PAGES_BASE = "/monitor/"
cd frontend
npm run build
```

---

## 菜单说明

侧边栏分为两大组，路由通过 URL Hash 区分：

| 分组 | 菜单项 | 路由 | 说明 |
|------|--------|------|------|
| **内容管理** | 视频管理 | `#/videos` | 添加 / 删除 / 搜索视频，批量导入，立即采集 |
| | 单视频详情 | `#/`（默认） | 选定视频的 KPI、趋势图、日期筛选 |
| **数据分析** | 累计数据趋势 | `#/analytics/cumulative` | 全站累计播放 / 点赞 / 评论趋势 |
| | 增量数据趋势 | `#/analytics/incremental` | 全站日增量趋势 + 快照明细 |
| | 排行榜 | `#/rankings` | 视频排行与互动率 |

**顶部工具栏：**

| 组件 | 作用 |
|------|------|
| GitHub 同步 | 配置 Token，启用看板内自动写入 CSV |
| YouTube 采集 | 配置本地 API Key（`npm run dev` 下立刻采集用） |
| GitHub Actions | 查看最近 workflow 状态，远程触发采集 |
| 刷新看板 | 重新加载 `site.json` |
| 主题切换 | 日间 / 夜间模式 |

---

## 数据看板说明

### 单视频详情

- **视频选择器**：搜索并切换监测视频
- **立刻采集**：本地开发环境下即时拉取该视频当前数据（GitHub Pages 受 CORS 限制，请用本地 dev）
- **日期筛选**：今天 / 近 7 天 / 近 30 天 / 全部 / 自定义区间
- **KPI 卡片**：
  - 单日筛选（如「今天」）→ 展示**当前累计**播放 / 点赞 / 评论
  - 多日筛选 → 展示区间内**新增**播放 / 点赞 / 评论
- **播放量趋势图**：筛选区间内的累计播放量曲线
- **互动趋势图**：点赞或评论的累计曲线（可切换）

### 累计数据趋势

汇总**全部监测视频**在选定日期范围内，每日的累计播放 / 点赞 / 评论总量。

- 支持切换指标（播放 / 点赞 / 评论）
- 图表 tooltip 显示：当日贡献视频数、首次纳入监测的视频数（冷启动高亮）
- KPI 显示区间末日的累计总量

### 增量数据趋势

汇总全部监测视频的**日增量**（播放 / 点赞 / 评论）。

- 首次采集日仅作基线，**不计入增量**（避免批量首次采集日虚高）
- 下方 **快照明细表**：逐视频、逐日展示代表快照及新增指标
- **异常检测**：自动标记回退、冷启动、极端增量、贡献异常、采集缺失等

### 排行榜

基于各视频**最新快照**（各指标历史峰值）排序展示：

- 可切换排序字段：播放量 / 点赞量 / 评论数
- 支持升序 / 降序
- 展示点赞率、评论率

### 视频管理

- 添加单条或批量 YouTube 链接
- 列表展示缩略图、标题、频道、发布时间、添加时间、同步状态
- 「立即采集」：本地 dev 下采集全部视频当前数据
- 支持搜索、分页、跳转页码、删除

---

## 计算方式

> 所有日期均基于 **UTC+8（Asia/Shanghai）** 自然日。  
> 播放量、点赞量、评论量为 YouTube 报告的**累计值**（非实时精确值，API 存在延迟）。

### 通用预处理

1. **单调化（Monotonic）**  
   累计指标偶发回退时，取运行最大值抹平：

   ```
   views[i] = max(views[0..i])
   ```

2. **每日代表快照（Daily Representative Snapshot）**  
   同一自然日可能有多条采集记录，取**累计播放量最高**的一条（同值取更晚时间）作为该日代表。

3. **快照去重（采集侧）**  
   默认同视频同一小时（`DEDUP_GRANULARITY=hour`）只写入一条快照。

### 单视频详情

| 场景 | KPI 计算 |
|------|----------|
| 单日筛选 | 展示代表快照的累计值 |
| 多日筛选 | `末快照累计值 − 首快照累计值`（增量，下限为 0） |
| 图表数据 | 区间 < 7 天：保留各采集时点；≥ 7 天或「全部」：每日取代表快照 |

### 累计数据趋势（全站）

对每个自然日 `D`：

```
累计播放(D) = Σ 各视频在 D 日及之前最近代表快照的 views
```

- 视频在 D 日之前无快照 → 该日不计入
- 视频在 D 日有快照 → 计入；D 日之后无新快照 → **向前填充**（carry-forward）至下一快照日
- `contributing_videos`：当日有有效代表快照（含 forward-fill）的视频数
- `first_snapshot_videos`：当日为首次出现代表快照的视频数

### 增量数据趋势（全站）

对每个视频、每个自然日：

```
增量(D) = 代表快照(D) − 代表快照(D−1)
```

- **首次代表快照日**：增量 = 0（仅建立基线）
- 全站日增量 = 各视频当日增量之和
- `contributing_videos`：已监测 ≥ 2 天、当日有有效增量的视频数

### 排行榜与 Dashboard KPI

| 指标 | 计算 |
|------|------|
| 视频最新播放 / 点赞 / 评论 | 各视频全部快照中的**历史最大值** |
| 全站总播放 / 点赞 / 评论 | 各视频最新快照之和 |
| 点赞率 | `总点赞 / 总播放 × 100%`（保留 2 位小数） |
| 评论率 | `总评论 / 总播放 × 100%` |
| 今日新增播放（dashboard） | 各视频「今日代表快照 − 昨日代表快照」之和（≥ 0） |

### 异常检测（增量快照明细）

| 类型 | 判定条件 |
|------|----------|
| 冷启动 | 视频首次代表快照 |
| 播放回退 | 当日 views < 前一日 |
| 数值为零 | views、likes、comments 均为 0 |
| 极端增量 | 单视频日增量 > max(中位数×5, 10000) |
| 贡献异常 | 某日单视频增量占全站增量 ≥ 80% |
| 采集缺失 | 日期范围内某视频某日无代表快照 |

---

## 表格与字段说明

### `inputs/videos.csv`

| 字段 | 说明 |
|------|------|
| `video_id` | YouTube 11 位视频 ID（主键） |
| `title` | 视频标题（可空，采集时填充） |
| `video_url` | 视频链接 |
| `thumbnail_url` | 缩略图 URL（可空，采集时填充） |
| `publish_time` | 发布时间 |
| `channel_title` | 频道名称 |
| `status` | `active` / `inactive`（inactive 不参与采集与统计） |
| `created_at` | 添加到监测系统的时间 |

### `data/store.json` → `history` 快照

| 字段 | 说明 |
|------|------|
| `video_id` | 视频 ID |
| `snapshot_time` | 采集时间 `YYYY-MM-DD HH:MM:SS`（UTC+8） |
| `snapshot_bucket` | 去重桶，如 `2026-06-12 14:00:00` |
| `view_count` | 播放量（累计） |
| `like_count` | 点赞量（累计） |
| `comment_count` | 评论量（累计） |
| `created_at` | 记录写入时间 |

### 视频列表（看板）

| 列 | 说明 |
|----|------|
| 缩略图 | 本地缓存或远程缩略图 |
| 标题 | 含链接；副行显示最新播放 / 点赞（「即时」表示仅本地采集、未写入 JSON） |
| 频道 | `channel_title` |
| 发布时间 | YouTube 发布时间 |
| 添加时间 | 纳入监测系统的时间 |
| 状态 | 同步状态徽章 + `active` / `pending` |
| 操作 | 跳转详情、删除 |

### 排行榜

| 展示项 | 说明 |
|--------|------|
| 排名序号 | 当前排序下的名次 |
| 标题 / 缩略图 | 视频基本信息 |
| 播放 · 赞 · 评论 | 最新快照累计值 |
| 点赞率 / 评论率 | `点赞(或评论) / 播放 × 100%` |

### 增量快照明细表

| 列 | 说明 |
|----|------|
| 视频 | 缩略图 + 标题 |
| 日期 | 自然日（UTC+8） |
| 采集时间 | 代表快照的 `snapshot_time` |
| 播放量 / 点赞量 / 评论量 | 当日代表快照累计值 |
| 新增播放 / 点赞 / 评论 | 相对上一条代表快照的差值 |
| 状态 | 异常标签（如有） |
| 操作 | 跳转单视频详情 |

---

## 数据文件结构

### `frontend/public/data/site.json`（前端唯一数据源）

```json
{
  "generated_at": "2026-06-12T10:00:00",
  "mode": "static",
  "dashboard": {
    "kpi": { "video_count", "monitored_with_data", "total_views", ... },
    "rankings": [ ... ],
    "trend": [ { "time", "total_views" } ],
    "daily_new_by_video": [ { "video_id", "title", "delta_views" } ],
    "videos": [ ... ]
  },
  "details": {
    "<video_id>": {
      "video": { ... },
      "latest": { "view_count", "like_count", "comment_count", "snapshot_time" },
      "history": [ { "time", "views", "likes", "comments" } ],
      "view_deltas": [ { "time", "delta_views" } ]
    }
  }
}
```

前端通过 `fetch(BASE_URL + '/data/site.json')` 加载，无运行时后端。

---

## 接口说明

### 静态数据（生产环境）

| 调用 | 方法 | 说明 |
|------|------|------|
| `/data/site.json` | GET | 看板全部数据（dashboard + 各视频 details） |

前端封装（`frontend/src/api.ts`）：

| 函数 | 返回 |
|------|------|
| `fetchHealth()` | 数据加载状态、`generated_at` |
| `fetchVideos()` | 视频列表 |
| `fetchDashboard()` | KPI、排行、trend 等 |
| `fetchVideoDetail(id)` | 单视频详情 |
| `fetchAllDetails()` | 全部视频 details 字典 |

### 本地开发专用（`npm run dev`，Vite 中间件）

| 路径 | 方法 | 说明 |
|------|------|------|
| `/api/run-collect` | POST | 执行 `collector.py` + `build_static.py` |
| `/api/persist-snapshots` | POST | 将看板「立刻采集」结果写入 `store.json` |
| `/yt-api/*` | GET | 代理至 `googleapis.com/youtube/v3`（需 `.env` 配置代理） |

### YouTube Data API v3（采集脚本 / 本地 dev）

```
GET /videos?part=statistics,snippet&id={ids}&key={API_KEY}
```

返回字段映射：`viewCount` → 播放量，`likeCount` → 点赞量，`commentCount` → 评论量。

### GitHub REST API（看板内同步，浏览器直连）

| 用途 | 端点 |
|------|------|
| 读写 CSV / JSON | `PUT/GET .../repos/{owner}/{repo}/contents/{path}` |
| 触发采集 | `POST .../repos/{owner}/{repo}/actions/workflows/collect.yml/dispatches` |
| 查询 workflow | `GET .../repos/{owner}/{repo}/actions/workflows/collect.yml/runs` |

需 Personal Access Token，权限与创建步骤见 [附录 A](#附录-a-github-token-创建与看板配置详细步骤)。

---

## 后期可扩展功能

以下方向与现有 JSON 数据层和静态架构兼容，可按优先级逐步实施：

| 方向 | 说明 |
|------|------|
| **告警通知** | 日增量低于/高于阈值时，通过 GitHub Actions 发送邮件 / Slack / 企业微信 |
| **多频道 / 分组** | 在 CSV 或 store 中增加 `group` / `campaign` 字段，看板按组筛选 |
| **数据导出** | 一键导出 CSV / Excel 报表（当前已支持 videos.csv 下载） |
| **更多平台** | 接入 TikTok、B 站等，统一快照格式写入 store |
| **自定义采集频率** | 修改 workflow cron 表达式，或按视频重要性分级采集 |
| **历史数据导入** | 使用 `scripts/import_external_export.py` 迁移外部导出数据 |
| **认证与权限** | GitHub Pages 私有仓库 + OAuth，或迁移至带鉴权的托管平台 |
| **API 配额优化** | 批量请求合并、增量采集（仅拉取有变化的视频） |
| **大屏模式** | 新增只读大屏路由，自动轮播核心 KPI |
| **多语言** | i18n 支持英文 / 日文界面 |

---

## 目录结构

```
├── .env.example                 # 环境变量模板
├── .github/workflows/collect.yml # 定时采集 + 构建 + 部署
├── data/
│   └── store.json               # 主数据（视频元信息 + 历史快照）
├── inputs/
│   └── videos.csv               # 监控视频列表（人工 / 看板维护）
├── scripts/
│   ├── collector.py             # YouTube 数据采集
│   ├── build_static.py            # 导出 site.json
│   ├── storage.py                 # JSON 存储与去重
│   ├── analytics.py               # Dashboard 聚合（Python 侧）
│   ├── youtube_client.py          # YouTube API 客户端
│   └── requirements.txt
└── frontend/
    ├── public/
    │   ├── data/site.json         # 前端读取的静态数据
    │   ├── thumbnails/            # 本地化缩略图
    │   └── favicon.svg
    └── src/
        ├── api.ts                 # 静态数据加载
        ├── analyticsAggregate.ts  # 趋势聚合（前端侧）
        ├── analyticsSnapshots.ts  # 快照明细与异常检测
        ├── githubCsvSync.ts       # GitHub API 同步
        └── App.tsx                # 主看板
```

---

## 附录 A：GitHub Token 创建与看板配置（详细步骤）

看板内「添加视频」自动写入 `inputs/videos.csv` 并触发采集，需先在 GitHub 创建 Token，再在看板里配置一次。

Token **仅保存在浏览器 localStorage**，不会写入仓库或上传到第三方服务器。

---

### 第一步：在 GitHub 创建 Personal Access Token

> 以下步骤以 **Fine-grained token（细粒度令牌，推荐）** 为例。Classic Token 见本文末尾 [附录 A-2](#附录-a-2使用-classic-token备选)。

#### 1. 打开 Token 设置页

浏览器访问（需登录 GitHub）：

```
https://github.com/settings/personal-access-tokens/new
```

或手动导航：

```
GitHub 右上角头像 → Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token
```

**界面示意：**

```
┌─────────────────────────────────────────┐
│ GitHub  Settings                        │
├─────────────────────────────────────────┤
│ 左侧菜单最底部：                         │
│   ▶ Developer settings                  │
│       ▶ Personal access tokens          │
│           • Fine-grained tokens  ← 点这里│
│           • Tokens (classic)            │
└─────────────────────────────────────────┘
```

#### 2. 填写 Token 基本信息（Token name / Expiration）

| 字段 | 建议填写 |
|------|----------|
| **Token name** | `kol-monitor-dashboard`（任意易识别的名称） |
| **Expiration** | `90 days` 或 `No expiration`（过期后需重新生成） |
| **Description** | 可选，如「看板自动写入 videos.csv」 |

#### 3. 选择仓库访问范围（Repository access）

选择 **Only select repositories**，然后在下拉框中勾选本项目仓库，例如：

```
☑ youtube-vedio-statistics
```

不要选「All repositories」，除非你有明确需要。

#### 4. 设置权限（Repository permissions）

展开 **Repository permissions**，至少设置：

| 权限项 | 级别 | 用途 |
|--------|------|------|
| **Contents** | **Read and write** | 读写 `inputs/videos.csv`（必须） |
| **Actions** | **Read and write** | 添加视频后自动触发采集 workflow（建议） |

其余权限保持 **No access** 即可。

**界面示意：**

```
Repository permissions
├── Contents      [ Read and write ▼ ]  ← 必选
├── Actions       [ Read and write ▼ ]  ← 建议
├── Metadata      ( 自动 Read-only )
└── 其他项         [ No access ▼ ]
```

#### 5. 生成并复制 Token

点击页面底部 **Generate token**。

> ⚠️ **Token 只显示一次！** 请立即复制保存（形如 `github_pat_11A...` 或 `ghp_...`），关闭页面后无法再次查看。

**界面示意：**

```
┌──────────────────────────────────────────────┐
│ Make sure to copy your personal access token │
│ now. You won't be able to see it again!      │
│                                              │
│  github_pat_11AAAA...xxxxxxxx  [ Copy ]      │
└──────────────────────────────────────────────┘
```

---

### 第二步：在看板中配置 GitHub 同步

#### 1. 打开已部署的看板页面

- 生产环境：`https://<用户名>.github.io/<仓库名>/`
- 本地开发：http://localhost:3000

#### 2. 点击顶部「GitHub 同步未配置」徽章

展开配置表单。

#### 3. 填写以下信息

| 字段 | 示例 | 说明 |
|------|------|------|
| 用户名 / 组织 | `Daas3bb` | 仓库 Owner，见 `github.com/Daas3bb/...` |
| 仓库名 | `youtube-vedio-statistics` | 不含用户名 |
| 分支 | `main` | 通常为 `main` 或 `master` |
| GitHub Token | `github_pat_...` | 上一步复制的完整 Token |

GitHub Pages 部署的看板会自动预填仓库名（构建时注入 `VITE_GITHUB_REPO`），你主要填写 **Token** 即可。

#### 4. 点击「保存配置」

- 顶部徽章变为：**「GitHub 同步已配置 ✓」**
- 可选：点击「测试连接」验证 Token 与权限

**界面示意：**

```
┌──────────────────────────────────────────────────────────┐
│  [ GitHub 同步已配置 ✓ ]  [ YouTube 采集未配置 ]  ...     │
├──────────────────────────────────────────────────────────┤
│  用户名 / 组织    [ Daas3bb                          ]   │
│  仓库名          [ youtube-vedio-statistics          ]   │
│  分支            [ main                              ]   │
│  GitHub Token    [ ••••••••••••••••••••••••••••••••  ]   │
│                                                          │
│  [ 保存配置 ]  [ 测试连接 ]                                 │
└──────────────────────────────────────────────────────────┘
```

---

### 第三步：验证自动写入是否生效

1. 进入 **视频管理**，在输入框粘贴一条 YouTube 链接，点击 **添加视频**
2. 成功时应看到 Toast 提示：

   ```
   已自动写入 inputs/videos.csv（1 个），采集任务已触发
   ```

3. 打开 GitHub 仓库确认：
   - **Code → inputs/videos.csv** 出现新行
   - **Actions** 有新的 **Collect and Deploy Static Site** 运行记录

4. 等待 Actions 完成后刷新看板，新视频应出现完整标题、缩略图和采集数据

**验证流程示意：**

```
看板添加视频
     │
     ▼
GitHub API 写入 inputs/videos.csv
     │
     ▼
触发 collect.yml workflow
     │
     ▼
collector.py 采集 → build_static.py → 部署 Pages
     │
     ▼
看板「刷新看板」→ 显示新数据
```

---

### 常见问题

**Q: 提示 `write_failed:403` 或 `Resource not accessible`**

- Token 缺少 **Contents: Read and write** 权限
- 或 Fine-grained Token 未授权到正确的仓库
- 解决：重新生成 Token，确认仓库和权限

**Q: 写入成功但未触发采集**

- Token 缺少 **Actions: Read and write**
- 解决：重新生成 Token 并勾选 Actions 权限；或到 Actions 页手动 Run workflow

**Q: 提示 `read_failed:404`**

- 仓库名 / 用户名 / 分支填错
- 或 `inputs/videos.csv` 在该分支不存在
- 解决：核对配置，确保仓库里已有 `inputs/videos.csv`

**Q: Token 会泄露吗？**

- Token 存在浏览器 localStorage，仅本机可见
- 不要在公共电脑保存；离职或换设备时在 GitHub 删除对应 Token

**Q: 换浏览器后还要重新配置吗？**

- 需要。每个浏览器需单独保存一次 Token

**Q: GitHub Pages 线上版能「立刻采集」吗？**

- 不能。浏览器直连 YouTube API 受 CORS 限制；线上版请依赖 Actions 定时 / 手动采集
- 本地 `npm run dev` 可配置 API Key 后使用「立刻采集」

---

### 附录 A-2：使用 Classic Token（备选）

若 Fine-grained Token 不可用，可使用 Classic Token：

1. 打开 https://github.com/settings/tokens/new
2. **Note** 填 `kol-monitor-dashboard`
3. **Expiration** 按需选择
4. 勾选 scope：**`repo`**（私有仓库必须；公开仓库也可只勾 `public_repo`）
5. 点击 **Generate token** 并复制

**界面示意：**

```
┌─────────────────────────────────────────┐
│ New personal access token (classic)     │
├─────────────────────────────────────────┤
│ Note: kol-monitor-dashboard             │
│ Expiration: [ 90 days ▼ ]               │
│                                         │
│ Select scopes:                          │
│   ☑ repo          Full control of...    │
│   ☐ workflow    (可选，触发 Actions)     │
│   ☐ ...                                 │
│                                         │
│              [ Generate token ]         │
└─────────────────────────────────────────┘
```

Classic Token 权限较宽，**仅建议个人使用，不要分享给他人**。

---

## 许可证

内部 / 演示项目，按需自行选择开源协议。
