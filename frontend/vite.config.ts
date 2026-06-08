import { execFile } from "node:child_process";
import { writeFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import path from "path";
import type { IncomingMessage } from "node:http";
import { fileURLToPath } from "url";
import type { Plugin } from "vite";
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { HttpsProxyAgent } from "https-proxy-agent";

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..");

function readRequestBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(chunk as Buffer));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
    req.on("error", reject);
  });
}

function localCollectPlugin(): Plugin {
  let running = false;

  return {
    name: "local-collect",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const isRunCollect = req.url === "/api/run-collect" && req.method === "POST";
        const isPersistSnapshots =
          req.url === "/api/persist-snapshots" && req.method === "POST";
        if (!isRunCollect && !isPersistSnapshots) {
          next();
          return;
        }

        if (running) {
          res.statusCode = 429;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ ok: false, error: "collect_running" }));
          return;
        }

        running = true;
        res.setHeader("Content-Type", "application/json");

        try {
          if (isPersistSnapshots) {
            const body = await readRequestBody(req);
            const tmpPath = join(tmpdir(), `persist-snapshots-${Date.now()}.json`);
            writeFileSync(tmpPath, body, "utf-8");
            try {
              await execFileAsync("python", ["scripts/persist_snapshots.py", tmpPath], {
                cwd: PROJECT_ROOT,
                timeout: 180_000,
                windowsHide: true,
              });
            } finally {
              unlinkSync(tmpPath);
            }
            res.end(JSON.stringify({ ok: true }));
            return;
          }

          await execFileAsync("python", ["scripts/collector.py"], {
            cwd: PROJECT_ROOT,
            timeout: 180_000,
            windowsHide: true,
          });
          await execFileAsync("python", ["scripts/build_static.py"], {
            cwd: PROJECT_ROOT,
            timeout: 120_000,
            windowsHide: true,
          });
          res.end(JSON.stringify({ ok: true }));
        } catch (error) {
          res.statusCode = 500;
          const message = error instanceof Error ? error.message : String(error);
          res.end(JSON.stringify({ ok: false, error: message }));
        } finally {
          running = false;
        }
      });
    },
  };
}

function resolveUpstreamProxy(env: Record<string, string>): string {
  const direct = env.HTTPS_PROXY || env.HTTP_PROXY || "";
  if (direct) return direct;
  const ip = (env.PROXY_IP || "").trim();
  if (ip) return `http://${ip}`;
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
    plugins: [react(), localCollectPlugin()],
    server: {
      port: 3000,
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
