# KOL YouTube 数据监控系统（静态版）

> **定位**：YouTube 合作视频数据监控看板，纯静态前端部署，无需后端服务器  
> **存储**：JSON 文件（`data/store.json`）· **采集**：GitHub Actions · **部署**：GitHub Pages

---

## 架构

```
inputs/videos.csv          GitHub Actions (每 2 小时)
       │                            │
       ▼                            ▼
data/store.json  ──►  scripts/collector.py  ──►  scripts/build_static.py
                                                          │
                                                          ▼
                                              frontend/public/data/site.json
                                                          │
                                                          ▼
                                              npm run build → GitHub Pages
```

- **无 MySQL、无 FastAPI、无 SSH 隧道、无云服务器**
- 前端读取构建好的 `site.json` 展示看板
- 视频列表在 `inputs/videos.csv` 中维护

---

## 本地开发

### 1. 配置 API Key（可选，仅本地采集时需要）

```powershell
Copy-Item .env.example .env
# 编辑 .env，填入 YOUTUBE_API_KEY
```

### 2. 构建静态数据

```powershell
python scripts/build_static.py
```

首次运行会从 `inputs/videos.csv` 和 `data/history.csv` 导入到 `data/store.json`。

### 3. 启动前端

```powershell
cd frontend
npm install
npm run dev
```

浏览器访问：**http://localhost:5173**

### 4. 本地手动采集（可选）

```powershell
pip install -r scripts/requirements.txt
python scripts/collector.py
python scripts/build_static.py
```

---

## 添加监控视频

### 方式 A：看板内自动写入（推荐）

添加视频后自动 commit 到 `inputs/videos.csv`，并触发采集。需先在 GitHub 创建 Token，再在看板里配置一次。

Token **仅保存在浏览器 localStorage**，不会写入仓库或上传到第三方服务器。

#### 第一步：在 GitHub 创建 Personal Access Token

> 以下步骤以 **Fine-grained token（细粒度令牌，推荐）** 为例。Classic Token 见本文末尾附录。

**1. 打开 Token 设置页**

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

**2. 填写 Token 基本信息（Token name / Expiration）**

| 字段 | 建议填写 |
|------|----------|
| **Token name** | `kol-monitor-dashboard`（任意易识别的名称） |
| **Expiration** | `90 days` 或 `No expiration`（过期后需重新生成） |
| **Description** | 可选，如「看板自动写入 videos.csv」 |

**3. 选择仓库访问范围（Repository access）**

选择 **Only select repositories**，然后在下拉框中勾选本项目仓库，例如：

```
☑ KOL-video-monitor-system
```

不要选「All repositories」，除非你有明确需要。

**4. 设置权限（Repository permissions）**

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

**5. 生成并复制 Token**

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

#### 第二步：在看板中配置 GitHub 同步

**1. 打开已部署的看板页面**（本地开发则为 http://localhost:5173）

**2. 在「视频列表管理」区域，点击「配置 GitHub 自动写入」**

**3. 填写以下信息：**

| 字段 | 示例 | 说明 |
|------|------|------|
| 用户名 / 组织 | `Daas3bb` | 仓库 Owner，见 `github.com/Daas3bb/...` |
| 仓库名 | `KOL-video-monitor-system` | 不含用户名 |
| 分支 | `main` | 通常为 `main` 或 `master` |
| GitHub Token | `github_pat_...` | 上一步复制的完整 Token |

GitHub Pages 部署的看板会自动预填仓库名（构建时注入 `VITE_GITHUB_REPO`），你主要填写 **Token** 即可。

**4. 点击「保存配置」**

顶部提示变为：**「已启用 GitHub 自动同步…」**，按钮显示 **「GitHub 同步已配置 ✓」**。

---

#### 第三步：验证自动写入是否生效

1. 在输入框粘贴一条 YouTube 链接，点击 **添加视频**
2. 成功时应看到 Toast 提示：

   ```
   已自动写入 inputs/videos.csv（1 个），采集任务已触发
   ```

3. 打开 GitHub 仓库确认：
   - **Code → inputs/videos.csv** 出现新行
   - **Actions** 有新的 workflow 运行记录

4. 等待 Actions 完成后刷新看板，新视频应出现完整标题、缩略图和采集数据

---

#### 常见问题

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

---

#### 附录：使用 Classic Token（备选）

若 Fine-grained Token 不可用，可使用 Classic Token：

1. 打开 https://github.com/settings/tokens/new
2. **Note** 填 `kol-monitor-dashboard`
3. **Expiration** 按需选择
4. 勾选 scope：**`repo`**（私有仓库必须；公开仓库也可只勾 `public_repo`）
5. 点击 **Generate token** 并复制

Classic Token 权限较宽，**仅建议个人使用，不要分享给他人**。

---

### 方式 B：手动编辑 CSV

编辑 `inputs/videos.csv`，追加一行：

```csv
video_id,title,video_url,thumbnail_url,publish_time,channel_title,status,created_at
YOUR_VIDEO_ID,,https://www.youtube.com/watch?v=YOUR_VIDEO_ID,,,,active,
```

title 等字段可留空，采集时会自动从 YouTube API 填充。

---

## 生产部署（GitHub Pages）

### 1. 推送代码到 GitHub

### 2. 配置 Secret

仓库 **Settings → Secrets → Actions**，添加：

| Secret | 说明 |
|--------|------|
| `YOUTUBE_API_KEY` | YouTube Data API v3 Key |

### 3. 启用 GitHub Pages

Settings → Pages → Source 选 **GitHub Actions**

### 4. 自动流程

`.github/workflows/collect.yml` 每 2 小时：

1. 运行 `scripts/collector.py` 采集数据
2. 运行 `scripts/build_static.py` 生成静态 JSON
3. `npm run build` 构建前端
4. 提交 `data/store.json` 和 `site.json`
5. 部署到 GitHub Pages

也可手动触发：**Actions → Collect and Deploy Static Site → Run workflow**

### 5. Actions 报错排查（git rebase / unrelated histories）

若日志里出现类似内容：

```
git commit -m 'chore: daily fetch (auto)'
git rebase origin/main
CONFLICT in data/history.csv
fatal: refusing to merge unrelated histories
```

**原因：**

1. 跑的是**旧版或自定义 workflow**（提交 `data/history.csv` 并 rebase），不是当前的 `Collect and Deploy Static Site`
2. 远程 `main` 曾被 **force push**，与 Actions 里的 git 历史不一致（unrelated histories）
3. 两个不同项目的历史被合进同一仓库，rebase 时出现 585 个冲突提交

**处理步骤：**

1. 打开 **Actions**，确认失败的是哪个 workflow 名称
2. 在 `.github/workflows/` 中**删除**旧 workflow（只保留 `collect.yml`）
3. 确认 `collect.yml` 的提交步骤是写入 `data/store.json`（不是只写 `history.csv`）
4. 重新 **Run workflow → Collect and Deploy Static Site**

若仍失败，在本地用干净代码覆盖远程 main（慎用，会重写远程历史）：

```powershell
cd D:\GithubFile\KOL-video-monitor-system
git checkout main
git pull origin main
git push origin main
```

然后只在 Actions 里手动运行 **Collect and Deploy Static Site**。

---

## 可部署的平台

本项目是纯静态站点（HTML + JS + JSON），**任何静态托管平台**均可部署，无需服务器。

| 平台 | 适合场景 | 说明 |
|------|----------|------|
| **GitHub Pages** | 推荐，零成本 | 项目已内置 workflow，自动采集 + 部署 |
| **Cloudflare Pages** | 全球 CDN、自定义域名 | 连接 GitHub 仓库，Build 命令 `cd frontend && npm run build`，输出目录 `frontend/dist` |
| **Vercel / Netlify** | 快速上线、预览环境 | 同上，Root 设为 `frontend`，Build `npm run build`，Output `dist` |
| **腾讯云 EdgeOne Pages** | 国内访问快 | CodeBuddy / 控制台上传 `frontend/dist` |
| **CodeBuddy Cloud Studio** | 临时演示 | 生成 `*.app.codebuddy.work` 临时链接 |
| **Docker + Nginx** | 自建预览 | `docker compose up` → http://localhost:8080 |
| **阿里云 OSS / 腾讯云 COS** | 对象存储 + CDN | 上传 `frontend/dist` 目录，开启静态网站 |

**注意：** 非 GitHub Pages 部署时，需在构建前设置 `PAGES_BASE` 环境变量（若站点不在域名根路径）：

```powershell
# 例如部署到 https://example.com/monitor/
$env:PAGES_BASE = "/monitor/"
cd frontend
npm run build
```

GitHub Actions 已自动设置 `PAGES_BASE=/<仓库名>/`。

---

## Docker 静态预览（可选）

```powershell
python scripts/build_static.py
cd frontend
npm run build
cd ..
docker compose up -d --build
```

访问：**http://localhost:8080**

---

## 目录结构

```
├── .env.example
├── data/
│   ├── store.json              # 主数据（视频 + 历史快照）
│   └── history.csv             # 遗留 CSV（首次导入用）
├── inputs/
│   └── videos.csv              # 监控视频列表（在此添加新视频）
├── scripts/
│   ├── collector.py            # YouTube 数据采集
│   ├── build_static.py         # 导出 frontend/public/data/site.json
│   ├── storage.py              # JSON 存储层
│   ├── analytics.py            # 看板聚合计算
│   └── requirements.txt
├── frontend/
│   └── public/data/site.json   # 前端读取的静态数据
└── .github/workflows/collect.yml
```

---

## 许可证

内部 / 演示项目，按需自行选择开源协议。
