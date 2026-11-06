import { useRef, useState } from "react";

const MIN_WIDTH = 280;
const MAX_WIDTH = 600;

function clampWidth(width) {
  return Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, Math.round(width)));
}

export default function ArticleListPanel({ width, onSaveWidth, children }) {
  const [draftWidth, setDraftWidth] = useState(null);
  const [resizing, setResizing] = useState(false);
  const dragRef = useRef(null);
  const saveQueueRef = useRef(Promise.resolve());
  const saveVersionRef = useRef(0);
  const currentWidth = draftWidth ?? width;

  function saveWidth(nextWidth) {
    const version = ++saveVersionRef.current;
    // Keep rapid keyboard adjustments and consecutive drags in order.
    saveQueueRef.current = saveQueueRef.current
      .then(() => onSaveWidth(nextWidth))
      .catch(() => {}) // The app reports setting errors in a toast.
      .then(() => {
        if (version === saveVersionRef.current && !dragRef.current) {
          setDraftWidth(null);
        }
      });
  }

  function startResize(event) {
    if (!event.isPrimary || event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.focus();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { x: event.clientX, width: currentWidth, nextWidth: currentWidth };
    setResizing(true);
  }

  function moveResize(event) {
    const drag = dragRef.current;
    if (!drag) return;
    drag.nextWidth = clampWidth(drag.width + event.clientX - drag.x);
    setDraftWidth(drag.nextWidth);
  }

  function finishResize() {
    const drag = dragRef.current;
    if (!drag) return;
    dragRef.current = null;
    setResizing(false);
    saveWidth(drag.nextWidth);
  }

  function handleKeyDown(event) {
    if (dragRef.current) return;
    let nextWidth;
    switch (event.key) {
      case "ArrowLeft": nextWidth = currentWidth - 10; break;
      case "ArrowRight": nextWidth = currentWidth + 10; break;
      case "Home": nextWidth = MIN_WIDTH; break;
      case "End": nextWidth = MAX_WIDTH; break;
      default: return;
    }
    event.preventDefault();
    event.stopPropagation();
    nextWidth = clampWidth(nextWidth);
    setDraftWidth(nextWidth);
    saveWidth(nextWidth);
  }

  return (
    <section
      className={`list-column${resizing ? " is-resizing" : ""}`}
      aria-label="Article list"
      style={{ "--article-list-w": `${currentWidth}px` }}
    >
      {children}
      <div
        className="article-list-resizer"
        role="separator"
        tabIndex={0}
        aria-label="Article list width"
        aria-orientation="vertical"
        aria-valuemin={MIN_WIDTH}
        aria-valuemax={MAX_WIDTH}
        aria-valuenow={currentWidth}
        aria-valuetext={`${currentWidth} pixels`}
        title="Drag to resize, or use Left and Right arrow keys"
        onPointerDown={startResize}
        onPointerMove={moveResize}
        onPointerUp={finishResize}
        onPointerCancel={finishResize}
        onLostPointerCapture={finishResize}
        onKeyDown={handleKeyDown}
      />
    </section>
  );
}
