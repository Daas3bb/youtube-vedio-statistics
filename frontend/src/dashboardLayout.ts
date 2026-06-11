export type NavGroupId = "content" | "analytics";

export type PanelId =
  | "detail"
  | "videos"
  | "analytics-cumulative"
  | "analytics-incremental"
  | "rankings";

export const DEFAULT_PAGE: PanelId = "detail";

const PAGE_LABELS: Record<PanelId, string> = {
  videos: "视频管理",
  detail: "单视频详情",
  "analytics-cumulative": "累计数据趋势",
  "analytics-incremental": "增量数据趋势",
  rankings: "排行榜",
};

export interface NavMenuGroup {
  id: NavGroupId;
  label: string;
  items: PanelId[];
}

export const NAV_MENU_GROUPS: NavMenuGroup[] = [
  {
    id: "content",
    label: "内容管理",
    items: ["videos", "detail"],
  },
  {
    id: "analytics",
    label: "数据分析",
    items: ["analytics-cumulative", "analytics-incremental", "rankings"],
  },
];

const NAV_GROUP_LABELS: Record<NavGroupId, string> = {
  content: "内容管理",
  analytics: "数据分析",
};

export function navGroupLabel(groupId: NavGroupId): string {
  return NAV_GROUP_LABELS[groupId];
}

export function pageLabel(page: PanelId): string {
  return PAGE_LABELS[page];
}

export function panelNavGroup(page: PanelId): NavGroupId | null {
  for (const group of NAV_MENU_GROUPS) {
    if (group.items.includes(page)) return group.id;
  }
  return null;
}

export function pageFromHash(hash = window.location.hash): PanelId {
  const path = hash.replace(/^#\/?/, "").split("?")[0];
  if (path === "videos") return "videos";
  if (path === "rankings") return "rankings";
  if (path === "analytics/trends" || path === "analytics/incremental") {
    return "analytics-incremental";
  }
  if (path === "analytics/cumulative") return "analytics-cumulative";
  return DEFAULT_PAGE;
}

export function hashFromPage(page: PanelId): string {
  if (page === DEFAULT_PAGE) return "#/";
  if (page === "analytics-cumulative") return "#/analytics/cumulative";
  if (page === "analytics-incremental") return "#/analytics/incremental";
  return `#/${page}`;
}

export function navigateToPage(page: PanelId) {
  const next = hashFromPage(page);
  if (window.location.hash !== next) {
    window.location.hash = next;
  }
}

const NAV_EXPANDED_KEY = "kol-nav-expanded";

export type NavExpandedState = Record<NavGroupId, boolean>;

const DEFAULT_NAV_EXPANDED: NavExpandedState = {
  content: true,
  analytics: true,
};

export function loadNavExpandedState(): NavExpandedState {
  try {
    const raw = localStorage.getItem(NAV_EXPANDED_KEY);
    if (!raw) return { ...DEFAULT_NAV_EXPANDED };
    const parsed = JSON.parse(raw) as Partial<NavExpandedState>;
    return {
      content: parsed.content ?? DEFAULT_NAV_EXPANDED.content,
      analytics: parsed.analytics ?? DEFAULT_NAV_EXPANDED.analytics,
    };
  } catch {
    return { ...DEFAULT_NAV_EXPANDED };
  }
}

export function saveNavExpandedState(state: NavExpandedState): void {
  try {
    localStorage.setItem(NAV_EXPANDED_KEY, JSON.stringify(state));
  } catch {
    // ignore
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
