import { useState } from "react";
import {
  defaultGithubSettings,
  isGithubSyncReady,
  loadGithubSettings,
  saveGithubSettings,
  verifyGithubSettings,
  type GithubSyncSettings,
} from "./githubCsvSync";

interface GithubSyncPanelProps {
  onSaved?: () => void;
}

export function GithubSyncPanel({ onSaved }: GithubSyncPanelProps) {
  const [open, setOpen] = useState(false);
  const [settings, setSettings] = useState<GithubSyncSettings>(() => loadGithubSettings());
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<string[] | null>(null);
  const ready = isGithubSyncReady(settings);

  const save = () => {
    saveGithubSettings(settings);
    setTestResult(null);
    onSaved?.();
  };

  const testConnection = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const result = await verifyGithubSettings(settings);
      setTestResult(result.messages);
      if (!result.ok) {
        setTestResult((prev) => [
          ...(prev ?? []),
          "",
          "若使用 Classic Token，需勾选 repo；Fine-grained 需 Contents + Actions 均为 Read and write。",
        ]);
      }
    } catch (e) {
      setTestResult([`测试失败：${e instanceof Error ? e.message : String(e)}`]);
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="github-sync-panel">
      <button
        type="button"
        className={`config-status-badge ${ready ? "ok" : "err"}`}
        onClick={() => setOpen((v) => !v)}
      >
        {ready ? "GitHub 同步已配置" : "GitHub 同步未配置"}
      </button>
      {open && (
        <div className="github-sync-form">
          <p className="github-sync-hint">
            配置后，添加视频将自动写入仓库 <code>inputs/videos.csv</code> 并触发采集。
            Token 仅保存在本机浏览器，需勾选 <strong>Contents: Read and write</strong>（写入 videos.csv）。
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
            <button type="button" className="btn" onClick={testConnection} disabled={testing}>
              {testing ? "测试中…" : "测试连接"}
            </button>
            <button
              type="button"
              className="btn"
              onClick={() => {
                setSettings(defaultGithubSettings());
                setTestResult(null);
              }}
            >
              重置
            </button>
          </div>
          {testResult && (
            <pre className="github-test-result">{testResult.join("\n")}</pre>
          )}
        </div>
      )}
    </div>
  );
}
