import path from "path";
import { fileURLToPath } from "url";
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { HttpsProxyAgent } from "https-proxy-agent";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function resolveUpstreamProxy(env: Record<string, string>): string {
  const direct = env.HTTPS_PROXY || env.HTTP_PROXY || "";
  if (direct) return direct;
  const port = (env.PROXY_PORT || "").trim();
  if (port) return `http://127.0.0.1:${port}`;
  return process.env.HTTPS_PROXY || process.env.HTTP_PROXY || "";
}

export default defineConfig(({ mode }) => {
  const rootEnv = loadEnv(mode, path.resolve(__dirname, ".."), "");
  const upstreamProxy = resolveUpstreamProxy(rootEnv);
  const proxyAgent = upstreamProxy ? new HttpsProxyAgent(upstreamProxy) : undefined;

  if (upstreamProxy) {
    console.log(`[vite] YouTube API 代理: ${upstreamProxy}`);
  } else {
    console.warn(
      "[vite] 未配置代理：请在项目根目录 .env 设置 PROXY_PORT=7897 或 HTTPS_PROXY（国内需代理才能访问 Google API）"
    );
  }

  return {
    base: process.env.PAGES_BASE || "/",
    plugins: [react()],
    server: {
      port: 5173,
      proxy: {
        "/yt-api": {
          target: "https://www.googleapis.com/youtube/v3",
          changeOrigin: true,
          rewrite: (p) => p.replace(/^\/yt-api/, ""),
          agent: proxyAgent,
          timeout: 60_000,
          proxyTimeout: 60_000,
        },
      },
    },
    build: {
      rollupOptions: {
        output: {
          manualChunks: {
            echarts: ["echarts", "echarts-for-react"],
          },
        },
      },
    },
  };
});
