import { useState } from "react";
import {
  defaultGithubSettings,
  isGithubSyncReady,
  loadGithubSettings,
  saveGithubSettings,
  type GithubSyncSettings,
} from "./githubCsvSync";

interface GithubSyncPanelProps {
  onSaved?: () => void;
}

export function GithubSyncPanel({ onSaved }: GithubSyncPanelProps) {
  const [open, setOpen] = useState(false);
  const [settings, setSettings] = useState<GithubSyncSettings>(() => loadGithubSettings());
  const ready = isGithubSyncReady(settings);

  const save = () => {
    saveGithubSettings(settings);
    onSaved?.();
  };

  return (
    <div className="github-sync-panel">
      <button type="button" className="btn" onClick={() => setOpen((v) => !v)}>
        {ready ? "GitHub 同步已配置 ✓" : "配置 GitHub 自动写入"}
      </button>
      {open && (
        <div className="github-sync-form">
          <p className="github-sync-hint">
            配置后，添加视频将自动写入仓库 <code>inputs/videos.csv</code> 并触发采集。
            Token 仅保存在本机浏览器，需勾选 <strong>Contents: Read and write</strong> 与{" "}
            <strong>Actions: Read and write</strong>（用于「立刻采集」）。
            详细图文步骤见仓库 <code>README.md</code>「添加监控视频 → 方式 A」。
            {" "}
            <a
              href="https://github.com/settings/personal-access-tokens/new"
              target="_blank"
              rel="noreferrer"
              className="link"
            >
              前往创建 Token →
            </a>
          </p>
          <div className="github-sync-grid">
            <label>
              用户名 / 组织
              <input
                value={settings.owner}
                onChange={(e) => setSettings({ ...settings, owner: e.target.value.trim() })}
                placeholder="Daas3bb"
              />
            </label>
            <label>
              仓库名
              <input
                value={settings.repo}
                onChange={(e) => setSettings({ ...settings, repo: e.target.value.trim() })}
                placeholder="youtube-vedio-statistics"
              />
            </label>
            <label>
              分支
              <input
                value={settings.branch}
                onChange={(e) => setSettings({ ...settings, branch: e.target.value.trim() })}
                placeholder="main"
              />
            </label>
            <label className="span-2">
              GitHub Token（Personal Access Token，形如 github_pat_… 或 ghp_…，不是 YouTube API Key）
              <input
                type="password"
                value={settings.token}
                onChange={(e) => setSettings({ ...settings, token: e.target.value.trim() })}
                placeholder="github_pat_..."
              />
            </label>
          </div>
          <div className="batch-add-actions">
            <button type="button" className="btn btn-primary" onClick={save}>
              保存配置
            </button>
            <button
              type="button"
              className="btn"
              onClick={() => setSettings(defaultGithubSettings())}
            >
              重置
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
