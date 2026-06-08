import { useEffect, useMemo, useRef, useState } from "react";
import type { Video } from "./api";
import { Thumbnail } from "./Thumbnail";

interface VideoSelectProps {
  videos: Video[];
  value: string;
  onChange: (videoId: string) => void;
  placeholder?: string;
  searchable?: boolean;
}

function matchVideo(video: Video, query: string) {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return (
    video.video_id.toLowerCase().includes(q) ||
    video.title.toLowerCase().includes(q) ||
    video.channel_title.toLowerCase().includes(q)
  );
}

export function VideoSelect({
  videos,
  value,
  onChange,
  placeholder = "选择视频",
  searchable = false,
}: VideoSelectProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const selected = videos.find((video) => video.video_id === value);
  const filteredVideos = useMemo(
    () => (searchable ? videos.filter((video) => matchVideo(video, query)) : videos),
    [videos, query, searchable],
  );

  useEffect(() => {
    if (!open) return;

    const handlePointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  const pick = (videoId: string) => {
    onChange(videoId);
    setQuery("");
    setOpen(false);
  };

  const handleSearchKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      const first = filteredVideos[0];
      if (first) pick(first.video_id);
      return;
    }
    if (event.key === "Escape") {
      setQuery("");
      setOpen(false);
    }
  };

  const selectBody = (
    <div className={`video-select${open ? " open" : ""}`}>
      <button
        type="button"
        className="video-select-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((prev) => !prev)}
      >
        {selected ? (
          <>
            <Thumbnail
              videoId={selected.video_id}
              url={selected.thumbnail_url}
              className="video-select-thumb"
            />
            <span className="video-select-label">
              <span className="video-select-title">{selected.title || selected.video_id}</span>
              {selected.channel_title && (
                <span className="video-select-channel">{selected.channel_title}</span>
              )}
            </span>
          </>
        ) : (
          <span className="video-select-placeholder">{placeholder}</span>
        )}
        <span className="video-select-caret" aria-hidden>
          ▾
        </span>
      </button>

      {open && (
        <ul className="video-select-menu" role="listbox">
          {filteredVideos.length ? (
            filteredVideos.map((video) => {
              const active = video.video_id === value;
              return (
                <li key={video.video_id} role="option" aria-selected={active}>
                  <button
                    type="button"
                    className={`video-select-option${active ? " active" : ""}`}
                    onClick={() => pick(video.video_id)}
                  >
                    <Thumbnail
                      videoId={video.video_id}
                      url={video.thumbnail_url}
                      className="video-select-thumb"
                    />
                    <span className="video-select-label">
                      <span className="video-select-title">{video.title || video.video_id}</span>
                      {video.channel_title && (
                        <span className="video-select-channel">{video.channel_title}</span>
                      )}
                    </span>
                  </button>
                </li>
              );
            })
          ) : (
            <li className="video-select-empty">无匹配视频</li>
          )}
        </ul>
      )}
    </div>
  );

  if (!searchable) {
    return (
      <div ref={rootRef}>
        {selectBody}
      </div>
    );
  }

  return (
    <div className="video-select-group" ref={rootRef}>
      <input
        type="search"
        className="video-search-input"
        placeholder="搜索标题、频道或视频 ID"
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={handleSearchKeyDown}
      />
      {selectBody}
    </div>
  );
}
