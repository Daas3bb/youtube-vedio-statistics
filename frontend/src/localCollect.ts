export type LocalCollectResult =
  | { ok: true }
  | { ok: false; error: string };

export async function runLocalCollectScripts(): Promise<LocalCollectResult> {
  if (!import.meta.env.DEV) {
    return { ok: false, error: "仅本地 npm run dev 环境可用" };
  }

  try {
    const res = await fetch("/api/run-collect", { method: "POST" });
    const data = (await res.json()) as { ok?: boolean; error?: string };
    if (!res.ok || !data.ok) {
      return { ok: false, error: data.error || `HTTP ${res.status}` };
    }
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "请求失败",
    };
  }
}
