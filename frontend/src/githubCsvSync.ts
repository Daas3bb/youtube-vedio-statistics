import type { StaticSiteData } from "./api";
import {
  applyDeletionToDashboard,
  buildVideoUrl,
  toCsvLine,
} from "./localVideos";

const SETTINGS_KEY = "kol-github-sync-settings";
const CSV_PATH = "inputs/videos.csv";
const STORE_PATH = "data/store.json";
const SITE_PATH = "frontend/public/data/site.json";

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
  onProgress?: (message: string) => void,
  dispatchedAfterMs = Date.now()
): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (!isGithubSyncReady(settings)) {
    return { ok: false, reason: "no_token" };
  }

  type WorkflowRun = {
    id: number;
    status: string;
    conclusion: string | null;
    created_at?: string;
  };

  const isNewRun = (run: WorkflowRun): boolean => {
    if (previousRunId != null && run.id > previousRunId) return true;
    if (run.created_at) {
      const created = Date.parse(run.created_at);
      if (!Number.isNaN(created) && created >= dispatchedAfterMs - 15_000) return true;
    }
    return false;
  };

  const deadline = Date.now() + timeoutMs;
  const waitStartedMs = Date.now();
  await sleep(3000);

  while (Date.now() < deadline) {
    const res = await fetch(
      githubRepoUrl(settings, "actions/workflows/collect.yml/runs?per_page=8"),
      { headers: githubAuthHeaders(settings) }
    );
    if (!res.ok) {
      const err = await res.text();
      return { ok: false, reason: `poll_failed:${res.status}:${err.slice(0, 80)}` };
    }

    const data = (await res.json()) as { workflow_runs?: WorkflowRun[] };
    const runs = data.workflow_runs ?? [];
    const newRuns = runs.filter(isNewRun);
    const target =
      newRuns.find((run) => run.status !== "completed") ??
      newRuns.find((run) => run.status === "completed");

    const waitedSec = Math.floor((Date.now() - waitStartedMs) / 1000);

    if (!target) {
      if (waitedSec >= 45 && waitedSec % 15 < 5) {
        onProgress?.(
          `等待采集任务启动（已 ${waitedSec}s）…若持续无响应，请到 GitHub 仓库 Actions 页查看是否有排队任务`
        );
      } else {
        onProgress?.(`等待采集任务启动（已 ${waitedSec}s）…`);
      }
      await sleep(5000);
      continue;
    }

    if (target.status === "completed") {
      if (target.conclusion === "success") return { ok: true };
      return { ok: false, reason: `workflow_${target.conclusion || "failed"}` };
    }

    onProgress?.(`GitHub Actions 运行中（${target.status}）…`);
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

export interface CollectWorkflowStep {
  number: number;
  name: string;
  status: string;
  conclusion: string | null;
}

export interface CollectWorkflowJob {
  id: number;
  name: string;
  status: string;
  conclusion: string | null;
  started_at: string | null;
  completed_at: string | null;
  steps: CollectWorkflowStep[];
}

export interface CollectWorkflowRunInfo {
  id: number;
  name: string;
  status: string;
  conclusion: string | null;
  event: string;
  created_at: string;
  updated_at: string;
  html_url: string;
  jobs: CollectWorkflowJob[];
}

export function collectWorkflowPageUrl(
  settings: GithubSyncSettings = loadGithubSettings()
): string {
  return `https://github.com/${settings.owner}/${settings.repo}/actions/workflows/collect.yml`;
}

export function formatWorkflowEvent(event: string): string {
  if (event === "schedule") return "定时";
  if (event === "workflow_dispatch") return "手动";
  if (event === "push") return "代码推送";
  return event;
}

export function formatWorkflowStatus(status: string, conclusion: string | null): string {
  if (status === "queued") return "排队中";
  if (status === "in_progress") return "运行中";
  if (status === "waiting" || status === "pending" || status === "requested") return "等待中";
  if (status === "completed") {
    if (conclusion === "success") return "成功";
    if (conclusion === "failure") return "失败";
    if (conclusion === "cancelled") return "已取消";
    if (conclusion === "skipped") return "已跳过";
    return conclusion || "已完成";
  }
  return status;
}

export function formatJobStatus(status: string, conclusion: string | null): string {
  return formatWorkflowStatus(status, conclusion);
}

export async function fetchLatestCollectWorkflowRun(
  settings: GithubSyncSettings = loadGithubSettings()
): Promise<
  { ok: true; run: CollectWorkflowRunInfo | null } | { ok: false; reason: string }
> {
  if (!isGithubSyncReady(settings)) {
    return { ok: false, reason: "no_token" };
  }

  const res = await fetch(
    githubRepoUrl(settings, "actions/workflows/collect.yml/runs?per_page=1"),
    { headers: githubAuthHeaders(settings) }
  );
  if (!res.ok) {
    const err = await res.text();
    return { ok: false, reason: `poll_failed:${res.status}:${err.slice(0, 80)}` };
  }

  const data = (await res.json()) as {
    workflow_runs?: Array<{
      id: number;
      name: string;
      status: string;
      conclusion: string | null;
      event: string;
      created_at: string;
      updated_at: string;
      html_url: string;
    }>;
  };

  const raw = data.workflow_runs?.[0];
  if (!raw) return { ok: true, run: null };

  const jobsRes = await fetch(
    githubRepoUrl(settings, `actions/runs/${raw.id}/jobs?per_page=20`),
    { headers: githubAuthHeaders(settings) }
  );

  let jobs: CollectWorkflowJob[] = [];
  if (jobsRes.ok) {
    const jobsData = (await jobsRes.json()) as {
      jobs?: Array<{
        id: number;
        name: string;
        status: string;
        conclusion: string | null;
        started_at: string | null;
        completed_at: string | null;
        steps?: Array<{
          number: number;
          name: string;
          status: string;
          conclusion: string | null;
        }>;
      }>;
    };
    jobs = (jobsData.jobs ?? []).map((job) => ({
      id: job.id,
      name: job.name,
      status: job.status,
      conclusion: job.conclusion,
      started_at: job.started_at,
      completed_at: job.completed_at,
      steps: (job.steps ?? []).map((step) => ({
        number: step.number,
        name: step.name,
        status: step.status,
        conclusion: step.conclusion,
      })),
    }));
  }

  return {
    ok: true,
    run: {
      id: raw.id,
      name: raw.name,
      status: raw.status,
      conclusion: raw.conclusion,
      event: raw.event,
      created_at: raw.created_at,
      updated_at: raw.updated_at,
      html_url: raw.html_url,
      jobs,
    },
  };
}

export async function appendVideosToGithubCsv(
  videoIds: string[],
  settings: GithubSyncSettings = loadGithubSettings()
): Promise<{ ok: true; added: number } | { ok: false; reason: string }> {
  if (!videoIds.length) return { ok: false, reason: "empty" };
  if (!isGithubSyncReady(settings)) {
    return { ok: false, reason: "no_token" };
  }

  const maxAttempts = 4;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
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

    if (putRes.ok) {
      return { ok: true, added: newIds.length };
    }

    const err = await putRes.text();
    if (putRes.status === 409 && attempt < maxAttempts) {
      await sleep(600 * attempt);
      continue;
    }

    return { ok: false, reason: `write_failed:${putRes.status}:${err.slice(0, 120)}` };
  }

  return { ok: false, reason: "write_failed:409:sha_conflict_after_retries" };
}

function buildCsvWithoutIds(
  currentText: string,
  dropIds: Set<string>
): { nextText: string; removed: number } {
  const lines = currentText.split(/\r?\n/);
  if (!lines.length) {
    return { nextText: currentText, removed: 0 };
  }

  const header = lines[0];
  const kept = [header];
  let removed = 0;

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (!trimmed) continue;
    const id = trimmed.split(",")[0]?.trim();
    if (id && dropIds.has(id)) {
      removed++;
      continue;
    }
    kept.push(line);
  }

  const nextText = kept.length > 1 ? `${kept.join("\n")}\n` : `${header}\n`;
  return { nextText, removed };
}

async function updateGithubTextFile(
  path: string,
  mutate: (currentText: string) => { nextText: string; changed: boolean },
  message: string,
  settings: GithubSyncSettings = loadGithubSettings()
): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (!isGithubSyncReady(settings)) {
    return { ok: false, reason: "no_token" };
  }

  const maxAttempts = 4;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const res = await githubFetch(settings, path);
    if (res.status === 404) {
      return { ok: false, reason: "file_not_found" };
    }
    if (!res.ok) {
      const err = await res.text();
      return { ok: false, reason: `read_failed:${res.status}:${err.slice(0, 120)}` };
    }

    const payload = (await res.json()) as { content?: string; sha?: string };
    if (!payload.content || !payload.sha) {
      return { ok: false, reason: "invalid_file_payload" };
    }

    const currentText = base64ToUtf8(payload.content.replace(/\n/g, ""));
    const { nextText, changed } = mutate(currentText);
    if (!changed) {
      return { ok: true };
    }

    const putRes = await fetch(
      `https://api.github.com/repos/${settings.owner}/${settings.repo}/contents/${path}`,
      {
        method: "PUT",
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${settings.token}`,
          "X-GitHub-Api-Version": "2022-11-28",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          message,
          content: utf8ToBase64(nextText),
          sha: payload.sha,
          branch: settings.branch,
        }),
      }
    );

    if (putRes.ok) {
      return { ok: true };
    }

    const err = await putRes.text();
    if (putRes.status === 409 && attempt < maxAttempts) {
      await sleep(600 * attempt);
      continue;
    }

    return { ok: false, reason: `write_failed:${putRes.status}:${err.slice(0, 120)}` };
  }

  return { ok: false, reason: "write_failed:409:sha_conflict_after_retries" };
}

async function updateGithubJsonFile<T>(
  path: string,
  mutate: (data: T) => T | null,
  message: string,
  settings: GithubSyncSettings = loadGithubSettings()
): Promise<{ ok: true } | { ok: false; reason: string }> {
  return updateGithubTextFile(
    path,
    (currentText) => {
      const data = JSON.parse(currentText) as T;
      const next = mutate(data);
      if (!next) {
        return { nextText: currentText, changed: false };
      }
      const nextText = `${JSON.stringify(next, null, 2)}\n`;
      return { nextText, changed: nextText !== currentText };
    },
    message,
    settings
  );
}

function pruneSiteData(site: StaticSiteData, dropIds: Set<string>): StaticSiteData {
  const dashboard = applyDeletionToDashboard(site.dashboard, dropIds);
  const details = { ...site.details };
  dropIds.forEach((id) => {
    delete details[id];
  });
  return {
    ...site,
    generated_at: new Date().toISOString().slice(0, 19),
    dashboard,
    details,
  };
}

export async function removeVideosFromGithubCsv(
  videoIds: string[],
  settings: GithubSyncSettings = loadGithubSettings()
): Promise<{ ok: true; removed: number } | { ok: false; reason: string }> {
  if (!videoIds.length) return { ok: false, reason: "empty" };

  const dropIds = new Set(videoIds);
  let removed = 0;
  const result = await updateGithubTextFile(
    CSV_PATH,
    (currentText) => {
      const next = buildCsvWithoutIds(currentText, dropIds);
      removed = next.removed;
      return { nextText: next.nextText, changed: next.removed > 0 };
    },
    `feat: remove ${videoIds.length} video(s) via dashboard`,
    settings
  );

  if (!result.ok) return result;
  return { ok: true, removed };
}

export async function removeVideosFromStoreJson(
  videoIds: string[],
  settings: GithubSyncSettings = loadGithubSettings()
): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (!videoIds.length) return { ok: false, reason: "empty" };

  const dropIds = new Set(videoIds);
  return updateGithubJsonFile<{
    videos: Array<{ video_id?: string }>;
    history: Array<{ video_id?: string }>;
  }>(
    STORE_PATH,
    (store) => {
      const videos = (store.videos ?? []).filter(
        (row) => row.video_id && !dropIds.has(row.video_id)
      );
      const history = (store.history ?? []).filter(
        (row) => row.video_id && !dropIds.has(row.video_id)
      );
      const changed =
        videos.length !== (store.videos ?? []).length ||
        history.length !== (store.history ?? []).length;
      if (!changed) return null;
      return { ...store, videos, history };
    },
    `feat: purge ${videoIds.length} video(s) from store.json`,
    settings
  );
}

export async function removeVideosFromSiteJson(
  videoIds: string[],
  settings: GithubSyncSettings = loadGithubSettings()
): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (!videoIds.length) return { ok: false, reason: "empty" };

  const dropIds = new Set(videoIds);
  return updateGithubJsonFile<StaticSiteData>(
    SITE_PATH,
    (site) => {
      const next = pruneSiteData(site, dropIds);
      const changed =
        next.dashboard.videos.length !== site.dashboard.videos.length ||
        Object.keys(next.details).length !== Object.keys(site.details).length;
      if (!changed) return null;
      return next;
    },
    `feat: remove ${videoIds.length} video(s) from site.json`,
    settings
  );
}

export async function removeVideosFromGithub(
  videoIds: string[],
  settings: GithubSyncSettings = loadGithubSettings()
): Promise<
  | { ok: true; csvRemoved: number; storeUpdated: boolean; siteUpdated: boolean }
  | { ok: false; reason: string }
> {
  if (!videoIds.length) return { ok: false, reason: "empty" };
  if (!isGithubSyncReady(settings)) {
    return { ok: false, reason: "no_token" };
  }

  const csvResult = await removeVideosFromGithubCsv(videoIds, settings);
  if (!csvResult.ok) return csvResult;

  const storeResult = await removeVideosFromStoreJson(videoIds, settings);
  if (!storeResult.ok) return storeResult;

  const siteResult = await removeVideosFromSiteJson(videoIds, settings);
  if (!siteResult.ok) return siteResult;

  return {
    ok: true,
    csvRemoved: csvResult.removed,
    storeUpdated: true,
    siteUpdated: true,
  };
}

export async function verifyGithubSettings(
  settings: GithubSyncSettings = loadGithubSettings()
): Promise<{ ok: boolean; messages: string[] }> {
  const messages: string[] = [];
  if (!isGithubSyncReady(settings)) {
    return { ok: false, messages: ["请先填写用户名、仓库名、分支和 Token"] };
  }

  if (settings.token.startsWith("AIzaSy")) {
    return {
      ok: false,
      messages: ["当前填的是 YouTube API Key（AIzaSy…），请改用 GitHub Personal Access Token（github_pat_… 或 ghp_…）"],
    };
  }

  const csvRes = await githubFetch(settings, CSV_PATH);
  if (csvRes.status === 401) messages.push("✗ Token 无效或已过期");
  else if (csvRes.status === 403) messages.push("✗ 无法读取 videos.csv（需 Contents: Read and write，且 Token 已授权本仓库）");
  else if (csvRes.status === 404) messages.push("✗ 找不到 inputs/videos.csv，请检查仓库名/分支");
  else if (csvRes.ok) messages.push("✓ 可读写 inputs/videos.csv");
  else messages.push(`✗ 读取 CSV 失败（HTTP ${csvRes.status}）`);

  const wfRes = await fetch(githubRepoUrl(settings, "actions/workflows/collect.yml"), {
    headers: githubAuthHeaders(settings),
  });
  if (wfRes.status === 403) messages.push("✗ 无法访问 Actions（需 Actions: Read and write）");
  else if (wfRes.status === 404) messages.push("✗ 找不到 .github/workflows/collect.yml");
  else if (wfRes.ok) messages.push("✓ 可访问 collect.yml 工作流");

  const runsRes = await fetch(
    githubRepoUrl(settings, "actions/workflows/collect.yml/runs?per_page=1"),
    { headers: githubAuthHeaders(settings) }
  );
  if (runsRes.status === 403) messages.push("✗ 无法查看 Actions 运行记录");
  else if (runsRes.ok) messages.push("✓ 可查看 Actions 运行记录（支持「立刻采集」）");

  const ok = csvRes.ok && wfRes.ok && runsRes.ok;
  return { ok, messages };
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
  if (reason === "csv_not_found" || reason === "file_not_found") {
    return "仓库中找不到目标文件，请检查仓库名/分支";
  }
  if (reason === "timeout") {
    return "等待超时：Actions 未在 10 分钟内启动或完成。请到仓库 Actions 页查看是否有排队/失败任务，并确认 Token 有 Actions: Read and write";
  }
  if (reason.startsWith("dispatch_failed:403")) {
    return "Token 无 Actions 权限，请勾选 Actions: Read and write";
  }
  if (reason.startsWith("dispatch_failed:404")) return "找不到 collect.yml 工作流";
  if (reason.includes("workflow_dispatch")) {
    return "工作流未开启手动触发，请将最新 collect.yml 推送到 GitHub 后再试";
  }
  if (reason.startsWith("write_failed:409")) {
    return "videos.csv 已被其他人/Actions 更新（版本冲突），请稍后重试「同步 GitHub」";
  }
  if (reason.startsWith("write_failed:403")) return "Token 无写入权限，请勾选 Contents: Read and write";
  if (reason.startsWith("write_failed:401")) return "Token 无效或已过期";
  if (reason.startsWith("read_failed:404")) return "仓库/分支/文件路径不正确";
  if (reason.startsWith("workflow_")) {
    const detail = reason.replace("workflow_", "");
    if (detail === "failure") {
      return "采集任务在 GitHub Actions 中失败，请到仓库 Actions 页查看日志（常见原因：未配置 YOUTUBE_API_KEY Secret，或 git push 冲突）";
    }
    return `采集任务失败（${detail}）`;
  }
  return reason;
}

export function videoUrl(videoId: string): string {
  return buildVideoUrl(videoId);
}
