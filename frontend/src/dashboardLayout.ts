export type PanelId = "detail" | "videos" | "rankings";

export const DEFAULT_PANEL_ORDER: PanelId[] = ["detail", "videos", "rankings"];

const STORAGE_KEY = "kol-dashboard-panel-order";

export function loadPanelOrder(): PanelId[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [...DEFAULT_PANEL_ORDER];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [...DEFAULT_PANEL_ORDER];
    const valid = parsed.filter(
      (id): id is PanelId =>
        id === "detail" || id === "videos" || id === "rankings"
    );
    const missing = DEFAULT_PANEL_ORDER.filter((id) => !valid.includes(id));
    return valid.length ? [...valid, ...missing] : [...DEFAULT_PANEL_ORDER];
  } catch {
    return [...DEFAULT_PANEL_ORDER];
  }
}

export function savePanelOrder(order: PanelId[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(order));
}

export function reorderPanels(order: PanelId[], fromId: PanelId, toId: PanelId): PanelId[] {
  const from = order.indexOf(fromId);
  const to = order.indexOf(toId);
  if (from < 0 || to < 0 || from === to) return order;
  const next = [...order];
  next.splice(from, 1);
  next.splice(to, 0, fromId);
  return next;
}
