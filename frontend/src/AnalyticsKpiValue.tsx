import { useState } from "react";
import {
  canToggleAnalyticsValue,
  formatAnalyticsCompact,
  formatAnalyticsFull,
} from "./chartUtils";

interface AnalyticsKpiValueProps {
  value: number;
}

export function AnalyticsKpiValue({ value }: AnalyticsKpiValueProps) {
  const [showRaw, setShowRaw] = useState(false);
  const clickable = canToggleAnalyticsValue(value);
  const display = showRaw ? formatAnalyticsFull(value) : formatAnalyticsCompact(value);

  if (!clickable) {
    return <div className="value">{display}</div>;
  }

  return (
    <button
      type="button"
      className={`value kpi-value-toggle${showRaw ? " is-raw" : ""}`}
      title={showRaw ? "点击切换为缩写" : `点击查看原始值：${formatAnalyticsFull(value)}`}
      aria-label={showRaw ? "显示缩写数值" : `显示原始值 ${formatAnalyticsFull(value)}`}
      onClick={() => setShowRaw((prev) => !prev)}
    >
      {display}
    </button>
  );
}
