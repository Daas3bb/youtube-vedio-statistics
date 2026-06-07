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
  const [owner = "", repo = ""] = repoEnv.includes("/") ? repoEnv.split("/", 2) : ["", ""];
  return {
    owner,
    repo,
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

  try {
    await fetch(
      `https://api.github.com/repos/${settings.owner}/${settings.repo}/actions/workflows/collect.yml/dispatches`,
      {
        method: "POST",
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${settings.token}`,
          "X-GitHub-Api-Version": "2022-11-28",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ ref: settings.branch }),
      }
    );
  } catch {
    // 写入成功即可；触发采集失败不阻断
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

export function videoUrl(videoId: string): string {
  return buildVideoUrl(videoId);
}
