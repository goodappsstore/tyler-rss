import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Archive,
  BarChart3,
  ChevronRight,
  CircleDot,
  Folder,
  FolderCog,
  FolderOpen,
  Inbox,
  Plus,
  Pencil,
  Search,
  Settings,
  Star,
  Sun,
  Tag,
  Trash2,
  ArrowDownUp,
} from "lucide-react";
import { FeedIcon, IconButton, Kbd, Spinner } from "./ui";
import BrandMark from "./BrandMark";
import { errorMessage } from "../api";


function Count({ value, accent = false }) {
  if (!value) return null;
  return (
    <span className={`nav-count ${accent ? "is-accent" : ""}`.trim()}>
      {value > 999 ? "999+" : value}
    </span>
  );
}

function SmartItem({ icon: Icon, label, count, active, onClick, strong }) {
  return (
    <button
      type="button"
      className={`nav-item ${active ? "is-active" : ""} ${
        strong ? "has-unread" : ""
      }`.trim()}
      onClick={onClick}
      aria-current={active ? "page" : undefined}
    >
      <Icon size={16} strokeWidth={1.8} className="nav-icon" />
      <span className="nav-label">{label}</span>
      <Count value={count} accent={active} />
    </button>
  );
}

export default function Sidebar({
  bootstrap,
  scope,
  onSelectScope,
  onFocusSearch,
  onOpenDialog,
  onAddFolder,
  onRenameFolder,
  onDeleteFolder,
  onRenameTag,
  onDeleteTag,
  onMoveFeed,
  onNavigate,
}) {
  const [expanded, setExpanded] = useState(() => new Set());
  const [addingFolder, setAddingFolder] = useState(false);
  const [folderName, setFolderName] = useState("");
  const [folderError, setFolderError] = useState(null);
  const [savingFolder, setSavingFolder] = useState(false);
  const [deletingFolder, setDeletingFolder] = useState(null);
  const [deletingTag, setDeletingTag] = useState(null);
  const [draggingId, setDraggingId] = useState(null);
  const [dragPosition, setDragPosition] = useState(null);
  const [dropTarget, setDropTarget] = useState(null);
  const [movingId, setMovingId] = useState(null);
  const [moveError, setMoveError] = useState(null);
  const folderInputRef = useRef(null);
  const scrollRef = useRef(null);
  const seeded = useRef(false);
  const dragCleanup = useRef(null);
  const suppressFeedClick = useRef(false);
  useEffect(() => () => dragCleanup.current?.(), []);

  const feeds = bootstrap?.feeds ?? [];
  const folders = bootstrap?.folders ?? [];
  const tags = bootstrap?.tags ?? [];
  const counts = bootstrap?.counts ?? {};
  const byFeed = bootstrap?.unread_by_feed ?? {};
  const byFolder = bootstrap?.unread_by_folder ?? {};

  useEffect(() => {
    if (seeded.current || folders.length === 0) return;
    seeded.current = true;
    setExpanded(new Set(folders.map((folder) => folder.id)));
  }, [folders]);

  useEffect(() => {
    if (scope.type !== "feed") return;
    const feed = feeds.find((item) => item.id === scope.id);
    if (!feed || feed.folder_id == null) return;
    setExpanded((current) => {
      if (current.has(feed.folder_id)) return current;
      const next = new Set(current);
      next.add(feed.folder_id);
      return next;
    });
  }, [scope, feeds]);

  useEffect(() => {
    if (addingFolder) folderInputRef.current?.focus();
  }, [addingFolder]);

  const unfiledFeeds = feeds.filter((feed) => feed.folder_id == null);
  const draggedFeed = feeds.find((feed) => feed.id === draggingId);

  function navigate(nextScope) {
    onSelectScope(nextScope);
    onNavigate?.();
  }

  function toggleFolder(id) {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function submitFolder(event) {
    event.preventDefault();
    const name = folderName.trim();
    if (!name || savingFolder) return;
    setSavingFolder(true);
    setFolderError(null);
    try {
      await onAddFolder(name);
      setFolderName("");
      setAddingFolder(false);
    } catch (error) {
      setFolderError(errorMessage(error));
    } finally {
      setSavingFolder(false);
    }
  }

  function cancelFolder() {
    setAddingFolder(false);
    setFolderName("");
    setFolderError(null);
  }

  async function moveToFolder(feedId, folderId) {
    const feed = feeds.find((item) => item.id === feedId);
    if (!feed || feed.folder_id === folderId || movingId != null) return;
    setMovingId(feedId);
    setMoveError(null);
    try {
      await onMoveFeed(feedId, folderId);
      if (folderId != null) setExpanded((current) => new Set([...current, folderId]));
    } catch (error) {
      setMoveError(errorMessage(error));
    } finally {
      setMovingId(null);
    }
  }

  function startDrag(event, feed) {
    if (!event.isPrimary || event.button !== 0 || movingId != null) return;
    dragCleanup.current?.();
    suppressFeedClick.current = false;
    const source = event.currentTarget;
    const startX = event.clientX;
    const startY = event.clientY;
    const pointerId = event.pointerId;
    let moved = false;
    let pointerX = startX;
    let pointerY = startY;
    let scrollFrame = null;
    source.setPointerCapture(pointerId);

    function destination() {
      const target = document.elementFromPoint(pointerX, pointerY)?.closest("[data-folder-drop]");
      if (!target || !scrollRef.current?.contains(target)) return undefined;
      const value = target.dataset.folderDrop;
      return value === "uncategorized" ? null : Number(value);
    }

    function updateDropTarget() {
      const folderId = destination();
      if (folderId === undefined || folderId === feed.folder_id) {
        setDropTarget(null);
      } else {
        setDropTarget(folderId ?? "uncategorized");
      }
    }

    function scrollWhileDragging() {
      const scroll = scrollRef.current;
      if (!scroll) return;
      const bounds = scroll.getBoundingClientRect();
      if (pointerX >= bounds.left && pointerX <= bounds.right) {
        if (pointerY < bounds.top + 36) scroll.scrollTop -= 8;
        else if (pointerY > bounds.bottom - 36) scroll.scrollTop += 8;
      }
      updateDropTarget();
      scrollFrame = requestAnimationFrame(scrollWhileDragging);
    }

    function onMove(event) {
      if (event.pointerId !== pointerId) return;
      if (!moved && Math.hypot(event.clientX - startX, event.clientY - startY) < 6) return;
      event.preventDefault();
      pointerX = event.clientX;
      pointerY = event.clientY;
      if (!moved) {
        moved = true;
        suppressFeedClick.current = true;
        setDraggingId(feed.id);
        setMoveError(null);
        scrollFrame = requestAnimationFrame(scrollWhileDragging);
      }
      setDragPosition({ x: pointerX, y: pointerY });
      updateDropTarget();
    }

    function cleanup() {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("blur", cleanup);
      source.removeEventListener("lostpointercapture", cleanup);
      cancelAnimationFrame(scrollFrame);
      if (source.hasPointerCapture(pointerId)) source.releasePointerCapture(pointerId);
      setDraggingId(null);
      setDragPosition(null);
      setDropTarget(null);
      dragCleanup.current = null;
    }

    function onUp(event) {
      if (event.pointerId !== pointerId) return;
      pointerX = event.clientX;
      pointerY = event.clientY;
      const folderId = destination();
      cleanup();
      if (!moved) return;
      if (folderId !== undefined) moveToFolder(feed.id, folderId);
    }

    function onCancel(event) {
      if (event.pointerId === pointerId) cleanup();
    }

    function onKeyDown(event) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopImmediatePropagation();
      cleanup();
    }

    window.addEventListener("pointermove", onMove, { passive: false });
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("blur", cleanup);
    source.addEventListener("lostpointercapture", cleanup);
    dragCleanup.current = cleanup;
  }

  function selectFeed(event, feed) {
    if (suppressFeedClick.current && event.detail > 0) return;
    navigate({ type: "feed", id: feed.id });
  }

  return (
    <aside className={`sidebar ${draggingId != null ? "is-dragging-feed" : ""}`.trim()} aria-label="Library navigation">
      <div className="sidebar-scroll" ref={scrollRef}>
        <button
          type="button"
          className="brand"
          onClick={() => navigate({ type: "all" })}
          title="Tyler — all articles"
        >
          <span className="brand-mark" aria-hidden="true">
            <BrandMark size={20} />
          </span>
          <span className="brand-word">Tyler</span>
        </button>

        <button
          type="button"
          className="sidebar-search"
          onClick={onFocusSearch}
          title="Search articles (/)"
        >
          <Search size={14} strokeWidth={1.8} aria-hidden="true" />
          <span>Search articles</span>
          <Kbd>/</Kbd>
        </button>

        <button
          type="button"
          className="sidebar-search sidebar-add-feed"
          onClick={() => onOpenDialog("add-feed")}
          title="Add feed"
        >
          <Plus size={14} strokeWidth={2} aria-hidden="true" />
          <span>Add feed</span>
        </button>

        <nav className="nav-section" aria-label="Smart views">
          <div className="sidebar-label">Library</div>
          <SmartItem
            icon={Inbox}
            label="All"
            count={counts.all}
            active={scope.type === "all"}
            onClick={() => navigate({ type: "all" })}
          />
          <SmartItem
            icon={CircleDot}
            label="Unread"
            count={counts.unread}
            active={scope.type === "unread"}
            strong={(counts.unread ?? 0) > 0}
            onClick={() => navigate({ type: "unread" })}
          />
          <SmartItem
            icon={Star}
            label="Starred"
            count={counts.starred}
            active={scope.type === "starred"}
            onClick={() => navigate({ type: "starred" })}
          />
          <SmartItem
            icon={Sun}
            label="Today"
            count={counts.today}
            active={scope.type === "today"}
            onClick={() => navigate({ type: "today" })}
          />
          <SmartItem icon={Archive} label="Archive" count={counts.archived}
            active={scope.type === "archived"} onClick={() => navigate({ type: "archived" })} />
        </nav>

        <div className="nav-section">
          <div className="sidebar-label folder-label-row">
            <span>Folders</span>
            <IconButton
              label="New folder"
              size="xs"
              onClick={() => {
                setAddingFolder(true);
                setFolderError(null);
              }}
            >
              <Plus size={13} />
            </IconButton>
          </div>

          {addingFolder && (
            <form className="folder-form" onSubmit={submitFolder}>
              <input
                ref={folderInputRef}
                value={folderName}
                onChange={(event) => {
                  setFolderName(event.target.value);
                  setFolderError(null);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Escape") {
                    event.stopPropagation();
                    cancelFolder();
                  }
                }}
                placeholder="Folder name"
                aria-label="Folder name"
                maxLength={80}
              />
              <button
                type="submit"
                className="folder-form-submit"
                aria-label="Create folder"
                title="Create folder"
                disabled={!folderName.trim() || savingFolder}
              >
                {savingFolder ? <Spinner size={12} /> : <Plus size={13} />}
              </button>
              {folderError && (
                <div className="folder-form-error" role="alert">
                  {folderError}
                </div>
              )}
            </form>
          )}

          <div className="folder-tree">
            {folders.map((folder) => {
              const open = expanded.has(folder.id);
              const folderFeeds = feeds.filter(
                (feed) => feed.folder_id === folder.id
              );
              const unread = folder.unread_count ?? byFolder[folder.id] ?? 0;
              const active = scope.type === "folder" && scope.id === folder.id;
              return (
                <div className="folder-group" key={folder.id} data-folder-drop={folder.id}>
                  <div className={`folder-row ${active ? "is-active" : ""} ${dropTarget === folder.id ? "is-drop-target" : ""}`.trim()}>
                    <button
                      type="button"
                      className={`folder-chevron ${open ? "is-open" : ""}`.trim()}
                      onClick={() => toggleFolder(folder.id)}
                      aria-label={`${open ? "Collapse" : "Expand"} ${folder.name}`}
                      aria-expanded={open}
                      title={open ? "Collapse" : "Expand"}
                    >
                      <ChevronRight size={12} />
                    </button>
                    <button
                      type="button"
                      className="folder-main"
                      onClick={() => navigate({ type: "folder", id: folder.id })}
                      aria-current={active ? "page" : undefined}
                    >
                      {open ? (
                        <FolderOpen size={15} strokeWidth={1.7} />
                      ) : (
                        <Folder size={15} strokeWidth={1.7} />
                      )}
                      <span className="folder-name">{folder.name}</span>
                      <Count value={unread} accent={active} />
                    </button>
                    <div className="folder-actions">
                      <IconButton
                        label={`Rename ${folder.name}`}
                        size="xs"
                        onClick={() => onRenameFolder(folder)}
                        disabled={deletingFolder != null}
                      >
                        <Pencil size={12} />
                      </IconButton>
                      <IconButton
                        label={`Delete ${folder.name}`}
                        size="xs"
                        className="folder-delete"
                        disabled={deletingFolder != null}
                        onClick={async () => {
                          setDeletingFolder(folder.id);
                          try {
                            await onDeleteFolder(folder);
                          } finally {
                            setDeletingFolder(null);
                          }
                        }}
                      >
                        {deletingFolder === folder.id ? <Spinner size={12} /> : <Trash2 size={12} />}
                      </IconButton>
                    </div>
                  </div>
                  {open && folderFeeds.length > 0 && (
                    <div className="feed-children">
                      {folderFeeds.map((feed) => (
                        <FeedRow
                          key={feed.id}
                          feed={feed}
                          unread={feed.unread_count ?? byFeed[feed.id] ?? 0}
                          active={scope.type === "feed" && scope.id === feed.id}
                          onClick={(event) => selectFeed(event, feed)}
                          onPointerDown={(event) => startDrag(event, feed)}
                          dragging={draggingId === feed.id}
                          moving={movingId === feed.id}
                        />
                      ))}
                    </div>
                  )}
                </div>
              );
            })}

            {(unfiledFeeds.length > 0 || draggingId != null) && (
              <div className="folder-group unfiled-group" data-folder-drop="uncategorized">
                <div className={`unfiled-label ${dropTarget === "uncategorized" ? "is-drop-target" : ""}`.trim()}>Uncategorized</div>
                {unfiledFeeds.map((feed) => (
                  <FeedRow
                    key={feed.id}
                    feed={feed}
                    unread={feed.unread_count ?? byFeed[feed.id] ?? 0}
                    active={scope.type === "feed" && scope.id === feed.id}
                    onClick={(event) => selectFeed(event, feed)}
                    onPointerDown={(event) => startDrag(event, feed)}
                    dragging={draggingId === feed.id}
                    moving={movingId === feed.id}
                  />
                ))}
              </div>
            )}

            {folders.length === 0 && unfiledFeeds.length === 0 && (
              <p className="sidebar-hint">No feeds yet.</p>
            )}
            {moveError && <p className="sidebar-move-error" role="alert">{moveError}</p>}
            {draggingId != null && (
              <p className="sidebar-hint" role="status">Drop on a folder or Uncategorized. Esc cancels.</p>
            )}
          </div>
        </div>

        {tags.length > 0 && (
          <div className="nav-section tags-section">
            <div className="sidebar-label folder-label-row">
              <span>Tags</span>
              <IconButton
                label="Manage tags"
                size="xs"
                onClick={() => onOpenDialog("tags")}
              >
                <Tag size={12} />
              </IconButton>
            </div>
            <div className="tag-list">
              {tags.map((tag) => {
                const active = scope.type === "tag" && scope.id === tag.id;
                return (
                  <div
                    key={tag.id}
                    className={`tag-row ${active ? "is-active" : ""}`.trim()}
                  >
                    <button
                      type="button"
                      className="tag-main"
                      onClick={() => navigate({ type: "tag", id: tag.id })}
                      aria-current={active ? "page" : undefined}
                    >
                      <span
                        className="tag-dot"
                        style={{ background: tag.color || "var(--accent)" }}
                        aria-hidden="true"
                      />
                      <span className="tag-name">{tag.name}</span>
                      <Count value={tag.count} accent={active} />
                    </button>
                    <div className="tag-actions">
                      <IconButton
                        label={`Rename ${tag.name}`}
                        size="xs"
                        onClick={() => onRenameTag(tag)}
                        disabled={deletingTag != null}
                      >
                        <Pencil size={12} />
                      </IconButton>
                      <IconButton
                        label={`Delete ${tag.name}`}
                        size="xs"
                        className="tag-delete"
                        disabled={deletingTag != null}
                        onClick={async () => {
                          setDeletingTag(tag.id);
                          try {
                            await onDeleteTag(tag);
                          } finally {
                            setDeletingTag(null);
                          }
                        }}
                      >
                        {deletingTag === tag.id ? <Spinner size={12} /> : <Trash2 size={12} />}
                      </IconButton>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      <div className="sidebar-footer">
        <div className="sidebar-actions">
          <button
            type="button"
            className="sidebar-action"
            onClick={() => onOpenDialog("settings")}
            title="Settings"
          >
            <Settings size={14} strokeWidth={1.8} />
            <span>Settings</span>
          </button>
          <button
            type="button"
            className="sidebar-action"
            onClick={() => onOpenDialog("transfer")}
            title="Import or export"
          >
            <ArrowDownUp size={14} strokeWidth={1.8} />
            <span>Transfer</span>
          </button>
          <button
            type="button"
            className="sidebar-action"
            onClick={() => onOpenDialog("stats")}
            title="Reading statistics"
          >
            <BarChart3 size={14} strokeWidth={1.8} />
            <span>Stats</span>
          </button>
          <button
            type="button"
            className="sidebar-action"
            onClick={() => onOpenDialog("manage-feeds")}
            title="Manage feeds"
            aria-label="Manage feeds"
          >
            <FolderCog size={14} strokeWidth={1.8} />
            <span>Feeds</span>
          </button>
        </div>
        <div
          className="sidebar-meta"
          title={bootstrap?.data_dir ? `Data: ${bootstrap.data_dir}` : undefined}
        >
          <span>
            {feeds.length} {feeds.length === 1 ? "feed" : "feeds"}
          </span>
          <span className="meta-dot" aria-hidden="true" />
          <span>{counts.all ?? 0} articles</span>
          {bootstrap?.version && (
            <span className="sidebar-version">v{bootstrap.version}</span>
          )}
        </div>
      </div>
      {draggedFeed && dragPosition && createPortal(
        <div
          className="feed-drag-preview"
          style={{ left: dragPosition.x + 14, top: dragPosition.y + 14 }}
          aria-hidden="true"
        >
          <FeedIcon title={draggedFeed.title} iconUrl={draggedFeed.icon_url} size={15} />
          <span>{draggedFeed.title}</span>
        </div>,
        document.body
      )}
    </aside>
  );
}

function FeedRow({ feed, unread, active, onClick, onPointerDown, dragging, moving }) {
  return (
    <button
      type="button"
      className={`feed-row ${active ? "is-active" : ""} ${dragging ? "is-dragging" : ""}`.trim()}
      onClick={onClick}
      draggable={false}
      onPointerDown={onPointerDown}
      disabled={moving}
      aria-current={active ? "page" : undefined}
      title={`${feed.title} · Drag to a folder`}
    >
      <FeedIcon
        title={feed.title}
        iconUrl={feed.icon_url}
        size={15}
        className="feed-row-icon"
      />
      <span className={`feed-row-name ${unread > 0 ? "has-unread" : ""}`.trim()}>
        {feed.title}
      </span>
      {feed.last_status === "error" && (
        <span className="feed-error-dot" title={feed.error || "Last fetch failed"} aria-label={feed.error || "Last fetch failed"} />
      )}
      {(moving || ["pending", "fetching"].includes(feed.last_status)) && <Spinner size={12} label={moving ? "Moving feed" : "Loading feed"} />}
      <Count value={unread} accent={active} />
    </button>
  );
}
