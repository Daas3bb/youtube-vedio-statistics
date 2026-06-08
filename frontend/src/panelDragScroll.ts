const EDGE_ZONE = 110;
const MAX_STEP = 20;
const MIN_STEP_RATIO = 0.25;

let active = false;
let lastClientY = 0;
let rafId = 0;

function scrollStep() {
  if (!active) return;

  const y = lastClientY;
  const viewport = window.innerHeight;
  let step = 0;

  if (y < EDGE_ZONE) {
    step = -MAX_STEP * Math.max(MIN_STEP_RATIO, (EDGE_ZONE - y) / EDGE_ZONE);
  } else if (y > viewport - EDGE_ZONE) {
    step = MAX_STEP * Math.max(MIN_STEP_RATIO, (y - (viewport - EDGE_ZONE)) / EDGE_ZONE);
  }

  if (step !== 0) {
    window.scrollBy(0, step);
    rafId = window.requestAnimationFrame(scrollStep);
  }
}

function onDocumentDragOver(event: DragEvent) {
  if (!active) return;
  event.preventDefault();
  lastClientY = event.clientY;
  window.cancelAnimationFrame(rafId);
  rafId = window.requestAnimationFrame(scrollStep);
}

function stopPanelDragScroll() {
  active = false;
  window.cancelAnimationFrame(rafId);
  document.removeEventListener("dragover", onDocumentDragOver);
  document.removeEventListener("dragend", stopPanelDragScroll);
  document.removeEventListener("drop", stopPanelDragScroll);
}

export function beginPanelDragScroll() {
  if (active) return;
  active = true;
  document.addEventListener("dragover", onDocumentDragOver);
  document.addEventListener("dragend", stopPanelDragScroll);
  document.addEventListener("drop", stopPanelDragScroll);
}

export function endPanelDragScroll() {
  stopPanelDragScroll();
}
