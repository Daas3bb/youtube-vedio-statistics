import { useState } from "react";
import {
  isYoutubeApiReady,
  loadYoutubeApiKey,
  loadYoutubeApiProxy,
  saveYoutubeApiKey,
  saveYoutubeApiProxy,
} from "./youtubeSettings";

interface YoutubeApiPanelProps {
  onSaved?: () => void;
}

export function YoutubeApiPanel({ onSaved }: YoutubeApiPanelProps) {
  const [open, setOpen] = useState(false);
  const [apiKey, setApiKey] = useState(() => loadYoutubeApiKey());
  const [apiProxy, setApiProxy] = useState(() => loadYoutubeApiProxy());
  const ready = isYoutubeApiReady();

  const save = () => {
    saveYoutubeApiKey(apiKey);
    saveYoutubeApiProxy(apiProxy);
    onSaved?.();
  };

  return (
    <div className="github-sync-panel">
      <button type="button" className="btn" onClick={() => setOpen((v) => !v)}>
        {ready ? "YouTube 即时采集 ✓" : "YouTube 即时采集"}
      </button>
      {open && (
        <div className="github-sync-form">
          <p className="github-sync-hint">
            「立刻采集」经 Vite 代理访问 YouTube API。请在项目根目录 <code>.env</code> 配置{" "}
            <code>PROXY_PORT=7897</code>（Clash HTTP 端口），保存后重启 <code>npm run dev</code>，
            无需再在终端手动设置环境变量。
            GitHub Actions 在美国服务器运行，<strong>不需要</strong>配置代理。
          </p>
          <div className="github-sync-grid">
            <label className="span-2">
              YouTube API Key（也可写在根目录 .env 的 YOUTUBE_API_KEY）
              <input
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value.trim())}
                placeholder="AIzaSy..."
              />
            </label>
            <label className="span-2">
              浏览器直连代理地址（可选，一般留空，用 .env 的 PROXY_PORT 即可）
              <input
                value={apiProxy}
                onChange={(e) => setApiProxy(e.target.value.trim())}
                placeholder="留空 → 使用 Vite /yt-api 代理"
              />
            </label>
          </div>
          <div className="batch-add-actions">
            <button type="button" className="btn btn-primary" onClick={save}>
              保存配置
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
