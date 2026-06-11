export type Theme = "light" | "dark";

const STORAGE_KEY = "kol-theme";

export function loadTheme(): Theme {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === "dark") return "dark";
    if (saved === "light") return "light";
    return "light";
  } catch {
    return "light";
  }
}

export function applyTheme(theme: Theme): void {
  document.documentElement.setAttribute("data-theme", theme);
}

export function saveTheme(theme: Theme): void {
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // ignore
  }
}

export function setTheme(theme: Theme): void {
  applyTheme(theme);
  saveTheme(theme);
}

export function toggleTheme(current: Theme): Theme {
  const next: Theme = current === "dark" ? "light" : "dark";
  setTheme(next);
  return next;
}

export function readChartCssColors(): {
  muted: string;
  grid: string;
  warning: string;
  success: string;
  danger: string;
} {
  const styles = getComputedStyle(document.documentElement);
  const pick = (name: string, fallback: string) =>
    styles.getPropertyValue(name).trim() || fallback;
  return {
    muted: pick("--chart-muted", "#8b9cb3"),
    grid: pick("--chart-grid", "#2d3a4f"),
    warning: pick("--warning", "#f59e0b"),
    success: pick("--success", "#22c55e"),
    danger: pick("--danger-text", "#ff7b7b"),
  };
}
