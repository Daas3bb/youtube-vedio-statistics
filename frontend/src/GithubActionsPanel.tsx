import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import {
  collectWorkflowPageUrl,
  fetchLatestCollectWorkflowRun,
  formatGithubSyncError,
  formatJobStatus,
  formatWorkflowEvent,
  formatWorkflowStatus,
  isGithubSyncReady,
  loadGithubSettings,
  runCollectNow,
  type CollectWorkflowRunInfo,
} from "./githubCsvSync";

export interface GithubActionsPanelHandle {
  triggerAndWatch: (options?: {
    onProgress?: (message: string) => void;
  }) => Promise<{ ok: true } | { ok: false; reason: string }>;
}

interface GithubActionsPanelProps {
  githubSyncReady: boolean;
  onCollectCompleted?: () => void;
}

function formatLocalTime(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return iso;
  return new Date(t).toLocaleString("zh-CN", { hour12: false });
}

function isRunning(run: CollectWorkflowRunInfo | null): boolean {
  return run?.status === "queued" || run?.status === "in_progress";
}

function badgeClass(run: CollectWorkflowRunInfo | null, ready: boolean): string {
  if (!ready) return "err";
  if (!run) return "warn";
  if (isRunning(run)) return "run";
  if (run.status === "completed" && run.conclusion === "success") return "ok";
  if (run.status === "completed" && run.conclusion === "failure") return "err";
  return "warn";
}

function badgeLabel(
  run: CollectWorkflowRunInfo | null,
  ready: boolean,
  loading: boolean
): string {
  if (!ready) return "Actions 未配置";
  if (loading && !run) return "Actions 加载中…";
  if (!run) return "Actions 无记录";
  if (isRunning(run)) return `Actions ${formatWorkflowStatus(run.status, run.conclusion)}`;
  return `Actions ${formatWorkflowStatus(run.status, run.conclusion)}`;
}

function itemStatusClass(status: string, conclusion: string | null): string {
  if (status === "queued" || status === "in_progress") return "run";
  if (status === "completed" && conclusion === "success") return "ok";
  if (status === "completed" && conclusion === "failure") return "err";
  return "pending";
}

export const GithubActionsPanel = forwardRef<GithubActionsPanelHandle, GithubActionsPanelProps>(
  function GithubActionsPanel({ githubSyncReady, onCollectCompleted }, ref) {
    const [open, setOpen] = useState(false);
    const [run, setRun] = useState<CollectWorkflowRunInfo | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [triggering, setTriggering] = useState(false);
    const [progress, setProgress] = useState<string | null>(null);
    const pollRef = useRef<number | null>(null);

    const refresh = useCallback(async (silent = false) => {
      if (!isGithubSyncReady()) {
        setRun(null);
        setError("请先配置 GitHub 同步（Token 需 Actions 读权限）");
        return;
      }

      if (!silent) setLoading(true);
      if (!silent) setError(null);

      try {
        const result = await fetchLatestCollectWorkflowRun();
        if (result.ok) {
          setRun(result.run);
          if (!result.run && !silent) {
            setError(null);
          }
        } else {
          setError(formatGithubSyncError(result.reason));
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "加载失败");
      } finally {
        if (!silent) setLoading(false);
      }
    }, []);

    const runWorkflow = useCallback(
      async (onProgress?: (message: string) => void) => {
        setTriggering(true);
        setProgress("正在触发采集工作流…");
        setError(null);

        try {
          const result = await runCollectNow(loadGithubSettings(), (msg) => {
            setProgress(msg);
            onProgress?.(msg);
          });
          if (result.ok) {
            setProgress("采集工作流已完成，数据已写入仓库");
            await refresh(true);
            onCollectCompleted?.();
            return result;
          }

          setError(formatGithubSyncError(result.reason));
          setProgress(null);
          await refresh(true);
          return result;
        } catch (e) {
          const message = e instanceof Error ? e.message : "触发失败";
          setError(message);
          setProgress(null);
          return { ok: false as const, reason: message };
        } finally {
          setTriggering(false);
        }
      },
      [onCollectCompleted, refresh]
    );

    useImperativeHandle(
      ref,
      () => ({
        triggerAndWatch: async (options) => {
          setOpen(true);
          return runWorkflow(options?.onProgress);
        },
      }),
      [runWorkflow]
    );

    useEffect(() => {
      if (githubSyncReady) {
        refresh(true);
      } else {
        setRun(null);
      }
    }, [githubSyncReady, refresh]);

    useEffect(() => {
      if (!githubSyncReady) return undefined;

      const intervalMs = open || isRunning(run) ? 8000 : 30000;
      pollRef.current = window.setInterval(() => {
        refresh(true);
      }, intervalMs);

      return () => {
        if (pollRef.current) window.clearInterval(pollRef.current);
      };
    }, [open, githubSyncReady, run, refresh]);

    useEffect(() => {
      if (open && githubSyncReady) {
        refresh();
      }
    }, [open, githubSyncReady, refresh]);

    const handleTrigger = async () => {
      if (triggering || isRunning(run)) return;
      await runWorkflow();
    };

    const settings = loadGithubSettings();
    const actionsUrl = collectWorkflowPageUrl(settings);
    const running = isRunning(run) || triggering;

    return (
      <div className="github-sync-panel github-actions-panel">
        <button
          type="button"
          className={`config-status-badge ${badgeClass(run, githubSyncReady)}`}
          onClick={() => setOpen((v) => !v)}
        >
          {badgeLabel(run, githubSyncReady, loading)}
        </button>

        {open && (
          <div className="github-sync-form">
            <p className="github-sync-hint">
              监测 <code>collect.yml</code> 采集部署工作流（每 2 小时定时 + 添加视频后自动触发）。
              工作流会在 GitHub 服务器上运行采集并更新 <code>store.json</code>。
            </p>

            {!githubSyncReady && (
              <p className="actions-panel-error">请先配置 GitHub 同步，且 Token 需 Actions 读权限。</p>
            )}

            {githubSyncReady && (
              <>
                <div className="actions-run-summary">
                  {run ? (
                    <>
                      <div className="actions-run-row">
                        <span className="actions-run-label">最近运行</span>
                        <span className={`actions-status-pill ${badgeClass(run, true)}`}>
                          {formatWorkflowStatus(run.status, run.conclusion)}
                        </span>
                      </div>
                      <div className="actions-run-meta">
                        <span>触发：{formatWorkflowEvent(run.event)}</span>
                        <span>开始：{formatLocalTime(run.created_at)}</span>
                        <span>更新：{formatLocalTime(run.updated_at)}</span>
                      </div>
                      <a
                        className="link actions-run-link"
                        href={run.html_url}
                        target="_blank"
                        rel="noreferrer"
                      >
                        在 GitHub 查看此次运行 →
                      </a>
                    </>
                  ) : (
                    <p className="actions-run-empty">暂无运行记录</p>
                  )}
                </div>

                {run?.jobs.map((job) => (
                  <div key={job.id} className="actions-job-block">
                    <div className="actions-job-head">
                      <span className="actions-job-name">{job.name}</span>
                      <span
                        className={`actions-status-pill ${itemStatusClass(job.status, job.conclusion)}`}
                      >
                        {formatJobStatus(job.status, job.conclusion)}
                      </span>
                    </div>
                    {job.steps.length > 0 && (
                      <ul className="actions-step-list">
                        {job.steps.map((step) => (
                          <li
                            key={step.number}
                            className={`actions-step-item ${itemStatusClass(step.status, step.conclusion)}`}
                          >
                            <span className="actions-step-dot" aria-hidden />
                            <span className="actions-step-name">{step.name}</span>
                            <span className="actions-step-status">
                              {formatJobStatus(step.status, step.conclusion)}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                ))}

                {progress && <p className="actions-progress">{progress}</p>}
                {error && <p className="actions-panel-error">{error}</p>}

                <div className="batch-add-actions">
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={handleTrigger}
                    disabled={!githubSyncReady || triggering || isRunning(run)}
                  >
                    {triggering ? "运行中…" : running ? "工作流进行中" : "手动触发采集"}
                  </button>
                  <button
                    type="button"
                    className="btn"
                    onClick={() => refresh()}
                    disabled={loading || triggering}
                  >
                    {loading ? "刷新中…" : "刷新状态"}
                  </button>
                  <a className="btn" href={actionsUrl} target="_blank" rel="noreferrer">
                    打开 Actions 页
                  </a>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    );
  }
);
