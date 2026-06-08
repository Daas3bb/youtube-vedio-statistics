export type PanelId = "detail" | "videos" | "rankings";

export const DEFAULT_PAGE: PanelId = "detail";

const PAGE_LABELS: Record<PanelId, string> = {
  detail: "视频详情",
  videos: "视频管理",
  rankings: "播放量排行",
};

export function pageLabel(page: PanelId): string {
  return PAGE_LABELS[page];
}

export function pageFromHash(hash = window.location.hash): PanelId {
  const path = hash.replace(/^#\/?/, "").split("?")[0];
  if (path === "videos") return "videos";
  if (path === "rankings") return "rankings";
  return DEFAULT_PAGE;
}

export function hashFromPage(page: PanelId): string {
  if (page === DEFAULT_PAGE) return "#/";
  return `#/${page}`;
}

export function navigateToPage(page: PanelId) {
  const next = hashFromPage(page);
  if (window.location.hash !== next) {
    window.location.hash = next;
  }
}

const VIDEO_LIST_PAGE_SIZE_KEY = "kol-video-list-page-size";

export function loadVideoListPageSize(defaultSize: number, maxSize: number): number {
  try {
    const size = Number.parseInt(localStorage.getItem(VIDEO_LIST_PAGE_SIZE_KEY) ?? "", 10);
    if (!Number.isFinite(size) || size < 1 || size > maxSize) return defaultSize;
    return size;
  } catch {
    return defaultSize;
  }
}

export function saveVideoListPageSize(size: number) {
  localStorage.setItem(VIDEO_LIST_PAGE_SIZE_KEY, String(size));
}
