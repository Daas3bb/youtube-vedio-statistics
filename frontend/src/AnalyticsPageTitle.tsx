import type { ReactNode } from "react";

export type AnalyticsHintTone = "highlight";

export type AnalyticsPageHint =
  | string
  | {
      parts: Array<{
        text: string;
        tone?: AnalyticsHintTone;
      }>;
    };

interface AnalyticsPageTitleProps {
  title: string;
  hints: AnalyticsPageHint[];
}

function renderHint(hint: AnalyticsPageHint): ReactNode {
  if (typeof hint === "string") return hint;

  return hint.parts.map((part, index) =>
    part.tone ? (
      <span key={index} className={`analytics-page-hint-${part.tone}`}>
        {part.text}
      </span>
    ) : (
      <span key={index}>{part.text}</span>
    )
  );
}

export function AnalyticsPageTitle({ title, hints }: AnalyticsPageTitleProps) {
  return (
    <div className="analytics-page-title-wrap" tabIndex={0}>
      <h2 className="analytics-page-title">
        {title}
        {hints.length > 0 && (
          <span className="analytics-page-title-hint-icon" aria-hidden>
            ⓘ
          </span>
        )}
      </h2>
      {hints.length > 0 && (
        <div className="analytics-page-title-popover" role="tooltip">
          <ul className="analytics-page-title-list">
            {hints.map((hint, index) => (
              <li key={index}>{renderHint(hint)}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
