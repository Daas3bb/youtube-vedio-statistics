import { buildVideoUrl, toCsvLine } from "./localVideos";

const SETTINGS_KEY = "kol-github-sync-settings";
const CSV_PATH = "inputs/videos.csv";

export interface GithubSyncSettings {
  owner: string;
  repo: string;
  branch: string;
  token: string;
}

export function defaultGithubSettings(): GithubSyncSettings {
  const repoEnv = (import.meta.env.VITE_GITHUB_REPO as string | undefined) || "";
  const [envOwner = "", envRepo = ""] = repoEnv.includes("/") ? repoEnv.split("/", 2) : ["", ""];
  return {
    owner: envOwner || (import.meta.env.VITE_GITHUB_OWNER as string | undefined) || "Daas3bb",
    repo: envRepo || (import.meta.env.VITE_GITHUB_REPO_NAME as string | undefined) || "youtube-vedio-statistics",
    branch: (import.meta.env.VITE_GITHUB_BRANCH as string | undefined) || "main",
    token: "",
  };
}

export function loadGithubSettings(): GithubSyncSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return defaultGithubSettings();
    return { ...defaultGithubSettings(), ...(JSON.parse(raw) as Partial<GithubSyncSettings>) };
  } catch {
    return defaultGithubSettings();
  }
}

export function saveGithubSettings(settings: GithubSyncSettings): void {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

export function isGithubSyncReady(settings: GithubSyncSettings = loadGithubSettings()): boolean {
  return Boolean(settings.owner && settings.repo && settings.branch && settings.token);
}

function utf8ToBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  bytes.forEach((b) => {
    binary += String.fromCharCode(b);
  });
  return btoa(binary);
}

function base64ToUtf8(b64: string): string {
  const binary = atob(b64);
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function parseVideoIdsFromCsv(text: string): Set<string> {
  const ids = new Set<string>();
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("video_id")) continue;
    const id = trimmed.split(",")[0]?.trim();
    if (id) ids.add(id);
  }
  return ids;
}

async function githubFetch(
  settings: GithubSyncSettings,
  path: string,
  init: RequestInit = {}
): Promise<Response> {
  const url = `https://api.github.com/repos/${settings.owner}/${settings.repo}/contents/${path}?ref=${encodeURIComponent(settings.branch)}`;
  return fetch(url, {
    ...init,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${settings.token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      ...(init.headers || {}),
    },
  });
}

function githubAuthHeaders(settings: GithubSyncSettings): HeadersInit {
  return {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${settings.token}`,
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

function githubRepoUrl(settings: GithubSyncSettings, subpath: string): string {
  return `https://api.github.com/repos/${settings.owner}/${settings.repo}/${subpath}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function getLatestCollectRunId(
  settings: GithubSyncSettings = loadGithubSettings()
): Promise<number | null> {
  if (!isGithubSyncReady(settings)) return null;
  const res = await fetch(
    githubRepoUrl(settings, "actions/workflows/collect.yml/runs?per_page=1"),
    { headers: githubAuthHeaders(settings) }
  );
  if (!res.ok) return null;
  const data = (await res.json()) as { workflow_runs?: Array<{ id: number }> };
  return data.workflow_runs?.[0]?.id ?? null;
}

export async function triggerCollectWorkflow(
  settings: GithubSyncSettings = loadGithubSettings()
): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (!isGithubSyncReady(settings)) {
    return { ok: false, reason: "no_token" };
  }

  const res = await fetch(
    githubRepoUrl(settings, "actions/workflows/collect.yml/dispatches"),
    {
      method: "POST",
      headers: {
        ...githubAuthHeaders(settings),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ ref: settings.branch }),
    }
  );

  if (res.status === 204 || res.ok) {
    return { ok: true };
  }

  const err = await res.text();
  return { ok: false, reason: `dispatch_failed:${res.status}:${err.slice(0, 120)}` };
}

export async function waitForCollectWorkflow(
  settings: GithubSyncSettings = loadGithubSettings(),
  previousRunId: number | null = null,
  timeoutMs = 8 * 60 * 1000,
  onProgress?: (message: string) => void
): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (!isGithubSyncReady(settings)) {
    return { ok: false, reason: "no_token" };
  }

  const deadline = Date.now() + timeoutMs;
  await sleep(2500);

  while (Date.now() < deadline) {
    const res = await fetch(
      githubRepoUrl(settings, "actions/workflows/collect.yml/runs?per_page=5"),
      { headers: githubAuthHeaders(settings) }
    );
    if (!res.ok) {
      const err = await res.text();
      return { ok: false, reason: `poll_failed:${res.status}:${err.slice(0, 80)}` };
    }

    const data = (await res.json()) as {
      workflow_runs?: Array<{
        id: number;
        status: string;
        conclusion: string | null;
      }>;
    };
    const runs = data.workflow_runs ?? [];
    const target =
      runs.find((run) => previousRunId == null || run.id > previousRunId) ?? runs[0];

    if (target) {
      if (target.status === "completed") {
        if (target.conclusion === "success") return { ok: true };
        return { ok: false, reason: `workflow_${target.conclusion || "failed"}` };
      }
      onProgress?.(`GitHub Actions 运行中（${target.status}）…`);
    } else {
      onProgress?.("等待采集任务启动…");
    }

    await sleep(5000);
  }

  return { ok: false, reason: "timeout" };
}

export async function runCollectNow(
  settings: GithubSyncSettings = loadGithubSettings(),
  onProgress?: (message: string) => void
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const previousRunId = await getLatestCollectRunId(settings);
  const triggered = await triggerCollectWorkflow(settings);
  if (!triggered.ok) return triggered;

  onProgress?.("已触发采集，等待 GitHub Actions 完成…");
  return waitForCollectWorkflow(settings, previousRunId, 8 * 60 * 1000, onProgress);
}

export async function appendVideosToGithubCsv(
  videoIds: string[],
  settings: GithubSyncSettings = loadGithubSettings()
): Promise<{ ok: true; added: number } | { ok: false; reason: string }> {
  if (!videoIds.length) return { ok: false, reason: "empty" };
  if (!isGithubSyncReady(settings)) {
    return { ok: false, reason: "no_token" };
  }

  const res = await githubFetch(settings, CSV_PATH);
  if (res.status === 404) {
    return { ok: false, reason: "csv_not_found" };
  }
  if (!res.ok) {
    const err = await res.text();
    return { ok: false, reason: `read_failed:${res.status}:${err.slice(0, 120)}` };
  }

  const payload = (await res.json()) as { content?: string; sha?: string };
  if (!payload.content || !payload.sha) {
    return { ok: false, reason: "invalid_csv_payload" };
  }

  const currentText = base64ToUtf8(payload.content.replace(/\n/g, ""));
  const existingIds = parseVideoIdsFromCsv(currentText);
  const newIds = videoIds.filter((id) => !existingIds.has(id));
  if (!newIds.length) {
    return { ok: true, added: 0 };
  }

  const suffix = currentText.endsWith("\n") || !currentText ? "" : "\n";
  const appended = newIds.map((id) => toCsvLine(id)).join("\n");
  const nextText = `${currentText}${suffix}${appended}\n`;

  const putRes = await fetch(
    `https://api.github.com/repos/${settings.owner}/${settings.repo}/contents/${CSV_PATH}`,
    {
      method: "PUT",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${settings.token}`,
        "X-GitHub-Api-Version": "2022-11-28",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        message: `feat: add ${newIds.length} video(s) via dashboard`,
        content: utf8ToBase64(nextText),
        sha: payload.sha,
        branch: settings.branch,
      }),
    }
  );

  if (!putRes.ok) {
    const err = await putRes.text();
    return { ok: false, reason: `write_failed:${putRes.status}:${err.slice(0, 120)}` };
  }

  return { ok: true, added: newIds.length };
}

export function downloadVideosCsv(videoIds: string[], existingIds: Set<string> = new Set()): void {
  const header =
    "video_id,title,video_url,thumbnail_url,publish_time,channel_title,status,created_at";
  const lines = videoIds
    .filter((id) => !existingIds.has(id))
    .map((id) => toCsvLine(id));
  if (!lines.length) return;

  const blob = new Blob([`${header}\n${lines.join("\n")}\n`], {
    type: "text/csv;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "videos-new.csv";
  a.click();
  URL.revokeObjectURL(url);
}

export function buildCsvAppendSnippet(videoIds: string[]): string {
  return videoIds.map((id) => toCsvLine(id)).join("\n");
}

export function formatGithubSyncError(reason: string): string {
  if (reason === "no_token") return "未配置 GitHub Token";
  if (reason === "csv_not_found") return "仓库中找不到 inputs/videos.csv";
  if (reason === "timeout") return "采集超时，请稍后在 Actions 页查看或手动刷新看板";
  if (reason.startsWith("dispatch_failed:403")) {
    return "Token 无 Actions 权限，请勾选 Actions: Read and write";
  }
  if (reason.startsWith("dispatch_failed:404")) return "找不到 collect.yml 工作流";
  if (reason.startsWith("write_failed:403")) return "Token 无写入权限，请勾选 Contents: Read and write";
  if (reason.startsWith("write_failed:401")) return "Token 无效或已过期";
  if (reason.startsWith("read_failed:404")) return "仓库/分支/文件路径不正确";
  if (reason.startsWith("workflow_")) return `采集任务失败（${reason.replace("workflow_", "")}）`;
  return reason;
}

export function videoUrl(videoId: string): string {
  return buildVideoUrl(videoId);
}
