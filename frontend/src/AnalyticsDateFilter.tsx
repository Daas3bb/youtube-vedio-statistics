import { useRef } from "react";
import {
  detectAnalyticsDatePreset,
  type AnalyticsDatePreset,
  dateRangeForAnalyticsPreset,
} from "./analyticsFilter";

function openDatePicker(input: HTMLInputElement | null) {
  if (!input) return;
  if (typeof input.showPicker === "function") {
    try {
      input.showPicker();
      return;
    } catch {
      // 部分浏览器需在用户手势内调用
    }
  }
  input.click();
}

interface AnalyticsDateFilterProps {
  from: string;
  to: string;
  min: string;
  max: string;
  videoCount: number;
  onFromChange: (value: string) => void;
  onToChange: (value: string) => void;
}

export function AnalyticsDateFilter({
  from,
  to,
  min,
  max,
  videoCount,
  onFromChange,
  onToChange,
}: AnalyticsDateFilterProps) {
  const fromRef = useRef<HTMLInputElement>(null);
  const toRef = useRef<HTMLInputElement>(null);
  const preset = detectAnalyticsDatePreset(from, to);

  const applyPreset = (next: Exclude<AnalyticsDatePreset, "custom">) => {
    const range = dateRangeForAnalyticsPreset(next);
    onFromChange(range.from);
    onToChange(range.to);
  };

  return (
    <div className="detail-date-filter analytics-date-filter">
      <div
        className="detail-date-field"
        role="button"
        tabIndex={0}
        onClick={() => openDatePicker(fromRef.current)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            openDatePicker(fromRef.current);
          }
        }}
      >
        <span className="detail-date-field-label">起始日期</span>
        <input
          ref={fromRef}
          type="date"
          value={from}
          min={min}
          max={to || max}
          onChange={(e) => onFromChange(e.target.value)}
          onClick={(e) => {
            e.stopPropagation();
            openDatePicker(fromRef.current);
          }}
        />
      </div>
      <div
        className="detail-date-field"
        role="button"
        tabIndex={0}
        onClick={() => openDatePicker(toRef.current)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            openDatePicker(toRef.current);
          }
        }}
      >
        <span className="detail-date-field-label">结束日期</span>
        <input
          ref={toRef}
          type="date"
          value={to}
          min={from || min}
          max={max}
          onChange={(e) => onToChange(e.target.value)}
          onClick={(e) => {
            e.stopPropagation();
            openDatePicker(toRef.current);
          }}
        />
      </div>
      <button
        type="button"
        className={`btn detail-date-preset-btn${preset === "last7" ? " active" : ""}`}
        onClick={() => applyPreset("last7")}
      >
        近7天
      </button>
      <button
        type="button"
        className={`btn detail-date-preset-btn${preset === "last30" ? " active" : ""}`}
        onClick={() => applyPreset("last30")}
      >
        近30天
      </button>
      <button
        type="button"
        className={`btn detail-date-preset-btn${preset === "last90" ? " active" : ""}`}
        onClick={() => applyPreset("last90")}
      >
        近90天
      </button>
      <span className="detail-date-hint">
        已筛选 {from} ~ {to} · 监测视频 {videoCount} 个（按日汇总）
      </span>
    </div>
  );
}
