import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

/**
 * Tauri detection. The app is desktop-only, but the frontend should fail with a
 * useful message if it is ever opened in a plain browser by mistake.
 */
export const isTauri =
  typeof window !== "undefined" &&
  (!!window.__TAURI_INTERNALS__ || window.isTauri === true);

export function mediaSrc(value) {
  const prefix = "tyler-media://localhost/";
  if (!isTauri || typeof value !== "string" || !value.startsWith(prefix)) return value;
  return convertFileSrc(value.slice(prefix.length), "tyler-media");
}

export class OfflineError extends Error {
  constructor() {
    super(
      "Tyler needs the desktop app. Start it with `npm run tauri dev` instead of opening the Vite URL directly."
    );
    this.name = "OfflineError";
  }
}

function call(command, args) {
  if (!isTauri) return Promise.reject(new OfflineError());
  return invoke(command, args);
}

/** Human-readable message from a Rust command error or JS Error. */
export function errorMessage(error) {
  if (!error) return "Something went wrong.";
  if (typeof error === "string") return error;
  if (typeof error.message === "string") return error.message;
  try {
    return String(error);
  } catch {
    return "Something went wrong.";
  }
}

/**
 * Defensive field normalization. The contract exposes snake_case model fields
 * to the frontend (article.feed_id, bootstrap.data_dir, settings.mark_read_on_open)
 * while command arguments stay camelCase. These helpers keep the UI correct if a
 * command ever returns camelCase model fields, and are no-ops once the backend
 * matches the contract.
 */
function withAliases(source, aliases) {
  if (!source || typeof source !== "object") return source;
  const next = { ...source };
  for (const [snake, camel] of aliases) {
    if (next[snake] === undefined && next[camel] !== undefined) {
      next[snake] = next[camel];
    }
  }
  return next;
}

const FEED_ALIASES = [
  ["site_url", "siteUrl"],
  ["icon_url", "iconUrl"],
  ["folder_id", "folderId"],
  ["folder_name", "folderName"],
  ["unread_count", "unreadCount"],
  ["last_fetched_at", "lastFetchedAt"],
  ["last_status", "lastStatus"],
  ["fetch_interval", "fetchInterval"],
  ["is_active", "isActive"],
  ["created_at", "createdAt"],
];

const FOLDER_ALIASES = [
  ["unread_count", "unreadCount"],
  ["feed_count", "feedCount"],
];

const ARTICLE_ALIASES = [
  ["feed_id", "feedId"],
  ["feed_title", "feedTitle"],
  ["feed_icon", "feedIcon"],
  ["published_at", "publishedAt"],
  ["fetched_at", "fetchedAt"],
  ["is_read", "isRead"],
  ["is_starred", "isStarred"],
  ["is_archived", "isArchived"],
  ["reading_time", "readingTime"],
  ["image_url", "imageUrl"],
  ["tag_names", "tagNames"],
];

const DETAIL_ALIASES = [
  ...ARTICLE_ALIASES,
  ["content_html", "contentHtml"],
  ["full_content_loaded", "fullContentLoaded"],
  ["content_text", "contentText"],
  ["site_url", "siteUrl"],
  ["folder_name", "folderName"],
  ["prev_id", "prevId"],
  ["next_id", "nextId"],
];

const SETTINGS_ALIASES = [
  ["font_size", "fontSize"],
  ["line_width", "lineWidth"],
  ["article_list_width", "articleListWidth"],
  ["show_summaries", "showSummaries"],
  ["mark_read_on_open", "markReadOnOpen"],
  ["load_full_article_by_default", "loadFullArticleByDefault"],
  ["default_sort", "defaultSort"],
  ["refresh_minutes", "refreshMinutes"],
  ["feed_download_limit_mb", "feedDownloadLimitMb"],
  ["retention_days", "retentionDays"],
  ["date_format", "dateFormat"],
  ["reader_font", "readerFont"],
  ["reduce_motion", "reduceMotion"],
  ["open_links_in_app", "openLinksInApp"],
  ["notifications_enabled", "notificationsEnabled"],
  ["unread_badge", "unreadBadge"],
  ["tts_enabled", "ttsEnabled"],
  ["tts_voice", "ttsVoice"],
  ["tts_keep_playing", "ttsKeepPlaying"],
  ["llm_enabled", "llmEnabled"],
  ["llm_base_url", "llmBaseUrl"],
  ["llm_api_key", "llmApiKey"],
  ["llm_model", "llmModel"],
  ["llm_prompt", "llmPrompt"],
  ["llm_max_input_words", "llmMaxInputWords"],
  ["llm_max_output_words", "llmMaxOutputWords"],
];

function normalizeFeed(feed) {
  const next = withAliases(feed, FEED_ALIASES);
  if (next) next.icon_url = mediaSrc(next.icon_url);
  return next;
}

function normalizeFolder(folder) {
  return withAliases(folder, FOLDER_ALIASES);
}

function normalizeArticle(article) {
  const next = withAliases(article, ARTICLE_ALIASES);
  if (next) {
    next.feed_icon = mediaSrc(next.feed_icon);
    next.image_url = mediaSrc(next.image_url);
  }
  return next;
}

function normalizeDetail(article) {
  if (!article) return article;
  const next = normalizeArticle(withAliases(article, DETAIL_ALIASES));
  if (Array.isArray(next.tags)) next.tags = next.tags.map((tag) => ({ ...tag }));
  return next;
}

function normalizeSettings(settings) {
  return withAliases(settings, SETTINGS_ALIASES);
}

function normalizeBootstrap(bootstrap) {
  if (!bootstrap) return bootstrap;
  return {
    ...bootstrap,
    feeds: Array.isArray(bootstrap.feeds)
      ? bootstrap.feeds.map(normalizeFeed)
      : [],
    folders: Array.isArray(bootstrap.folders)
      ? bootstrap.folders.map(normalizeFolder)
      : [],
    tags: Array.isArray(bootstrap.tags) ? bootstrap.tags : [],
    settings: normalizeSettings(bootstrap.settings),
    unread_by_feed:
      bootstrap.unread_by_feed ?? bootstrap.unreadByFeed ?? {},
    unread_by_folder:
      bootstrap.unread_by_folder ?? bootstrap.unreadByFolder ?? {},
    data_dir: bootstrap.data_dir ?? bootstrap.dataDir ?? "",
  };
}

function normalizeList(result) {
  if (!result) return { articles: [], total: 0 };
  return {
    ...result,
    articles: Array.isArray(result.articles)
      ? result.articles.map(normalizeArticle)
      : [],
  };
}

function normalizeCandidates(result) {
  if (!result) return result;
  const list = result.candidates ?? result;
  if (!Array.isArray(list)) return result;
  const candidates = list.map((candidate) =>
    withAliases(candidate, [["site_url", "siteUrl"]])
  );
  return Array.isArray(result) ? candidates : { ...result, candidates };
}

function normalizeTagList(tags) {
  return Array.isArray(tags) ? tags : [];
}

function normalizeStats(stats) {
  if (!stats) return stats;
  return {
    ...stats,
    perFeed: Array.isArray(stats.perFeed)
      ? stats.perFeed.map((item) => withAliases(item, [["feed_id", "feedId"]]))
      : [],
    perDay: Array.isArray(stats.perDay) ? stats.perDay : [],
  };
}

/**
 * Settings patches arrive from the UI with contract snake_case keys. Older
 * command implementations key their patch handling by camelCase, so include
 * both spellings; unknown keys are ignored and the read path normalizes back.
 */
function settingsPatchForCommand(patch) {
  if (!patch || typeof patch !== "object") return patch;
  const next = { ...patch };
  for (const [snake, camel] of SETTINGS_ALIASES) {
    if (next[snake] !== undefined) next[camel] = next[snake];
  }
  return next;
}

export const api = {
  // Core
  ping: () => call("ping"),
  bootstrap: () => call("bootstrap").then(normalizeBootstrap),

  // Articles
  listArticles: (query = {}) =>
    call("list_articles", { query }).then(normalizeList),
  getArticle: (id) => call("get_article", { id }).then(normalizeDetail),
  fetchArticleSource: (articleId) => call("fetch_article_source", { articleId }),
  saveFullArticle: (articleId, html, sourceUrl, expectedUrl) => call("save_full_article", { articleId, html, sourceUrl, expectedUrl }).then(normalizeDetail),
  exportArticleMarkdown: (path, markdown) => call("export_article_markdown", { path, markdown }),
  printArticle: () => call("print_article"),
  openArticleLink: (url) => call("open_article_link", { url }),
  takeOpenRequests: () => call("take_open_requests"),
  updateUnreadBadge: (unread, enabled) => call("update_unread_badge", { unread, enabled }),
  generateSummary: (articleId) => call("generate_summary", { articleId }),
  setArticleState: (id, patch) => call("set_article_state", { id, patch }),
  markAllRead: (scope = {}) => call("mark_all_read", { scope }),
  cacheArticleMedia: (articleId) =>
    call("cache_article_media", { articleId }),
  saveImageFromUrl: (url) => call("save_image_from_url", { url }),

  // Feeds & folders
  discoverFeeds: (url) =>
    call("discover_feeds", { url }).then(normalizeCandidates),
  addFeed: (args) => call("add_feed", { args }).then(normalizeFeed),
  addFeeds: (args) => call("add_feeds", { args }).then((result) => ({
    feeds: (result?.feeds || []).map(normalizeFeed),
    failures: result?.failures || [],
  })),
  updateFeed: (args) => call("update_feed", { args }).then(normalizeFeed),
  deleteFeed: (id) => call("delete_feed", { id }),
  refresh: (feedId = null, scheduled = false) =>
    call("refresh", { feedId, scheduled }),
  refreshStatus: () => call("refresh_status"),

  createFolder: (name) =>
    call("create_folder", { name }).then(normalizeFolder),
  renameFolder: (id, name) => call("rename_folder", { id, name }),
  deleteFolder: (id) => call("delete_folder", { id }),

  // Tags
  createTag: (name, color) =>
    call("create_tag", { name, color }).then((tag) => ({ ...tag })),
  createTags: (names, color = "#c2410c") =>
    call("create_tags", { names, color }).then(normalizeTagList),
  renameTag: (id, name, color) => call("rename_tag", { id, name, color }),
  deleteTag: (id) => call("delete_tag", { id }),
  setArticleTags: (articleId, tagIds) =>
    call("set_article_tags", { articleId, tagIds }).then(normalizeTagList),
  listTags: () => call("list_tags").then(normalizeTagList),

  startTts: (sessionId) => call("start_tts", { sessionId }),
  stopTts: (sessionId) => call("stop_tts", { sessionId }),
  async synthesizeTts(sessionId, voice, tokens) {
    const bytes = await call("synthesize_tts", { sessionId, voice, tokens });
    const buffer = bytes instanceof ArrayBuffer ? bytes : new Uint8Array(bytes).buffer;
    return new Float32Array(buffer);
  },
  prepareTts: (voice) => call("prepare_tts", { voice }),

  // Settings & data
  getSettings: () => call("get_settings").then(normalizeSettings),
  setSettings: (patch) =>
    call("set_settings", { patch: settingsPatchForCommand(patch) }).then(
      normalizeSettings
    ),
  dataInfo: () => call("data_info"),
  openDataDir: () => call("open_data_dir"),
  exportBackup: (path) => call("export_backup", { path }),
  importBackup: (path) =>
    call("import_backup", { path }).then(normalizeBootstrap),
  cleanupArticles: (args) => call("cleanup_articles", { args }),
  getStats: () => call("get_stats").then(normalizeStats),

  // OPML
  opmlImport: (path) => call("opml_import", { path }),
  opmlImportUrl: (url) => call("opml_import_url", { url }),
  opmlExport: (path) => call("opml_export", { path }),

  listenFeedUpdates(onUpdate) {
    if (!isTauri) return () => {};
    let cancelled = false;
    let unlisten;
    listen("feed:updated", (event) => {
      if (!cancelled) onUpdate?.(event.payload);
    }).then((cleanup) => {
      if (cancelled) cleanup();
      else unlisten = cleanup;
    }).catch(() => {});
    return () => { cancelled = true; unlisten?.(); };
  },

  /**
   * Subscribe to refresh events. Returns a synchronous cleanup function that is
   * always safe to call, even if the async listener setup has not finished.
   */
  listenRefresh(onProgress, onDone) {
    if (!isTauri) return () => {};
    let cancelled = false;
    let unlisteners = [];

    Promise.all([
      listen("refresh:progress", (event) => {
        if (!cancelled) onProgress?.(event.payload);
      }),
      listen("refresh:done", (event) => {
        if (!cancelled) onDone?.(event.payload);
      }),
    ])
      .then((fns) => {
        if (cancelled) fns.forEach((fn) => fn());
        else unlisteners = fns;
      })
      .catch(() => {
        // Events are a progressive enhancement; refresh still resolves.
      });

    return () => {
      cancelled = true;
      unlisteners.forEach((fn) => {
        try {
          fn();
        } catch {
          /* noop */
        }
      });
      unlisteners = [];
    };
  },
};
