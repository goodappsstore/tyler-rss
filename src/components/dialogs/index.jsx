import { useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { version as appVersion } from "../../../package.json";
import "../dialogs.css";
import {
  X, Rss, Plus, Search, MoreHorizontal, Pencil, RefreshCw, Trash2, Check,
  FolderPlus, Folder, ChevronDown, AlertCircle, Loader2,
  Download, Upload, FileArchive, FileText, Database, HardDrive, ExternalLink,
  Palette, BookOpen, Info, Sun, Moon, Monitor, Tags, BarChart3, CheckCircle2,
  Link2, Sparkles, Volume2,
} from "lucide-react";
import { api } from "../../api";
import { TTS_VOICES } from "../../tts/voices";
import { parseTagNames } from "../../lib/tags";
import {
  FEED_STARTERS,
  STARTER_CATEGORIES,
  sameFeedUrl,
} from "../../lib/feedStarters";
import { save, open as openDialog } from "@tauri-apps/plugin-dialog";

const modalStack = [];

const TAG_COLORS = [
  "#c2410c", "#b45309", "#4d7c0f", "#0f766e",
  "#0369a1", "#6d28d9", "#be185d", "#57534e",
];

const INTERVALS = [
  [15, "Every 15 minutes"], [30, "Every 30 minutes"], [60, "Every hour"],
  [180, "Every 3 hours"], [720, "Every 12 hours"], [1440, "Once a day"],
];

function errText(err) {
  if (!err) return "Something went wrong.";
  if (typeof err === "string") return err;
  return err.message || err.error || String(err);
}

function hostOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return url || ""; }
}

function formatBytes(bytes) {
  const n = Number(bytes);
  if (!Number.isFinite(n) || n <= 0) return "0 B";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function todayStamp() {
  const d = new Date();
  const p = (v) => String(v).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function Spinner({ size = 14 }) {
  return <Loader2 size={size} className="dlg-spin" aria-hidden="true" />;
}

function ErrorNote({ children }) {
  if (!children) return null;
  return (
    <div className="dlg-note dlg-note-error" role="alert">
      <AlertCircle size={15} />
      <span>{children}</span>
    </div>
  );
}

function InfoNote({ children, tone = "info" }) {
  if (!children) return null;
  return (
    <div className={`dlg-note dlg-note-${tone}`}>
      {tone === "success" ? <CheckCircle2 size={15} /> : <Info size={15} />}
      <span>{children}</span>
    </div>
  );
}

function Field({ label, hint, children }) {
  return (
    <label className="dlg-field">
      {label && <span className="dlg-label">{label}</span>}
      {children}
      {hint && <span className="dlg-hint">{hint}</span>}
    </label>
  );
}

function Toggle({ checked, onChange, label, description }) {
  return (
    <div className="dlg-toggle-row">
      <div className="dlg-toggle-copy">
        <span className="dlg-toggle-label">{label}</span>
        {description && <span className="dlg-hint">{description}</span>}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={!!checked}
        aria-label={label}
        className={`dlg-switch${checked ? " is-on" : ""}`}
        onClick={() => onChange(!checked)}
      >
        <span className="dlg-switch-dot" />
      </button>
    </div>
  );
}

function Modal({ open, onClose, title, subtitle, eyebrow, icon: Icon, width = 700, children, footer }) {
  const panelRef = useRef(null);
  const titleId = useId();
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    if (!open) return undefined;
    const token = {};
    modalStack.push(token);
    const previous = document.activeElement;

    const onKey = (event) => {
      if (modalStack[modalStack.length - 1] !== token) return;
      if (event.key === "Escape") {
        event.preventDefault();
        closeRef.current?.();
        return;
      }
      if (event.key !== "Tab") return;
      const nodes = panelRef.current?.querySelectorAll(
        'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
      );
      if (!nodes || !nodes.length) return;
      const list = Array.from(nodes).filter((el) => el.offsetParent !== null);
      if (!list.length) return;
      const first = list[0];
      const last = list[list.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const timer = setTimeout(() => {
      const target =
        panelRef.current?.querySelector("[data-autofocus]") ||
        panelRef.current?.querySelector("input, select, textarea, button");
      target?.focus();
    }, 40);

    return () => {
      clearTimeout(timer);
      document.removeEventListener("keydown", onKey);
      const idx = modalStack.indexOf(token);
      if (idx >= 0) modalStack.splice(idx, 1);
      if (!modalStack.length) document.body.style.overflow = prevOverflow;
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus?.();
    };
  }, [open]);

  if (!open) return null;

  return createPortal(
    <div
      className="dlg-overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose?.();
      }}
    >
      <div
        ref={panelRef}
        className="dlg-panel"
        style={{ maxWidth: width }}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <header className="dlg-header">
          <div className="dlg-heading">
            {Icon && (
              <span className="dlg-heading-icon">
                <Icon size={18} />
              </span>
            )}
            <div className="dlg-heading-copy">
              <div className="dlg-eyebrow">{eyebrow || "Tyler"}</div>
              <h2 id={titleId} className="dlg-title">{title}</h2>
              {subtitle && <p className="dlg-subtitle">{subtitle}</p>}
            </div>
          </div>
          <button type="button" className="dlg-icon-btn" onClick={onClose} aria-label="Close dialog">
            <X size={18} />
          </button>
        </header>
        <div className="dlg-body">{children}</div>
        {footer && <footer className="dlg-footer">{footer}</footer>}
      </div>
    </div>,
    document.body
  );
}

/* ------------------------------------------------------------------ */
/* Add feed                                                            */
/* ------------------------------------------------------------------ */

export function AddFeedDialog({
  open,
  onClose,
  folders = [],
  existingFeeds = [],
  initialUrl = "",
  onAdded,
  onImportOpml,
}) {
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [folderId, setFolderId] = useState("");
  const [candidates, setCandidates] = useState([]);
  const [discoveryTried, setDiscoveryTried] = useState(false);
  const [busy, setBusy] = useState(null);
  const [selectedFeeds, setSelectedFeeds] = useState(new Map());
  const [starterQuery, setStarterQuery] = useState("");
  const [error, setError] = useState("");
  const urlRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    setUrl(initialUrl || "");
    setTitle("");
    setFolderId("");
    setCandidates([]);
    setDiscoveryTried(false);
    setBusy(null);
    setSelectedFeeds(new Map());
    setStarterQuery("");
    setError("");
    const timer = setTimeout(() => urlRef.current?.focus(), 60);
    return () => clearTimeout(timer);
  }, [open, initialUrl]);

  const normalize = () => {
    const raw = url.trim();
    if (!raw) return "";
    return /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`;
  };

  const closeAndReset = (feed) => {
    setBusy(null);
    setSelectedFeeds(new Map());
    setCandidates([]);
    setDiscoveryTried(false);
    setUrl("");
    setTitle("");
    setFolderId("");
    setError("");
    onAdded?.(feed);
    onClose?.();
  };

  const addFeed = async (feedUrl) => {
    if (busy) return;
    const target = feedUrl || normalize();
    if (!target) {
      setError("Enter a feed or site URL first.");
      urlRef.current?.focus();
      return;
    }
    setBusy("add");
    setError("");
    try {
      const feed = await api.addFeed({
        url: target,
        folderId: folderId === "" ? null : Number(folderId),
        title: title.trim() || null,
      });
      closeAndReset(feed);
    } catch (err) {
      setError(errText(err));
      setBusy(null);
    }
  };

  const toggleFeed = (feed) => {
    setSelectedFeeds((current) => {
      const next = new Map(current);
      if (next.has(feed.url)) next.delete(feed.url);
      else next.set(feed.url, { url: feed.url, title: feed.title || feed.name });
      return next;
    });
  };

  const addSelected = async () => {
    if (busy || selectedFeeds.size === 0) return;
    setBusy("add");
    setError("");
    try {
      const result = await api.addFeeds(Array.from(selectedFeeds.values()).map((feed) => ({
        ...feed, folderId: folderId === "" ? null : Number(folderId),
      })));
      if (result.feeds.length) onAdded?.(result.feeds);
      if (result.failures.length) {
        const addedUrls = new Set(result.feeds.map((feed) => feed.url));
        setSelectedFeeds((current) => new Map(Array.from(current).filter(([url]) => !addedUrls.has(url))));
        setError(result.failures.join("\n"));
      } else {
        setSelectedFeeds(new Map());
        onClose?.();
      }
    } catch (err) {
      setError(errText(err));
    } finally {
      setBusy(null);
    }
  };

  const editSelected = () => {
    const feed = selectedFeeds.values().next().value;
    if (!feed) return;
    setUrl(feed.url);
    setTitle(feed.title || "");
    setSelectedFeeds(new Map());
    urlRef.current?.focus();
  };

  const discover = async () => {
    const target = normalize();
    if (!target) {
      setError("Paste a site or feed URL to look for feeds.");
      urlRef.current?.focus();
      return;
    }
    setBusy("discover");
    setError("");
    setCandidates([]);
    try {
      const result = await api.discoverFeeds(target);
      const list = result?.candidates ?? result ?? [];
      setCandidates(Array.isArray(list) ? list : []);
      setDiscoveryTried(true);
    } catch (err) {
      setError(errText(err));
      setDiscoveryTried(false);
    } finally {
      setBusy(null);
    }
  };

  const addCandidate = (candidate) => {
    if (busy) return;
    setBusy("add");
    setError("");
    api.addFeed({
      url: candidate.url,
      folderId: folderId === "" ? null : Number(folderId),
      title: title.trim() || candidate.title || null,
    })
      .then((feed) => closeAndReset(feed))
      .catch((err) => {
        setError(errText(err));
        setBusy(null);
      });
  };

  const starterNeedle = starterQuery.trim().toLowerCase();
  const visibleStarters = starterNeedle
    ? FEED_STARTERS.filter((starter) =>
        `${starter.name} ${starter.category} ${hostOf(starter.url)}`
          .toLowerCase()
          .includes(starterNeedle)
      )
    : FEED_STARTERS;
  const starterGroups = STARTER_CATEGORIES.map((category) => ({
    category,
    starters: visibleStarters.filter((starter) => starter.category === category),
  })).filter((group) => group.starters.length > 0);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Add feeds"
      eyebrow="Library"
      subtitle="Paste a URL or select several publications. Stories load in the background."
      icon={Rss}
      width={760}
      footer={
        <>
          <button type="button" className="dlg-btn dlg-btn-ghost" onClick={onClose} disabled={!!busy}>
            Cancel
          </button>
          <div className="dlg-footer-right">
            <button
              type="button"
              className="dlg-btn dlg-btn-subtle"
              onClick={discover}
              disabled={!!busy || !url.trim()}
            >
              {busy === "discover" ? <Spinner /> : <Search size={15} />}
              Find feeds
            </button>
            <button
              type="button"
              className="dlg-btn dlg-btn-primary"
              onClick={() => selectedFeeds.size ? addSelected() : addFeed()}
              disabled={!!busy || (!url.trim() && selectedFeeds.size === 0)}
            >
              {busy === "add" ? <Spinner /> : <Plus size={15} />}
              {selectedFeeds.size ? `Add ${selectedFeeds.size} ${selectedFeeds.size === 1 ? "feed" : "feeds"}` : "Add feed"}
            </button>
          </div>
        </>
      }
    >
      <div className="dlg-stack">
        <Field label="Feed or site URL">
          <div className="dlg-input-wrap">
            <Link2 size={15} className="dlg-input-icon" />
            <input
              ref={urlRef}
              data-autofocus
              className="dlg-input dlg-input-with-icon"
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  if (selectedFeeds.size) addSelected();
                  else if (candidates.length === 1) addCandidate(candidates[0]);
                  else addFeed();
                }
              }}
              placeholder="https://example.com/feed"
              spellCheck={false}
              autoCapitalize="off"
              autoCorrect="off"
            />
          </div>
        </Field>

        <div className="dlg-grid-2">
          <Field label="Title" hint="Optional. Uses the feed's own title by default.">
            <input
              className="dlg-input"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Feed title"
            />
          </Field>
          <Field label="Folder">
            <select
              className="dlg-select"
              value={folderId}
              onChange={(event) => setFolderId(event.target.value)}
            >
              <option value="">Uncategorized</option>
              {folders.map((folder) => (
                <option key={folder.id} value={folder.id}>{folder.name}</option>
              ))}
            </select>
          </Field>
        </div>

        <ErrorNote>{error}</ErrorNote>

        {selectedFeeds.size > 0 && (
          <div className="dlg-selection-bar" role="status">
            <span>{selectedFeeds.size} selected · added to {folders.find((folder) => String(folder.id) === folderId)?.name || "Uncategorized"}</span>
            <div className="dlg-selection-actions">
              {selectedFeeds.size === 1 && <button type="button" className="dlg-btn dlg-btn-ghost dlg-btn-sm" onClick={editSelected} disabled={!!busy}><Pencil size={13} /> Edit details</button>}
              <button type="button" className="dlg-btn dlg-btn-ghost dlg-btn-sm" onClick={() => setSelectedFeeds(new Map())} disabled={!!busy}>Clear selection</button>
            </div>
          </div>
        )}

        {busy === "discover" && (
          <div className="dlg-inline-loading">
            <Spinner />
            <span>Checking the page for feed links…</span>
          </div>
        )}

        {discoveryTried && busy !== "discover" && (
          <section className="dlg-discovery" aria-live="polite">
            <div className="dlg-section-row">
              <h3 className="dlg-section-title">Feeds found</h3>
              <span className="dlg-mono">{candidates.length} candidate{candidates.length === 1 ? "" : "s"}</span>
            </div>
            {candidates.length === 0 ? (
              <div className="dlg-empty dlg-empty-compact">
                <Rss size={20} />
                <p>No feed was advertised on that page. You can still try the URL directly with Add feed.</p>
              </div>
            ) : (
              <div className="dlg-candidates">
                {candidates.map((candidate, index) => (
                  <button
                    type="button"
                    key={`${candidate.url}-${index}`}
                    className="dlg-candidate"
                    onClick={() => toggleFeed(candidate)}
                    disabled={!!busy}
                    aria-pressed={selectedFeeds.has(candidate.url)}
                  >
                    <span className="dlg-candidate-icon"><Rss size={16} /></span>
                    <span className="dlg-candidate-copy">
                      <span className="dlg-candidate-title">{candidate.title || hostOf(candidate.url)}</span>
                      <span className="dlg-candidate-host dlg-mono">{hostOf(candidate.site_url || candidate.url)}</span>
                    </span>
                    <span className="dlg-badge">{candidate.kind || "feed"}</span>
                    {selectedFeeds.has(candidate.url) ? <Check size={15} /> : <Plus size={15} className="dlg-candidate-plus" />}
                  </button>
                ))}
              </div>
            )}
          </section>
        )}

        <section className="dlg-starters" aria-live="polite">
          <div className="dlg-section-row">
            <div className="dlg-starters-heading">
              <h3 className="dlg-section-title">Suggested feeds</h3>
              <span className="dlg-mono">{FEED_STARTERS.length} publications</span>
            </div>
            {onImportOpml && (
              <button
                type="button"
                className="dlg-btn dlg-btn-ghost dlg-btn-sm"
                onClick={onImportOpml}
                disabled={!!busy}
              >
                <Upload size={14} />
                Import OPML
              </button>
            )}
          </div>
          <div className="dlg-input-wrap">
            <Search size={15} className="dlg-input-icon" />
            <input
              className="dlg-input dlg-input-with-icon"
              value={starterQuery}
              onChange={(event) => setStarterQuery(event.target.value)}
              placeholder="Search publications and topics"
              spellCheck={false}
              autoComplete="off"
            />
          </div>
          <div className="dlg-starter-scroll">
            {starterGroups.length === 0 ? (
              <div className="dlg-empty dlg-empty-compact">
                <Rss size={20} />
                <p>No suggested feed matches “{starterQuery.trim()}”. You can still add any URL above.</p>
              </div>
            ) : (
              starterGroups.map((group) => (
                <div key={group.category} className="dlg-starter-group">
                  <h4 className="dlg-starter-group-title">{group.category}</h4>
                  <div className="dlg-starter-grid">
                    {group.starters.map((starter) => {
                      const added = existingFeeds.some((feed) =>
                        sameFeedUrl(feed.url, starter.url)
                      );
                      const selected = selectedFeeds.has(starter.url);
                      return (
                        <button
                          type="button"
                          key={starter.url}
                          className={`dlg-starter${added ? " is-added" : ""}${selected ? " is-selected" : ""}`}
                          onClick={() => toggleFeed(starter)}
                          disabled={!!busy || added}
                          aria-pressed={selected}
                          title={
                            added
                              ? `${starter.name} is already in your library`
                              : `${selected ? "Deselect" : "Select"} ${starter.name}`
                          }
                        >
                          <span className="dlg-starter-glyph" aria-hidden="true">
                            {added || selected ? (
                              <Check size={12} />
                            ) : (
                              starter.name.charAt(0)
                            )}
                          </span>
                          <span className="dlg-starter-copy">
                            <span className="dlg-starter-name">{starter.name}</span>
                            <span className="dlg-starter-host dlg-mono">
                              {hostOf(starter.url)}
                            </span>
                          </span>
                          <span className="dlg-starter-action" aria-hidden="true">
                            {added ? "Added" : selected ? <Check size={13} /> : <Plus size={13} />}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))
            )}
          </div>
        </section>

        <p className="dlg-footnote">
          Enter adds the URL directly; Tyler discovers feed links if the address is a web page.
        </p>
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/* Manage feeds                                                        */
/* ------------------------------------------------------------------ */

export function FolderDialog({ open, onClose, folder, action, feedCount = 0, onChanged }) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const deleting = action === "delete";

  useEffect(() => {
    if (!open) return;
    setName(folder?.name || "");
    setError("");
    setBusy(false);
  }, [open, folder?.id, action]);

  const close = () => {
    if (!busy) onClose();
  };

  const submit = async (event) => {
    event.preventDefault();
    if (busy || !folder || (!deleting && !name.trim())) return;
    setBusy(true);
    setError("");
    try {
      if (deleting) await api.deleteFolder(folder.id);
      else await api.renameFolder(folder.id, name.trim());
      await onChanged?.();
      onClose();
    } catch (err) {
      setError(errText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={close}
      title={deleting ? "Delete folder?" : "Rename folder"}
      subtitle={folder?.name}
      eyebrow="Library"
      icon={deleting ? Trash2 : Folder}
      width={440}
    >
      <form onSubmit={submit}>
        {deleting ? (
          <p className="dlg-hint">
            {feedCount} {feedCount === 1 ? "feed will" : "feeds will"} move to Uncategorized.
            {" "}Your feeds and saved articles will be kept.
          </p>
        ) : (
          <Field label="Folder name">
            <input
              className="dlg-input"
              value={name}
              onChange={(event) => setName(event.target.value)}
              data-autofocus
              disabled={busy}
            />
          </Field>
        )}
        <ErrorNote>{error}</ErrorNote>
        <div className="dlg-confirm-actions">
          <button
            type="button"
            className="dlg-btn dlg-btn-ghost"
            onClick={close}
            disabled={busy}
            data-autofocus={deleting ? true : undefined}
          >
            Cancel
          </button>
          <button
            type="submit"
            className={`dlg-btn ${deleting ? "dlg-btn-danger" : "dlg-btn-primary"}`}
            disabled={busy || (!deleting && !name.trim())}
          >
            {busy && <Spinner />}
            {deleting ? "Delete folder" : "Save"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

export function ManageFeedsDialog({ open, onClose, feeds = [], folders = [], onChanged, onAddFeed }) {
  const [query, setQuery] = useState("");
  const [menuId, setMenuId] = useState(null);
  const [editing, setEditing] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [refreshing, setRefreshing] = useState({});
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState("");
  const [rowErrors, setRowErrors] = useState({});
  const [foldersOpen, setFoldersOpen] = useState(false);
  const [newFolder, setNewFolder] = useState("");
  const [folderBusy, setFolderBusy] = useState(null);
  const [folderAction, setFolderAction] = useState(null);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setMenuId(null);
    setEditing(null);
    setConfirmDelete(null);
    setRefreshing({});
    setBusy(null);
    setError("");
    setRowErrors({});
    setFoldersOpen(false);
    setNewFolder("");
    setFolderBusy(null);
    setFolderAction(null);
  }, [open]);

  useEffect(() => {
    if (menuId == null) return undefined;
    const close = (event) => {
      if (!event.target.closest?.("[data-feed-menu]")) setMenuId(null);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [menuId]);

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = (feeds || []).filter((feed) => {
      if (!q) return true;
      return [feed.title, feed.url, feed.folder_name || "Uncategorized"]
        .some((value) => String(value || "").toLowerCase().includes(q));
    });
    const buckets = new Map();
    for (const feed of filtered) {
      const key = feed.folder_id == null ? null : feed.folder_id;
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(feed);
    }
    const result = [];
    const orderedFolders = [...(folders || [])].sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
    for (const folder of orderedFolders) {
      if (buckets.has(folder.id)) {
        result.push({ key: `folder-${folder.id}`, name: folder.name, feeds: buckets.get(folder.id) });
        buckets.delete(folder.id);
      }
    }
    for (const [key, items] of buckets) {
      if (key === null) continue;
      result.push({ key: `folder-${key}`, name: items[0]?.folder_name || "Folder", feeds: items });
      buckets.delete(key);
    }
    if (buckets.has(null)) {
      result.push({ key: "uncategorized", name: "Uncategorized", feeds: buckets.get(null) });
    }
    return result;
  }, [feeds, folders, query]);

  const openEdit = (feed) => {
    setMenuId(null);
    setConfirmDelete(null);
    setError("");
    setEditing({
      id: feed.id,
      title: feed.title || "",
      url: feed.url || "",
      folderId: feed.folder_id == null ? "" : String(feed.folder_id),
      fetchInterval: String(feed.fetch_interval || 60),
      isActive: feed.is_active !== false,
    });
  };

  const saveEdit = async () => {
    if (!editing) return;
    if (!editing.title.trim()) {
      setError("A feed title cannot be empty.");
      return;
    }
    setBusy("edit");
    setError("");
    try {
      await api.updateFeed({
        id: editing.id,
        title: editing.title.trim(),
        url: editing.url.trim(),
        folderId: editing.folderId === "" ? null : Number(editing.folderId),
        fetchInterval: Number(editing.fetchInterval),
        isActive: editing.isActive,
      });
      setEditing(null);
      onChanged?.();
    } catch (err) {
      setError(errText(err));
    } finally {
      setBusy(null);
    }
  };

  const refreshFeed = async (feed) => {
    setMenuId(null);
    setRefreshing((prev) => ({ ...prev, [feed.id]: true }));
    setRowErrors((prev) => ({ ...prev, [feed.id]: "" }));
    try {
      const result = await api.refresh(feed.id);
      if (result?.failed) {
        setRowErrors((prev) => ({
          ...prev,
          [feed.id]: result.failures?.[0] || "The feed could not be refreshed.",
        }));
      }
      onChanged?.();
    } catch (err) {
      setRowErrors((prev) => ({ ...prev, [feed.id]: errText(err) }));
    } finally {
      setRefreshing((prev) => {
        const next = { ...prev };
        delete next[feed.id];
        return next;
      });
    }
  };

  const deleteFeed = async (feed) => {
    setBusy(`delete-${feed.id}`);
    setError("");
    try {
      await api.deleteFeed(feed.id);
      if (editing?.id === feed.id) setEditing(null);
      setConfirmDelete(null);
      onChanged?.();
    } catch (err) {
      setError(errText(err));
    } finally {
      setBusy(null);
    }
  };

  const createFolder = async () => {
    const name = newFolder.trim();
    if (!name) return;
    setFolderBusy("create");
    setError("");
    try {
      await api.createFolder(name);
      setNewFolder("");
      onChanged?.();
    } catch (err) {
      setError(errText(err));
    } finally {
      setFolderBusy(null);
    }
  };

  const folderFeedCount = (id) => feeds.filter((feed) => feed.folder_id === id).length;

  const removeFolder = async (folder) => {
    if (folderBusy) return;
    if (folderFeedCount(folder.id) > 0) {
      setFolderAction({ folder, action: "delete" });
      return;
    }
    setFolderBusy(`delete-${folder.id}`);
    setError("");
    try {
      await api.deleteFolder(folder.id);
      await onChanged?.();
    } catch (err) {
      setError(errText(err));
    } finally {
      setFolderBusy(null);
    }
  };

  const total = feeds?.length || 0;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Manage feeds"
      eyebrow="Library"
      subtitle={`${total} feed${total === 1 ? "" : "s"} across ${groups.length} folder${groups.length === 1 ? "" : "s"}`}
      icon={Folder}
      width={780}
      footer={
        <>
          <button type="button" className="dlg-btn dlg-btn-ghost" onClick={onClose}>Close</button>
          <button type="button" className="dlg-btn dlg-btn-primary" onClick={() => { onAddFeed?.(); setMenuId(null); }}>
            <Plus size={15} />
            Add feed
          </button>
        </>
      }
    >
      <FolderDialog
        open={open && !!folderAction}
        folder={folderAction?.folder}
        action={folderAction?.action}
        feedCount={folderAction ? folderFeedCount(folderAction.folder.id) : 0}
        onClose={() => setFolderAction(null)}
        onChanged={async () => {
          if (folderAction?.action === "delete" && editing?.folderId === String(folderAction.folder.id)) {
            setEditing((current) => ({ ...current, folderId: "" }));
          }
          await onChanged?.();
        }}
      />
      <div className="dlg-manage">
        <div className="dlg-toolbar">
          <div className="dlg-search">
            <Search size={15} />
            <input
              className="dlg-input dlg-input-search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search feeds"
              aria-label="Search feeds"
            />
          </div>
          <button
            type="button"
            className={`dlg-btn dlg-btn-subtle${foldersOpen ? " is-on" : ""}`}
            onClick={() => setFoldersOpen((value) => !value)}
            aria-expanded={foldersOpen}
          >
            <FolderPlus size={15} />
            Folders
            <ChevronDown size={14} className={foldersOpen ? "dlg-chevron-up" : ""} />
          </button>
        </div>

        <ErrorNote>{error}</ErrorNote>

        {foldersOpen && (
          <section className="dlg-folder-panel">
            <div className="dlg-section-row">
              <h3 className="dlg-section-title">Folders</h3>
              <span className="dlg-mono">{folders.length} total</span>
            </div>

            <div className="dlg-folder-create">
              <input
                className="dlg-input"
                value={newFolder}
                onChange={(event) => setNewFolder(event.target.value)}
                onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); createFolder(); } }}
                placeholder="New folder name"
              />
              <button
                type="button"
                className="dlg-btn dlg-btn-secondary"
                onClick={createFolder}
                disabled={!newFolder.trim() || !!folderBusy}
              >
                {folderBusy === "create" ? <Spinner /> : <Plus size={15} />}
                Create
              </button>
            </div>

            {folders.length === 0 ? (
              <p className="dlg-footnote">No folders yet. Feeds stay in Uncategorized until you make one.</p>
            ) : (
              <div className="dlg-folder-list">
                {[...folders].sort((a, b) => (a.position ?? 0) - (b.position ?? 0)).map((folder) => (
                  <div className="dlg-folder-row" key={folder.id}>
                    <Folder size={15} className="dlg-folder-icon" />
                    <span className="dlg-folder-name">{folder.name}</span>
                    <span className="dlg-mono dlg-folder-count">{folderFeedCount(folder.id)} feeds</span>
                    <button
                      type="button"
                      className="dlg-icon-btn dlg-icon-btn-sm"
                      aria-label={`Rename ${folder.name}`}
                      disabled={!!folderBusy}
                      onClick={() => setFolderAction({ folder, action: "rename" })}
                    >
                      <Pencil size={14} />
                    </button>
                    <button
                      type="button"
                      className="dlg-icon-btn dlg-icon-btn-sm dlg-icon-danger"
                      aria-label={`Delete ${folder.name}`}
                      disabled={!!folderBusy}
                      onClick={() => removeFolder(folder)}
                    >
                      {folderBusy === `delete-${folder.id}` ? <Spinner /> : <Trash2 size={14} />}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </section>
        )}

        {groups.length === 0 ? (
          <div className="dlg-empty">
            <Rss size={24} />
            <p>{query.trim() ? "No feeds match that search." : "No feeds yet. Add one to start reading."}</p>
            {!query.trim() && (
              <button type="button" className="dlg-btn dlg-btn-primary dlg-btn-sm" onClick={() => onAddFeed?.()}>
                <Plus size={14} /> Add feed
              </button>
            )}
          </div>
        ) : (
          groups.map((group) => (
            <section className="dlg-feed-group" key={group.key}>
              <div className="dlg-group-head">
                <span className="dlg-group-name">{group.name}</span>
                <span className="dlg-group-rule" />
                <span className="dlg-mono">{group.feeds.length}</span>
              </div>
              <div className="dlg-feed-list">
                {group.feeds.map((feed) => {
                  const isEditing = editing?.id === feed.id;
                  return (
                    <div className={`dlg-feed-item${isEditing ? " is-editing" : ""}`} key={feed.id}>
                      <div className="dlg-feed-row">
                        <span className="dlg-feed-avatar">
                          <span className="dlg-feed-initial">{(feed.title || "?").trim().charAt(0).toUpperCase()}</span>
                          {feed.icon_url && (
                            <img
                              src={feed.icon_url}
                              alt=""
                              onError={(event) => { event.currentTarget.remove(); }}
                            />
                          )}
                        </span>
                        <div className="dlg-feed-copy">
                          <span className="dlg-feed-title">{feed.title || hostOf(feed.url)}</span>
                          <span className="dlg-feed-host dlg-mono">{hostOf(feed.url)}</span>
                        </div>
                        {feed.unread_count > 0 && <span className="dlg-unread-pill">{feed.unread_count}</span>}
                        <span
                          className={`dlg-status dlg-status-${feed.last_status || "never"}`}
                          title={
                            feed.last_status === "error"
                              ? feed.error || "Last refresh failed"
                              : feed.last_status === "ok"
                                ? "Last refresh succeeded"
                                : ["pending", "fetching"].includes(feed.last_status) ? "Loading feed in the background" : "Not refreshed yet"
                          }
                        />
                        {refreshing[feed.id] && <Spinner />}
                        <div className="dlg-feed-menu-wrap" data-feed-menu>
                          <button
                            type="button"
                            className="dlg-icon-btn dlg-icon-btn-sm"
                            aria-label={`Actions for ${feed.title}`}
                            aria-expanded={menuId === feed.id}
                            onClick={() => setMenuId(menuId === feed.id ? null : feed.id)}
                          >
                            <MoreHorizontal size={17} />
                          </button>
                          {menuId === feed.id && (
                            <div className="dlg-menu" role="menu">
                              <button type="button" role="menuitem" onClick={() => openEdit(feed)}>
                                <Pencil size={14} /> Edit
                              </button>
                              <button type="button" role="menuitem" onClick={() => refreshFeed(feed)} disabled={["pending", "fetching"].includes(feed.last_status)}>
                                <RefreshCw size={14} /> Refresh now
                              </button>
                              <span className="dlg-menu-rule" />
                              <button
                                type="button"
                                role="menuitem"
                                className="dlg-menu-danger"
                                onClick={() => {
                                  setMenuId(null);
                                  setEditing(null);
                                  setConfirmDelete(feed);
                                }}
                              >
                                <Trash2 size={14} /> Delete
                              </button>
                            </div>
                          )}
                        </div>
                      </div>

                      {(rowErrors[feed.id] || feed.error) && (
                        <div className="dlg-row-error" role="alert"><AlertCircle size={13} /> {rowErrors[feed.id] || feed.error}</div>
                      )}

                      {isEditing && (
                        <div className="dlg-edit-panel">
                          <div className="dlg-grid-2">
                            <Field label="Title">
                              <input
                                className="dlg-input"
                                value={editing.title}
                                onChange={(event) => setEditing({ ...editing, title: event.target.value })}
                              />
                            </Field>
                            <Field label="Folder">
                              <select
                                className="dlg-select"
                                value={editing.folderId}
                                onChange={(event) => setEditing({ ...editing, folderId: event.target.value })}
                              >
                                <option value="">Uncategorized</option>
                                {folders.map((folder) => (
                                  <option key={folder.id} value={folder.id}>{folder.name}</option>
                                ))}
                              </select>
                            </Field>
                          </div>
                          <Field label="Feed URL" hint="Changing the URL keeps saved articles, reading state, stars, and tags. Tyler loads the new address in the background.">
                            <input
                              className="dlg-input"
                              value={editing.url}
                              onChange={(event) => setEditing({ ...editing, url: event.target.value })}
                              disabled={feed.last_status === "fetching"}
                              spellCheck={false}
                              autoCapitalize="off"
                              autoCorrect="off"
                            />
                          </Field>
                          <div className="dlg-grid-2 dlg-align-end">
                            <Field label="Fetch interval" hint="Used for automatic refresh. Manual refresh checks immediately.">
                              <select
                                className="dlg-select"
                                value={editing.fetchInterval}
                                onChange={(event) => setEditing({ ...editing, fetchInterval: event.target.value })}
                              >
                                {INTERVALS.map(([value, label]) => (
                                  <option key={value} value={value}>{label}</option>
                                ))}
                              </select>
                            </Field>
                            <Toggle
                              label="Feed is active"
                              description="Inactive feeds are skipped by refresh."
                              checked={editing.isActive}
                              onChange={(value) => setEditing({ ...editing, isActive: value })}
                            />
                          </div>
                          <div className="dlg-edit-actions">
                            <button type="button" className="dlg-btn dlg-btn-ghost dlg-btn-sm" onClick={() => setEditing(null)}>
                              Cancel
                            </button>
                            <button type="button" className="dlg-btn dlg-btn-primary dlg-btn-sm" onClick={saveEdit} disabled={busy === "edit" || !editing.url.trim()}>
                              {busy === "edit" ? <Spinner /> : <Check size={14} />}
                              Save changes
                            </button>
                          </div>
                        </div>
                      )}

                      {confirmDelete?.id === feed.id && (
                        <div className="dlg-delete-panel">
                          <span className="dlg-delete-copy">
                            Delete “{confirmDelete.title}” and all of its saved articles? This cannot be undone.
                          </span>
                          <div className="dlg-delete-actions">
                            <button type="button" className="dlg-btn dlg-btn-sm dlg-btn-ghost" onClick={() => setConfirmDelete(null)}>
                              Keep feed
                            </button>
                            <button
                              type="button"
                              className="dlg-btn dlg-btn-sm dlg-btn-danger"
                              onClick={() => deleteFeed(confirmDelete)}
                              disabled={busy === `delete-${feed.id}`}
                            >
                              {busy === `delete-${feed.id}` ? <Spinner /> : <Trash2 size={14} />}
                              Delete feed
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
          ))
        )}
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/* Settings                                                            */
/* ------------------------------------------------------------------ */

const SECTIONS = [
  { id: "appearance", label: "Appearance", icon: Palette },
  { id: "reading", label: "Reading", icon: BookOpen },
  { id: "tts", label: "Read aloud", icon: Volume2 },
  { id: "llm", label: "LLM summaries", icon: Sparkles },
  { id: "feeds", label: "Feeds & storage", icon: Database },
  { id: "about", label: "About", icon: Info },
];

function Segmented({ value, options, onChange, label }) {
  return (
    <div className="dlg-segmented" role="group" aria-label={label}>
      {options.map((option) => (
        <button
          type="button"
          key={option.value}
          className={`dlg-seg-btn${value === option.value ? " is-active" : ""}`}
          onClick={() => onChange(option.value)}
          aria-pressed={value === option.value}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function RangeRow({ label, value, min, max, step = 1, suffix = "", onChange }) {
  const pct = ((Number(value) - min) / (max - min)) * 100;
  return (
    <div className="dlg-range-row">
      <div className="dlg-range-head">
        <span className="dlg-toggle-label">{label}</span>
        <span className="dlg-mono dlg-range-value">{value}{suffix}</span>
      </div>
      <input
        type="range"
        className="dlg-range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        style={{ "--dlg-range-fill": `${Math.max(0, Math.min(100, pct))}%` }}
        aria-label={label}
      />
      <div className="dlg-range-scale dlg-mono">
        <span>{min}{suffix}</span>
        <span>{max}{suffix}</span>
      </div>
    </div>
  );
}

function ThemePreview({ variant }) {
  return (
    <span className={`dlg-theme-preview is-${variant}`} aria-hidden="true">
      <span className="dlg-preview-bar">
        <span className="dlg-preview-dot" />
        <span className="dlg-preview-line is-short" />
      </span>
      <span className="dlg-preview-body">
        <span className="dlg-preview-line" />
        <span className="dlg-preview-line is-mid" />
        <span className="dlg-preview-line is-faint" />
      </span>
    </span>
  );
}

function LlmSettingsForm({ settings, onSave }) {
  const [draft, setDraft] = useState({
    llm_enabled: !!settings.llm_enabled,
    llm_base_url: settings.llm_base_url || "",
    llm_api_key: settings.llm_api_key || "",
    llm_model: settings.llm_model || "",
    llm_prompt: settings.llm_prompt || "",
    llm_max_input_words: settings.llm_max_input_words || "",
    llm_max_output_words: settings.llm_max_output_words || "",
  });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const update = (key, value) => {
    setDraft((current) => ({ ...current, [key]: value }));
    setSaved(false);
  };
  const submit = async (event) => {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    setError("");
    try {
      await onSave({
        ...draft,
        llm_max_input_words: Number(draft.llm_max_input_words) || 0,
        llm_max_output_words: Number(draft.llm_max_output_words) || 0,
      });
      setSaved(true);
    } catch (err) {
      setError(errText(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} className="dlg-stack">
      <header className="dlg-section-head">
        <h3 className="dlg-settings-title">LLM summaries</h3>
        <p className="dlg-settings-lede">Use your own OpenAI compatible endpoint. Article text is sent only when you choose Summarize in the reader.</p>
      </header>
      <fieldset className="dlg-llm-fields dlg-stack" disabled={saving}>
        <Toggle label="Enable LLM summaries" checked={draft.llm_enabled}
          description="Optional. Use Summarize in the reader to get started."
          onChange={(value) => update("llm_enabled", value)} />
        <Field label="Base URL" hint="API base URL, including /v1 if required. Tyler appends /chat/completions.">
          <input className="dlg-input" type="url" placeholder="https://your-provider.example/v1"
            required={draft.llm_enabled} value={draft.llm_base_url}
            onChange={(event) => update("llm_base_url", event.target.value)} />
        </Field>
        <Field label="API key" hint="Saved locally with your settings and included in exported backups.">
          <input className="dlg-input" type="password" autoComplete="off" spellCheck={false}
            required={draft.llm_enabled} value={draft.llm_api_key}
            onChange={(event) => update("llm_api_key", event.target.value)} />
        </Field>
        <Field label="Model" hint="Enter the exact model ID accepted by your endpoint.">
          <input className="dlg-input" required={draft.llm_enabled} value={draft.llm_model}
            spellCheck={false} onChange={(event) => update("llm_model", event.target.value)} />
        </Field>
        <Field label="Summary prompt" hint="Used for every summary. Edit these instructions to change how articles are summarized.">
          <textarea className="dlg-input dlg-textarea" rows={6} required value={draft.llm_prompt}
            onChange={(event) => update("llm_prompt", event.target.value)} />
        </Field>
        <div className="dlg-grid-2">
          <Field label="Max input words" hint="Article title and text are clipped before sending. Blank or 0 means unlimited.">
            <input className="dlg-input" type="number" min={0} max={4294967295} step={1}
              placeholder="Unlimited" value={draft.llm_max_input_words}
              onChange={(event) => update("llm_max_input_words", event.target.value)} />
          </Field>
          <Field label="Max output words" hint="Token budget = words × 4/3, rounded up. Blank or 0 means no app limit; provider limits still apply.">
            <input className="dlg-input" type="number" min={0} max={4294967295} step={1}
              placeholder="Unlimited" value={draft.llm_max_output_words}
              onChange={(event) => update("llm_max_output_words", event.target.value)} />
          </Field>
        </div>
      </fieldset>
      <ErrorNote>{error}</ErrorNote>
      {saved && <InfoNote tone="success">LLM settings saved.</InfoNote>}
      <div>
        <button type="submit" className="dlg-btn dlg-btn-primary" disabled={saving}>
          {saving ? <Spinner /> : <Check size={14} />} Save LLM settings
        </button>
      </div>
    </form>
  );
}

export function SettingsDialog({ open, onClose, settings = {}, onSave, dataInfo, onOpenDataDir, ttsModel, onRetryTts, initialSection = "appearance" }) {
  const [section, setSection] = useState("appearance");
  const [local, setLocal] = useState(settings || {});
  const [info, setInfo] = useState(dataInfo || null);
  const [error, setError] = useState("");
  const [saveState, setSaveState] = useState(null);
  const [cleanupDays, setCleanupDays] = useState("90");
  const [cleaning, setCleaning] = useState(false);
  const [cleanupMessage, setCleanupMessage] = useState("");
  const timerRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    setSection(initialSection);
    setLocal(settings || {});
    setInfo(dataInfo || null);
    setError("");
    setSaveState(null);
    setCleanupDays(String(settings?.retention_days || 90));
    setCleaning(false);
    setCleanupMessage("");
    return () => clearTimeout(timerRef.current);
    // Reset only when the dialog opens, not when the parent echoes saved settings.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialSection]);

  useEffect(() => {
    if (open && settings) setLocal(settings);
  }, [settings, open]);

  useEffect(() => {
    if (open && dataInfo) setInfo(dataInfo);
  }, [dataInfo, open]);

  const apply = (patch) => {
    setLocal((prev) => ({ ...prev, ...patch }));
    setError("");
    setSaveState("saving");
    Promise.resolve(onSave?.(patch))
      .then(() => {
        setSaveState("saved");
        clearTimeout(timerRef.current);
        timerRef.current = setTimeout(() => setSaveState(null), 1600);
      })
      .catch((err) => {
        setSaveState(null);
        setError(errText(err));
      });
  };

  const refreshInfo = async () => {
    try {
      const next = await api.dataInfo();
      if (next) setInfo(next);
    } catch (err) {
      setError(errText(err));
    }
  };

  const openDataDir = async () => {
    try {
      if (onOpenDataDir) {
        await onOpenDataDir();
      } else {
        await api.openDataDir();
      }
    } catch (err) {
      setError(errText(err));
    }
  };

  const runCleanup = async () => {
    const days = Number(cleanupDays);
    if (!Number.isFinite(days) || days <= 0) return;
    setCleaning(true);
    setCleanupMessage("");
    setError("");
    try {
      const result = await api.cleanupArticles({ olderThanDays: days, keepStarred: true, keepUnread: true });
      const removed = result?.removed ?? 0;
      setCleanupMessage(`Removed ${removed} article${removed === 1 ? "" : "s"}. Starred and unread articles were kept.`);
      refreshInfo();
    } catch (err) {
      setError(errText(err));
    } finally {
      setCleaning(false);
    }
  };

  const theme = local.theme || "system";
  const density = local.density || "comfortable";
  const readerFont = local.reader_font || "serif";
  const dateFormat = local.date_format || "relative";

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Settings"
      eyebrow="Tyler"
      subtitle={section === "llm" ? "Save your endpoint, prompt, and limits below." : "Preferences are saved as you change them."}
      icon={Palette}
      width={800}
      footer={
        <>
          <span className={`dlg-save-state${saveState ? " is-visible" : ""}`}>
            {saveState === "saving" && <><Spinner size={13} /> Saving…</>}
            {saveState === "saved" && <><Check size={14} /> Saved</>}
          </span>
          <button type="button" className="dlg-btn dlg-btn-ghost" onClick={onClose}>Done</button>
        </>
      }
    >
      <div className="dlg-settings">
        <nav className="dlg-nav" aria-label="Settings sections">
          {SECTIONS.map(({ id, label, icon: Icon }) => (
            <button
              type="button"
              key={id}
              className={`dlg-nav-btn${section === id ? " is-active" : ""}`}
              onClick={() => setSection(id)}
              aria-current={section === id ? "page" : undefined}
            >
              <Icon size={16} />
              <span>{label}</span>
            </button>
          ))}
        </nav>

        <div className="dlg-settings-main">
          <ErrorNote>{error}</ErrorNote>

          {section === "tts" && (
            <div className="dlg-stack dlg-stack-lg">
              <header className="dlg-section-head">
                <h3 className="dlg-settings-title">Read aloud</h3>
                <p className="dlg-settings-lede">Listen to articles privately on your device with Kokoro.</p>
              </header>
              <InfoNote>
                Enabling downloads the Kokoro ONNX model once (about 92 MB, plus a small voice file).
                It is saved locally and reused, including offline. The “82M” in its name refers to
                82 million parameters. Article text stays on your device.
              </InfoNote>
              <Toggle label="Enable text to speech"
                description="Download only when enabled. Use the play, pause, and stop controls beside the command palette."
                checked={!!local.tts_enabled} onChange={(value) => apply({ tts_enabled: value })} />
              {local.tts_enabled && ttsModel?.message && (
                <div role="status">
                  {ttsModel.status === "error" ? <ErrorNote>{ttsModel.message}</ErrorNote> : <InfoNote>{ttsModel.message}</InfoNote>}
                  {ttsModel.status === "error" && <button type="button" className="dlg-btn dlg-btn-ghost" onClick={onRetryTts}>Retry download</button>}
                </div>
              )}
              <Field label="Voice" hint="Official Kokoro English voices. Each voice is downloaded once when selected (about 0.5 MB). Changes apply to the next playback.">
                <select className="dlg-input" value={local.tts_voice || "af_heart"}
                  onChange={(event) => apply({ tts_voice: event.target.value })}>
                  {["American English", "British English"].map((language) => (
                    <optgroup key={language} label={language}>
                      {TTS_VOICES.filter((voice) => voice.language === language).map((voice) => (
                        <option key={voice.id} value={voice.id}>{voice.name} · {voice.gender}</option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              </Field>
              <Toggle label="Keep speaking when switching articles"
                description="Continue the original article as you browse. Turn off to stop when the selected article changes."
                checked={!!local.tts_keep_playing} onChange={(value) => apply({ tts_keep_playing: value })} />
              <p className="dlg-footnote">Reads the title and currently available article text. Load the full article before playing to hear its full text. Disabling stops playback and keeps downloaded files for next time. Playback starts with the first segment and prepares just one segment ahead.</p>
            </div>
          )}

          {section === "llm" && <LlmSettingsForm settings={local} onSave={onSave} />}

          {section === "appearance" && (
            <div className="dlg-stack dlg-stack-lg">
              <header className="dlg-section-head">
                <h3 className="dlg-settings-title">Appearance</h3>
                <p className="dlg-settings-lede">Tyler follows your system theme by default.</p>
              </header>

              <div>
                <span className="dlg-label">Theme</span>
                <div className="dlg-theme-grid" role="radiogroup" aria-label="Theme">
                  {[
                    { value: "system", label: "System", icon: Monitor, preview: "system" },
                    { value: "light", label: "Light", icon: Sun, preview: "light" },
                    { value: "dark", label: "Dark", icon: Moon, preview: "dark" },
                  ].map(({ value, label, icon: Icon, preview }) => (
                    <button
                      type="button"
                      key={value}
                      role="radio"
                      aria-checked={theme === value}
                      className={`dlg-theme-card${theme === value ? " is-active" : ""}`}
                      onClick={() => apply({ theme: value })}
                    >
                      <ThemePreview variant={preview} />
                      <span className="dlg-theme-label">
                        <Icon size={14} />
                        {label}
                        {theme === value && <Check size={14} className="dlg-theme-check" />}
                      </span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="dlg-divider" />

              <Toggle
                label="Reduce motion"
                description="Removes panel transitions and chart animation."
                checked={!!local.reduce_motion}
                onChange={(value) => apply({ reduce_motion: value })}
              />
            </div>
          )}

          {section === "reading" && (
            <div className="dlg-stack dlg-stack-lg">
              <header className="dlg-section-head">
                <h3 className="dlg-settings-title">Reading</h3>
                <p className="dlg-settings-lede">Set how articles set in the reader.</p>
              </header>

              <div>
                <span className="dlg-label">Reader typeface</span>
                <Segmented
                  label="Reader typeface"
                  value={readerFont}
                  onChange={(value) => apply({ reader_font: value })}
                  options={[{ value: "serif", label: "Newsreader (serif)" }, { value: "sans", label: "Inter (sans)" }]}
                />
              </div>

              <RangeRow
                label="Font size"
                value={local.font_size ?? 17}
                min={14}
                max={24}
                suffix=" px"
                onChange={(value) => apply({ font_size: value })}
              />
              <RangeRow
                label="Article list width"
                value={local.article_list_width ?? 460}
                min={280}
                max={600}
                step={10}
                suffix=" px"
                onChange={(value) => apply({ article_list_width: value })}
              />
              <RangeRow
                label="Line width"
                value={local.line_width ?? 680}
                min={520}
                max={920}
                step={10}
                suffix=" px"
                onChange={(value) => apply({ line_width: value })}
              />

              <div className="dlg-grid-2">
                <div>
                  <span className="dlg-label">Density</span>
                  <Segmented
                    label="Density"
                    value={density}
                    onChange={(value) => apply({ density: value })}
                    options={[{ value: "comfortable", label: "Comfortable" }, { value: "compact", label: "Compact" }]}
                  />
                </div>
                <div>
                  <span className="dlg-label">Dates</span>
                  <Segmented
                    label="Date format"
                    value={dateFormat}
                    onChange={(value) => apply({ date_format: value })}
                    options={[{ value: "relative", label: "Relative" }, { value: "absolute", label: "Absolute" }]}
                  />
                </div>
              </div>

              <div className="dlg-divider" />

              <Toggle
                label="Show summaries"
                description="Preview the opening of each article in the list."
                checked={local.show_summaries !== false}
                onChange={(value) => apply({ show_summaries: value })}
              />
              <Toggle label="Open links in Tyler"
                description="Open original articles and article links in a separate Tyler window."
                checked={!!local.open_links_in_app} onChange={(value) => apply({ open_links_in_app: value })} />
              <Toggle
                label="Load full article by default"
                description="Automatically fetch and save the full text when you open any article. Off by default; load individual articles on demand."
                checked={!!local.load_full_article_by_default}
                onChange={(value) => apply({ load_full_article_by_default: value })}
              />
              <Toggle
                label="Mark read on open"
                description="Opening an article marks it as read."
                checked={local.mark_read_on_open !== false}
                onChange={(value) => apply({ mark_read_on_open: value })}
              />
            </div>
          )}

          {section === "feeds" && (
            <div className="dlg-stack dlg-stack-lg">
              <header className="dlg-section-head">
                <h3 className="dlg-settings-title">Feeds & storage</h3>
                <p className="dlg-settings-lede">Refresh cadence, retention, and the local data folder.</p>
              </header>

              <Toggle label="Unread badge"
                description="Show the unread count on the Dock or supported taskbar."
                checked={local.unread_badge !== false} onChange={(value) => apply({ unread_badge: value })} />
              <Toggle label="New article notifications"
                description="Notify when a refresh finds new articles. Tyler stays in the tray when its reader window is closed."
                checked={!!local.notifications_enabled} onChange={async (value) => {
                  try {
                    if (value) {
                      const { isPermissionGranted, requestPermission } = await import("@tauri-apps/plugin-notification");
                      const granted = await isPermissionGranted() || await requestPermission() === "granted";
                      if (!granted) { setError("Notifications are disabled in system settings."); return; }
                    }
                    apply({ notifications_enabled: value });
                  } catch (error) { setError(errText(error)); }
                }} />
              <div className="dlg-grid-2">
                <Field label="Auto-refresh" hint="Check for due feeds at least this often. Shorter feed intervals are checked sooner. Manual only disables periodic checks.">
                  <select
                    className="dlg-select"
                    value={local.refresh_minutes ?? 30}
                    onChange={(event) => apply({ refresh_minutes: Number(event.target.value) })}
                  >
                    <option value={0}>Manual only</option>
                    <option value={15}>Every 15 minutes</option>
                    <option value={30}>Every 30 minutes</option>
                    <option value={60}>Every hour</option>
                    <option value={180}>Every 3 hours</option>
                  </select>
                </Field>
                <Field label="Keep articles" hint="Starred and unread articles are never removed automatically.">
                  <select
                    className="dlg-select"
                    value={local.retention_days ?? 0}
                    onChange={(event) => {
                      const value = Number(event.target.value);
                      apply({ retention_days: value });
                      if (value > 0) setCleanupDays(String(value));
                    }}
                  >
                    <option value={0}>Forever</option>
                    <option value={30}>30 days</option>
                    <option value={90}>90 days</option>
                    <option value={180}>180 days</option>
                    <option value={365}>1 year</option>
                  </select>
                </Field>
              </div>

              <div>
                <RangeRow
                  label="Feed download limit"
                  value={local.feed_download_limit_mb ?? 20}
                  min={1}
                  max={100}
                  suffix=" MiB"
                  onChange={(value) => apply({ feed_download_limit_mb: value })}
                />
                <p className="dlg-hint">Maximum size per feed, discovery page, or OPML link after decompression. Default: 20 MiB. Downloads that exceed this limit stop with an error; raise it here and retry if needed. Higher limits use more memory.</p>
              </div>

              <div className="dlg-callout">
                <div className="dlg-callout-copy">
                  <span className="dlg-callout-title">Cleanup runs in the backend</span>
                  <p className="dlg-hint">
                    {local.retention_days > 0
                      ? `Articles older than ${local.retention_days} days are removed after each refresh. Starred and unread articles stay.`
                      : "Automatic cleanup is off. Run a manual cleanup with the window below."}
                  </p>
                </div>
                <div className="dlg-cleanup-row">
                  <select
                    className="dlg-select dlg-select-sm"
                    value={cleanupDays}
                    onChange={(event) => setCleanupDays(event.target.value)}
                    aria-label="Cleanup window"
                  >
                    <option value="30">Older than 30 days</option>
                    <option value="90">Older than 90 days</option>
                    <option value="180">Older than 180 days</option>
                    <option value="365">Older than 1 year</option>
                  </select>
                  <button
                    type="button"
                    className="dlg-btn dlg-btn-secondary dlg-btn-sm"
                    onClick={runCleanup}
                    disabled={cleaning}
                  >
                    {cleaning ? <Spinner /> : <Trash2 size={14} />}
                    Clean up now
                  </button>
                </div>
                {cleanupMessage && <InfoNote tone="success">{cleanupMessage}</InfoNote>}
              </div>

              <div className="dlg-divider" />

              <div>
                <div className="dlg-section-row">
                  <span className="dlg-label">Data folder</span>
                  <button type="button" className="dlg-btn dlg-btn-sm dlg-btn-subtle" onClick={refreshInfo}>
                    <RefreshCw size={13} /> Refresh
                  </button>
                </div>
                <div className="dlg-path-row">
                  <code className="dlg-path dlg-mono">{info?.dataDir || dataInfo?.dataDir || "Not available"}</code>
                  <button type="button" className="dlg-btn dlg-btn-secondary dlg-btn-sm" onClick={openDataDir}>
                    <ExternalLink size={14} /> Open
                  </button>
                </div>

                <div className="dlg-data-grid">
                  <div className="dlg-data-cell">
                    <span className="dlg-data-label">Database</span>
                    <span className="dlg-data-value">{formatBytes(info?.dbBytes)}</span>
                  </div>
                  <div className="dlg-data-cell">
                    <span className="dlg-data-label">Media</span>
                    <span className="dlg-data-value">{formatBytes(info?.mediaBytes)}</span>
                    <span className="dlg-mono dlg-data-sub">{info?.mediaFiles ?? 0} files</span>
                  </div>
                  <div className="dlg-data-cell">
                    <span className="dlg-data-label">Articles</span>
                    <span className="dlg-data-value">{Number(info?.articles ?? 0).toLocaleString()}</span>
                  </div>
                  <div className="dlg-data-cell">
                    <span className="dlg-data-label">Feeds</span>
                    <span className="dlg-data-value">{Number(info?.feeds ?? 0).toLocaleString()}</span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {section === "about" && (
            <div className="dlg-stack dlg-stack-lg">
              <div className="dlg-about-mark" aria-hidden="true">T<span>✳</span></div>
              <div>
                <h3 className="dlg-about-name">Tyler</h3>
                <p className="dlg-about-version dlg-mono">Version {appVersion}</p>
              </div>
              <p className="dlg-about-copy">
                A local-first RSS reader. Feeds, articles, reading state, and media stay in a SQLite
                database on this machine — no account and no cloud sync.
              </p>
              <div className="dlg-divider" />
              <div className="dlg-about-rows">
                <div><span>Storage</span><span className="dlg-mono">{info?.dataDir || dataInfo?.dataDir || "Local data folder"}</span></div>
                <div><span>License</span><span>MIT License</span></div>
                <div><span>Built with</span><span>Tauri 2 · React 19 · Rust</span></div>
              </div>
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/* Transfer                                                            */
/* ------------------------------------------------------------------ */

const ZIP_FILTER = [{ name: "Tyler backup", extensions: ["zip"] }];
const OPML_FILTER = [{ name: "OPML feed list", extensions: ["opml", "xml"] }];

function firstPath(result) {
  if (!result) return null;
  if (Array.isArray(result)) return result[0] || null;
  return result;
}

export function TransferDialog({ open, onClose, onImported, onChanged }) {
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState("");
  const [backupResult, setBackupResult] = useState(null);
  const [importConfirm, setImportConfirm] = useState(null);
  const [importResult, setImportResult] = useState(null);
  const [opmlExportResult, setOpmlExportResult] = useState(null);
  const [opmlImportResult, setOpmlImportResult] = useState(null);
  const [opmlUrl, setOpmlUrl] = useState("");
  const [info, setInfo] = useState(null);

  useEffect(() => {
    if (!open) return;
    setBusy(null);
    setError("");
    setBackupResult(null);
    setImportConfirm(null);
    setImportResult(null);
    setOpmlExportResult(null);
    setOpmlImportResult(null);
    setOpmlUrl("");
    setInfo(null);
    api.dataInfo().then((next) => setInfo(next)).catch(() => {});
  }, [open]);

  const anyBusy = !!busy;

  const exportBackup = async () => {
    setError("");
    setBackupResult(null);
    try {
      const path = firstPath(await save({
        defaultPath: `tyler-backup-${todayStamp()}.tyler.zip`,
        filters: ZIP_FILTER,
      }));
      if (!path) return;
      setBusy("backup-export");
      const result = await api.exportBackup(path);
      setBackupResult({ path: result?.path || path, bytes: result?.bytes });
      api.dataInfo().then((next) => setInfo(next)).catch(() => {});
    } catch (err) {
      setError(errText(err));
    } finally {
      setBusy(null);
    }
  };

  const chooseImportBackup = async () => {
    setError("");
    setImportResult(null);
    try {
      const path = firstPath(await openDialog({ multiple: false, directory: false, filters: ZIP_FILTER }));
      if (!path) return;
      setImportConfirm(path);
    } catch (err) {
      setError(errText(err));
    }
  };

  const importBackup = async () => {
    if (!importConfirm) return;
    setBusy("backup-import");
    setError("");
    try {
      const bootstrap = await api.importBackup(importConfirm);
      setImportResult({ path: importConfirm });
      setImportConfirm(null);
      onImported?.(bootstrap);
    } catch (err) {
      setError(errText(err));
    } finally {
      setBusy(null);
    }
  };

  const exportOpml = async () => {
    setError("");
    setOpmlExportResult(null);
    try {
      const path = firstPath(await save({
        defaultPath: `tyler-feeds-${todayStamp()}.opml`,
        filters: OPML_FILTER,
      }));
      if (!path) return;
      setBusy("opml-export");
      const result = await api.opmlExport(path);
      setOpmlExportResult({ path, count: result?.count ?? 0 });
    } catch (err) {
      setError(errText(err));
    } finally {
      setBusy(null);
    }
  };

  const importOpml = async () => {
    setError("");
    setOpmlImportResult(null);
    try {
      const path = firstPath(await openDialog({ multiple: false, directory: false, filters: OPML_FILTER }));
      if (!path) return;
      setBusy("opml-import");
      const result = await api.opmlImport(path);
      setOpmlImportResult({
        imported: result?.imported ?? 0,
        skipped: result?.skipped ?? 0,
        failures: Array.isArray(result?.failures) ? result.failures : [],
      });
      onChanged?.();
    } catch (err) {
      setError(errText(err));
    } finally {
      setBusy(null);
    }
  };

  const importOpmlUrl = async () => {
    const target = opmlUrl.trim();
    if (!target) {
      setError("Paste a link to an OPML file first.");
      return;
    }
    setError("");
    setOpmlImportResult(null);
    setBusy("opml-url");
    try {
      const result = await api.opmlImportUrl(target);
      setOpmlImportResult({
        imported: result?.imported ?? 0,
        skipped: result?.skipped ?? 0,
        failures: Array.isArray(result?.failures) ? result.failures : [],
      });
      setOpmlUrl("");
      onChanged?.();
    } catch (err) {
      setError(errText(err));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Backup & transfer"
      eyebrow="Library"
      subtitle="Take your library with you, or bring one in."
      icon={FileArchive}
      width={760}
      footer={
        <>
          <span className="dlg-footnote dlg-footer-note">Backups include the database and cached media.</span>
          <button type="button" className="dlg-btn dlg-btn-ghost" onClick={onClose}>Close</button>
        </>
      }
    >
      <div className="dlg-stack dlg-stack-lg">
        <ErrorNote>{error}</ErrorNote>

        <div className="dlg-transfer-grid">
          <section className="dlg-transfer-card">
            <span className="dlg-transfer-icon"><Download size={18} /></span>
            <h3 className="dlg-card-title">Export backup</h3>
            <p className="dlg-card-copy">A single .tyler.zip with your database and media files. Keep it somewhere safe.</p>
            <div className="dlg-card-actions">
              <button type="button" className="dlg-btn dlg-btn-primary dlg-btn-sm" onClick={exportBackup} disabled={anyBusy}>
                {busy === "backup-export" ? <Spinner /> : <FileArchive size={14} />}
                {busy === "backup-export" ? "Writing backup…" : "Save backup"}
              </button>
            </div>
            {backupResult && (
              <InfoNote tone="success">
                Backup saved · {formatBytes(backupResult.bytes)}<br />
                <span className="dlg-mono dlg-break">{backupResult.path}</span>
              </InfoNote>
            )}
          </section>

          <section className="dlg-transfer-card">
            <span className="dlg-transfer-icon"><Upload size={18} /></span>
            <h3 className="dlg-card-title">Import backup</h3>
            <p className="dlg-card-copy">Restore a .tyler.zip. This replaces your current library after keeping a timestamped copy.</p>
            {!importConfirm && (
              <div className="dlg-card-actions">
                <button type="button" className="dlg-btn dlg-btn-secondary dlg-btn-sm" onClick={chooseImportBackup} disabled={anyBusy}>
                  {busy === "backup-import" ? <Spinner /> : <Upload size={14} />}
                  Choose backup…
                </button>
              </div>
            )}
            {importConfirm && (
              <div className="dlg-confirm-box">
                <div className="dlg-confirm-head"><AlertCircle size={15} /> Replace current library?</div>
                <p className="dlg-hint">
                  All current feeds, articles, tags, and settings will be replaced by the backup. Tyler keeps
                  one timestamped copy of the current data folder before importing.
                </p>
                <p className="dlg-mono dlg-break dlg-hint">{importConfirm}</p>
                <div className="dlg-confirm-actions">
                  <button type="button" className="dlg-btn dlg-btn-sm dlg-btn-ghost" onClick={() => setImportConfirm(null)} disabled={anyBusy}>
                    Cancel
                  </button>
                  <button type="button" className="dlg-btn dlg-btn-sm dlg-btn-danger" onClick={importBackup} disabled={anyBusy}>
                    {busy === "backup-import" ? <Spinner /> : <Upload size={14} />}
                    {busy === "backup-import" ? "Importing…" : "Replace library"}
                  </button>
                </div>
              </div>
            )}
            {importResult && (
              <InfoNote tone="success">
                Library restored. A copy of the previous data was kept next to the data folder.
              </InfoNote>
            )}
          </section>

          <section className="dlg-transfer-card">
            <span className="dlg-transfer-icon"><FileText size={18} /></span>
            <h3 className="dlg-card-title">Export OPML</h3>
            <p className="dlg-card-copy">Feed list only, with folders. Good for moving to another reader.</p>
            <div className="dlg-card-actions">
              <button type="button" className="dlg-btn dlg-btn-secondary dlg-btn-sm" onClick={exportOpml} disabled={anyBusy}>
                {busy === "opml-export" ? <Spinner /> : <FileText size={14} />}
                {busy === "opml-export" ? "Exporting…" : "Save OPML"}
              </button>
            </div>
            {opmlExportResult && (
              <InfoNote tone="success">
                Exported {opmlExportResult.count} feed{opmlExportResult.count === 1 ? "" : "s"}.
              </InfoNote>
            )}
          </section>

          <section className="dlg-transfer-card">
            <span className="dlg-transfer-icon"><FileText size={18} /></span>
            <h3 className="dlg-card-title">Import OPML</h3>
            <p className="dlg-card-copy">Add feeds from an OPML file. Existing feeds are skipped, folders are created as needed.</p>
            <div className="dlg-card-actions">
              <button type="button" className="dlg-btn dlg-btn-secondary dlg-btn-sm" onClick={importOpml} disabled={anyBusy}>
                {busy === "opml-import" ? <Spinner /> : <Upload size={14} />}
                {busy === "opml-import" ? "Importing feeds…" : "Choose OPML…"}
              </button>
            </div>
            <div className="dlg-opml-url">
              <div className="dlg-input-wrap">
                <Link2 size={14} className="dlg-input-icon" />
                <input
                  className="dlg-input dlg-input-with-icon"
                  value={opmlUrl}
                  onChange={(event) => setOpmlUrl(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      importOpmlUrl();
                    }
                  }}
                  placeholder="https://example.com/feeds.opml"
                  spellCheck={false}
                  autoCapitalize="off"
                  autoCorrect="off"
                  disabled={anyBusy}
                />
              </div>
              <button
                type="button"
                className="dlg-btn dlg-btn-secondary dlg-btn-sm"
                onClick={importOpmlUrl}
                disabled={anyBusy || !opmlUrl.trim()}
              >
                {busy === "opml-url" ? <Spinner /> : <Link2 size={14} />}
                {busy === "opml-url" ? "Importing…" : "Import link"}
              </button>
            </div>
            {opmlImportResult && (
              <div className="dlg-opml-result">
                <InfoNote tone={opmlImportResult.failures.length ? "info" : "success"}>
                  {opmlImportResult.imported} imported · {opmlImportResult.skipped} skipped · {opmlImportResult.failures.length} failed
                </InfoNote>
                {opmlImportResult.failures.length > 0 && (
                  <ul className="dlg-failure-list">
                    {opmlImportResult.failures.map((failure, index) => (
                      <li key={index} className="dlg-mono">{failure}</li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </section>
        </div>

        <div className="dlg-divider" />

        <section className="dlg-datainfo">
          <div className="dlg-section-row">
            <h3 className="dlg-section-title">Your data</h3>
            <span className="dlg-mono">{info ? `${info.articles ?? 0} articles · ${info.feeds ?? 0} feeds` : "Reading local storage…"}</span>
          </div>
          <div className="dlg-path-row">
            <code className="dlg-path dlg-mono">{info?.dataDir || "Loading data folder…"}</code>
          </div>
          <div className="dlg-datainfo-sizes">
            <span><Database size={13} /> DB {formatBytes(info?.dbBytes)}</span>
            <span><HardDrive size={13} /> Media {formatBytes(info?.mediaBytes)} · {info?.mediaFiles ?? 0} files</span>
          </div>
        </section>
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/* Stats                                                               */
/* ------------------------------------------------------------------ */

function buildDays(perDay) {
  const counts = new Map();
  for (const entry of perDay || []) {
    if (entry?.date) counts.set(String(entry.date).slice(0, 10), Number(entry.count) || 0);
  }
  const days = [];
  const today = new Date();
  today.setHours(12, 0, 0, 0);
  for (let offset = 13; offset >= 0; offset -= 1) {
    const date = new Date(today);
    date.setDate(today.getDate() - offset);
    const pad = (value) => String(value).padStart(2, "0");
    const key = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
    days.push({
      key,
      count: counts.get(key) || 0,
      dayNum: date.getDate(),
      label: date.toLocaleDateString(undefined, { weekday: "short" }),
      full: date.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" }),
    });
  }
  return days;
}

export function StatsDialog({ open, onClose, onSelectFeed }) {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const next = await api.getStats();
      setStats(next);
    } catch (err) {
      setError(errText(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!open) return;
    setStats(null);
    load();
  }, [open]);

  const days = useMemo(() => buildDays(stats?.perDay), [stats]);
  const maxDay = Math.max(1, ...days.map((day) => day.count));
  const last14 = days.reduce((sum, day) => sum + day.count, 0);

  const rankedFeeds = useMemo(() => {
    const list = [...(stats?.perFeed || [])].sort((a, b) => (b.count || 0) - (a.count || 0)).slice(0, 8);
    const max = Math.max(1, ...list.map((feed) => feed.count || 0));
    return list.map((feed) => ({ ...feed, pct: Math.max(2, ((feed.count || 0) / max) * 100) }));
  }, [stats]);

  const total = stats?.totalArticles ?? 0;
  const read = stats?.read ?? 0;
  const readPct = total > 0 ? Math.round((read / total) * 100) : 0;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Reading stats"
      eyebrow="Library"
      subtitle="What you have collected and where it came from."
      icon={BarChart3}
      width={720}
      footer={<button type="button" className="dlg-btn dlg-btn-ghost" onClick={onClose}>Close</button>}
    >
      {loading ? (
        <div className="dlg-loading-panel">
          <Spinner size={20} />
          <span>Counting your library…</span>
        </div>
      ) : error ? (
        <div className="dlg-stack">
          <ErrorNote>{error}</ErrorNote>
          <div><button type="button" className="dlg-btn dlg-btn-secondary dlg-btn-sm" onClick={load}>Try again</button></div>
        </div>
      ) : (
        <div className="dlg-stack dlg-stack-lg">
          <div className="dlg-kpis">
            {[
              { label: "Articles", value: total },
              { label: "Unread", value: stats?.unread ?? 0 },
              { label: "Starred", value: stats?.starred ?? 0 },
              { label: "Feeds", value: stats?.feeds ?? 0 },
            ].map((kpi) => (
              <div className="dlg-kpi" key={kpi.label}>
                <span className="dlg-kpi-label">{kpi.label}</span>
                <span className="dlg-kpi-value">{Number(kpi.value).toLocaleString()}</span>
              </div>
            ))}
          </div>

          <section className="dlg-stat-section">
            <div className="dlg-section-row">
              <h3 className="dlg-section-title">Last 14 days</h3>
              <span className="dlg-mono">{last14} article{last14 === 1 ? "" : "s"}</span>
            </div>
            {total === 0 ? (
              <div className="dlg-empty dlg-empty-compact">
                <BarChart3 size={20} />
                <p>No article history yet. Stats fill in as feeds refresh.</p>
              </div>
            ) : (
              <div className="dlg-chart" role="img" aria-label={`Articles per day for the last 14 days, ${last14} total`}>
                {days.map((day) => (
                  <div className="dlg-bar-col" key={day.key} title={`${day.full}: ${day.count} article${day.count === 1 ? "" : "s"}`}>
                    <span className="dlg-bar-value dlg-mono">{day.count > 0 ? day.count : ""}</span>
                    <span className="dlg-bar-track">
                      <span
                        className={`dlg-bar${day.count === 0 ? " is-zero" : ""}`}
                        style={{ height: `${Math.max(2, (day.count / maxDay) * 100)}%` }}
                      />
                    </span>
                    <span className="dlg-bar-label dlg-mono">{day.dayNum}</span>
                  </div>
                ))}
              </div>
            )}
            <div className="dlg-read-summary">
              <div className="dlg-read-bar"><span style={{ width: `${readPct}%` }} /></div>
              <span className="dlg-read-copy">
                <strong>{readPct}%</strong> read · {Number(read).toLocaleString()} of {Number(total).toLocaleString()}
                {stats?.oldest ? <span className="dlg-mono dlg-oldest"> · since {String(stats.oldest).slice(0, 10)}</span> : null}
              </span>
            </div>
          </section>

          <section className="dlg-stat-section">
            <div className="dlg-section-row">
              <h3 className="dlg-section-title">Most active feeds</h3>
              <span className="dlg-mono">by article count</span>
            </div>
            {rankedFeeds.length === 0 ? (
              <div className="dlg-empty dlg-empty-compact">
                <Rss size={20} />
                <p>Add a feed to see it ranked here.</p>
              </div>
            ) : (
              <div className="dlg-rank-list">
                {rankedFeeds.map((feed) => (
                  <button
                    type="button"
                    className="dlg-rank-row"
                    key={feed.feed_id}
                    onClick={() => { onSelectFeed?.(feed.feed_id); onClose?.(); }}
                    title={`Open ${feed.title}`}
                  >
                    <span className="dlg-rank-title">{feed.title}</span>
                    <span className="dlg-rank-bar"><span style={{ width: `${feed.pct}%` }} /></span>
                    <span className="dlg-rank-count dlg-mono">{feed.count}</span>
                    {feed.unread > 0 && <span className="dlg-rank-unread">{feed.unread} unread</span>}
                  </button>
                ))}
              </div>
            )}
          </section>
        </div>
      )}
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/* Tags                                                                */
/* ------------------------------------------------------------------ */

function ColorPalette({ value, onPick, label = "Tag color" }) {
  return (
    <div className="dlg-swatches" role="group" aria-label={label}>
      {TAG_COLORS.map((color) => (
        <button
          type="button"
          key={color}
          className={`dlg-swatch${value === color ? " is-active" : ""}`}
          style={{ "--dlg-swatch": color }}
          onClick={() => onPick(color)}
          aria-label={`Use ${color}`}
          aria-pressed={value === color}
        >
          {value === color && <Check size={11} />}
        </button>
      ))}
    </div>
  );
}

export function TagDialog({ open, onClose, tag, action, onChanged }) {
  const [name, setName] = useState("");
  const [color, setColor] = useState(TAG_COLORS[0]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const deleting = action === "delete";

  useEffect(() => {
    if (!open) return;
    setName(tag?.name || "");
    setColor(tag?.color || TAG_COLORS[0]);
    setBusy(false);
    setError("");
  }, [open, tag?.id, action]);

  const close = () => {
    if (!busy) onClose();
  };

  const submit = async (event) => {
    event.preventDefault();
    if (busy || !tag || (!deleting && !name.trim())) return;
    setBusy(true);
    setError("");
    try {
      if (deleting) await api.deleteTag(tag.id);
      else await api.renameTag(tag.id, name.trim(), color);
      await onChanged?.();
      onClose();
    } catch (err) {
      setError(errText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={close}
      title={deleting ? "Delete tag?" : "Edit tag"}
      subtitle={tag?.name}
      eyebrow="Library"
      icon={deleting ? Trash2 : Tags}
      width={440}
    >
      <form onSubmit={submit}>
        {deleting ? (
          <p className="dlg-hint">
            This tag will be removed from {tag?.count ?? 0} {(tag?.count ?? 0) === 1 ? "article" : "articles"}.
            {" "}Your saved articles will be kept.
          </p>
        ) : (
          <div className="dlg-stack">
            <Field label="Tag name">
              <input
                className="dlg-input"
                value={name}
                onChange={(event) => setName(event.target.value)}
                data-autofocus
                disabled={busy}
              />
            </Field>
            <ColorPalette value={color} onPick={(next) => { if (!busy) setColor(next); }} />
          </div>
        )}
        <ErrorNote>{error}</ErrorNote>
        <div className="dlg-confirm-actions">
          <button
            type="button"
            className="dlg-btn dlg-btn-ghost"
            onClick={close}
            disabled={busy}
            data-autofocus={deleting ? true : undefined}
          >
            Cancel
          </button>
          <button
            type="submit"
            className={`dlg-btn ${deleting ? "dlg-btn-danger" : "dlg-btn-primary"}`}
            disabled={busy || (!deleting && !name.trim())}
          >
            {busy && <Spinner />}
            {deleting ? "Delete tag" : "Save"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

export function TagsDialog({ open, onClose, tags = [], onChanged }) {
  const [name, setName] = useState("");
  const [color, setColor] = useState(TAG_COLORS[0]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(null);
  const [renaming, setRenaming] = useState(null);
  const [recolorId, setRecolorId] = useState(null);
  const [deleteTag, setDeleteTag] = useState(null);

  useEffect(() => {
    if (!open) return;
    setName("");
    setColor(TAG_COLORS[0]);
    setError("");
    setBusy(null);
    setRenaming(null);
    setRecolorId(null);
    setDeleteTag(null);
  }, [open]);

  const createTag = async () => {
    if (busy) return;
    const names = parseTagNames(name);
    if (!names.length) {
      setError("Give the tags a name first.");
      return;
    }
    setBusy("create");
    setError("");
    try {
      await api.createTags(names, color);
      setName("");
      await onChanged?.();
    } catch (err) {
      setError(errText(err));
    } finally {
      setBusy(null);
    }
  };

  const saveRename = async () => {
    if (!renaming) return;
    const value = renaming.name.trim();
    if (!value) return;
    setBusy(`rename-${renaming.id}`);
    setError("");
    try {
      await api.renameTag(renaming.id, value);
      setRenaming(null);
      onChanged?.();
    } catch (err) {
      setError(errText(err));
    } finally {
      setBusy(null);
    }
  };

  const recolorTag = async (tag, nextColor) => {
    setBusy(`color-${tag.id}`);
    setError("");
    try {
      await api.renameTag(tag.id, tag.name, nextColor);
      setRecolorId(null);
      onChanged?.();
    } catch (err) {
      setError(errText(err));
    } finally {
      setBusy(null);
    }
  };

  const removeTag = async (tag) => {
    setBusy(`delete-${tag.id}`);
    setError("");
    try {
      await api.deleteTag(tag.id);
      setDeleteTag(null);
      onChanged?.();
    } catch (err) {
      setError(errText(err));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Tags"
      eyebrow="Library"
      subtitle="A second axis for sorting articles across folders."
      icon={Tags}
      width={620}
      footer={<button type="button" className="dlg-btn dlg-btn-ghost" onClick={onClose}>Close</button>}
    >
      <div className="dlg-stack dlg-stack-lg">
        <section className="dlg-tag-create">
          <h3 className="dlg-section-title">New tags</h3>
          <div className="dlg-tag-create-row">
            <input
              className="dlg-input"
              value={name}
              onChange={(event) => setName(event.target.value)}
              onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); createTag(); } }}
              placeholder="work, reading, ideas"
              aria-label="New tag names, separated by commas"
              disabled={!!busy}
              data-autofocus
            />
            <button type="button" className="dlg-btn dlg-btn-primary dlg-btn-sm" onClick={createTag} disabled={!parseTagNames(name).length || !!busy}>
              {busy === "create" ? <Spinner /> : <Plus size={14} />}
              Create
            </button>
          </div>
          <p className="dlg-hint">Separate tag names with commas. Existing tags are reused.</p>
          <ColorPalette value={color} onPick={setColor} label="New tag color" />
        </section>

        <ErrorNote>{error}</ErrorNote>

        <section>
          <div className="dlg-section-row">
            <h3 className="dlg-section-title">Your tags</h3>
            <span className="dlg-mono">{tags.length} total</span>
          </div>

          {tags.length === 0 ? (
            <div className="dlg-empty">
              <Tags size={24} />
              <p>No tags yet. Create one above, then apply it from the reader.</p>
            </div>
          ) : (
            <div className="dlg-tag-list">
              {tags.map((tag) => (
                <div className="dlg-tag-item" key={tag.id}>
                  <div className="dlg-tag-row">
                    <button
                      type="button"
                      className="dlg-tag-dot"
                      style={{ "--dlg-tag-color": tag.color || TAG_COLORS[0] }}
                      onClick={() => setRecolorId(recolorId === tag.id ? null : tag.id)}
                      aria-label={`Change color of ${tag.name}`}
                      title="Change color"
                    />
                    {renaming?.id === tag.id ? (
                      <>
                        <input
                          className="dlg-input dlg-input-sm dlg-tag-rename"
                          value={renaming.name}
                          autoFocus
                          onChange={(event) => setRenaming({ ...renaming, name: event.target.value })}
                          onKeyDown={(event) => {
                            if (event.key === "Enter") { event.preventDefault(); saveRename(); }
                            if (event.key === "Escape") { event.preventDefault(); setRenaming(null); }
                          }}
                        />
                        <button type="button" className="dlg-icon-btn dlg-icon-btn-sm" aria-label="Save tag name" onClick={saveRename} disabled={!!busy}>
                          {busy === `rename-${tag.id}` ? <Spinner /> : <Check size={14} />}
                        </button>
                        <button type="button" className="dlg-icon-btn dlg-icon-btn-sm" aria-label="Cancel rename" onClick={() => setRenaming(null)}>
                          <X size={14} />
                        </button>
                      </>
                    ) : (
                      <>
                        <span className="dlg-tag-name">{tag.name}</span>
                        <span className="dlg-mono dlg-tag-count">{tag.count ?? 0} article{tag.count === 1 ? "" : "s"}</span>
                        <button
                          type="button"
                          className="dlg-icon-btn dlg-icon-btn-sm"
                          aria-label={`Rename ${tag.name}`}
                          onClick={() => { setRenaming({ id: tag.id, name: tag.name }); setRecolorId(null); setDeleteTag(null); }}
                        >
                          <Pencil size={14} />
                        </button>
                        <button
                          type="button"
                          className="dlg-icon-btn dlg-icon-btn-sm dlg-icon-danger"
                          aria-label={`Delete ${tag.name}`}
                          onClick={() => { setDeleteTag(tag); setRecolorId(null); setRenaming(null); }}
                        >
                          <Trash2 size={14} />
                        </button>
                      </>
                    )}
                  </div>

                  {recolorId === tag.id && (
                    <div className="dlg-tag-recolor">
                      <ColorPalette
                        value={tag.color}
                        label={`Color for ${tag.name}`}
                        onPick={(next) => recolorTag(tag, next)}
                      />
                      {busy === `color-${tag.id}` && <Spinner />}
                    </div>
                  )}

                  {deleteTag?.id === tag.id && (
                    <div className="dlg-delete-panel dlg-tag-delete">
                      <span className="dlg-delete-copy">Delete “{tag.name}”? Articles keep their place, but lose this tag.</span>
                      <div className="dlg-delete-actions">
                        <button type="button" className="dlg-btn dlg-btn-sm dlg-btn-ghost" onClick={() => setDeleteTag(null)}>Cancel</button>
                        <button
                          type="button"
                          className="dlg-btn dlg-btn-sm dlg-btn-danger"
                          onClick={() => removeTag(tag)}
                          disabled={busy === `delete-${tag.id}`}
                        >
                          {busy === `delete-${tag.id}` ? <Spinner /> : <Trash2 size={14} />}
                          Delete tag
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>

        <p className="dlg-footnote">Tags are local to this library and travel with backups.</p>
      </div>
    </Modal>
  );
}
