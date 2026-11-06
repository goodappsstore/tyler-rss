import { useEffect, useMemo, useRef, useState } from "react";
import { parseTagNames } from "../lib/tags";
import {
  Asterisk,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock,
  Copy,
  ExternalLink,
  Folder,
  Keyboard,
  Link2,
  Loader2,
  Mail,
  MailOpen,
  Plus,
  Rss,
  Sparkles,
  Star,
  Tag,
  X,
} from "lucide-react";
import { api } from "../api";
import ArticleContent from "./ArticleContent";
import ReaderTools, { ArticleEnclosures, printArticle } from "./ReaderTools";
import { useToast } from "../store";
import "./reader.css";

const MEDIA_REQUESTED = new Set();

const DEFAULTS = {
  font_size: 18,
  line_width: 700,
  reader_font: "serif",
  date_format: "relative",
};

function isMacPlatform() {
  if (typeof navigator === "undefined") return false;
  return /Mac|iPhone|iPad|iPod/i.test(navigator.platform || navigator.userAgent || "");
}

function modKey() {
  return isMacPlatform() ? "⌘" : "Ctrl";
}function absoluteDate(value) {
  if (!value) return "Undated";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Undated";
  return date.toLocaleDateString(undefined, {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

function relativeDate(value) {
  if (!value) return "Undated";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Undated";
  const diff = Date.now() - date.getTime();

  if (diff < 0) return absoluteDate(value);
  if (diff < 45 * 1000) return "Just now";
  if (diff < 60 * 60 * 1000) {
    const minutes = Math.max(1, Math.round(diff / 60000));
    return `${minutes} min ago`;
  }
  if (diff < 24 * 60 * 60 * 1000) {
    const hours = Math.max(1, Math.round(diff / 3600000));
    return `${hours} hr ago`;
  }
  if (diff < 7 * 24 * 60 * 60 * 1000) {
    const days = Math.max(1, Math.round(diff / 86400000));
    return `${days} d ago`;
  }
  return absoluteDate(value);
}

function displayDate(value, format) {
  return format === "absolute" ? absoluteDate(value) : relativeDate(value);
}

function readingTime(minutes) {
  const value = Number(minutes) || 0;
  if (value <= 0) return "Quick read";
  return `${value} min read`;
}

function copyText(text) {
  return new Promise((resolve) => {
    if (!text) {
      resolve(false);
      return;
    }

    if (navigator.clipboard?.writeText) {
      navigator.clipboard
        .writeText(text)
        .then(() => resolve(true))
        .catch(() => resolve(fallbackCopy(text)));
      return;
    }

    resolve(fallbackCopy(text));
  });
}

function fallbackCopy(text) {
  try {
    const field = document.createElement("textarea");
    field.value = text;
    field.setAttribute("readonly", "");
    field.style.position = "fixed";
    field.style.top = "-9999px";
    field.style.opacity = "0";
    document.body.appendChild(field);
    field.select();
    const copied = document.execCommand("copy");
    document.body.removeChild(field);
    return copied;
  } catch {
    return false;
  }
}

function FeedMark({ src, size = 30, className = "" }) {
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [src]);

  return (
    <span
      className={`reader-feedmark ${className}`}
      style={{ width: size, height: size }}
    >
      {src && !failed ? (
        <img
          src={src}
          alt=""
          draggable="false"
          onError={() => setFailed(true)}
        />
      ) : (
        <Rss size={Math.max(12, Math.round(size * 0.5))} strokeWidth={1.8} />
      )}
    </span>
  );
}

function ReaderActions({
  article,
  compact = false,
  copyState,
  onToggleStar,
  onToggleRead,
  onOpenTags,
  onCopy,
  onOpenOriginal,
  onOpenShortcuts,
  onSummarize,
  summarizing,
}) {
  const starred = Boolean(article?.is_starred);
  const read = Boolean(article?.is_read);
  const tagCount = article?.tags?.length || 0;

  const copyLabel =
    copyState === "copied" ? "Copied" : copyState === "failed" ? "Retry" : "Copy";

  return (
    <div className={`reader-actions ${compact ? "reader-actions--compact" : ""}`}>
      <div className="reader-actions-group">
        <button
          type="button"
          className={`reader-action ${summarizing ? "is-summarizing" : ""}`}
          onClick={onSummarize}
          title={summarizing ? "Generating summary in the background" : "Summarize article"}
          aria-label={summarizing ? "Generating summary in the background" : "Summarize article"}
          aria-busy={summarizing}
          disabled={summarizing}
        >
          <Sparkles size={16} strokeWidth={1.9}
            className={summarizing ? "reader-summary-pulse" : undefined} aria-hidden="true" />
          <span className="reader-action-label">{summarizing ? "Summarizing…" : "Summarize"}</span>
        </button>
        <button
          type="button"
          className={`reader-action ${starred ? "is-active" : ""}`}
          onClick={onToggleStar}
          aria-pressed={starred}
          title={`${starred ? "Unstar" : "Star"} (s)`}
        >
          <Star
            size={16}
            strokeWidth={1.9}
            fill={starred ? "currentColor" : "none"}
          />
          <span className="reader-action-label">
            {starred ? "Starred" : "Star"}
          </span>
        </button>

        <button
          type="button"
          className={`reader-action ${read ? "is-muted" : "is-active-soft"}`}
          onClick={onToggleRead}
          title={read ? "Mark unread (u)" : "Mark read (m)"}
        >
          {read ? (
            <MailOpen size={16} strokeWidth={1.9} />
          ) : (
            <Mail size={16} strokeWidth={1.9} />
          )}
          <span className="reader-action-label">
            {read ? "Unread" : "Read"}
          </span>
        </button>

        <button
          type="button"
          className={`reader-action ${tagCount > 0 ? "is-active" : ""}`}
          onClick={onOpenTags}
          data-tags-trigger=""
          title="Tags"
          aria-haspopup="dialog"
        >
          <Tag size={16} strokeWidth={1.9} />
          <span className="reader-action-label">Tags</span>
          {tagCount > 0 ? <span className="reader-action-count">{tagCount}</span> : null}
        </button>
      </div>

      <div className="reader-actions-group">
        <button
          type="button"
          className={`reader-action ${copyState === "copied" ? "is-copied" : ""}`}
          onClick={onCopy}
          title="Copy article link"
        >
          {copyState === "copied" ? (
            <Check size={16} strokeWidth={2} />
          ) : (
            <Link2 size={16} strokeWidth={1.9} />
          )}
          <span className="reader-action-label">{copyLabel}</span>
        </button>

        <button
          type="button"
          className="reader-action"
          onClick={onOpenOriginal}
          title="Open original in browser"
        >
          <ExternalLink size={16} strokeWidth={1.9} />
          <span className="reader-action-label">Original</span>
        </button>

        <button
          type="button"
          className="reader-action reader-action--icon"
          onClick={onOpenShortcuts}
          title="Keyboard shortcuts"
          aria-label="Keyboard shortcuts"
        >
          <Keyboard size={17} strokeWidth={1.9} />
        </button>
      </div>
    </div>
  );
}

function TagPopover({
  tags,
  selectedIds,
  position,
  popRef,
  onToggle,
  onCreate,
  onClose,
}) {
  const [draft, setDraft] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");

  const selected = useMemo(
    () => new Set((selectedIds || []).map(Number)),
    [selectedIds]
  );

  const submit = async (event) => {
    event.preventDefault();
    const names = parseTagNames(draft);
    if (!names.length || creating) return;

    setCreating(true);
    setError("");
    try {
      const added = await onCreate(names);
      if (added?.length) {
        setDraft("");
      } else {
        setError("Those tags could not be added. Try again.");
      }
    } catch {
      setError("Could not add those tags. Try again.");
    } finally {
      setCreating(false);
    }
  };

  return (
    <div
      ref={popRef}
      className="tag-pop"
      style={{ top: position.top, left: position.left, width: position.width }}
      role="dialog"
      aria-label="Article tags"
    >
      <div className="tag-pop-head">
        <div>
          <span className="tag-pop-eyebrow">Organize</span>
          <h3 className="tag-pop-title">Tags</h3>
        </div>
        <button
          type="button"
          className="tag-pop-close"
          onClick={onClose}
          aria-label="Close tags"
        >
          <X size={15} />
        </button>
      </div>

      <div className="tag-pop-list">
        {tags.length === 0 ? (
          <p className="tag-pop-empty">
            No tags yet. Create one below to file this story.
          </p>
        ) : (
          tags.map((tag) => {
            const isSelected = selected.has(Number(tag.id));
            return (
              <button
                key={tag.id}
                type="button"
                role="checkbox"
                aria-checked={isSelected}
                className={`tag-pop-row ${isSelected ? "is-selected" : ""}`}
                onClick={() => onToggle(tag)}
                disabled={creating}
              >
                <span
                  className="tag-pop-dot"
                  style={{ background: tag.color || "var(--accent)" }}
                  aria-hidden="true"
                />
                <span className="tag-pop-name">{tag.name}</span>
                <span className="tag-pop-count">{tag.count ?? 0}</span>
                <span className="tag-pop-check" aria-hidden="true">
                  {isSelected ? <Check size={13} strokeWidth={2.4} /> : null}
                </span>
              </button>
            );
          })
        )}
      </div>

      <form className="tag-pop-create" onSubmit={submit}>
        <Plus size={14} strokeWidth={2} aria-hidden="true" />
        <input
          value={draft}
          onChange={(event) => {
            setDraft(event.target.value);
            if (error) setError("");
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.stopPropagation();
              onClose();
            }
          }}
          placeholder="New tags, separated by commas"
          aria-label="New tag names, separated by commas"
          disabled={creating}
        />
        <button type="submit" disabled={!parseTagNames(draft).length || creating}>
          {creating ? <Loader2 size={13} className="reader-spin" /> : "Add"}
        </button>
      </form>

      {error ? <p className="tag-pop-error">{error}</p> : null}
      <p className="tag-pop-hint">Changes apply to this story.</p>
    </div>
  );
}

function ReaderSummary({ result, onDismiss }) {
  const [copyState, setCopyState] = useState("idle");
  const copyTimer = useRef(null);

  useEffect(() => {
    setCopyState("idle");
    return () => window.clearTimeout(copyTimer.current);
  }, [result.text]);

  const copySummary = async () => {
    const copied = await copyText(result.text);
    setCopyState(copied ? "copied" : "failed");
    window.clearTimeout(copyTimer.current);
    copyTimer.current = window.setTimeout(() => setCopyState("idle"), 1800);
  };

  return (
    <aside className="reader-summary" aria-label="Article summary">
      <div className="reader-summary-head">
        <h2><Sparkles size={14} aria-hidden="true" /> {result.cached ? "Cached summary" : "Article summary"}</h2>
        <div className="reader-actions-group">
          <button type="button" className="reader-action" onClick={copySummary}>
            {copyState === "copied" ? <Check size={14} /> : <Copy size={14} />}
            {copyState === "copied" ? "Copied" : copyState === "failed" ? "Retry copy" : "Copy"}
          </button>
          <button type="button" className="reader-action reader-action--icon"
            onClick={onDismiss} aria-label="Close summary" title="Close summary">
            <X size={15} />
          </button>
        </div>
      </div>
      <div className="reader-summary-body" tabIndex={0} aria-label="Summary text">
        {result.text}
        {result.truncated && (
          <p className="reader-summary-note">The model reached its output limit. Increase the limit in LLM settings for a longer response.</p>
        )}
      </div>
      <span className="reader-sr" role="status">
        {copyState === "copied" ? "Summary copied to clipboard." : copyState === "failed" ? "Could not copy the summary. Try again." : ""}
      </span>
    </aside>
  );
}

function ReaderSkeleton() {
  return (
    <div className="reader-scroll reader-skeleton-scroll">
      <div className="reader-frame reader-loading" aria-busy="true" aria-live="polite">
        <span className="reader-sr">Loading article</span>
        <div className="reader-skeleton-kicker">
          <span className="reader-skeleton-block reader-skeleton-icon" />
          <span className="reader-skeleton-block reader-skeleton-line is-short" />
        </div>
        <div className="reader-skeleton-title">
          <span className="reader-skeleton-block" />
          <span className="reader-skeleton-block" />
          <span className="reader-skeleton-block is-short" />
        </div>
        <div className="reader-skeleton-meta">
          <span className="reader-skeleton-block" />
          <span className="reader-skeleton-block" />
          <span className="reader-skeleton-block" />
        </div>
        <div className="reader-skeleton-actions">
          <span className="reader-skeleton-block" />
          <span className="reader-skeleton-block" />
          <span className="reader-skeleton-block" />
        </div>
        <div className="reader-skeleton-body">
          <span className="reader-skeleton-block" />
          <span className="reader-skeleton-block" />
          <span className="reader-skeleton-block" />
          <span className="reader-skeleton-block is-short" />
          <span className="reader-skeleton-block reader-skeleton-image" />
          <span className="reader-skeleton-block" />
          <span className="reader-skeleton-block" />
          <span className="reader-skeleton-block is-short" />
        </div>
      </div>
    </div>
  );
}

function ReaderEmpty({ onOpenShortcuts }) {
  const mod = modKey();

  return (
    <div className="reader-empty">
      <div className="reader-empty-inner">
        <div className="reader-empty-mark" aria-hidden="true">
          <Asterisk size={20} strokeWidth={1.8} />
        </div>
        <p className="reader-empty-eyebrow">Tyler Reader</p>
        <h2 className="reader-empty-title">
          Select a story
          <br />
          <em>to begin.</em>
        </h2>
        <p className="reader-empty-copy">
          Choose an article from the list. Full text, images, and the source
          stay in this column.
        </p>
        <div className="reader-empty-keys" aria-label="Keyboard hints">
          <span>
            <kbd>↓</kbd>
            <kbd>↑</kbd>
            <span>Move</span>
          </span>
          <span>
            <kbd>M</kbd>
            <span>Read</span>
          </span>
          <span>
            <kbd>S</kbd>
            <span>Star</span>
          </span>
          <span>
            <kbd>{mod}</kbd>
            <kbd>K</kbd>
            <span>Search</span>
          </span>
        </div>
        <button
          type="button"
          className="reader-empty-shortcuts"
          onClick={onOpenShortcuts}
        >
          <Keyboard size={15} strokeWidth={1.9} />
          All shortcuts
        </button>
      </div>
    </div>
  );
}

export default function Reader({
  article,
  loading,
  settings,
  allTags,
  hasPrev,
  hasNext,
  onPrev,
  onNext,
  onToggleStar,
  onToggleRead,
  onSetTags,
  onCreateTags,
  onOpenOriginal,
  onCopyLink,
  onRefreshArticle,
  onToggleArchive,
  onLoadFullArticle,
  loadingFullArticle = false,
  onOpenShortcuts,
  onSummarize,
  summarizing = false,
  summary,
  onDismissSummary,
}) {
  const config = { ...DEFAULTS, ...(settings || {}) };
  const articleId = article?.id ?? null;

  const { push } = useToast();
  const [findOpen, setFindOpen] = useState(false);
  const [findQuery, setFindQuery] = useState("");
  const [findCount, setFindCount] = useState(0);
  const [findIndex, setFindIndex] = useState(0);
  const findInputRef = useRef(null);
  useEffect(() => { setFindQuery(""); setFindIndex(0); setFindCount(0); }, [articleId]);
  useEffect(() => { setFindIndex(0); }, [findQuery, article?.content_html]);
  useEffect(() => { if (findOpen) findInputRef.current?.focus(); }, [findOpen]);
  useEffect(() => {
    if (!articleId) return undefined;
    function onKeyDown(event) {
      if (!(event.metaKey || event.ctrlKey) || event.altKey || document.querySelector('[role="dialog"]')) return;
      if (event.key.toLowerCase() === "f") { event.preventDefault(); setFindOpen(true); findInputRef.current?.select(); }
      if (event.key.toLowerCase() === "p") { event.preventDefault(); printArticle(push); }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [articleId, push]);
  function stepFind(delta) { setFindIndex((current) => findCount ? (current + delta + findCount) % findCount : 0); }

  const scrollRef = useRef(null);
  const frameRef = useRef(null);
  const popRef = useRef(null);
  const refreshRef = useRef(onRefreshArticle);
  const copyTimer = useRef(null);

  const [progress, setProgress] = useState(0);
  const [tagOpen, setTagOpen] = useState(false);
  const [tagPosition, setTagPosition] = useState({ top: 0, left: 0, width: 304 });
  const [selectedTagIds, setSelectedTagIds] = useState([]);
  const [copyState, setCopyState] = useState("idle");
  const [savingMedia, setSavingMedia] = useState(false);

  useEffect(() => {
    refreshRef.current = onRefreshArticle;
  }, [onRefreshArticle]);

  const tagSignature = (article?.tags || [])
    .map((tag) => tag?.id)
    .filter((id) => id != null)
    .sort((a, b) => a - b)
    .join(",");

  useEffect(() => {
    setSelectedTagIds((article?.tags || []).map((tag) => tag.id).filter((id) => id != null));
  }, [articleId, tagSignature]);

  const availableTags = useMemo(() => {
    return [...(allTags || [])].sort((a, b) =>
      String(a.name || "").localeCompare(String(b.name || ""))
    );
  }, [allTags]);

  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return undefined;

    let frame = 0;
    const update = () => {
      frame = 0;
      const max = element.scrollHeight - element.clientHeight;
      const next = max > 0 ? Math.min(1, Math.max(0, element.scrollTop / max)) : 0;
      setProgress(next);
    };
    const onScroll = () => {
      if (!frame) frame = window.requestAnimationFrame(update);
    };

    element.addEventListener("scroll", onScroll, { passive: true });
    const observer = new ResizeObserver(update);
    observer.observe(element);
    if (frameRef.current) observer.observe(frameRef.current);
    update();

    return () => {
      element.removeEventListener("scroll", onScroll);
      observer.disconnect();
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [articleId, loading]);

  useEffect(() => {
    const element = scrollRef.current;
    if (element) element.scrollTop = 0;
    setProgress(0);
    setTagOpen(false);
    setCopyState("idle");
    setSavingMedia(false);
  }, [articleId]);

  useEffect(() => {
    if (!articleId) return undefined;
    if (copyTimer.current) window.clearTimeout(copyTimer.current);
    return () => {
      if (copyTimer.current) window.clearTimeout(copyTimer.current);
    };
  }, [articleId]);

  useEffect(() => {
    if (!tagOpen) return undefined;

    const onPointerDown = (event) => {
      const target = event.target;
      if (!target || typeof target.closest !== "function") return;
      if (target.closest("[data-tags-trigger]")) return;
      if (popRef.current?.contains(target)) return;
      setTagOpen(false);
    };
    const onKeyDown = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        setTagOpen(false);
      }
    };

    document.addEventListener("mousedown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("mousedown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [tagOpen]);

  useEffect(() => {
    if (!articleId) return undefined;
    const html = article?.content_html;
    if (!html || !/<img\b/i.test(html)) {
      setSavingMedia(false);
      return undefined;
    }
    const mediaKey = `${articleId}:${!!article?.full_content_loaded}`;
    if (MEDIA_REQUESTED.has(mediaKey)) {
      setSavingMedia(false);
      return undefined;
    }

    MEDIA_REQUESTED.add(mediaKey);
    let active = true;
    setSavingMedia(true);

    api
      .cacheArticleMedia(articleId)
      .then(() => {
        if (!active) return;
        refreshRef.current?.(articleId);
      })
      .catch(() => {
        MEDIA_REQUESTED.delete(mediaKey);
      })
      .finally(() => {
        if (active) setSavingMedia(false);
      });

    return () => {
      active = false;
    };
  }, [articleId, article?.content_html]);

  const openTags = (event) => {
    if (!article) return;
    if (tagOpen) {
      setTagOpen(false);
      return;
    }

    const trigger = event?.currentTarget;
    const rect = trigger?.getBoundingClientRect?.();
    if (rect) {
      const width = Math.min(304, Math.max(248, window.innerWidth - 24));
      const left = Math.max(
        12,
        Math.min(rect.right - width, window.innerWidth - width - 12)
      );
      let top = rect.bottom + 8;
      if (top + 370 > window.innerHeight) {
        top = Math.max(12, rect.top - 378);
      }
      setTagPosition({ top, left, width });
    }
    setTagOpen(true);
  };

  const toggleTag = async (tag) => {
    if (!article || tag?.id == null) return;
    const current = selectedTagIds;
    const next = current.includes(tag.id)
      ? current.filter((id) => id !== tag.id)
      : [...current, tag.id];

    setSelectedTagIds(next);
    try {
      await onSetTags?.(article.id, next);
    } catch {
      setSelectedTagIds(current);
    }
  };

  const createTags = async (names) => {
    if (!article) return null;
    const tags = await onCreateTags?.(names);
    if (!tags?.length) return null;

    const current = selectedTagIds;
    const next = Array.from(new Set([...current, ...tags.map((tag) => tag.id)]));
    setSelectedTagIds(next);
    try {
      await onSetTags?.(article.id, next);
    } catch (error) {
      setSelectedTagIds(current);
      throw error;
    }
    return tags;
  };

  const copyLink = async () => {
    if (!article?.url) return;
    const copied = await copyText(article.url);
    setCopyState(copied ? "copied" : "failed");
    if (copied) onCopyLink?.();
    if (copyTimer.current) window.clearTimeout(copyTimer.current);
    copyTimer.current = window.setTimeout(() => setCopyState("idle"), 1800);
  };

  const openOriginal = (url) => {
    const target = typeof url === "string" && url ? url : article?.url;
    if (target) onOpenOriginal?.(target);
  };

  const canPrev =
    hasPrev !== undefined ? Boolean(hasPrev) : article?.prev_id != null;
  const canNext =
    hasNext !== undefined ? Boolean(hasNext) : article?.next_id != null;

  const fontFamily =
    config.reader_font === "sans"
      ? 'var(--font-sans, "Inter Variable", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif)'
      : 'var(--font-serif, "Newsreader Variable", Georgia, "Times New Roman", serif)';

  const frameStyle = { "--reader-width": `${Number(config.line_width) || 700}px` };
  const contentStyle = {
    "--reader-width": `${Number(config.line_width) || 700}px`,
  };

  if (loading && !article) {
    return (
      <section className="reader reader--loading" aria-label="Reader">
        <ReaderSkeleton />
      </section>
    );
  }

  if (!article) {
    return (
      <section className="reader reader--empty" aria-label="Reader">
        <ReaderEmpty onOpenShortcuts={onOpenShortcuts} />
      </section>
    );
  }

  const articleTitle = article.title || "Untitled story";
  const dateText = displayDate(article.published_at || article.fetched_at, config.date_format);

  return (
    <section className="reader" aria-label="Reader">
      <div
        className={`reader-progress ${progress > 0.01 ? "is-visible" : ""}`}
        aria-hidden="true"
      >
        <span style={{ width: `${Math.round(progress * 1000) / 10}%` }} />
      </div>

      <span className="reader-sr" role="status">
        {summarizing ? "Generating summary in the background. You can keep reading." : summary ? "Summary ready." : ""}
      </span>
      <div className="reader-sticky">
        <div className="reader-sticky-inner">
          <FeedMark src={article.feed_icon} size={20} />
          <div className="reader-sticky-title">
            <span>{article.feed_title || "Feed"}</span>
            <strong>{articleTitle}</strong>
          </div>
          <ReaderActions
            article={article}
            compact
            copyState={copyState}
            onToggleStar={() => onToggleStar?.(article)}
            onToggleRead={() => onToggleRead?.(article)}
            onOpenTags={openTags}
            onCopy={copyLink}
            onOpenOriginal={() => openOriginal()}
            onOpenShortcuts={onOpenShortcuts}
            onSummarize={onSummarize}
            summarizing={summarizing}
          />
        </div>
      </div>

      <ReaderTools article={article} onToggleArchive={onToggleArchive} onLoadFullArticle={onLoadFullArticle}
        loadingFullArticle={loadingFullArticle} findOpen={findOpen} onFindOpen={setFindOpen}
        findQuery={findQuery} onFindQuery={setFindQuery} findCount={findCount} findIndex={findIndex}
        onFindStep={stepFind} inputRef={findInputRef} />

      {summary && <ReaderSummary result={summary} onDismiss={onDismissSummary} />}

      <div className="reader-scroll" ref={scrollRef}>
        <div className="reader-frame" ref={frameRef} style={frameStyle}>
          <header className="reader-head">
            <div className="reader-source">
              <FeedMark src={article.feed_icon} size={34} />
              <div className="reader-source-text">
                <span className="reader-feed-title">
                  {article.feed_title || "Unknown feed"}
                </span>
                <span className="reader-source-sub">
                  {article.folder_name ? (
                    <>
                      <Folder size={11} strokeWidth={1.9} aria-hidden="true" />
                      {article.folder_name}
                    </>
                  ) : (
                    "Uncategorized"
                  )}
                </span>
              </div>
            </div>

            <h1 className="reader-title">{articleTitle}</h1>

            <div className="reader-meta">
              <time dateTime={article.published_at || undefined} title={absoluteDate(article.published_at)}>
                {dateText}
              </time>
              <span className="reader-meta-dot" aria-hidden="true" />
              <span className="reader-meta-item">
                <Clock size={12} strokeWidth={1.9} aria-hidden="true" />
                {readingTime(article.reading_time)}
              </span>
              {article.author ? (
                <>
                  <span className="reader-meta-dot" aria-hidden="true" />
                  <span className="reader-meta-author">{article.author}</span>
                </>
              ) : null}
            </div>

            <ReaderActions
              article={article}
              copyState={copyState}
              onToggleStar={() => onToggleStar?.(article)}
              onToggleRead={() => onToggleRead?.(article)}
              onOpenTags={openTags}
              onCopy={copyLink}
              onOpenOriginal={() => openOriginal()}
              onOpenShortcuts={onOpenShortcuts}
              onSummarize={onSummarize}
              summarizing={summarizing}
            />
          </header>

          <div className="reader-content" style={contentStyle}>
            <ArticleEnclosures enclosures={article.enclosures} />
            <ArticleContent
              findQuery={findOpen ? findQuery : ""} findIndex={findIndex} onFindCount={setFindCount}
              html={article.content_html}
              onOpenExternal={openOriginal}
              fontSize={config.font_size}
              lineWidth={config.line_width}
              fontFamily={fontFamily}
            />
          </div>

          <footer className="reader-foot">
            {savingMedia ? (
              <div className="reader-saving" role="status">
                <Loader2 size={12} className="reader-spin" />
                Saving images
              </div>
            ) : null}

            <div className="reader-end">
              <span aria-hidden="true" />
              <p>You&apos;re at the end</p>
              <span aria-hidden="true" />
            </div>

            <nav className="reader-nav" aria-label="Article navigation">
              <button
                type="button"
                className="reader-nav-button"
                onClick={() => onPrev?.()}
                disabled={!canPrev}
              >
                <ChevronLeft size={18} strokeWidth={1.8} />
                <span className="reader-nav-copy">
                  <strong>Previous</strong>
                  <small>{canPrev ? "Previous story" : "Start of list"}</small>
                </span>
                <kbd>↑</kbd>
              </button>

              <button
                type="button"
                className="reader-nav-button is-next"
                onClick={() => onNext?.()}
                disabled={!canNext}
              >
                <kbd>↓</kbd>
                <span className="reader-nav-copy">
                  <strong>Next</strong>
                  <small>{canNext ? "Next story" : "End of list"}</small>
                </span>
                <ChevronRight size={18} strokeWidth={1.8} />
              </button>
            </nav>
          </footer>
        </div>
      </div>

      {tagOpen ? (
        <TagPopover
          tags={availableTags}
          selectedIds={selectedTagIds}
          position={tagPosition}
          popRef={popRef}
          onToggle={toggleTag}
          onCreate={createTags}
          onClose={() => setTagOpen(false)}
        />
      ) : null}
    </section>
  );
}
