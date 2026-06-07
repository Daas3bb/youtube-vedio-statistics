const KEY_SETTINGS = "kol-youtube-api-key";
const PROXY_SETTINGS = "kol-youtube-api-proxy";

export function loadYoutubeApiKey(): string {
  try {
    return localStorage.getItem(KEY_SETTINGS)?.trim() || "";
  } catch {
    return "";
  }
}

export function saveYoutubeApiKey(key: string): void {
  localStorage.setItem(KEY_SETTINGS, key.trim());
}

export function loadYoutubeApiProxy(): string {
  try {
    return localStorage.getItem(PROXY_SETTINGS)?.trim() || "";
  } catch {
    return "";
  }
}

export function saveYoutubeApiProxy(url: string): void {
  localStorage.setItem(PROXY_SETTINGS, url.trim());
}

export function isYoutubeApiReady(): boolean {
  const key = loadYoutubeApiKey();
  return Boolean(key && key.startsWith("AIza"));
}
