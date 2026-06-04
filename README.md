# KOL YouTube 数据监控系统

> **版本**：MVP V1.0  
> **定位**：品牌投放 / MCN 运营的 YouTube 合作视频数据监控工具  
> **存储**：CSV（无数据库）· **采集**：YouTube Data API v3 · **定时**：GitHub Actions

面向品牌在 YouTube 上投放的 KOL 合作视频，统一采集播放量、点赞、评论，沉淀历史快照，并通过 Dashboard 查看趋势与排行。

---

## 功能一览

| 模块 | 说明 |
|------|------|
| 视频列表 | 支持 YouTube 链接或 11 位 Video ID，保存至 `inputs/videos.csv` |
| 手动采集 | Web 看板或 API 触发，拉取实时统计并写入快照 |
| 快照存储 | 追加 `data/history.csv`，用于趋势与增量计算 |
| 去重 | 同一视频在同一**小时**内只保留一条（可改为 `minute`） |
| Dashboard | KPI、播放趋势、今日新增、排行榜、单视频详情 |
| 定时采集 | GitHub Actions 每 2 小时自动采集并提交 CSV |

---

## 技术栈

| 层级 | 技术 |
|------|------|
| 后端 | Python 3.11+、FastAPI、httpx |
| 前端 | React 18、Vite、ECharts |
| 数据 | CSV 文件 |
| CI | GitHub Actions |

---

## 目录结构

```
kol-youtube-monitor/
├── .env.example              # 环境变量模板（勿提交真实 Key）
├── inputs/videos.csv         # 监控视频列表
├── data/history.csv          # 历史快照
├── backend/
│   ├── main.py               # FastAPI 服务
│   ├── collector.py          # 采集脚本（CLI / Actions 共用）
│   ├── youtube_client.py     # YouTube API 封装
│   ├── storage.py            # CSV 读写与去重
│   └── analytics.py          # 看板聚合计算
├── frontend/                 # React 看板
├── scripts/
│   ├── verify_api.py         # 验证 API Key
│   ├── bootstrap.ps1         # Windows 一键配置
│   └── bootstrap.sh          # macOS/Linux 一键配置
└── .github/workflows/collect.yml
```

---

## 环境要求

- **Python** 3.11 或 3.12（推荐；3.14 需使用 `--only-binary=:all:` 安装依赖）
- **Node.js** 18+
- **YouTube Data API v3** 密钥（Google Cloud Console）

---

## 一、申请 YouTube API Key

1. 打开 [Google Cloud Console](https://console.cloud.google.com/)
2. 创建或选择项目 → **API 和服务** → **库** → 启用 **YouTube Data API v3**
3. **凭据** → **创建凭据** → **API 密钥**
4. （建议）限制密钥：仅 YouTube Data API v3，并设置 HTTP 引荐来源或 IP 限制

默认每日配额约 10,000 单位；每次 `videos.list` 约 1 单位。监控 50 个视频、每 2 小时采集一次，单日消耗远低于配额。

---

## 二、本地配置

### 方式 A：一键脚本（Windows）

```powershell
cd d:\Giselle\ReactCode\kol-youtube-monitor
notepad .env.example   # 先记下要填的字段
Copy-Item .env.example .env
notepad .env           # 填入: YOUTUBE_API_KEY=你的真实密钥
.\scripts\bootstrap.ps1
```

### 方式 B：手动配置

```powershell
# 1. 环境变量
Copy-Item .env.example .env
# 编辑 .env，设置 YOUTUBE_API_KEY=...

# 2. 后端依赖
pip install -r backend/requirements.txt
# Python 3.14 若安装失败:
# pip install -r backend/requirements.txt --only-binary=:all:

# 3. 验证 API 连通性
python scripts/verify_api.py
# 输出 ✅ 表示 Key 有效

# 4. 前端依赖
cd frontend
npm install
```

`.env` 示例：

```env
YOUTUBE_API_KEY=AIzaSyxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
DEDUP_GRANULARITY=hour
```

> ⚠️ **切勿**将 `.env` 提交到 Git；已在 `.gitignore` 中忽略。

---

## 三、启动项目

**终端 1 — 后端**

```powershell
cd backend
uvicorn main:app --reload --port 8000
```

**终端 2 — 前端**

```powershell
cd frontend
npm run dev
```

浏览器访问：**http://localhost:5173**

### 推荐使用流程

1. 在「视频列表」粘贴 YouTube 链接 → **添加视频**
2. 点击 **手动采集数据**（需 API Key 已配置）
3. 查看 KPI、趋势图、排行榜
4. 每隔数小时再次采集，即可看到增长曲线与「今日新增播放量」

### 命令行采集（与 GitHub Actions 相同）

```powershell
cd backend
python collector.py
```

---

## 四、Git 仓库初始化与推送

本项目已支持标准 Git 工作流：

```powershell
cd d:\Giselle\ReactCode\kol-youtube-monitor

# 若尚未初始化（首次）
git init
git add .
git commit -m "feat: KOL YouTube 监控 MVP 初始版本"

# 关联远程仓库（将 URL 换成你的 GitHub 地址）
git remote add origin https://github.com/<你的用户名>/kol-youtube-monitor.git
git branch -M main
git push -u origin main
```

### GitHub Actions 定时采集

1. 推送代码到 GitHub 后，进入仓库 **Settings → Secrets and variables → Actions**
2. 新建 Secret：`YOUTUBE_API_KEY` = 你的 API Key
3. **Actions** 页可手动运行 **Hourly YouTube Data Collection**，或等待每 2 小时自动执行
4. 工作流会更新 `inputs/videos.csv`、`data/history.csv` 并自动 commit
5. 本地同步：`git pull`

工作流提交前会执行 `git pull --rebase`，降低多人/多环境同时提交 CSV 的冲突概率。

---

## 五、API 接口

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/health` | 健康检查，`api_key_configured` 表示是否读到 Key |
| GET | `/api/videos` | 视频列表 |
| POST | `/api/videos` | 添加视频 `{"url_or_id": "https://youtu.be/xxx"}` |
| DELETE | `/api/videos/{video_id}` | 删除视频 |
| POST | `/api/collect` | 采集全部；可选 `{"video_id": "xxx"}` |
| GET | `/api/dashboard` | 看板聚合数据 |
| GET | `/api/videos/{video_id}/detail` | 单视频历史与增量 |

Swagger 文档：http://127.0.0.1:8000/docs

---

## 六、数据文件说明

### `inputs/videos.csv`

| 字段 | 说明 |
|------|------|
| video_id | YouTube 11 位 ID |
| title | 标题（采集后自动更新） |
| video_url | 完整链接 |
| thumbnail_url | 缩略图 |
| publish_time | 发布日期 |
| channel_title | 频道名 |
| status | `active` / `inactive` |
| created_at | 录入时间 |

### `data/history.csv`

| 字段 | 说明 |
|------|------|
| video_id | 视频 ID |
| snapshot_time | 采集时间 |
| view_count | 播放量快照 |
| like_count | 点赞快照 |
| comment_count | 评论快照 |
| created_at | 写入时间 |

**去重规则**：`video_id` + 小时桶（如 `2026-06-04 14:00:00`）已存在则跳过，避免重复消耗配额。

---

## 七、常见问题

### Q: `verify_api.py` 报未配置 Key？

确认项目根目录存在 `.env`，且 `YOUTUBE_API_KEY` 不是占位符 `your_api_key_here`。

### Q: 采集成功但「今日新增」为 0？

需要至少**两个自然日**各有快照，系统才能计算「今日 vs 昨日」的播放差值。

### Q: Python 3.14 安装 pydantic 失败？

```powershell
pip install -r backend/requirements.txt --only-binary=:all:
```

或安装 Python 3.11/3.12 创建虚拟环境。

### Q: 前端显示「加载失败」？

确认后端已在 `8000` 端口运行；Vite 已将 `/api` 代理到后端。

### Q: GitHub Actions push 失败？

检查仓库 **Settings → Actions → General → Workflow permissions** 是否为 **Read and write**。

---

## 八、路线图（V2）

- [ ] MySQL + KOL / Video 关系模型
- [ ] Celery + Redis 定时任务
- [ ] 播放量异常告警
- [ ] 多平台（TikTok、Instagram）
- [ ] AI 投放复盘报告

---

## 许可证

内部 / 演示项目，按需自行选择开源协议。
