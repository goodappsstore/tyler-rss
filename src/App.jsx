import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Archive,
  Asterisk,
  CircleDot,
  Command,
  Inbox,
  Keyboard,
  Newspaper,
  Play,
  Pause,
  Square,
  Rss,
  Search,
  Star,
  Sun,
  WifiOff,
} from "lucide-react";
import { api, errorMessage, isTauri } from "./api";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { useToast } from "./store";
import Sidebar from "./components/Sidebar";
import TopBar from "./components/TopBar";
import ArticleList from "./components/ArticleList";
import ArticleListPanel from "./components/ArticleListPanel";
import Onboarding from "./components/Onboarding";
import Reader from "./components/Reader";
import CommandPalette from "./components/CommandPalette";
import ShortcutsSheet from "./components/ShortcutsSheet";
import useTts from "./tts/useTts";
import BrandMark from "./components/BrandMark";
import {
  AddFeedDialog,
  ManageFeedsDialog,
  FolderDialog,
  TagDialog,
  SettingsDialog,
  TransferDialog,
  StatsDialog,
  TagsDialog,
} from "./components/dialogs";
import { Button, EmptyState, Kbd } from "./components/ui";

const PAGE_SIZE = 80;

// Used only in memory to keep results attached to their article and LLM configuration.
function summaryRequestKey(article, settings) {
  return JSON.stringify([
    article.id,
    article.title,
    article.content_text || article.summary,
    settings?.llm_enabled,
    settings?.llm_base_url,
    settings?.llm_api_key,
    settings?.llm_model,
    settings?.llm_prompt,
    settings?.llm_max_input_words,
    settings?.llm_max_output_words,
  ]);
}

// Keep already loaded pages when a background refresh brings a new first page.
// New stories are added at the top for newest-first views and at the end for
// the other orders; existing rows keep their place so the open article and the
// user's position in the list do not move.
function mergeRefreshedArticles(current, incoming, sort) {
  const incomingById = new Map(incoming.map((article) => [article.id, article]));
  const currentIds = new Set(current.map((article) => article.id));
  const updated = current.map((article) => incomingById.get(article.id) || article);
  const added = incoming.filter((article) => !currentIds.has(article.id));
  if (added.length === 0) return updated;
  return sort === "newest" ? [...added, ...updated] : [...updated, ...added];
}

const isMac =
  typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

function TitleBar({ onOpenPalette, tts, ttsEnabled, canSpeak }) {
  const active = tts.playback.articleId != null;
  const playLabel = active && !tts.playback.paused
    ? "Pause reading aloud"
    : tts.playback.paused ? "Resume reading aloud" : "Read current article aloud";
  return (
    <header className="titlebar">
      <div className="titlebar-drag" data-tauri-drag-region />
      <div className="titlebar-actions">
        {ttsEnabled && (
          <div className="titlebar-tts" role="group" aria-label="Read aloud">
            <span className="titlebar-tts-status" role="status" title={tts.playback.title || tts.model.message}>
              {tts.playback.articleId != null
                ? `${tts.playback.paused ? "Paused" : tts.playback.status === "loading" ? "Preparing speech" : "Reading"} · ${tts.playback.title}`
                : tts.model.status === "loading" ? tts.model.message : ""}
            </span>
            <button type="button" className="titlebar-command"
              onClick={tts.play} disabled={!canSpeak && !active}
              aria-label={playLabel} title={playLabel}>
              {tts.playback.articleId != null && !tts.playback.paused ? <Pause size={13} /> : <Play size={13} />}
            </button>
            {active && (
              <button type="button" className="titlebar-command" onClick={tts.stop}
                aria-label="Stop reading aloud" title="Stop reading aloud">
                <Square size={12} fill="currentColor" />
              </button>
            )}
          </div>
        )}
        <button
          type="button"
          className="titlebar-command"
          onClick={onOpenPalette}
          title="Open command palette"
        >
          <Command size={12} strokeWidth={2} aria-hidden="true" />
          <span className="titlebar-key">{isMac ? "K" : "Ctrl K"}</span>
        </button>
      </div>
    </header>
  );
}

function Splash() {
  return (
    <div className="splash" role="status" aria-label="Opening Tyler">
      <div className="splash-inner">
        <BrandMark size={52} className="splash-logo" />
        <div className="splash-word">Tyler</div>
        <div className="splash-track" aria-hidden="true">
          <div className="splash-fill" />
        </div>
        <p className="splash-note">Opening your library…</p>
      </div>
    </div>
  );
}

function BootError({ message, onRetry }) {
  return (
    <div className="splash splash-error">
      <div className="splash-inner">
        <div className="splash-mark is-error" aria-hidden="true">
          <WifiOff size={20} strokeWidth={1.8} />
        </div>
        <h1 className="boot-error-title">Tyler couldn't open your library.</h1>
        <p className="boot-error-body">{message}</p>
        <Button variant="primary" onClick={onRetry}>
          Try again
        </Button>
        {!isTauri && (
          <p className="boot-error-note">
            This window is running outside the desktop shell.
          </p>
        )}
      </div>
    </div>
  );
}

function ReaderSkeleton() {
  return (
    <div className="reader-skeleton" aria-hidden="true">
      <div className="reader-skeleton-inner">
        <div className="skeleton-bar shimmer" style={{ width: "18%" }} />
        <div
          className="skeleton-bar skeleton-reader-title shimmer"
          style={{ width: "88%" }}
        />
        <div
          className="skeleton-bar skeleton-reader-title shimmer"
          style={{ width: "62%" }}
        />
        <div className="skeleton-byline">
          <span className="skeleton-bar shimmer" style={{ width: "24%" }} />
          <span className="skeleton-bar shimmer" style={{ width: "16%" }} />
        </div>
        <div className="reader-skeleton-rule" />
        {[97, 91, 95, 78, 93, 88, 64].map((width, index) => (
          <span
            key={index}
            className="skeleton-bar skeleton-paragraph shimmer"
            style={{ width: `${width}%` }}
          />
        ))}
      </div>
    </div>
  );
}

function ReaderPlaceholder({ onOpenShortcuts }) {
  return (
    <div className="reader-placeholder">
      <div className="reader-placeholder-mark" aria-hidden="true">
        <Asterisk size={26} strokeWidth={1.6} />
      </div>
      <span className="reader-placeholder-eyebrow">Reader</span>
      <h2>Choose a story.</h2>
      <p>
        Pick an article from the list, or move through it with the keyboard.
        The full text opens here.
      </p>
      <div className="reader-keys" aria-label="Keyboard shortcuts">
        <span>
          <Kbd>↓</Kbd>
          <Kbd>↑</Kbd> move
        </span>
        <span>
          <Kbd>M</Kbd> read
        </span>
        <span>
          <Kbd>S</Kbd> star
        </span>
      </div>
      <button type="button" className="text-button" onClick={onOpenShortcuts}>
        <Keyboard size={14} />
        All keyboard shortcuts
      </button>
    </div>
  );
}

export default function App() {
  const { push } = useToast();

  const [bootstrap, setBootstrap] = useState(null);
  const [bootError, setBootError] = useState(null);
  const [booting, setBooting] = useState(true);
  const [bootAttempt, setBootAttempt] = useState(0);

  const [scope, setScope] = useState({ type: "all" });
  const [filter, setFilter] = useState("all");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState(null);

  const [articles, setArticles] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [listError, setListError] = useState(null);

  const [selectedId, setSelectedId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState(null);

  const [refreshing, setRefreshing] = useState(false);
  const [progress, setProgress] = useState(null);

  const [paletteOpen, setPaletteOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [dialog, setDialog] = useState(null);
  const [dataInfo, setDataInfo] = useState(null);
  const [markingAll, setMarkingAll] = useState(false);
  const [summaryJobs, setSummaryJobs] = useState({});
  const [fullArticleJobs, setFullArticleJobs] = useState({});
  const fullArticleRequests = useRef(new Set());
  const libraryGeneration = useRef(0);

  const searchRef = useRef(null);
  const articlesRef = useRef(articles);
  const nextCursorRef = useRef(null);
  const loadingRef = useRef(loading);
  const loadingMoreRef = useRef(loadingMore);
  const detailRef = useRef(detail);
  const lastDetailRef = useRef(null);
  const selectedIdRef = useRef(selectedId);
  const bootstrapRef = useRef(bootstrap);
  const scopeRef = useRef(scope);
  const requestSeq = useRef(0);
  const detailSeq = useRef(0);
  const refreshingRef = useRef(false);
  const refreshSilentRef = useRef(false);
  const finishRefreshRef = useRef(null);
  const runRefreshRef = useRef(null);
  const fetchRef = useRef(null);
  const keyboardRef = useRef({});
  const fontSizeQueueRef = useRef(Promise.resolve());
  const summaryRequestsRef = useRef(new Map());

  useEffect(() => {
    const requests = summaryRequestsRef.current;
    return () => requests.clear();
  }, []);

  useEffect(() => {
    if (detail) lastDetailRef.current = detail;
  }, [detail]);

  articlesRef.current = articles;
  loadingRef.current = loading;
  loadingMoreRef.current = loadingMore;
  selectedIdRef.current = selectedId;
  bootstrapRef.current = bootstrap;
  scopeRef.current = scope;

  // Keep the reader on the article that is still selected if a background
  // refresh or a late request clears the detail for a moment. A different
  // selection or a view change clears selectedId, so this cannot show a stale
  // article in those cases.
  const readerArticle =
    detail ||
    (selectedId != null && lastDetailRef.current?.id === selectedId
      ? lastDetailRef.current
      : null);
  detailRef.current = readerArticle;

  const settings = bootstrap?.settings;
  const tts = useTts({ settings, article: readerArticle, selectedId, notify: push });
  const currentSummaryKey = readerArticle ? summaryRequestKey(readerArticle, settings) : null;
  const currentSummary = summaryJobs[currentSummaryKey];
  const feeds = bootstrap?.feeds ?? [];
  const folders = bootstrap?.folders ?? [];
  const tags = bootstrap?.tags ?? [];
  const pendingFeedCount = feeds.filter((feed) => ["pending", "fetching"].includes(feed.last_status)).length;
  const scopeKey = `${scope.type}:${scope.id ?? ""}`;
  const effectiveFilter =
    scope.type === "archived"
      ? "archived"
      : scope.type === "unread"
      ? "unread"
      : scope.type === "starred"
        ? "starred"
        : scope.type === "today"
          ? "today"
          : filter;
  const effectiveSort = sort || settings?.default_sort || "newest";
  const queryKey = `${scopeKey}|${effectiveFilter}|${search}|${effectiveSort}`;
  const filterValue = scope.type === "today" || scope.type === "archived" ? "all" : effectiveFilter;
  const showOnboarding = !!bootstrap && feeds.length === 0;

  const loadBootstrap = useCallback(async () => {
    const next = await api.bootstrap();
    setBootstrap(next);
    return next;
  }, []);

  // Initial boot, with an explicit retry path.
  useEffect(() => {
    let alive = true;
    setBooting(true);
    api
      .bootstrap()
      .then((next) => {
        if (!alive) return;
        setBootstrap(next);
        setBootError(null);
      })
      .catch((error) => {
        if (!alive) return;
        setBootError(errorMessage(error));
      })
      .finally(() => {
        if (alive) setBooting(false);
      });
    return () => {
      alive = false;
    };
  }, [bootAttempt]);

  useEffect(() => {
    if (!bootstrap || !isTauri) return undefined;
    api.updateUnreadBadge(bootstrap.counts.unread || 0, bootstrap.settings.unread_badge !== false).catch(() => {});
  }, [bootstrap?.counts.unread, bootstrap?.settings.unread_badge]);

  useEffect(() => {
    if (!bootstrap || !isTauri) return undefined;
    let alive = true;
    let draining = false;
    let drainAgain = false;
    const cleanups = [];
    async function importPaths(paths) {
      for (const path of paths) {
        if (!/\.opml$/i.test(path)) { push("Drop an OPML (.opml) file to import subscriptions.", "info"); continue; }
        try {
          const result = await api.opmlImport(path);
          await loadBootstrap();
          fetchRef.current?.("reset", { silent: true });
          push(`${result.imported} feeds imported. ${result.skipped} skipped.`, "success");
          if (result.failures?.length) push(result.failures.join("\n"), "error");
        } catch (error) { push(errorMessage(error), "error"); }
      }
    }
    async function drain() {
      if (draining) { drainAgain = true; return; }
      draining = true;
      try {
        do {
          drainAgain = false;
          const requests = await api.takeOpenRequests();
          for (const request of requests) {
            if (/^feed:/i.test(request)) {
              const value = request.slice(5);
              const url = /^https?:\/\//i.test(value) ? value : `https:${value.startsWith("//") ? value : `//${value}`}`;
              if (alive) setDialog({ name: "add-feed", initialUrl: url });
            } else { await importPaths([request]); }
          }
        } while (drainAgain && alive);
      } catch (error) { push(errorMessage(error), "error"); }
      finally { draining = false; }
    }
    function keepCleanup(cleanup) { if (alive) cleanups.push(cleanup); else cleanup(); }
    listen("desktop:open", drain).then((cleanup) => { keepCleanup(cleanup); if (alive) drain(); }).catch(() => {});
    getCurrentWebview().onDragDropEvent((event) => {
      if (event.payload.type === "drop") importPaths(event.payload.paths);
    }).then(keepCleanup).catch(() => {});
    return () => { alive = false; cleanups.forEach((cleanup) => cleanup()); };
  }, [!!bootstrap, loadBootstrap, push]);

  // Debounced search (220ms).
  useEffect(() => {
    const timer = setTimeout(() => {
      setSearch(searchInput.trim());
    }, 220);
    return () => clearTimeout(timer);
  }, [searchInput]);

  function buildQuery(cursor = null) {
    const currentScope = scopeRef.current;
    const query = {
      filter: effectiveFilter,
      sort: effectiveSort,
      limit: PAGE_SIZE,
      cursor,
    };
    if (currentScope.type === "feed") query.feedId = currentScope.id;
    if (currentScope.type === "folder") query.folderId = currentScope.id;
    if (currentScope.type === "tag") query.tagId = currentScope.id;
    if (search.trim()) query.search = search.trim();
    return query;
  }

  async function fetchArticles(mode = "reset", options = {}) {
    const { silent = false, merge = false } = options;
    if (mode === "more") {
      if (loadingMoreRef.current || loadingRef.current || !nextCursorRef.current) return;
      loadingMoreRef.current = true;
      setLoadingMore(true);
    } else {
      loadingRef.current = true;
      loadingMoreRef.current = false;
      setLoadingMore(false);
      setListError(null);
      if (!silent) {
        setLoading(true);
        setArticles([]);
        setTotal(0);
        setHasMore(false);
        nextCursorRef.current = null;
      }
    }
    const seq = ++requestSeq.current;

    try {
      const cursor = mode === "more" ? nextCursorRef.current : null;
      const query = buildQuery(cursor);
      const merging = mode === "reset" && merge && articlesRef.current.length > 0;
      const boundaryId = merging ? articlesRef.current.at(-1).id : null;
      let result = await api.listArticles(query);
      if (seq !== requestSeq.current) return;
      const incoming = Array.isArray(result?.articles) ? result.articles : [];
      let reachedBoundary = incoming.some((article) => article.id === boundaryId);
      // Reconnect the refreshed pages to the end of the loaded list. A single
      // first page can leave a gap when more than PAGE_SIZE stories arrive.
      while (merging && result.nextCursor && !reachedBoundary) {
        result = await api.listArticles({ ...query, cursor: result.nextCursor });
        if (seq !== requestSeq.current) return;
        const page = Array.isArray(result?.articles) ? result.articles : [];
        incoming.push(...page);
        reachedBoundary = page.some((article) => article.id === boundaryId);
      }
      if (mode === "more") {
        const merged = mergeRefreshedArticles(articlesRef.current, incoming, "oldest");
        articlesRef.current = merged;
        setArticles(merged);
      } else if (merging) {
        // Keep loaded rows and the open article while merging the complete span.
        const merged = mergeRefreshedArticles(articlesRef.current, incoming, effectiveSort);
        articlesRef.current = merged;
        setArticles(merged);
      } else {
        articlesRef.current = incoming;
        setArticles(incoming);
      }
      setTotal(Number(result?.total) || 0);
      nextCursorRef.current = result?.nextCursor ?? null;
      setHasMore(nextCursorRef.current != null);
      setListError(null);
    } catch (error) {
      if (seq === requestSeq.current) setListError(errorMessage(error));
    } finally {
      if (seq === requestSeq.current) {
        loadingRef.current = false;
        loadingMoreRef.current = false;
        setLoading(false);
        setLoadingMore(false);
      }
    }
  }
  fetchRef.current = fetchArticles;

  // Fetch the first page whenever the view or search changes.
  useEffect(() => {
    if (!bootstrap) return;
    fetchRef.current?.("reset");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryKey, !!bootstrap]);

  // A new view starts without a stale open article.
  useEffect(() => {
    detailSeq.current += 1;
    selectedIdRef.current = null;
    detailRef.current = null;
    setSelectedId(null);
    setDetail(null);
    setDetailError(null);
    setDetailLoading(false);
  }, [queryKey]);

  // Theme resolution: settings drive data-theme, system changes are followed.
  useEffect(() => {
    const mode = settings?.theme || "system";
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      const resolved = mode === "system" ? (media.matches ? "dark" : "light") : mode;
      document.documentElement.dataset.theme = resolved;
      try {
        localStorage.setItem("tyler-theme", resolved);
      } catch {
        /* storage can be unavailable */
      }
    };
    apply();
    if (mode === "system") {
      if (media.addEventListener) {
        media.addEventListener("change", apply);
        return () => media.removeEventListener("change", apply);
      }
      media.addListener?.(apply);
      return () => media.removeListener?.(apply);
    }
    return undefined;
  }, [settings?.theme]);

  useEffect(() => {
    document.documentElement.dataset.reduceMotion = settings?.reduce_motion
      ? "true"
      : "false";
  }, [settings?.reduce_motion]);

  function mergeCounts(counts) {
    if (!counts) return;
    setBootstrap((current) =>
      current ? { ...current, counts: { ...current.counts, ...counts } } : current
    );
  }

  function currentArticle(id) {
    return (
      articlesRef.current.find((article) => article.id === id) ||
      (detailRef.current?.id === id ? detailRef.current : null)
    );
  }

  function resolveArticle(arg) {
    if (typeof arg === "number") return currentArticle(arg);
    if (arg && typeof arg === "object" && arg.id != null) {
      return currentArticle(arg.id) || arg;
    }
    if (detailRef.current) {
      return currentArticle(detailRef.current.id) || detailRef.current;
    }
    return null;
  }

  function patchCounts(before, patch) {
    if (!before || before.is_archived) return;
    const readDelta =
      patch.is_read === undefined
        ? 0
        : before.is_read
          ? patch.is_read
            ? 0
            : 1
          : patch.is_read
            ? -1
            : 0;
    const starDelta =
      patch.is_starred === undefined
        ? 0
        : before.is_starred
          ? patch.is_starred
            ? 0
            : -1
          : patch.is_starred
            ? 1
            : 0;
    if (!readDelta && !starDelta) return;

    setBootstrap((current) => {
      if (!current) return current;
      const counts = { ...current.counts };
      if (readDelta) counts.unread = Math.max(0, (counts.unread || 0) + readDelta);
      if (starDelta)
        counts.starred = Math.max(0, (counts.starred || 0) + starDelta);

      let nextFeeds = current.feeds;
      let nextFolders = current.folders;
      let nextByFeed = current.unread_by_feed;
      let nextByFolder = current.unread_by_folder;

      if (readDelta) {
        const feed = current.feeds.find((item) => item.id === before.feed_id);
        nextByFeed = { ...current.unread_by_feed };
        nextByFeed[before.feed_id] = Math.max(
          0,
          (nextByFeed[before.feed_id] ?? feed?.unread_count ?? 0) + readDelta
        );
        nextFeeds = current.feeds.map((item) =>
          item.id === before.feed_id
            ? {
                ...item,
                unread_count: Math.max(0, (item.unread_count || 0) + readDelta),
              }
            : item
        );
        if (feed?.folder_id != null) {
          nextByFolder = { ...current.unread_by_folder };
          nextByFolder[feed.folder_id] = Math.max(
            0,
            (nextByFolder[feed.folder_id] ?? 0) + readDelta
          );
          nextFolders = current.folders.map((item) =>
            item.id === feed.folder_id
              ? {
                  ...item,
                  unread_count: Math.max(0, (item.unread_count || 0) + readDelta),
                }
              : item
          );
        }
      }

      return {
        ...current,
        counts,
        feeds: nextFeeds,
        folders: nextFolders,
        unread_by_feed: nextByFeed,
        unread_by_folder: nextByFolder,
      };
    });
  }

  function applyPatch(id, patch) {
    const before = currentArticle(id);
    if (!before) return;
    articlesRef.current = articlesRef.current.map((article) =>
      article.id === id ? { ...article, ...patch } : article
    );
    setArticles(articlesRef.current);
    if (detailRef.current?.id === id) {
      detailRef.current = { ...detailRef.current, ...patch };
      setDetail(detailRef.current);
    }
    patchCounts(before, patch);
  }

  function handleToggleRead(arg, forced) {
    const article = resolveArticle(arg);
    if (!article) return;
    const before = currentArticle(article.id) || article;
    const next = forced === undefined ? !before.is_read : !!forced;
    if (next === before.is_read) return;

    applyPatch(before.id, { is_read: next });
    api
      .setArticleState(before.id, { isRead: next })
      .then((counts) => mergeCounts(counts))
      .catch((error) => {
        applyPatch(before.id, { is_read: before.is_read });
        push(errorMessage(error), "error");
      });
  }

  function handleToggleStar(arg) {
    const article = resolveArticle(arg);
    if (!article) return;
    const before = currentArticle(article.id) || article;
    const next = !before.is_starred;

    applyPatch(before.id, { is_starred: next });
    api
      .setArticleState(before.id, { isStarred: next })
      .then((counts) => mergeCounts(counts))
      .catch((error) => {
        applyPatch(before.id, { is_starred: before.is_starred });
        push(errorMessage(error), "error");
      });
  }

  async function openArticle(id, force = false) {
    if (id == null) return;
    if (!force && id === selectedIdRef.current) return;
    selectedIdRef.current = id;
    setSelectedId(id);
    setDetailLoading(true);
    setDetailError(null);
    setDetail(null);
    detailRef.current = null;
    const seq = ++detailSeq.current;

    try {
      const next = await api.getArticle(id);
      if (seq !== detailSeq.current || selectedIdRef.current !== id) return;
      if (!next) {
        setDetailError("This article is no longer in the library.");
        setDetailLoading(false);
        return;
      }
      detailRef.current = next;
      setDetail(next);
      setDetailLoading(false);
      if (
        bootstrapRef.current?.settings?.mark_read_on_open &&
        next &&
        !next.is_read
      ) {
        handleToggleRead(next, true);
      }
      if (bootstrapRef.current?.settings?.load_full_article_by_default && next && !next.full_content_loaded) {
        loadFullArticle(next, { automatic: true });
      }
    } catch (error) {
      if (seq !== detailSeq.current) return;
      setDetailError(errorMessage(error));
      setDetailLoading(false);
    }
  }

  async function refreshArticle(arg) {
    const article = resolveArticle(arg);
    const id = article?.id ?? detailRef.current?.id;
    if (!id) return;
    setDetailLoading(true);
    try {
      const next = await api.getArticle(id);
      if (!next || next.id !== id) return;
      if (detailRef.current?.id === id || selectedIdRef.current === id) {
        detailRef.current = next;
        setDetail(next);
        setDetailError(null);
      }
    } catch (error) {
      push(errorMessage(error), "error");
    } finally {
      setDetailLoading(false);
    }
  }

  async function openExternal(arg) {
    const url = typeof arg === "string" ? arg : arg?.url || detailRef.current?.url;
    if (!url) return;
    try { await api.openArticleLink(url); }
    catch (error) { push(errorMessage(error), "error"); }
  }

  async function toggleArchive(article) {
    if (!article) return;
    try {
      const archived = !article.is_archived;
      await api.setArticleState(article.id, { isArchived: archived });
      applyPatch(article.id, { is_archived: archived });
      await loadBootstrap();
      await fetchRef.current?.("reset", { silent: true });
      push(archived ? "Article archived." : "Article restored.", "success");
    } catch (error) { push(errorMessage(error), "error"); }
  }

  async function loadFullArticle(article, { automatic = false } = {}) {
    if (!article?.url || fullArticleRequests.current.has(article.id)) return;
    const generation = libraryGeneration.current;
    const requests = fullArticleRequests.current;
    requests.add(article.id);
    setFullArticleJobs((current) => ({ ...current, [article.id]: true }));
    try {
      const source = await api.fetchArticleSource(article.id);
      const doc = new DOMParser().parseFromString(source.html, "text/html");
      doc.querySelectorAll("base").forEach((base) => base.remove());
      const base = doc.createElement("base");
      base.href = source.url;
      doc.head.prepend(base);
      const { Readability } = await import("@mozilla/readability");
      const extracted = new Readability(doc, { maxElemsToParse: 50000 }).parse();
      if (!extracted?.content) throw new Error("Could not extract this page. Try opening the original.");
      if (generation !== libraryGeneration.current) return;
      const next = await api.saveFullArticle(article.id, extracted.content, source.url, article.url);
      if (generation !== libraryGeneration.current) return;
      if (!next || next.id !== article.id) return;
      if (selectedIdRef.current === article.id) {
        detailRef.current = next;
        setDetail(next);
      }
      fetchRef.current?.("reset", { silent: true, merge: true });
      if (!automatic) push("Full article saved for offline reading.", "success");
    } catch (error) { if (generation === libraryGeneration.current) push(errorMessage(error), "error"); }
    finally {
      requests.delete(article.id);
      if (generation === libraryGeneration.current) setFullArticleJobs((current) => ({ ...current, [article.id]: false }));
    }
  }

  async function copyLink(arg) {
    const url =
      typeof arg === "string" ? arg : arg?.url || detailRef.current?.url;
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      push("Link copied.", "success");
    } catch {
      push("Could not copy the link.", "error");
    }
  }

  async function setTags(a, b) {
    const values = Array.isArray(a) ? a : Array.isArray(b) ? b : null;
    if (!values) return null;
    const tagIds = values
      .map((value) => (value && typeof value === "object" ? value.id : value))
      .filter((value) => value != null);
    const articleId =
      typeof a === "number"
        ? a
        : a && typeof a === "object" && !Array.isArray(a) && a.id != null
          ? a.id
          : detailRef.current?.id;
    if (articleId == null) return null;
    try {
      const nextTags = await api.setArticleTags(articleId, tagIds);
      const tagNames = (nextTags || []).map((tag) => tag.name);
      articlesRef.current = articlesRef.current.map((article) =>
        article.id === articleId ? { ...article, tag_names: tagNames } : article
      );
      setArticles(articlesRef.current);
      if (detailRef.current?.id === articleId) {
        detailRef.current = {
          ...detailRef.current,
          tags: nextTags || [],
          tag_names: tagNames,
        };
        setDetail(detailRef.current);
      }
      loadBootstrap().catch(() => {});
      return nextTags;
    } catch (error) {
      push(errorMessage(error), "error");
      throw error;
    }
  }

  async function createTags(names, color = "#c2410c") {
    try {
      const tags = await api.createTags(names, color || "#c2410c");
      await loadBootstrap();
      return tags;
    } catch (error) {
      push(errorMessage(error), "error");
      throw error;
    }
  }

  function finishRefresh(result, failure = null) {
    if (!refreshingRef.current) return;
    refreshingRef.current = false;
    setRefreshing(false);
    setProgress(null);
    const silent = refreshSilentRef.current;
    refreshSilentRef.current = false;

    if (failure) {
      push(failure, "error");
    } else if (result) {
      const added = Number(result.newArticles) || 0;
      const failed = Number(result.failed) || 0;
      if (failed > 0) {
        const firstFailure = result.failures?.[0];
        push(
          `${added} new ${added === 1 ? "article" : "articles"} · ${failed} ${
            failed === 1 ? "feed" : "feeds"
          } failed${firstFailure ? `. ${firstFailure}` : ""}`,
          "error"
        );
      } else if (added > 0) {
        push(`${added} new ${added === 1 ? "article" : "articles"}`, "success");
      } else if (!silent) {
        push("Feeds updated. Nothing new.", "info");
      }
    }

    loadBootstrap().catch(() => {});
    fetchRef.current?.("reset", { silent: true, merge: true });
  }

  async function runRefresh(feedId = null, silent = false, scheduled = false) {
    if (refreshingRef.current) return;
    if (!(bootstrapRef.current?.feeds?.length > 0)) {
      if (!silent) push("Add a feed before refreshing.", "info");
      return;
    }
    refreshingRef.current = true;
    refreshSilentRef.current = silent;
    setRefreshing(true);
    setProgress({ done: 0, total: 0, feedId: null, title: null });
    try {
      const result = await api.refresh(feedId, scheduled);
      finishRefresh(result);
    } catch (error) {
      finishRefresh(null, errorMessage(error));
    }
  }
  finishRefreshRef.current = finishRefresh;
  runRefreshRef.current = runRefresh;

  // Refresh progress comes from Tauri events; the command promise is a fallback.
  useEffect(() => {
    const unsubscribe = api.listenRefresh(
      (payload) => {
        if (refreshingRef.current) setProgress(payload);
      },
      (payload) => {
        if (refreshingRef.current) finishRefreshRef.current?.(payload);
        else { loadBootstrap().catch(() => {}); fetchRef.current?.("reset", { silent: true, merge: true }); }
      }
    );
    return unsubscribe;
  }, []);

  useEffect(() => {
    let timer;
    let alive = true;
    const unsubscribe = api.listenFeedUpdates((payload) => {
      if (payload.error) {
        const feed = bootstrapRef.current?.feeds.find((item) => item.id === payload.feedId);
        push(`${feed?.title || "Feed"}: ${payload.error}`, "error");
      }
      clearTimeout(timer);
      timer = setTimeout(async () => {
        if (!alive) return;
        try {
          await loadBootstrap();
          if (alive && !payload.loading) fetchRef.current?.("reset", { silent: true, merge: true });
        } catch { /* Polling below retries while subscriptions are loading. */ }
      }, 150);
    });
    return () => { alive = false; clearTimeout(timer); unsubscribe(); };
  }, [loadBootstrap, push]);

  // Recover missed events and show articles before all cover images finish downloading.
  useEffect(() => {
    if (!pendingFeedCount) return undefined;
    const timer = setInterval(async () => {
      const previous = bootstrapRef.current;
      try {
        const next = await loadBootstrap();
        if (next.counts.all !== previous?.counts.all || !next.feeds.some((feed) => ["pending", "fetching"].includes(feed.last_status))) {
          fetchRef.current?.("reset", { silent: true, merge: true });
        }
      } catch { /* Try again on the next tick. */ }
    }, 2000);
    return () => clearInterval(timer);
  }, [pendingFeedCount, loadBootstrap]);

  const refreshScheduleKey = JSON.stringify(feeds.map((feed) => [
    feed.id, feed.is_active, feed.fetch_interval, feed.last_fetched_at, feed.last_status,
  ]));

  // Wake for the next feed deadline, or the global check interval if sooner.
  useEffect(() => {
    const minutes = Number(settings?.refresh_minutes) || 0;
    if (minutes <= 0 || !feeds.length) return undefined;
    let timer;
    let cancelled = false;
    function schedule() {
      if (cancelled) return;
      const now = Date.now();
      let delay = minutes * 60_000;
      for (const feed of bootstrapRef.current?.feeds || []) {
        if (!feed.is_active || ["pending", "fetching"].includes(feed.last_status)) continue;
        const lastFetched = Date.parse(feed.last_fetched_at);
        const interval = Math.max(1, Math.min(10080, Number(feed.fetch_interval) || 30));
        const due = Number.isFinite(lastFetched) ? lastFetched + interval * 60_000 : now;
        delay = Math.min(delay, Math.max(5000, due - now));
      }
      timer = setTimeout(async () => {
        await runRefreshRef.current?.(null, true, true);
        schedule();
      }, delay);
    }
    schedule();
    return () => { cancelled = true; clearTimeout(timer); };
    // The key covers only changes that affect feed deadlines.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings?.refresh_minutes, refreshScheduleKey]);

  // Pick up anything published while the app was closed, once per session.
  const launchRefreshRef = useRef(false);
  useEffect(() => {
    if (!bootstrap || launchRefreshRef.current || feeds.length === 0) return undefined;
    const timer = setTimeout(() => {
      launchRefreshRef.current = true;
      runRefreshRef.current?.(null, true, true);
    }, 1500);
    return () => clearTimeout(timer);
  }, [bootstrap, feeds.length]);

  function selectScope(next) {
    setScope(next);
    setFilter("all");
    setSearchInput("");
    setSearch("");
    setSidebarOpen(false);
  }

  function changeFilter(next) {
    if (scope.type === "today" && next === "all") return;
    if (scope.type === "unread" || scope.type === "starred" || scope.type === "today") {
      setScope({ type: "all" });
    }
    setFilter(next);
  }

  function clearSearch() {
    setSearchInput("");
    setSearch("");
  }

  function focusSearch() {
    setSidebarOpen(false);
    requestAnimationFrame(() => {
      searchRef.current?.focus();
      searchRef.current?.select?.();
    });
  }

  async function markAllRead() {
    if (markingAll) return;
    setMarkingAll(true);
    const targetScope = {
      feedId: scope.type === "feed" ? scope.id : null,
      folderId: scope.type === "folder" ? scope.id : null,
      tagId: scope.type === "tag" ? scope.id : null,
      search: search.trim() || null,
    };
    try {
      const counts = await api.markAllRead(targetScope);
      mergeCounts(counts);
      articlesRef.current = articlesRef.current.map((article) => ({
        ...article,
        is_read: true,
      }));
      setArticles(articlesRef.current);
      if (detailRef.current) {
        detailRef.current = { ...detailRef.current, is_read: true };
        setDetail(detailRef.current);
      }
      await loadBootstrap();
      fetchRef.current?.("reset", { silent: true });
      push("Marked all as read.", "success");
    } catch (error) {
      push(errorMessage(error), "error");
    } finally {
      setMarkingAll(false);
    }
  }

  function openDialog(name, options = {}) {
    setDialog({ name, ...options });
    if (name === "settings") {
      setDataInfo(null);
      api
        .dataInfo()
        .then(setDataInfo)
        .catch(() => setDataInfo(null));
    }
  }

  const closeDialog = useCallback(() => setDialog(null), []);

  async function summarizeArticle(article) {
    const config = bootstrapRef.current?.settings;
    if (!config?.llm_enabled || !config.llm_base_url?.trim()
      || !config.llm_api_key?.trim() || !config.llm_model?.trim() || !config.llm_prompt?.trim()) {
      openDialog("settings", { section: "llm" });
      push("Enable LLM summaries and save your endpoint, API key, model, and prompt.", "info");
      return;
    }

    const key = summaryRequestKey(article, config);
    if (summaryRequestsRef.current.has(key)) return;
    if (summaryJobs[key]?.result) {
      setSummaryJobs((current) => ({
        ...current,
        [key]: { ...current[key], visible: true },
      }));
      return;
    }

    const request = api.generateSummary(article.id);
    summaryRequestsRef.current.set(key, request);
    setSummaryJobs((current) => ({
      ...current,
      [key]: { loading: true, visible: false, result: null },
    }));
    try {
      const result = await request;
      if (summaryRequestsRef.current.get(key) !== request) return;
      setSummaryJobs((current) => ({
        ...current,
        [key]: { loading: false, visible: true, result },
      }));
      if (selectedIdRef.current !== article.id) {
        push(`Summary ready for “${article.title || "Untitled story"}”. Open that article to read it.`, "success");
      }
    } catch (error) {
      if (summaryRequestsRef.current.get(key) !== request) return;
      setSummaryJobs((current) => ({
        ...current,
        [key]: { loading: false, visible: false, result: null },
      }));
      push(`Could not summarize “${article.title || "Untitled story"}”: ${errorMessage(error)}`, "error");
    } finally {
      if (summaryRequestsRef.current.get(key) === request) {
        summaryRequestsRef.current.delete(key);
      }
    }
  }

  function dismissSummary() {
    setSummaryJobs((current) => ({
      ...current,
      [currentSummaryKey]: { ...current[currentSummaryKey], visible: false },
    }));
  }

  async function handleFeedAdded(feed) {
    await loadBootstrap().catch(() => {});
    fetchRef.current?.("reset", { silent: true });
    if (Array.isArray(feed)) {
      push(`${feed.length} ${feed.length === 1 ? "feed" : "feeds"} added. Stories load in the background.`, "success");
    } else if (["pending", "fetching"].includes(feed?.last_status)) {
      push(`${feed.title || "Feed"} added. Stories load in the background.`, "success");
    } else if (feed?.last_status === "error") {
      push(`${feed.title || "Feed"} added. The first fetch failed.`, "info");
    } else if (feed?.title) {
      push(`${feed.title} added.`, "success");
    } else {
      push("Feed added.", "success");
    }
  }

  async function handleOnboardingAdd(url) {
    const feed = await api.addFeed({ url, folderId: null });
    await loadBootstrap();
    fetchRef.current?.("reset", { silent: true });
    if (feed?.last_status === "error") {
      push(`${feed.title || "Feed"} added. The first fetch failed.`, "info");
    } else {
      push(`${feed?.title || "Feed"} added.`, "success");
    }
    return feed;
  }

  async function handleOnboardingAddFeeds(selected) {
    const result = await api.addFeeds(selected.map((feed) => ({ url: feed.url, title: feed.name, folderId: null })));
    if (result.feeds.length) await handleFeedAdded(result.feeds);
    if (result.failures.length) push(result.failures.join("\n"), "error");
    return result;
  }

  async function moveFeed(feedId, folderId) {
    await api.updateFeed({ id: feedId, folderId });
    await handleDataChanged();
    if (detailRef.current?.feed_id === feedId) refreshArticle(detailRef.current);
  }

  async function deleteFolder(folder) {
    if (feeds.some((feed) => feed.folder_id === folder.id)) {
      openDialog("folder", { folder, action: "delete" });
      return;
    }
    try {
      await api.deleteFolder(folder.id);
      await handleDataChanged();
    } catch (error) {
      push(errorMessage(error), "error");
    }
  }

  async function handleTagsChanged() {
    await handleDataChanged();
    if (detailRef.current) await refreshArticle(detailRef.current);
  }

  async function deleteTag(tag) {
    if (tag.count > 0) {
      openDialog("tag", { tag, action: "delete" });
      return;
    }
    try {
      await api.deleteTag(tag.id);
      await handleTagsChanged();
    } catch (error) {
      push(errorMessage(error), "error");
    }
  }

  async function handleSaveSettings(patch) {
    try {
      const next = await api.setSettings(patch);
      setBootstrap((current) =>
        current
          ? { ...current, settings: { ...current.settings, ...next } }
          : current
      );
      const article = detailRef.current;
      if (patch.load_full_article_by_default && next.load_full_article_by_default && article && !article.full_content_loaded) {
        loadFullArticle(article, { automatic: true });
      }
      return next;
    } catch (error) {
      push(errorMessage(error), "error");
      throw error;
    }
  }

  function adjustReaderFontSize(delta) {
    // Save in order so quick presses and key repeats each change the size.
    fontSizeQueueRef.current = fontSizeQueueRef.current.then(async () => {
      const current = bootstrapRef.current;
      if (!current) return;
      const fontSize = current.settings.font_size ?? 18;
      const nextSize = Math.min(24, Math.max(14, fontSize + delta));
      if (nextSize === fontSize) return;

      const saved = await handleSaveSettings({ font_size: nextSize });
      // The next queued press can run before React renders the saved settings.
      bootstrapRef.current = {
        ...bootstrapRef.current,
        settings: { ...bootstrapRef.current.settings, font_size: saved.font_size },
      };
    }).catch(() => {});
  }

  const handleDataChanged = useCallback(async () => {
    try {
      const next = await loadBootstrap();
      const current = scopeRef.current;
      const valid =
        current.type === "all" ||
        current.type === "unread" ||
        current.type === "starred" ||
        current.type === "today" ||
        current.type === "archived" ||
        (current.type === "feed" &&
          next.feeds.some((feed) => feed.id === current.id)) ||
        (current.type === "folder" &&
          next.folders.some((folder) => folder.id === current.id)) ||
        (current.type === "tag" &&
          next.tags.some((tag) => tag.id === current.id));
      if (!valid) {
        scopeRef.current = { type: "all" };
        setScope({ type: "all" });
        setFilter("all");
        detailSeq.current += 1;
        selectedIdRef.current = null;
        detailRef.current = null;
        setSelectedId(null);
        setDetail(null);
        setDetailError(null);
      }
      fetchRef.current?.("reset", { silent: true });
    } catch (error) {
      push(errorMessage(error), "error");
    }
  }, [loadBootstrap, push]);

  async function handleImported(next) {
    tts.stop();
    libraryGeneration.current += 1;
    fullArticleRequests.current = new Set();
    setFullArticleJobs({});
    summaryRequestsRef.current.clear();
    setSummaryJobs({});
    if (next && Array.isArray(next.feeds)) {
      setBootstrap(next);
      scopeRef.current = { type: "all" };
      setScope({ type: "all" });
      setFilter("all");
      setSearchInput("");
      setSearch("");
      selectedIdRef.current = null;
      detailRef.current = null;
      setSelectedId(null);
      setDetail(null);
      fetchRef.current?.("reset");
    } else {
      await handleDataChanged();
    }
  }

  function handleSelectFeedFromStats(feedArg) {
    const id =
      typeof feedArg === "number"
        ? feedArg
        : feedArg?.feed_id ?? feedArg?.feedId ?? feedArg?.id;
    if (id == null) return;
    closeDialog();
    selectScope({ type: "feed", id });
  }

  function handlePaletteAction(action) {
    setPaletteOpen(false);
    if (action === "refresh") {
      runRefresh();
      return;
    }
    if (action === "shortcuts") {
      setShortcutsOpen(true);
      return;
    }
    if (action === "add-feed") {
      openDialog("add-feed");
      return;
    }
    if (["manage-feeds", "settings", "transfer", "stats", "tags"].includes(action)) {
      openDialog(action);
    }
  }

  function navigateList(direction) {
    const list = articlesRef.current;
    if (!list.length) return;
    const current = selectedIdRef.current;
    const index = list.findIndex((article) => article.id === current);
    let next;
    if (index === -1) next = direction > 0 ? list[0] : list[list.length - 1];
    else next = list[index + direction];
    if (next) openArticle(next.id);
  }

  function toggleSelectedRead() {
    const article =
      currentArticle(selectedIdRef.current) || detailRef.current || null;
    if (article) handleToggleRead(article);
  }

  function toggleSelectedStar() {
    const article =
      currentArticle(selectedIdRef.current) || detailRef.current || null;
    if (article) handleToggleStar(article);
  }

  function markSelectedUnread() {
    const article =
      currentArticle(selectedIdRef.current) || detailRef.current || null;
    if (article) handleToggleRead(article, false);
  }

  function loadMore() {
    if (loadingRef.current || loadingMoreRef.current) return;
    if (!nextCursorRef.current) return;
    fetchRef.current?.("more");
  }

  // One global key handler. All mutable state is read through a ref so the
  // listener never needs to be re-registered.
  keyboardRef.current = {
    paletteOpen,
    shortcutsOpen,
    dialogOpen: !!dialog,
    sidebarOpen,
    searchActive: !!searchInput || !!search,
    togglePalette: () => setPaletteOpen((value) => !value),
    closePalette: () => setPaletteOpen(false),
    closeShortcuts: () => setShortcutsOpen(false),
    closeSidebar: () => setSidebarOpen(false),
    clearSearch,
    focusSearch,
    openShortcuts: () => setShortcutsOpen(true),
    nextArticle: () => navigateList(1),
    prevArticle: () => navigateList(-1),
    toggleRead: toggleSelectedRead,
    toggleStar: toggleSelectedStar,
    markUnread: markSelectedUnread,
    refresh: () => runRefresh(),
    adjustFontSize: adjustReaderFontSize,
  };

  useEffect(() => {
    function onKeyDown(event) {
      const state = keyboardRef.current;
      const target = event.target;
      const typing =
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable);
      const mod = event.metaKey || event.ctrlKey;

      if (mod && !event.altKey && (event.key === "k" || event.key === "K")) {
        event.preventDefault();
        state.togglePalette();
        return;
      }

      if (event.key === "Escape") {
        if (state.paletteOpen) {
          event.preventDefault();
          state.closePalette();
          return;
        }
        if (state.shortcutsOpen) {
          event.preventDefault();
          state.closeShortcuts();
          return;
        }
        if (state.dialogOpen) return;
        if (state.searchActive) {
          event.preventDefault();
          state.clearSearch();
          return;
        }
        if (state.sidebarOpen) {
          event.preventDefault();
          state.closeSidebar();
        }
        return;
      }

      if (
        mod && !event.altKey && !typing &&
        !state.paletteOpen && !state.shortcutsOpen && !state.dialogOpen &&
        (event.key === "+" || event.key === "=" || event.key === "-")
      ) {
        event.preventDefault();
        state.adjustFontSize(event.key === "-" ? -1 : 1);
        return;
      }

      if (typing || mod || event.altKey) return;
      if (state.paletteOpen || state.shortcutsOpen || state.dialogOpen) return;

      switch (event.key) {
        case "/":
          event.preventDefault();
          state.focusSearch();
          break;
        case "?":
          event.preventDefault();
          state.openShortcuts();
          break;
        case "ArrowDown":
          event.preventDefault();
          state.nextArticle();
          break;
        case "ArrowUp":
          event.preventDefault();
          state.prevArticle();
          break;
        case "m":
          if (!event.repeat) state.toggleRead();
          break;
        case "s":
          if (!event.repeat) state.toggleStar();
          break;
        case "u":
          if (!event.repeat) state.markUnread();
          break;
        case "r":
          if (!event.repeat) {
            event.preventDefault();
            state.refresh();
          }
          break;
        default:
          break;
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const scopeMeta = useMemo(() => {
    if (search.trim()) return { title: "Search results", kind: "Search" };
    if (scope.type === "feed") {
      const feed = feeds.find((item) => item.id === scope.id);
      return {
        title: feed?.title || "Feed",
        kind: feed?.folder_name || "Feed",
      };
    }
    if (scope.type === "folder") {
      const folder = folders.find((item) => item.id === scope.id);
      return { title: folder?.name || "Folder", kind: "Folder" };
    }
    if (scope.type === "tag") {
      const tag = tags.find((item) => item.id === scope.id);
      return { title: tag?.name || "Tag", kind: "Tag" };
    }
    if (scope.type === "unread")
      return { title: "Unread", kind: "Smart view" };
    if (scope.type === "starred")
      return { title: "Starred", kind: "Smart view" };
    if (scope.type === "archived") return { title: "Archive", kind: "Smart view" };
    if (scope.type === "today") return { title: "Today", kind: "Smart view" };
    if (effectiveFilter === "unread")
      return { title: "Unread", kind: "Library" };
    if (effectiveFilter === "starred")
      return { title: "Starred", kind: "Library" };
    return { title: "All articles", kind: "Library" };
  }, [search, scope, feeds, folders, tags, effectiveFilter]);

  const canMarkAll =
    feeds.length > 0 &&
    !markingAll &&
    ["all", "unread", "feed", "folder", "tag"].includes(scope.type) &&
    effectiveFilter !== "starred";

  const detailIndex = articles.findIndex((article) => article.id === selectedId);
  let prevId = null;
  let nextId = null;
  if (detailIndex >= 0) {
    prevId = detailIndex > 0 ? articles[detailIndex - 1].id : null;
    nextId =
      detailIndex < articles.length - 1 ? articles[detailIndex + 1].id : null;
  } else if (readerArticle) {
    prevId = readerArticle.prev_id ?? null;
    nextId = readerArticle.next_id ?? null;
  }

  const progressLabel =
    refreshing && progress?.total
      ? `${progress.done ?? 0} / ${progress.total}`
      : "Refreshing";
  const progressPercent =
    progress?.total > 0
      ? Math.min(100, Math.round(((progress.done || 0) / progress.total) * 100))
      : null;

  function renderEmptyState() {
    const searchTerm = search.trim();
    const scopedName =
      scope.type === "feed"
        ? feeds.find((item) => item.id === scope.id)?.title
        : scope.type === "folder"
          ? folders.find((item) => item.id === scope.id)?.name
          : scope.type === "tag"
            ? tags.find((item) => item.id === scope.id)?.name
            : null;
    const leaveFilter = () => {
      if (scope.type === "all") {
        setFilter("all");
      } else if (scope.type === "unread" || scope.type === "starred") {
        selectScope({ type: "all" });
      } else {
        setFilter("all");
      }
    };

    if (searchTerm) {
      return (
        <EmptyState
          icon={Search}
          eyebrow="Search"
          title={`No matches for “${searchTerm}”`}
          body="Try a different spelling, fewer words, or search the whole library."
          action={
            <Button variant="primary" size="sm" onClick={clearSearch}>
              Clear search
            </Button>
          }
          compact
        />
      );
    }

    const selectedFeedLoading = scope.type === "feed" && feeds.some((feed) => feed.id === scope.id && ["pending", "fetching"].includes(feed.last_status));
    if (selectedFeedLoading || (scope.type === "all" && pendingFeedCount > 0)) {
      return <EmptyState icon={Rss} eyebrow="Loading feeds" title="Your stories are on the way." body="You can keep browsing and organizing your library while feeds load in the background." compact />;
    }

    if (effectiveFilter === "unread" || scope.type === "unread") {
      return (
        <EmptyState
          icon={CircleDot}
          eyebrow="Unread"
          title={
            scopedName
              ? `Nothing unread in ${scopedName}.`
              : "You're all caught up."
          }
          body={
            scopedName
              ? "You have read everything here. New stories will land after the next refresh."
              : "Every article in this view has been read. New stories will land here on the next refresh."
          }
          action={
            <Button variant="primary" size="sm" onClick={leaveFilter}>
              {scopedName ? "View all here" : "Browse all articles"}
            </Button>
          }
          secondaryAction={
            <Button variant="ghost" size="sm" onClick={() => runRefresh()}>
              Refresh
            </Button>
          }
          compact
        />
      );
    }

    if (effectiveFilter === "starred" || scope.type === "starred") {
      return (
        <EmptyState
          icon={Star}
          eyebrow="Starred"
          title={
            scopedName
              ? `Nothing starred in ${scopedName}.`
              : "Nothing starred yet."
          }
          body="Star the stories worth coming back to. They stay here, outside the unread queue."
          action={
            <Button variant="primary" size="sm" onClick={leaveFilter}>
              {scopedName ? "View all here" : "Browse all articles"}
            </Button>
          }
          compact
        />
      );
    }

    if (scope.type === "today") {
      return (
        <EmptyState
          icon={Sun}
          eyebrow="Today"
          title="Nothing from today."
          body="No articles have arrived since midnight. Refresh to check your feeds now."
          action={
            <Button variant="primary" size="sm" onClick={() => runRefresh()}>
              Refresh feeds
            </Button>
          }
          compact
        />
      );
    }

    if (scope.type === "archived") {
      return <EmptyState icon={Archive} eyebrow="Archive" title="No archived articles."
        body="Archive a story from the reader to keep it here. Restore it whenever you want it back in your library." compact />;
    }

    if (scope.type === "feed") {
      const feed = feeds.find((item) => item.id === scope.id);
      return (
        <EmptyState
          icon={Rss}
          eyebrow="Feed"
          title={`${feed?.title || "This feed"} has no articles.`}
          body={
            feed?.error ||
            "The feed has not published anything yet, or the last fetch came back empty."
          }
          action={
            <Button variant="primary" size="sm" onClick={() => runRefresh(scope.id)}>
              Refresh feed
            </Button>
          }
          secondaryAction={
            <Button variant="ghost" size="sm" onClick={() => openDialog("manage-feeds")}>
              Manage feeds
            </Button>
          }
          compact
        />
      );
    }

    if (scope.type === "folder") {
      const folder = folders.find((item) => item.id === scope.id);
      return (
        <EmptyState
          icon={Inbox}
          eyebrow="Folder"
          title={`${folder?.name || "This folder"} is empty.`}
          body="No articles in this folder yet. Refresh your feeds or add a publication to it."
          action={
            <Button variant="primary" size="sm" onClick={() => runRefresh()}>
              Refresh feeds
            </Button>
          }
          secondaryAction={
            <Button variant="ghost" size="sm" onClick={() => openDialog("add-feed")}>
              Add feed
            </Button>
          }
          compact
        />
      );
    }

    if (scope.type === "tag") {
      const tag = tags.find((item) => item.id === scope.id);
      return (
        <EmptyState
          icon={Newspaper}
          eyebrow="Tag"
          title={`No articles tagged ${tag?.name || "here"}.`}
          body="Open an article and add this tag to keep related stories together."
          action={
            <Button
              variant="primary"
              size="sm"
              onClick={() => selectScope({ type: "all" })}
            >
              Browse all articles
            </Button>
          }
          compact
        />
      );
    }

    return (
      <EmptyState
        icon={Rss}
        eyebrow="Library"
        title="No articles yet."
        body="Your feeds are ready but the library is empty. Refresh to pull in the latest stories."
        action={
          <Button variant="primary" size="sm" onClick={() => runRefresh()}>
            Refresh feeds
          </Button>
        }
        secondaryAction={
          <Button variant="ghost" size="sm" onClick={() => openDialog("add-feed")}>
            Add a feed
          </Button>
        }
        compact
      />
    );
  }

  return (
    <div className={`app ${sidebarOpen ? "sidebar-open" : ""}`.trim()}>
      <TitleBar onOpenPalette={() => setPaletteOpen(true)} tts={tts}
        ttsEnabled={!!settings?.tts_enabled} canSpeak={!!readerArticle && !detailLoading} />

      {booting && !bootstrap ? (
        <Splash />
      ) : bootError && !bootstrap ? (
        <BootError
          message={bootError}
          onRetry={() => {
            setBootError(null);
            setBootAttempt((value) => value + 1);
          }}
        />
      ) : (
        <div className="workspace">
          {showOnboarding ? (
            <Onboarding
              dataDir={bootstrap?.data_dir}
              onAddFeed={handleOnboardingAdd}
              onAddFeeds={handleOnboardingAddFeeds}
              onBrowseFeeds={() => openDialog("add-feed")}
              onOpenTransfer={() => openDialog("transfer")}
              onOpenSettings={() => openDialog("settings")}
            />
          ) : (
            <>
              <button
                type="button"
                className="sidebar-backdrop"
                onClick={() => setSidebarOpen(false)}
                aria-label="Close navigation"
                tabIndex={sidebarOpen ? 0 : -1}
              />
              <Sidebar
                bootstrap={bootstrap}
                scope={scope}
                onSelectScope={selectScope}
                onFocusSearch={focusSearch}
                onOpenDialog={openDialog}
                onAddFolder={async (name) => {
                  await api.createFolder(name);
                  await loadBootstrap();
                }}
                onMoveFeed={moveFeed}
                onRenameFolder={(folder) => openDialog("folder", { folder, action: "rename" })}
                onDeleteFolder={deleteFolder}
                onRenameTag={(tag) => openDialog("tag", { tag, action: "rename" })}
                onDeleteTag={deleteTag}
                onNavigate={() => setSidebarOpen(false)}
              />

              <ArticleListPanel
                width={settings?.article_list_width ?? 460}
                onSaveWidth={(width) => handleSaveSettings({ article_list_width: width })}
              >
                <TopBar
                  archived={scope.type === "archived"}
                  scopeTitle={scopeMeta.title}
                  scopeKind={scopeMeta.kind}
                  count={total}
                  filter={filterValue}
                  onFilterChange={changeFilter}
                  sort={effectiveSort}
                  onSortChange={setSort}
                  search={searchInput}
                  onSearchChange={setSearchInput}
                  onSearchClear={clearSearch}
                  searchRef={searchRef}
                  refreshing={refreshing}
                  progressLabel={progressLabel}
                  progressPercent={progressPercent}
                  canMarkAll={canMarkAll}
                  onMarkAll={markAllRead}
                  onRefresh={() => runRefresh()}
                  onToggleSidebar={() => setSidebarOpen(true)}
                />
                <ArticleList
                  articles={articles}
                  loading={loading}
                  loadingMore={loadingMore}
                  hasMore={hasMore}
                  error={listError}
                  selectedId={selectedId}
                  onSelect={openArticle}
                  onToggleStar={handleToggleStar}
                  onLoadMore={loadMore}
                  onRetry={() => fetchRef.current?.("reset")}
                  settings={settings}
                  sort={effectiveSort}
                  emptyState={renderEmptyState()}
                />
              </ArticleListPanel>

              <section className="reader-column" aria-label="Reader">
                {detailError ? (
                  <EmptyState
                    icon={Newspaper}
                    eyebrow="Article"
                    title="This article didn't load."
                    body={detailError}
                    action={
                      <Button
                        variant="primary"
                        size="sm"
                        onClick={() => openArticle(selectedIdRef.current, true)}
                      >
                        Try again
                      </Button>
                    }
                    secondaryAction={
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => openExternal(readerArticle?.url)}
                      >
                        Open original
                      </Button>
                    }
                  />
                ) : readerArticle ? (
                  <Reader
                    key={readerArticle.id}
                    article={readerArticle}
                    loading={detailLoading}
                    settings={settings}
                    allTags={tags}
                    hasPrev={!!prevId}
                    hasNext={!!nextId}
                    onPrev={() => openArticle(prevId)}
                    onNext={() => openArticle(nextId)}
                    onToggleStar={() => handleToggleStar(readerArticle)}
                    onToggleRead={() => handleToggleRead(readerArticle)}
                    onToggleArchive={toggleArchive}
                    onLoadFullArticle={loadFullArticle}
                    loadingFullArticle={!!fullArticleJobs[readerArticle.id]}
                    onSetTags={setTags}
                    onCreateTags={createTags}
                    onOpenOriginal={(target) => openExternal(target || readerArticle.url)}
                    onCopyLink={() => copyLink(readerArticle.url)}
                    onRefreshArticle={() => refreshArticle(readerArticle)}
                    onOpenShortcuts={() => setShortcutsOpen(true)}
                    onSummarize={() => summarizeArticle(readerArticle)}
                    summarizing={!!currentSummary?.loading}
                    summary={currentSummary?.visible ? currentSummary.result : null}
                    onDismissSummary={dismissSummary}
                  />
                ) : detailLoading ? (
                  <ReaderSkeleton />
                ) : (
                  <ReaderPlaceholder onOpenShortcuts={() => setShortcutsOpen(true)} />
                )}
              </section>
            </>
          )}
        </div>
      )}

      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        onSelectArticle={(value) => {
          setPaletteOpen(false);
          const id = typeof value === "number" ? value : value?.id;
          if (id != null) openArticle(id);
        }}
        onAction={handlePaletteAction}
        feeds={feeds}
      />
      <ShortcutsSheet open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />

      {bootstrap && (
        <>
          <AddFeedDialog
            open={dialog?.name === "add-feed"}
            onClose={closeDialog}
            folders={folders}
            existingFeeds={feeds}
            initialUrl={dialog?.initialUrl || ""}
            onAdded={handleFeedAdded}
            onImportOpml={() => openDialog("transfer")}
          />
          <ManageFeedsDialog
            open={dialog?.name === "manage-feeds"}
            onClose={closeDialog}
            feeds={feeds}
            folders={folders}
            onChanged={handleDataChanged}
            onAddFeed={() => openDialog("add-feed")}
          />
          <FolderDialog
            open={dialog?.name === "folder"}
            folder={dialog?.folder}
            action={dialog?.action}
            feedCount={feeds.filter((feed) => feed.folder_id === dialog?.folder?.id).length}
            onClose={closeDialog}
            onChanged={handleDataChanged}
          />
          <SettingsDialog
            open={dialog?.name === "settings"}
            initialSection={dialog?.section || "appearance"}
            onClose={closeDialog}
            settings={settings}
            ttsModel={tts.model}
            onRetryTts={() => tts.prepare().catch(() => {})}
            onSave={handleSaveSettings}
            dataInfo={dataInfo}
            onOpenDataDir={api.openDataDir}
          />
          <TransferDialog
            open={dialog?.name === "transfer"}
            onClose={closeDialog}
            onImported={handleImported}
            onChanged={handleDataChanged}
          />
          <StatsDialog
            open={dialog?.name === "stats"}
            onClose={closeDialog}
            onSelectFeed={handleSelectFeedFromStats}
          />
          <TagsDialog
            open={dialog?.name === "tags"}
            onClose={closeDialog}
            tags={tags}
            onChanged={handleTagsChanged}
          />
          <TagDialog
            open={dialog?.name === "tag"}
            tag={dialog?.tag}
            action={dialog?.action}
            onClose={closeDialog}
            onChanged={handleTagsChanged}
          />
        </>
      )}
    </div>
  );
}
