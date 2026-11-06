import { useEffect, useRef, useState } from "react";
import { RefreshCw, Star } from "lucide-react";
import { EmptyState, FeedIcon, Spinner } from "./ui";
import {
  formatDateGroup,
  formatFullDate,
  formatRelative,
  formatTime,
} from "../lib/format";

function RowThumb({ src }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);
  if (!src || failed) return null;
  return (
    <img
      className="article-thumb"
      src={src}
      alt=""
      loading="lazy"
      draggable={false}
      onError={() => setFailed(true)}
    />
  );
}

function SkeletonList() {
  return (
    <div className="article-skeleton" aria-hidden="true">
      {[78, 92, 64, 86, 71, 88, 59].map((width, index) => (
        <div className="skeleton-row" key={index}>
          <div className="skeleton-icon shimmer" />
          <div className="skeleton-lines">
            <div className="skeleton-meta">
              <span className="skeleton-bar shimmer" style={{ width: "32%" }} />
              <span className="skeleton-bar shimmer" style={{ width: "12%" }} />
            </div>
            <span
              className="skeleton-bar skeleton-title shimmer"
              style={{ width: `${width}%` }}
            />
            <span className="skeleton-bar shimmer" style={{ width: "94%" }} />
            <span className="skeleton-bar shimmer" style={{ width: "62%" }} />
          </div>
        </div>
      ))}
    </div>
  );
}

function ArticleRow({
  article,
  selected,
  compact,
  showSummary,
  dateFormat,
  onSelect,
  onToggleStar,
}) {
  const unread = !article.is_read;
  const timeLabel =
    dateFormat === "absolute"
      ? formatTime(article.published_at || article.fetched_at)
      : formatRelative(article.published_at || article.fetched_at);
  const fullDate = formatFullDate(article.published_at || article.fetched_at);

  return (
    <div
      className={`article-row ${selected ? "is-selected" : ""} ${
        compact ? "is-compact" : ""
      } ${unread ? "is-unread" : "is-read"}`.trim()}
      data-article-id={article.id}
      onClick={() => onSelect(article.id)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSelect(article.id);
        }
      }}
      role="option"
      aria-selected={selected}
      tabIndex={0}
      title={fullDate}
    >
      <div className="article-row-inner">
        <div className="article-icon-wrap">
          <FeedIcon
            title={article.feed_title}
            iconUrl={article.feed_icon}
            size={18}
            className="article-feed-icon"
          />
        </div>
        <div className="article-body">
          <div className="article-meta">
            <span
              className={`unread-dot ${unread ? "" : "is-read"}`.trim()}
              aria-hidden="true"
            />
            <span className="article-feed-name">{article.feed_title}</span>
            <span className="article-time" title={fullDate}>
              {timeLabel}
            </span>
            <button
              type="button"
              className={`article-star ${article.is_starred ? "is-starred" : ""}`.trim()}
              onClick={(event) => {
                event.stopPropagation();
                onToggleStar?.(article);
              }}
              aria-label={article.is_starred ? "Unstar article" : "Star article"}
              title={article.is_starred ? "Unstar" : "Star"}
            >
              <Star
                size={14}
                strokeWidth={1.8}
                fill={article.is_starred ? "currentColor" : "none"}
              />
            </button>
          </div>
          <h3 className="article-title">{article.title || "Untitled"}</h3>
          {showSummary && article.summary && (
            <p className="article-excerpt">{article.summary}</p>
          )}
        </div>
        {!compact && <RowThumb src={article.image_url} />}
      </div>
    </div>
  );
}

export default function ArticleList({
  articles,
  loading,
  loadingMore,
  hasMore,
  error,
  selectedId,
  onSelect,
  onToggleStar,
  onLoadMore,
  onRetry,
  settings,
  sort,
  emptyState,
}) {
  const scrollRef = useRef(null);
  const sentinelRef = useRef(null);
  const compact = settings?.density === "compact";
  const showSummary = settings?.show_summaries !== false;
  const dateFormat = settings?.date_format || "relative";

  useEffect(() => {
    if (!selectedId) return;
    const row = scrollRef.current?.querySelector(
      `[data-article-id="${selectedId}"]`
    );
    row?.scrollIntoView({ block: "nearest" });
  }, [selectedId]);

  useEffect(() => {
    const root = scrollRef.current;
    const target = sentinelRef.current;
    if (!root || !target || !hasMore || loading || loadingMore) return undefined;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) onLoadMore?.();
      },
      { root, rootMargin: "320px 0px" }
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [hasMore, loading, loadingMore, onLoadMore, articles.length]);

  const groups = [];
  if (sort === "newest" && articles.length > 0) {
    for (const article of articles) {
      const label = formatDateGroup(article.published_at || article.fetched_at);
      const last = groups[groups.length - 1];
      if (last && last.label === label) last.articles.push(article);
      else groups.push({ label, articles: [article] });
    }
  }

  let content;
  if (loading && articles.length === 0) {
    content = <SkeletonList />;
  } else if (error && articles.length === 0) {
    content = (
      <EmptyState
        icon={RefreshCw}
        eyebrow="Could not load"
        title="The list didn't load."
        body={error}
        action={
          <button type="button" className="btn btn-default btn-sm" onClick={onRetry}>
            Try again
          </button>
        }
        compact
      />
    );
  } else if (articles.length === 0) {
    content = emptyState;
  } else if (sort === "newest") {
    content = groups.map((group) => (
      <section className="article-group" key={group.label}>
        <div className="group-header">
          <span>{group.label}</span>
          <span className="group-count">{group.articles.length}</span>
        </div>
        {group.articles.map((article) => (
          <ArticleRow
            key={article.id}
            article={article}
            selected={article.id === selectedId}
            compact={compact}
            showSummary={showSummary}
            dateFormat={dateFormat}
            onSelect={onSelect}
            onToggleStar={onToggleStar}
          />
        ))}
      </section>
    ));
  } else {
    content = (
      <section className="article-group">
        {articles.map((article) => (
          <ArticleRow
            key={article.id}
            article={article}
            selected={article.id === selectedId}
            compact={compact}
            showSummary={showSummary}
            dateFormat={dateFormat}
            onSelect={onSelect}
            onToggleStar={onToggleStar}
          />
        ))}
      </section>
    );
  }

  return (
    <div
      className="article-list-scroll"
      ref={scrollRef}
      role="listbox"
      aria-label="Articles"
      aria-busy={loading || loadingMore}
    >
      <div className="article-list-inner">{content}</div>

      {articles.length > 0 && (
        <div className="list-footer" ref={sentinelRef}>
          {hasMore ? (
            <button
              type="button"
              className="load-more"
              onClick={onLoadMore}
              disabled={loadingMore}
            >
              {loadingMore ? (
                <>
                  <Spinner size={13} /> Loading…
                </>
              ) : (
                "Load more"
              )}
            </button>
          ) : (
            <span className="list-end">
              {articles.length} {articles.length === 1 ? "article" : "articles"}
              <span aria-hidden="true"> · </span>
              end of list
            </span>
          )}
        </div>
      )}
    </div>
  );
}
