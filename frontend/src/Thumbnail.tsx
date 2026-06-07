import { useState } from "react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

function resolveSrc(url: string, videoId: string): string {
  if (url && !url.startsWith("http")) {
    return `${BASE}/${url.replace(/^\//, "")}`;
  }
  if (videoId) {
    return `${BASE}/thumbnails/${videoId}.jpg`;
  }
  return url;
}

interface ThumbnailProps {
  videoId: string;
  url?: string;
  className?: string;
}

export function Thumbnail({ videoId, url = "", className = "thumb" }: ThumbnailProps) {
  const [failed, setFailed] = useState(false);
  const candidates = [
    resolveSrc(url, videoId),
    `${BASE}/thumbnails/${videoId}.jpg`,
    `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`,
  ].filter((v, i, a) => v && a.indexOf(v) === i);

  const [idx, setIdx] = useState(0);

  if (failed || idx >= candidates.length) {
    return (
      <div className={`${className} thumb-fallback`} title={videoId}>
        ▶
      </div>
    );
  }

  return (
    <img
      className={className}
      src={candidates[idx]}
      alt=""
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => {
        if (idx + 1 < candidates.length) {
          setIdx(idx + 1);
        } else {
          setFailed(true);
        }
      }}
    />
  );
}
