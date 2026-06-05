# KOL YouTube 数据监控系统

> **版本**：MVP V1.0  
> **定位**：品牌投放 / MCN 运营的 YouTube 合作视频数据监控工具  
> **存储**：MySQL 8.0 · **采集**：YouTube Data API v3 · **定时**：GitHub Actions + SSH Tunnel

面向品牌在 YouTube 上投放的 KOL 合作视频，统一采集播放量、点赞、评论，沉淀历史快照，并通过 Dashboard 查看趋势与排行。

---

## 功能一览

| 模块 | 说明 |
|------|------|
| 视频列表 | 支持 YouTube 链接或 11 位 Video ID，单条或批量添加 |
| 手动采集 | Web 看板或 API 触发，拉取实时统计并写入快照 |
| 快照存储 | MySQL 历史快照表，用于趋势与增量计算 |
| 去重 | 同一视频在同一**小时**内只保留一条（可改为 `minute`） |
| Dashboard | KPI、播放趋势、今日新增、排行榜、单视频详情 |
| 定时采集 | GitHub Actions 每 2 小时通过 SSH Tunnel 自动采集 |

---

## 技术栈

| 层级 | 技术 |
|------|------|
| 后端 | Python 3.11+、FastAPI、SQLAlchemy、httpx |
| 前端 | React 18、Vite、ECharts |
| 数据库 | MySQL 8.0 |
| 部署 | Docker Compose（Nginx + FastAPI + MySQL） |
| CI | GitHub Actions（SSH Tunnel 安全连接） |

---

## 目录结构

```
kol-youtube-monitor/
├── .env.example              # 环境变量模板（勿提交真实 Key）
├── .env                      # 实际环境变量（已 gitignore）
├── docker-compose.yml        # Docker Compose 编排（mysql + backend + frontend）
├── certs/                    # SSL 证书目录（fullchain.pem + privkey.pem）
├── backend/
│   ├── Dockerfile            # 后端 Docker 镜像
│   ├── main.py               # FastAPI 服务
│   ├── collector.py          # 采集脚本（CLI / Actions 共用）
│   ├── youtube_client.py     # YouTube API 封装
│   ├── storage.py            # MySQL 读写与去重
│   ├── analytics.py          # 看板聚合计算
│   ├── database.py           # SQLAlchemy 数据库连接
│   └── config.py             # 配置读取
├── frontend/
│   ├── Dockerfile            # 前端多阶段构建（Node → Nginx）
│   ├── nginx.conf            # Nginx 反向代理 + HTTPS 配置
│   └── src/                  # React 源码
├── scripts/
│   ├── verify_api.py         # 验证 API Key
│   ├── bootstrap.ps1         # Windows 一键配置
│   └── bootstrap.sh          # macOS/Linux 一键配置
└── .github/workflows/collect.yml  # 定时采集（SSH Tunnel）
```

---

## 环境变量（.env）

```env
# YouTube Data API v3 Key（从 Google Cloud Console 获取）
YOUTUBE_API_KEY=AIzaSyxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx

# 快照去重粒度：hour（默认）或 minute
DEDUP_GRANULARITY=hour

# MySQL root 密码
MYSQL_ROOT_PASSWORD=your_strong_password

# CORS 允许的来源（逗号分隔，生产环境填写你的域名）
CORS_ORIGINS=https://yourdomain.com,http://localhost:5173
```

> ⚠️ **切勿**将 `.env` 提交到 Git；已在 `.gitignore` 中忽略。

---

## 一、申请 YouTube API Key

1. 打开 [Google Cloud Console](https://console.cloud.google.com/)
2. 创建或选择项目 → **API 和服务** → **库** → 启用 **YouTube Data API v3**
3. **凭据** → **创建凭据** → **API 密钥**
4. （建议）限制密钥：仅 YouTube Data API v3，并设置 HTTP 引荐来源或 IP 限制

默认每日配额约 10,000 单位；每次 `videos.list` 约 1 单位。监控 50 个视频、每 2 小时采集一次，单日消耗远低于配额。

---

## 二、本地开发启动

### 方式 A：Docker 启动后端 + 本地前端（推荐）

```powershell
# 1. 配置环境变量
Copy-Item .env.example .env
# 编辑 .env，填入 YOUTUBE_API_KEY 和 MYSQL_ROOT_PASSWORD

# 2. Docker 启动 MySQL + Backend
docker compose up -d --build mysql backend

# 3. 另开终端，启动前端
cd frontend
npm install   # 首次需要
npm run dev
```

浏览器访问：**http://localhost:5173**

### 方式 B：全部本地运行（不用 Docker）

```powershell
# 1. 先单独启动 MySQL（可用 Docker 或本地安装）
docker compose up -d mysql

# 2. 配置环境变量
Copy-Item .env.example .env
# 编辑 .env，设置 YOUTUBE_API_KEY

# 3. 启动后端
cd backend
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
python main.py

# 4. 另开终端，启动前端
cd frontend
npm install
npm run dev
```

浏览器访问：**http://localhost:5173**

### 验证后端

- 健康检查：http://127.0.0.1:8000/api/health
- Swagger 文档：http://127.0.0.1:8000/docs

### 推荐使用流程

1. 在「视频列表」粘贴 YouTube 链接 → **添加视频**
2. 点击 **手动采集数据**（需 API Key 已配置）
3. 查看 KPI、趋势图、排行榜
4. 每隔数小时再次采集，即可看到增长曲线与「今日新增播放量」

### 命令行采集

```powershell
cd backend
python collector.py
```

---

## 三、生产环境部署（Docker Compose 一键部署）

### 前置条件

- 一台 Linux 服务器（推荐 1CPU / 2GB 内存以上）
- 一个域名（已解析到服务器 IP）
- Docker 和 Docker Compose 已安装

### 步骤

```bash
# 1. SSH 连接到服务器
ssh root@你的服务器IP

# 2. 安装 Docker（如尚未安装）
curl -fsSL https://get.docker.com | sh

# 3. 拉取代码
git clone <你的Git仓库地址> kol-youtube-monitor
cd kol-youtube-monitor

# 4. 配置环境变量
cp .env.example .env
nano .env   # 设置 YOUTUBE_API_KEY、MYSQL_ROOT_PASSWORD、CORS_ORIGINS

# 5. 获取 SSL 证书（Let's Encrypt）
sudo apt install certbot -y
sudo certbot certonly --standalone -d yourdomain.com
mkdir -p certs
sudo cp /etc/letsencrypt/live/yourdomain.com/fullchain.pem certs/
sudo cp /etc/letsencrypt/live/yourdomain.com/privkey.pem certs/

# 6. 启动所有服务（MySQL + Backend + Nginx 前端）
docker compose up -d --build

# 7. 验证
docker compose ps
curl https://yourdomain.com/api/health
```

### 架构

```
用户 (HTTPS)
    │
    ▼
┌──────────┐     ┌──────────┐     ┌──────────┐
│  Nginx   │────▶│ Backend  │────▶│  MySQL   │
│ (前端静态) │     │ FastAPI  │     │   8.0    │
│ :80/:443 │     │  :8000   │     │  :3306   │
└──────────┘     └──────────┘     └──────────┘
  React 文件      /api/* 反代     仅 127.0.0.1
```

### SSL 证书自动续期

```bash
# 添加定时任务（做一次即可）
sudo crontab -e

# 添加这一行：每天凌晨 3 点检查续期，成功后重启前端
0 3 * * * certbot renew --quiet && docker compose -f /root/kol-youtube-monitor/docker-compose.yml restart frontend
```

### 代码更新

每次本地修改代码并 push 后，在服务器上：

```bash
cd kol-youtube-monitor
git pull
docker compose up -d --build
```

---

## 四、GitHub Actions 定时采集（SSH Tunnel）

采集工作流通过 SSH Tunnel 安全连接生产 MySQL，**不需要暴露 3306 端口**。

### 1. 在服务器上生成 SSH 密钥

```bash
ssh-keygen -t ed25519 -f ~/.ssh/deploy_key_github -N "" -C "github-actions"
cat ~/.ssh/deploy_key_github.pub >> ~/.ssh/authorized_keys
cat ~/.ssh/deploy_key_github   # 复制内容
```

### 2. 配置 GitHub Secrets

进入仓库 **Settings → Secrets and variables → Actions**，添加以下 Secret：

| Secret 名称 | 值 |
|-------------|---|
| `SSH_PRIVATE_KEY` | 上面生成的私钥完整内容 |
| `SSH_HOST` | 服务器 IP 或域名 |
| `SSH_USER` | SSH 登录用户名（如 `root`） |
| `SSH_PORT` | SSH 端口（默认 `22`） |
| `DB_USER` | MySQL 用户名（如 `root`） |
| `DB_PASSWORD` | MySQL 密码 |
| `YOUTUBE_API_KEY` | YouTube Data API v3 Key |

### 3. 触发方式

- **自动**：每 2 小时（UTC）自动执行
- **手动**：Actions 页 → Hourly YouTube Data Collection → Run workflow
- **Push**：push 到 main/master 分支时触发

---

## 五、Git 仓库初始化与推送

```powershell
cd d:\Giselle\ReactCode\kol-youtube-monitor

# 若尚未初始化（首次）
git init
git add .
git commit -m "feat: KOL YouTube 监控 MVP 初始版本"

# 关联远程仓库
git remote add origin https://github.com/<你的用户名>/kol-youtube-monitor.git
git branch -M main
git push -u origin main
```

---

## 六、API 接口

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/health` | 健康检查 |
| GET | `/api/videos` | 视频列表 |
| POST | `/api/videos` | 添加视频 `{"url_or_id": "https://youtu.be/xxx"}` |
| POST | `/api/videos/batch` | 批量添加 `{"urls_or_ids": ["url1", "url2"]}` |
| PATCH | `/api/videos/{video_id}/status` | 更新状态 `?status=inactive` |
| DELETE | `/api/videos/{video_id}` | 删除视频 |
| POST | `/api/collect` | 采集全部；可选 `{"video_id": "xxx"}` |
| GET | `/api/dashboard` | 看板聚合数据 |
| GET | `/api/videos/{video_id}/detail` | 单视频历史与增量 |

Swagger 文档：http://127.0.0.1:8000/docs

---

## 七、常见问题

### Q: 后端启动报错连接 MySQL 失败？

确认 MySQL 容器已启动：`docker compose ps`。首次启动 MySQL 需要约 30 秒初始化，等待 healthcheck 通过。

### Q: 采集成功但「今日新增」为 0？

需要至少**两个自然日**各有快照，系统才能计算「今日 vs 昨日」的播放差值。

### Q: 前端显示「加载失败」？

确认后端已在 `8000` 端口运行；Vite 已将 `/api` 代理到后端。

### Q: 生产部署后 HTTPS 证书过期？

确认 SSL 自动续期 cron 已配置。手动续期：

```bash
sudo certbot renew
docker compose restart frontend
```

### Q: GitHub Actions 采集失败？

1. 检查 Secrets 是否全部配置正确
2. 确认服务器 SSH 端口对外开放
3. 手动运行一次 workflow 查看错误日志

### Q: Python 3.14 安装依赖失败？

```powershell
pip install -r backend/requirements.txt --only-binary=:all:
```

或安装 Python 3.11/3.12 创建虚拟环境。

---

## 八、路线图（V2）

- [ ] Celery + Redis 定时任务
- [ ] 播放量异常告警
- [ ] 多平台（TikTok、Instagram）
- [ ] AI 投放复盘报告
- [ ] 用户权限管理

---

## 许可证

内部 / 演示项目，按需自行选择开源协议。
