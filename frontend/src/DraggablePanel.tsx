import { useState, type ReactNode } from "react";
import type { PanelId } from "./dashboardLayout";
import { beginPanelDragScroll, endPanelDragScroll } from "./panelDragScroll";

interface DraggablePanelProps {
  id: PanelId;
  onReorder: (fromId: PanelId, toId: PanelId) => void;
  children: ReactNode;
}

export function DraggablePanel({ id, onReorder, children }: DraggablePanelProps) {
  const [dragOver, setDragOver] = useState(false);

  const handleDragStart = (event: React.DragEvent<HTMLButtonElement>) => {
    event.dataTransfer.setData("application/x-panel-id", id);
    event.dataTransfer.effectAllowed = "move";
    beginPanelDragScroll();
  };

  const handleDragEnd = () => {
    endPanelDragScroll();
  };

  const handleDragOver = (event: React.DragEvent<HTMLElement>) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    setDragOver(true);

    const rect = event.currentTarget.getBoundingClientRect();
    const margin = 72;
    if (rect.bottom > window.innerHeight - margin) {
      window.scrollBy(0, Math.min(28, rect.bottom - window.innerHeight + margin));
    } else if (rect.top < margin) {
      window.scrollBy(0, Math.max(-28, rect.top - margin));
    }
  };

  const handleDragLeave = (event: React.DragEvent<HTMLElement>) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node)) {
      setDragOver(false);
    }
  };

  const handleDrop = (event: React.DragEvent<HTMLElement>) => {
    event.preventDefault();
    setDragOver(false);
    endPanelDragScroll();
    const fromId = event.dataTransfer.getData("application/x-panel-id") as PanelId;
    if (fromId && fromId !== id) onReorder(fromId, id);
  };

  return (
    <section
      className={`section draggable-panel${dragOver ? " drag-over" : ""}`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <button
        type="button"
        className="panel-drag-handle"
        draggable
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        title="拖拽调整看板位置"
        aria-label="拖拽调整看板位置"
      >
        ⠿
      </button>
      {children}
    </section>
  );
}
