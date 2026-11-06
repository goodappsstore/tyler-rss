import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeftRight,
  BarChart3,
  CornerDownLeft,
  FolderCog,
  Keyboard,
  Loader2,
  Plus,
  RefreshCw,
  Rss,
  Search,
  Settings,
  Tags,
  X,
} from "lucide-react";
import { api } from "../api";
import "./reader.css";

function modKey() {
  if (typeof navigator === "undefined") return "Ctrl";
  return /Mac|iPhone|iPad|iPod/i.test(navigator.platform || navigator.userAgent || "")
    ? "⌘"
    : "Ctrl";
}

const ACTIONS = [
  {
    id: "refresh",
    label: "Refresh feeds",
    hint: "Fetch new stories",
    icon: RefreshCw,
    keys: ["R"],
  },
  {
    id: "add-feed",
    label: "Add feed",
    hint: "Subscribe by URL",
    icon: Plus,
  },
  {
    id: "manage-feeds",
    label: "Manage feeds",
    hint: "Rename, group, and remove sources",
    icon: FolderCog,
  },
  {
    id: "settings",
    label: "Settings",
    hint: "Reading, appearance, and data",
    icon: Settings,
  },
  {
    id: "transfer",
    label: "Import / export",
    hint: "OPML files and full backups",
    icon: ArrowLeftRight,
  },
  {
    id: "stats",
    label: "Statistics",
    hint: "Reading totals and history",
    icon: BarChart3,
  },
  {
    id: "tags",
    label: "Tags",
    hint: "Browse your tag library",
    icon: Tags,
  },
  {
    id: "shortcuts",
    label: "Keyboard shortcuts",
    hint: "Every key in one place",
    icon: Keyboard,
  },
];

function shortDate(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";

  const diff = Date.now() - date.getTime();
  if (diff >= 0 && diff < 60 * 60 * 1000) {
    return `${Math.max(1, Math.round(diff / 60000))}m ago`;
  }
  if (diff >= 0 && diff < 24 * 60 * 60 * 1000) {
    return `${Math.max(1, Math.round(diff / 3600000))}h ago`;
  }
  if (diff >= 0 && diff < 7 * 24 * 60 * 60 * 1000) {
    return `${Math.max(1, Math.round(diff / 86400000))}d ago`;
  }
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function ResultIcon({ src }) {
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [src]);

  return (
    <span className="palette-result-icon">
      {src && !failed ? (
        <img src={src} alt="" draggable="false" onError={() => setFailed(true)} />
      ) : (
        <Rss size={14} strokeWidth={1.9} />
      )}
    </span>
  );
}

function TrapTab(event, container) {
  if (event.key !== "Tab" || !container) return;
  const focusable = Array.from(
    container.querySelectorAll(
      'button:not([disabled]), input:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'
    )
  ).filter((element) => element.offsetParent !== null);

  if (focusable.length === 0) return;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];

  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

export default function CommandPalette({
  open,
  onClose,
  onSelectArticle,
  onAction,
  feeds,
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);

  const paletteRef = useRef(null);
  const inputRef = useRef(null);
  const itemRefs = useRef([]);
  const restoreFocusRef = useRef(null);
  const requestRef = useRef(0);

  const trimmed = query.trim();
  const showingActions = trimmed.length === 0;
  const items = showingActions ? ACTIONS : results;
  const activeItem = items[activeIndex] || null;
  const mod = modKey();
  const feedCount = feeds?.length || 0;

  useEffect(() => {
    if (!open) {
      setQuery("");
      setResults([]);
      setError("");
      setSearching(false);
      setActiveIndex(0);
      return undefined;
    }

    restoreFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const timer = window.setTimeout(() => inputRef.current?.focus(), 20);
    return () => {
      window.clearTimeout(timer);
      restoreFocusRef.current?.focus?.();
    };
  }, [open]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  useEffect(() => {
    if (!open) return undefined;

    if (!trimmed) {
      setResults([]);
      setError("");
      setSearching(false);
      return undefined;
    }

    const requestId = requestRef.current + 1;
    requestRef.current = requestId;
    setResults([]);
    setSearching(true);
    setError("");

    const timer = window.setTimeout(async () => {
      try {
        const response = await api.listArticles({
          filter: "all",
          search: trimmed,
          limit: 8,
          offset: 0,
          sort: "newest",
        });
        if (requestRef.current !== requestId) return;
        setResults(Array.isArray(response?.articles) ? response.articles : []);
      } catch {
        if (requestRef.current !== requestId) return;
        setResults([]);
        setError("Search is unavailable right now. Try again.");
      } finally {
        if (requestRef.current === requestId) setSearching(false);
      }
    }, 180);

    return () => {
      window.clearTimeout(timer);
      if (requestRef.current === requestId) requestRef.current += 1;
    };
  }, [trimmed, open]);

  useEffect(() => {
    itemRefs.current[activeIndex]?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, items.length]);

  const close = () => onClose?.();

  const choose = (item) => {
    if (!item) return;
    if (showingActions) {
      onAction?.(item.id);
    } else {
      onSelectArticle?.(item.id);
    }
    close();
  };

  const handleKeyDown = (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close();
      return;
    }

    if (event.key === "Tab") {
      TrapTab(event, paletteRef.current);
      return;
    }

    if (event.ctrlKey && !event.metaKey && !event.altKey && event.key.toLowerCase() === "n") {
      event.preventDefault();
      event.stopPropagation();
      if (items.length) {
        setActiveIndex((index) => (index + 1) % items.length);
      }
      return;
    }

    if (event.ctrlKey && !event.metaKey && !event.altKey && event.key.toLowerCase() === "p") {
      event.preventDefault();
      event.stopPropagation();
      if (items.length) {
        setActiveIndex((index) => (index - 1 + items.length) % items.length);
      }
      return;
    }

    if (event.key === "Enter" && activeItem) {
      event.preventDefault();
      choose(activeItem);
    }
  };

  if (!open) return null;

  return (
    <div
      className="palette-overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) close();
      }}
      onKeyDown={handleKeyDown}
    >
      <div
        ref={paletteRef}
        className="palette"
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
      >
        <div className="palette-search">
          <Search size={19} strokeWidth={1.8} aria-hidden="true" />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search stories or run a command"
            aria-label="Search stories or run a command"
            aria-controls="palette-results"
            aria-activedescendant={
              activeItem
                ? `palette-item-${showingActions ? activeItem.id : activeItem.id}`
                : undefined
            }
            autoComplete="off"
            spellCheck="false"
          />
          {searching ? <Loader2 size={16} className="reader-spin palette-spinner" /> : null}
          <button
            type="button"
            className="palette-close"
            onClick={close}
            aria-label="Close command palette"
          >
            <X size={15} />
          </button>
        </div>

        <div className="palette-body" id="palette-results" role="listbox">
          {showingActions ? (
            <>
              <div className="palette-section">
                <span>Quick actions</span>
                <span className="palette-section-hint">{feedCount} feeds</span>
              </div>
              {ACTIONS.map((action, index) => {
                const Icon = action.icon;
                return (
                  <button
                    key={action.id}
                    id={`palette-item-${action.id}`}
                    ref={(element) => {
                      itemRefs.current[index] = element;
                    }}
                    type="button"
                    role="option"
                    aria-selected={index === activeIndex}
                    className={`palette-row ${index === activeIndex ? "is-active" : ""}`}
                    onMouseEnter={() => setActiveIndex(index)}
                    onClick={() => choose(action)}
                  >
                    <span className="palette-row-icon">
                      <Icon size={16} strokeWidth={1.9} />
                    </span>
                    <span className="palette-row-copy">
                      <strong>{action.label}</strong>
                      <small>{action.hint}</small>
                    </span>
                    <span className="palette-row-trail">
                      {action.keys?.length ? (
                        <kbd>{action.keys[0]}</kbd>
                      ) : (
                        <CornerDownLeft size={13} strokeWidth={1.8} />
                      )}
                    </span>
                  </button>
                );
              })}
            </>
          ) : (
            <>
              <div className="palette-section">
                <span>Stories</span>
                <span className="palette-section-hint">
                  {searching
                    ? "Searching"
                    : `${results.length}${results.length === 8 ? "+" : ""} found`}
                </span>
              </div>

              {searching && results.length === 0 ? (
                <div className="palette-state">
                  <Loader2 size={18} className="reader-spin" />
                  <span>Searching your library</span>
                </div>
              ) : null}

              {!searching && error ? (
                <div className="palette-state is-error">
                  <Search size={18} strokeWidth={1.7} />
                  <span>{error}</span>
                </div>
              ) : null}

              {!searching && !error && results.length === 0 ? (
                <div className="palette-state">
                  <Search size={18} strokeWidth={1.7} />
                  <span>
                    No stories match <strong>&ldquo;{trimmed}&rdquo;</strong>
                  </span>
                </div>
              ) : null}

              {results.map((article, index) => (
                <button
                  key={article.id}
                  id={`palette-item-${article.id}`}
                  ref={(element) => {
                    itemRefs.current[index] = element;
                  }}
                  type="button"
                  role="option"
                  aria-selected={index === activeIndex}
                  className={`palette-row palette-result ${index === activeIndex ? "is-active" : ""}`}
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => choose(article)}
                >
                  <ResultIcon src={article.feed_icon} />
                  <span className="palette-row-copy">
                    <strong>{article.title || "Untitled story"}</strong>
                    <small>
                      {article.feed_title || "Unknown feed"}
                      {article.published_at ? (
                        <>
                          <span aria-hidden="true"> · </span>
                          {shortDate(article.published_at)}
                        </>
                      ) : null}
                    </small>
                  </span>
                  <span className="palette-row-trail">
                    {index === activeIndex ? (
                      <CornerDownLeft size={14} strokeWidth={1.8} />
                    ) : null}
                  </span>
                </button>
              ))}
            </>
          )}
        </div>

        <div className="palette-foot">
          <span className="palette-hint">
            <kbd>Ctrl+N</kbd> / <kbd>Ctrl+P</kbd>
            Navigate
          </span>
          <span className="palette-hint">
            <CornerDownLeft size={12} strokeWidth={2} />
            Open
          </span>
          <span className="palette-hint">
            <kbd>Esc</kbd>
            Close
          </span>
          <span className="palette-foot-brand">
            <kbd>{mod}</kbd>
            <kbd>K</kbd>
          </span>
        </div>
      </div>
    </div>
  );
}
