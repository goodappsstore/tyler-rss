import {
  ArrowDownUp,
  CheckCheck,
  ChevronDown,
  PanelLeft,
  RefreshCw,
  Search,
  X,
} from "lucide-react";
import { Badge, IconButton, Kbd, Menu, SegmentedControl, Spinner } from "./ui";

const FILTER_OPTIONS = [
  { value: "all", label: "All" },
  { value: "unread", label: "Unread" },
  { value: "starred", label: "Starred" },
];

const SORT_LABELS = {
  newest: "Newest",
  oldest: "Oldest",
  feed: "By feed",
};

export default function TopBar({
  scopeTitle,
  archived = false,
  scopeKind,
  count,
  filter,
  onFilterChange,
  sort,
  onSortChange,
  search,
  onSearchChange,
  onSearchClear,
  searchRef,
  refreshing,
  progressLabel,
  progressPercent,
  canMarkAll,
  onMarkAll,
  onRefresh,
  onToggleSidebar,
}) {
  return (
    <header className="topbar">
      <div className="topbar-head">
        <IconButton
          label="Open navigation"
          className="mobile-sidebar-toggle"
          onClick={onToggleSidebar}
        >
          <PanelLeft size={17} />
        </IconButton>

        <div className="scope-heading">
          <span className="scope-eyebrow">{scopeKind}</span>
          <div className="scope-title-row">
            <h1 className="scope-title">{scopeTitle}</h1>
            <Badge tone="neutral" className="scope-count">
              {count > 9999 ? "9999+" : count ?? 0}
            </Badge>
          </div>
        </div>

        <div className="topbar-actions">
          {refreshing && (
            <span className="refresh-status" title={progressLabel}>
              <Spinner size={12} />
              <span className="refresh-status-text">{progressLabel}</span>
            </span>
          )}
          <IconButton
            label={refreshing ? "Refreshing feeds" : "Refresh feeds (r)"}
            onClick={onRefresh}
            disabled={refreshing}
            className="refresh-button"
          >
            <RefreshCw size={16} className={refreshing ? "spin" : ""} />
          </IconButton>
          <IconButton
            label="Mark all as read"
            onClick={onMarkAll}
            disabled={!canMarkAll}
            className="mark-all-button"
          >
            <CheckCheck size={17} />
          </IconButton>
          <Menu
            label="Sort articles"
            items={[
              {
                label: "Newest first",
                active: sort === "newest",
                onSelect: () => onSortChange("newest"),
              },
              {
                label: "Oldest first",
                active: sort === "oldest",
                onSelect: () => onSortChange("oldest"),
              },
              {
                label: "Group by feed",
                active: sort === "feed",
                onSelect: () => onSortChange("feed"),
              },
            ]}
            trigger={({ toggle }) => (
              <button
                type="button"
                className="sort-trigger"
                onClick={toggle}
                title="Sort articles"
                aria-label="Sort articles"
              >
                <ArrowDownUp size={14} strokeWidth={1.8} />
                <span className="sort-label">{SORT_LABELS[sort] || "Newest"}</span>
                <ChevronDown size={12} className="sort-chevron" />
              </button>
            )}
          />
        </div>
      </div>

      <div className="topbar-controls">
        <div className={`search-field ${search ? "has-value" : ""}`.trim()}>
          <Search size={14} strokeWidth={1.8} className="search-icon" aria-hidden="true" />
          <input
            ref={searchRef}
            type="search"
            value={search}
            onChange={(event) => onSearchChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape" && search) {
                event.stopPropagation();
                onSearchClear();
                event.currentTarget.blur();
              }
            }}
            placeholder="Search articles"
            aria-label="Search articles"
            spellCheck={false}
          />
          {search ? (
            <button
              type="button"
              className="search-clear"
              onClick={onSearchClear}
              aria-label="Clear search"
              title="Clear search"
            >
              <X size={13} />
            </button>
          ) : (
            <Kbd className="search-kbd">/</Kbd>
          )}
        </div>

        {!archived && <SegmentedControl
          options={FILTER_OPTIONS}
          value={filter}
          onChange={onFilterChange}
          ariaLabel="Filter articles"
          className="topbar-filter"
        />}
      </div>

      {refreshing && (
        <div className="refresh-track" aria-hidden="true">
          <div
            className="refresh-track-fill"
            style={{ width: `${progressPercent ?? 12}%` }}
          />
        </div>
      )}
    </header>
  );
}
