# PROJECT.md

## 1. Project description

Tyler is a local-first RSS reader for macOS, Windows, and Linux.
It is built with Tauri 2, Rust, React 19, Vite, and SQLite, with a three-pane reading interface.
It subscribes to RSS, Atom, and JSON feeds, organizes them into folders and tags, and supports smart views, full-text search, and offline media.
All subscriptions, articles, reading state, cached media, and settings are stored on the machine; there is no account, cloud sync, or telemetry. Optional LLM summaries send article text only to the user's configured endpoint on explicit request.
The Rust backend owns HTTP, feed parsing, SQLite/FTS5, media caching, optional LLM summary requests/cache, OPML, and backup/restore.
The React frontend owns the library, reader, command palette, dialogs, and keyboard-driven workflows.

## 2. Full feature list

### Subscriptions and discovery
- Add feeds by feed URL or by site URL; Tyler discovers advertised feeds from HTML `<link rel="alternate">` tags and common feed paths.
- Feed discovery/refresh, OPML link imports, and full-article fetches append `ref=tyler-rss.com` to request URLs when no `ref` query parameter exists. Existing values, including empty values, are preserved.
- Feed, discovery-page, and OPML-link downloads share `feedDownloadLimitMb`: 20 MiB by default, configurable from 1–100 MiB in Settings → Feeds & storage. Read at most the limit plus one byte after decompression, including chunked responses. Oversized downloads report the host, limit, and Settings location; subscription/refresh errors remain visible in Manage feeds and appear in notifications. Images and full-article source pages retain their separate 5 MiB caps.
- Feed discovery shows candidates with titles, hosts, and feed kinds before subscribing.
- A built-in catalog of 91 curated publications across technology, Apple, development, world news, business, science, design, gaming, audio, food, sport, photography, arts, health, security, and productivity.
- The starter catalog is searchable, grouped by category, and marks publications already in the library. Select multiple cards across searches/categories and subscribe in one batch with a shared destination folder. Discovered candidates can also be selected together; a single selection can be copied into the editable URL/title fields before subscribing.
- The welcome screen supports multiple starter selections and links to the full catalog.
- Adding a subscription saves it immediately with `pending` status. A background worker discovers/fetches/parses feeds; a separate media worker caches icons and covers so slow images do not delay the other subscriptions. Interrupted pending/fetching subscriptions resume on launch.
- Folders can be created, renamed, deleted, collapsed, and used to group feeds; feeds and folders show unread counts. Rename/delete buttons are available beside sidebar folders and in Manage feeds. Empty folders delete immediately; non-empty folders require one styled in-app confirmation, then their feeds move to Uncategorized with saved articles preserved.
- Feeds can be renamed, moved between folders, refreshed individually, assigned a fetch interval, deactivated, or deleted. Drag sidebar feed rows onto folder headers or Uncategorized; the destination highlights and opens after a successful move. Manage feeds remains the keyboard-accessible alternative.
- Automatic and startup refresh select only due feeds using their last-fetch time and individual interval. The global Auto-refresh preference sets the maximum delay between periodic checks; earlier feed deadlines wake the scheduler sooner. Manual only disables periodic checks. Explicit button/keyboard/tray refresh bypasses intervals. First subscriptions still load immediately.
- Feed ingestion uses an immediate SQLite transaction; articles, FTS changes, source metadata, and HTTP validators commit together. Failed ingestion leaves previous validators available for retry, and no network/media downloads run inside that transaction.
- Any subscription, including one added from the catalog, has an editable URL in Manage feeds. URL changes preserve the feed ID, saved articles, reading state, stars, and tags; clear old HTTP validators/source metadata; and queue a fresh fetch. Duplicate or unsupported URLs are rejected atomically. URL editing waits while that feed is actively fetching; folder/title edits remain available.
- Feed icons are fetched and cached locally; failed fetches retain an error message and status.

### Reading library
- Three-pane desktop layout: navigation sidebar, article list, and full-width reader. Drag the article list’s right edge to resize it from 280–600 px (460 px by default); the width is saved in SQLite and restored on launch. The focused separator supports Left/Right in 10 px steps and Home/End for limits; Settings → Reading also offers an article list width slider.
- Smart views: All, Unread, Starred, Today, and Archive with live counts.
- Scope the library by feed, folder, or tag.
- Filter by All, Unread, or Starred; sort by Newest, Oldest, or By feed.
- Date-grouped article rows with feed icon, title, summary, thumbnail, relative time, unread state, and star control.
- Infinite scrolling / load-more pagination uses cursors for newest, oldest, feed, and search ordering, so reading or unstarring loaded stories does not skip the next page.
- Background refreshes merge new stories into the already loaded list instead of rebuilding it. Fetch from the first page through the last loaded article (or the end if it no longer matches), then advance the cursor to the final fetched page so large updates cannot leave gaps. Load-more merges by ID to avoid duplicate rows when results reorder. The open article, selected row, and loaded rows stay in place; new stories appear at the top for newest-first and at the end for the other orders. If a late article request clears the detail, the reader keeps showing the last loaded copy while the article is still selected.
- Mark all as read for the current scope, feed, folder, tag, or search.
- Read/unread and starred state are persisted immediately and reflected in counts.
- Archive has a sidebar count and its own queries/search/sorting. Archive/Restore actions in the reader move stories between the active library and archive; read/star state is preserved.
- Article list and reader use Down/Up arrows for next/previous article navigation. These shortcuts pause in text fields and overlays and prevent native arrow scrolling when handled. Reader navigation hints and the shortcut sheet show the arrow keys.

### Reader
- Sanitized article HTML rendered in the reader. Scripts, forms, objects, and unsafe embeds are removed. Sandboxed HTTPS embeds allow only YouTube `/embed/` and Vimeo `/video/` players, with matching backend/frontend allowlists and CSP.
- Load full article fetches up to 5 MiB of public source HTML with a 20-second timeout. Mozilla Readability extracts the article in an inert document; the backend sanitizes and stores it with full-text search updates. A source URL check guards against library replacement; refresh preserves extracted HTML/text/reading time. Extraction does not bypass paywalls or execute page JavaScript.
- Settings → Reading → Load full article by default is off by default. When enabled, opening any article automatically uses the same extraction/save flow unless full text is already saved. Enabling the setting also loads the current article. In-flight requests are shared with the manual action; failures leave feed content readable and allow a manual retry. Automatic successes do not show a toast.
- Audio/video enclosures from feed links and Media RSS are saved in `article_enclosures` and rendered with native controls and no preloading. Inline audio/video also receive controls. Streaming and provider embeds remain online.
- Find in article (Cmd/Ctrl+F) highlights up to 1,000 literal, case-insensitive body matches, including matches across inline elements; Enter/Shift+Enter or buttons navigate matches.
- Export current article as Markdown using Turndown, including title and source metadata; Print/PDF (Cmd/Ctrl+P) uses the native/system print dialog with article-only print styles. PDF output depends on OS print support.
- Reader typography controls: serif or sans typeface, font size, line width, density, and date format.
- Cmd/Ctrl with `+` (or `=`) and `-` adjusts the saved reader font size by 1 px within the existing 14–24 px limits. Rapid presses and key repeats save in order; shortcuts pause in text fields and overlays.
- Article actions: star/unstar, mark read/unread, assign color-coded tags, copy link, open original, previous/next article, and refresh the current article.
- Optional LLM summaries through a user-supplied OpenAI compatible API base URL, API key, and model. Clicking Summarize in either reader action bar starts generation immediately using the editable saved prompt. The existing sparkle icon gently pulses while generating, honoring reduced motion; summary generation has no loading bar. The reader, navigation, and keyboard shortcuts remain usable; there is no extra prompt field or confirmation dialog. The default prompt requests a concise, faithful plain-text summary and treats article text as source material.
- Completed summaries appear in a dismissible panel below the compact toolbar, with Copy and independent scrolling. The article remains readable below it. App-owned jobs survive article navigation and attach each result to its source article/configuration; a notification announces completion for a different article. Closing and reopening a result reuses it. Library imports discard frontend jobs and ignore their late completions.
- Generated responses are cached in backend memory until the app closes. Cache keys cover article ID/title/text, endpoint, API key, model, prompt, and word limits. Identical concurrent requests share a per-entry lock. The frontend also keeps session-only job/results state keyed by article text and LLM configuration to prevent duplicate clicks and stale results after settings/content changes. Errors/empty responses are retryable, and summaries never enter SQLite or backups.
- Optional input/output word limits default to 0 (unlimited). Input clipping preserves paragraphs and counts whitespace-separated words across the title and article body; prompts are not clipped. Articles without body text use the feed summary. An output limit adds a word-count instruction and sends `max_tokens = ceil(words × 4/3)`; this is an approximate word cap, subject to model/provider limits. Output truncation is indicated in the summary panel.
- Models that explicitly reject `max_tokens` in a 400/422 response and name `max_completion_tokens` are retried once using that field with the same token budget. Small budgets can be exhausted by reasoning before visible text is returned; empty responses show an actionable error and are not cached.
- Article tags can be added or removed from the reader without leaving the article. Comma-separated entry creates or reuses several tags and applies all of them to the current article.
- Inline article images and cover images are cached locally and rewritten to the `tyler-media://` protocol.
- Reader shows feed, folder, author, publication time, reading time, and actions to copy or open the original article.
- The compact reader toolbar is visible as soon as an article opens and stays pinned to the top while scrolling. It occupies its own row so the article header is not covered; visibility does not depend on scroll position.
- Keyboard shortcuts sheet available from the reader and app chrome. Command-palette results use Ctrl+N/Ctrl+P for next/previous selection on all platforms; the palette footer and shortcut sheet document these keys. Enter opens the selection.

### Search and organization
- SQLite FTS5 full-text search across article titles, article text, authors, and feed titles.
- Search falls back to normalized LIKE matching when FTS cannot represent a query.
- Search respects the active scope and filters.
- Tags are color-coded, globally unique by name, and manageable from a dedicated Tags dialog.
- Tags can be renamed, recolored, deleted, and assigned to articles. Sidebar pencil/trash controls open an edit dialog or delete an unused tag immediately; deleting a tag used by articles requires confirmation and preserves those articles. Tag edits update the current reader and library views.
- The reader and Tags dialog accept comma-separated names, trim each name, and ignore empty entries. Batch creation runs in one transaction and reuses existing or repeated names using SQLite's case-insensitive name matching, preserving existing tag colors.

### Data, portability, and maintenance
- Local SQLite database with WAL mode, foreign keys, and FTS triggers.
- OPML import from a local file or directly from an HTTP(S) link; native file drops import `.opml` files. Packaged builds associate `.opml` files with Tyler.
- `feed:` links open Add feed with the HTTP(S) source prefilled. Single-instance dispatch handles subsequent launches; a backend queue preserves requests received before frontend startup.
- OPML export preserves folder structure.
- Portable `.tyler.zip` backup containing the SQLite database and cached media.
- Backup restore validates SQLite integrity, references, schema compatibility, and library queries, then runs migrations in staging before replacing live data. Failed installation rolls back; older safety copies are pruned only after success.
- Restore refuses to replace files while another command or media request holds the library open. The safety copy preserves the previous database, WAL/SHM files when present, and media.
- Reading statistics dialog: totals, 14-day activity chart, and per-feed breakdown.
- Manual cleanup of old articles, with starred and unread articles preserved.
- Automatic retention runs after refresh when `retentionDays > 0`. It shares the manual cleanup implementation, preserves unread/starred articles, deletes related media, and updates library counts. Selection/deletion share an immediate SQLite transaction. Zero means forever.
- Data directory override through `TYLER_DATA_DIR`.
- Settings → Feeds & storage → Open asks the backend to open the actual data directory in the system file manager, including overridden locations; failures appear in Settings.
- No account, sync service, telemetry, or analytics.

### App experience
- A themed loading animation is present in the HTML before React loads and stays visible during library bootstrap. The native window is shown after page load to avoid displaying an empty webview.
- Settings panel: theme, reader typeface, font size, line width, density, date format, summary visibility, mark-read-on-open, auto-refresh interval, retention/cleanup window, and reduced motion.
- Settings → LLM summaries has an explicit Save LLM settings form for enabling summaries, API base URL/key/model, main prompt, and word limits. Other preferences save immediately. LLM requests run in blocking workers with 15s connection and 180s total timeouts and no redirects. Endpoint URLs require HTTP(S) without embedded credentials, query parameters, or fragments; `/chat/completions` is appended to the supplied base path. The API key is stored in local settings and included in backups.
- Light, dark, and system-following themes.
- Compact density and reduced-motion support.
- Command palette (`⌘K` / `Ctrl+K`) for navigation, feeds, articles, and app actions.
- Keyboard shortcuts for search, refresh, article navigation, read state, stars, and reader font size.
- Background refresh with progress events, startup refresh, and configurable periodic refresh. New subscriptions show loading indicators; feed-update events and a polling fallback keep the library current while fetching.
- Database and filesystem IPC commands run through `spawn_blocking`, keeping SQLite lock waits and large queries off the UI thread. Article ingestion uses a short transaction; network image downloads run after it commits.
- Responsive sidebar with mobile/backdrop behavior.
- Native macOS overlay titlebar with adjusted traffic-light positioning.
- Tray icon with Open Tyler, Refresh feeds, and Quit Tyler. Closing the main window hides it; tray refresh remains available.
- Unread count in the tray tooltip/window title, plus an optional Dock/supported taskbar badge. Windows has no numeric badge API.
- Optional new-article notifications after refresh, enabled explicitly in Settings with system permission. Unread badge and notification settings persist.
- Open links in Tyler is exposed in Settings → Reading. Remote pages use separate windows without main-window IPC capabilities; HTTP(S)/mailto links otherwise use the system handler.
- Custom app icon and in-app brand mark.

### Product website
- `website/` is a standalone static landing page with feature, local data, keyboard shortcut, and download sections. Its 18 feature cards use the same layout and visual weight for subscriptions, reading, search, organization, summaries, full articles/media, local storage, portability, retention, appearance, keyboard navigation, and desktop controls.
- The LLM summaries feature card explains one-click background generation, the user's endpoint/prompt, and copying results. Data copy distinguishes the local library from explicitly requested summary calls and explains that LLM credentials are stored locally and included in backups; generated summaries remain in memory.
- The Saved locally card and data section cover locally stored articles, reading/archive state, preferences, and cached images. Copy distinguishes saved content from streamed media, source-page requests, and optional LLM calls. The shortcut table includes Down/Up article navigation, Ctrl+N/Ctrl+P palette selection, in-article find, match navigation, print/PDF, and reader font controls. The facts strip and command-palette card also show arrow-key article navigation.
- Serve `website/` as static files; it has no separate runtime dependencies or build requirement. Its existing app image is reused.
- Motion includes a staggered hero entrance, one-time section/card reveals through `IntersectionObserver`, and subtle button, navigation, and card hover feedback. Animations and smooth scrolling respect the system reduced-motion preference; content remains visible without JavaScript.
- Clicking the hero image opens a modal viewer with approximately 20 px side margins and the original aspect ratio. Tall images scroll vertically; Escape, the close button, or clicking outside the image dismisses the viewer. Without JavaScript, the link opens the image directly.

## 3. File hierarchy

Generated and ignored directories are omitted from the tree below: `node_modules/`, `dist/`, `src-tauri/target/`, and `src-tauri/gen/`.

```text
tyler-rss/
├── .github/
│   ├── workflows/release.yml          # Tag-only CI/CD: six native builds, twelve verified installers, then publish.
│   └── scripts/                      # check-release.mjs validates versions and installer assets.
├── scripts/bump-version.mjs           # Prompts for vMAJOR.MINOR.PATCH; updates five version files without committing or tagging.
├── index.html                         # Vite HTML entry; includes the initial loading screen, early theme script, shared CSS, and Tyler favicon.
├── package.json                       # Frontend metadata, npm scripts (dev/build/tauri/check/version:bump/release:check), and JS dependencies.
├── package-lock.json                  # Locked npm dependency tree; generated by npm.
├── vite.config.ts                     # Vite config: React plugin, relative base, fixed dev port 1420, ignores src-tauri.
├── .gitignore                         # Ignores build output, Tauri target/gen, node_modules, .DS_Store, logs, and env files.
├── README.md                          # Public overview: features, getting started, privacy, shortcuts, backups, source builds, AI assistance, and contributing.
├── LICENSE                            # MIT license; copyright 2026 Nitin Bansal.
├── CONTRACT.md                        # Internal backend/frontend interface and design contract; update when IPC or behavior changes.
├── PROJECT.md                         # This file: project overview, features, hierarchy, schema, and maintenance notes.
├── website/                           # Standalone static product website.
│   ├── index.html                     # Features, optional LLM summaries, local data, shortcuts, and download links.
│   ├── styles.css                     # Responsive landing-page styles and reduced-motion-aware animations.
│   ├── motion.js                      # Progressive, one-time scroll reveals without runtime dependencies.
│   ├── image-viewer.js                # Hero image modal opening, dismissal, and page scroll locking.
│   └── assets/tyler-rss.jpg            # Existing desktop app image.
├── public/
│   ├── theme.js                       # Resolves the saved/system theme before the initial loading screen paints.
│   └── tyler.svg                      # Web/favicon copy of the app icon used by index.html.
│
├── src/                               # React frontend.
│   ├── main.jsx                       # React entry; imports fonts/component styles, detects the OS, mounts ToastProvider and App.
│   ├── App.jsx                        # Main shell and state hub: bootstrap, query state, article list/detail, background summary jobs, refresh, dialogs, keyboard handling.
│   ├── api.js                         # Typed-ish wrappers around Tauri invoke; normalizes snake_case/camelCase fields and subscribes to refresh events.
│   ├── store.jsx                      # Toast context/provider with success/error/info notifications and auto-dismiss timers.
│   ├── styles.css                     # Global design tokens, theme variables, layout, sidebar, article list, onboarding, and shared UI styles.
│   ├── lib/
│   │   ├── format.js                  # Formatting helpers: relative/absolute dates, date groups, times, hostnames, byte sizes, and reading time.
│   │   ├── tags.js                    # Comma-separated tag name parsing; trims whitespace and drops empty entries.
│   │   └── feedStarters.js            # Curated 91-feed starter catalog, categories, onboarding selection, and loose feed-URL comparison.
│   └── components/
│       ├── BrandMark.jsx              # Inline SVG brand mark matching the desktop icon (terracotta tile, page, RSS signal).
│       ├── Onboarding.jsx             # First-run URL form, multi-select starter grid, full catalog link, OPML shortcut, and settings link.
│       ├── Sidebar.jsx                # Navigation, feed loading indicators, feed-to-folder drag/drop, tags, and library actions.
│       ├── TopBar.jsx                 # Article-list header: scope title, counts, filters, sort, search, mark-all-read, refresh, sidebar toggle.
│       ├── ArticleListPanel.jsx       # Resizable article-list panel with pointer/keyboard controls and queued width saves.
│       ├── ArticleList.jsx            # Scrollable article rows, date grouping, skeletons, empty states, star actions, and load-more handling.
│       ├── Reader.jsx                 # Full article reader: toolbar, summary action/result panel with copy, typography, tags, state actions, media, prev/next navigation.
│       ├── ReaderTools.jsx             # Full text, archive, find, Markdown/print tools, and enclosure players.
│       ├── ArticleContent.jsx         # DOMPurify-based article HTML sanitizer and link/image rewriting for the reader.
│       ├── CommandPalette.jsx         # Keyboard command palette: app actions, feed search, article search, and keyboard navigation.
│       ├── ShortcutsSheet.jsx         # Accessible keyboard-shortcut reference modal.
│       ├── ui.jsx                     # Shared primitives: Spinner, Button, IconButton, Badge, Kbd, SegmentedControl, Select, Menu, EmptyState, FeedIcon.
│       ├── reader.css                 # Reader, command-palette, shortcuts, and shared reading-specific styles.
│       ├── dialogs.css                # Self-contained dialog styles and tokens for all modal dialogs.
│       └── dialogs/
│           └── index.jsx              # All modal dialogs: add feed + starter catalog, manage feeds, folder rename/delete, tag edit/delete, settings/LLM configuration, transfer/OPML, stats, tags.
│
└── src-tauri/                         # Tauri/Rust backend and desktop configuration.
    ├── Cargo.toml                     # Rust package metadata and dependencies (Tauri/tray, desktop plugins, rusqlite, reqwest, encoding_rs, feed-rs, ammonia, zip; Rust 1.90+.).
    ├── Cargo.lock                     # Locked Rust dependency graph; generated by Cargo.
    ├── build.rs                       # Tauri build script.
    ├── tauri.conf.json                # Tauri app config: product name, window, CSP/devCSP, bundle targets, macOS 13.3 minimum, icons, category, descriptions.
    ├── capabilities/
    │   └── default.json               # Desktop capability permissions: core, event, drag, dialog, opener, and notification permissions for the main window.
    ├── icons/
    │   ├── icon.svg                    # Canonical Tyler app icon source. Regenerate all other icon files from this.
    │   ├── 32x32.png                   # Generated small desktop icon.
    │   ├── 64x64.png                   # Generated desktop icon.
    │   ├── 128x128.png                 # Generated desktop icon.
    │   ├── 128x128@2x.png              # Generated HiDPI desktop icon.
    │   ├── icon.png                    # Generated primary PNG icon used by bundles.
    │   ├── icon.icns                   # Generated macOS app icon.
    │   ├── icon.ico                    # Generated Windows app icon.
    │   ├── Square*Logo.png             # Generated Windows store tile assets.
    │   ├── StoreLogo.png               # Generated Windows store logo.
    │   ├── android/                    # Generated Android launcher/adaptive icon assets.
    │   └── ios/                        # Generated iOS app-icon assets.
    └── src/
        ├── main.rs                     # Thin binary entry point; calls tyler_lib::run() with Windows subsystem configuration in release.
        ├── lib.rs                      # Tauri builder: plugins, shared AppState, custom tyler-media protocol, setup, and command registration.
        ├── reader.rs                   # Source fetch/save, Markdown file writing, native print, and original-page windows.
        ├── desktop.rs                  # Tray actions, unread badges, pending OPML/feed open requests.
        ├── commands.rs                 # IPC command surface: bootstrap, articles, feeds, refresh, folders, tags, settings, OPML, backups, stats, media.
        ├── models.rs                   # Serde DTOs for feeds, folders, articles, tags, settings, counts, bootstrap, and command arguments.
        ├── db.rs                       # SQLite schema/migrations, guarded library connections, staged database preparation, FTS5 recovery, counts, and settings access.
        ├── feeds.rs                    # HTTP clients, URL normalization, feed parsing, sanitization, discovery, refresh/ingest, and image/icon caching.
        ├── articles.rs                 # Article queries, FTS/LIKE search, details, tag queries, state updates, mark-all-read, and media caching.
        ├── opml.rs                     # OPML outline parsing, folder creation, import from path/string, and folder-preserving export.
        ├── settings.rs                 # Settings defaults, validation, typed reads, patch writes, and last-refresh timestamp helpers.
        ├── summaries.rs                # OpenAI compatible summary requests, prompt assembly, word clipping/token budgets, and session-only cache with request coalescing.
        ├── subscriptions.rs            # Bounded background queues for first feed fetches and media caching, startup recovery, and feed-update events.
        ├── paths.rs                    # Data directory resolution, media URL helpers, directory creation, and containment checks for media serving/deletion.
        ├── transfer.rs                 # ZIP backup export, staged validation/migration, guarded replacement/rollback, and timestamped safety backups.
        └── error.rs                    # AppError variants, Display messages, and conversions from SQLite/IO/HTTP/JSON/ZIP/XML/URL errors.
```

## 4. Data schema details

### Database location

- Default: `~/.tyler-rss/tyler.sqlite`
- Override: set `TYLER_DATA_DIR` to another directory.
- SQLite is configured with `journal_mode=WAL`, `foreign_keys=ON`, `busy_timeout=5000`, and `synchronous=NORMAL`.
- Schema version is stored in `PRAGMA user_version`; currently `4`. Version 4 adds extracted-article persistence and audio/video enclosures and clears validators once for reparsing. Version 3 repairs legacy media paths and URLs to include the `media/` prefix without redownloading files.
- Migrations are additive and idempotent (`ALTER TABLE ... ADD COLUMN` when missing) to tolerate older databases and imported backups.

### Tables

```text
folders
  id            INTEGER PRIMARY KEY AUTOINCREMENT
  name          TEXT NOT NULL COLLATE NOCASE UNIQUE
  position      INTEGER NOT NULL DEFAULT 0
  created_at    TEXT NOT NULL

feeds
  id              INTEGER PRIMARY KEY AUTOINCREMENT
  title           TEXT NOT NULL DEFAULT ''
  url             TEXT NOT NULL UNIQUE
  site_url        TEXT
  description     TEXT
  icon_url        TEXT
  icon_remote     TEXT
  folder_id       INTEGER REFERENCES folders(id) ON DELETE SET NULL
  last_fetched_at TEXT
  last_status     TEXT NOT NULL DEFAULT 'never'  -- never, pending, fetching, ok, error
  error           TEXT
  fetch_interval  INTEGER NOT NULL DEFAULT 30
  is_active       INTEGER NOT NULL DEFAULT 1
  created_at      TEXT NOT NULL
  etag            TEXT
  last_modified   TEXT

articles
  id             INTEGER PRIMARY KEY AUTOINCREMENT
  article_id     INTEGER GENERATED ALWAYS AS (id) VIRTUAL
  feed_id        INTEGER NOT NULL REFERENCES feeds(id) ON DELETE CASCADE
  guid           TEXT NOT NULL
  title          TEXT NOT NULL DEFAULT ''
  url            TEXT
  author         TEXT
  summary        TEXT NOT NULL DEFAULT ''
  content_html   TEXT NOT NULL DEFAULT ''
  content_text   TEXT NOT NULL DEFAULT ''
  full_content_loaded INTEGER NOT NULL DEFAULT 0
  feed_title     TEXT NOT NULL DEFAULT ''
  published_at   TEXT NOT NULL
  fetched_at     TEXT NOT NULL
  is_read        INTEGER NOT NULL DEFAULT 0
  is_starred     INTEGER NOT NULL DEFAULT 0
  is_archived    INTEGER NOT NULL DEFAULT 0
  reading_time   INTEGER NOT NULL DEFAULT 1
  image_url      TEXT
  UNIQUE(feed_id, guid)

article_enclosures
  article_id INTEGER NOT NULL REFERENCES articles(id) ON DELETE CASCADE
  url        TEXT NOT NULL
  mime       TEXT NOT NULL
  PRIMARY KEY(article_id, url)

tags
  id          INTEGER PRIMARY KEY AUTOINCREMENT
  name        TEXT NOT NULL COLLATE NOCASE UNIQUE
  color       TEXT NOT NULL DEFAULT '#c2410c'
  created_at  TEXT NOT NULL

article_tags
  article_id  INTEGER NOT NULL REFERENCES articles(id) ON DELETE CASCADE
  tag_id      INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE
  PRIMARY KEY (article_id, tag_id)

media
  id          INTEGER PRIMARY KEY AUTOINCREMENT
  article_id  INTEGER NOT NULL REFERENCES articles(id) ON DELETE CASCADE
  url         TEXT NOT NULL
  local_path  TEXT NOT NULL
  mime        TEXT
  bytes       INTEGER NOT NULL DEFAULT 0
  created_at  TEXT NOT NULL
  UNIQUE(article_id, url)

settings
  key         TEXT PRIMARY KEY
  value       TEXT NOT NULL          -- JSON-encoded value
```

### Relationships

- A folder has many feeds; deleting a folder moves its feeds to Uncategorized (`folder_id = NULL`).
- A feed has many articles; deleting a feed cascades to its articles.
- Articles and tags have a many-to-many relationship through `article_tags`.
- An article has many cached media records; deleting an article cascades to its media rows.
- `feeds.url` is globally unique; `(feed_id, guid)` is unique so the same story is not inserted twice for a feed.
- `article_id` is a generated virtual alias of `articles.id`, kept for compatibility with FTS/search consumers.
- Derived values such as feed/folder/tag unread counts and feed counts are computed by queries and are not stored as columns.
- Timestamp columns store RFC3339 strings in UTC. The Today view is computed from local midnight converted to UTC.

### Indexes

```text
idx_articles_feed        ON articles(feed_id)
idx_articles_published   ON articles(published_at DESC)
idx_articles_unread      ON articles(is_read, is_archived)
idx_articles_starred     ON articles(is_starred)
idx_articles_archived    ON articles(is_archived)
idx_article_tags_tag     ON article_tags(tag_id)
idx_media_article        ON media(article_id)
```

### Full-text search

- `articles_fts` is an FTS5 external-content table over `articles`.
- Indexed columns: `article_id UNINDEXED`, `title`, `content_text`, `author`, `feed_title`.
- Insert/delete/update triggers keep FTS in sync with `articles`.
- FTS is rebuilt whenever its table is created or replaced, when forced during migration, or when article and FTS document counts differ. The index count comes from `articles_fts_docsize`; counting the external-content table itself reads the articles table and cannot detect an empty index.
- Backup validation also checks FTS against article content and rebuilds an inconsistent index before installation.
- Search input is escaped into tokens; queries that cannot be represented fall back to LIKE matching.

### Settings keys and defaults

Settings values are stored as JSON text and use camelCase keys:

| Key | Default | Notes |
| --- | --- | --- |
| `theme` | `"system"` | `system`, `light`, or `dark`. |
| `fontSize` | `18` | Clamped to 14–24. |
| `articleListWidth` | `460` | Article-list panel width in px; clamped to 280–600; saved after dragging or keyboard adjustments. |
| `lineWidth` | `720` | Clamped to 520–920. |
| `density` | `"comfortable"` | `comfortable` or `compact`. |
| `showSummaries` | `true` | Show article summaries in the list. |
| `markReadOnOpen` | `true` | Mark an article read when opened. |
| `loadFullArticleByDefault` | `false` | Automatically fetch/save full text when an article opens; reuse saved full text. Manual per-article loading remains available. |
| `defaultSort` | `"newest"` | `newest` or `oldest`. |
| `refreshMinutes` | `30` | Maximum interval between scheduled checks; earlier individual feed deadlines wake sooner. 0 disables periodic checks; clamped to 0–10080. |
| `feedDownloadLimitMb` | `20` | Maximum decoded bytes per feed, discovery page, or OPML-link download in MiB; integer from 1–100. Oversized downloads explain how to raise it and retry. |
| `retentionDays` | `0` | Automatic cleanup after refresh; unread/starred preserved; 0 = forever; clamped to 0–36500. |
| `dateFormat` | `"relative"` | `relative` or `absolute`. |
| `readerFont` | `"serif"` | `serif` or `sans`. |
| `reduceMotion` | `false` | Disables non-essential animation. |
| `openLinksInApp` | `false` | Settings → Reading; open originals/links in a separate Tyler window. |
| `notificationsEnabled` | `false` | Optional new-article system notifications after refresh. |
| `unreadBadge` | `true` | Dock/supported taskbar unread count; tray tooltip/title always show count. |
| `llmEnabled` | `false` | Enable optional summary generation; no automatic LLM requests. |
| `llmBaseUrl` | `""` | HTTP(S) API base URL; append `/chat/completions`. |
| `llmApiKey` | `""` | Bearer token; local settings storage, included in backups. |
| `llmModel` | `""` | Exact model ID accepted by the endpoint. |
| `llmPrompt` | Built-in plain-text summary instructions | Editable; cannot be blank. |
| `llmMaxInputWords` | `0` | 0 = unlimited; otherwise clip article title/body before sending; non-negative integer up to 4,294,967,295. |
| `llmMaxOutputWords` | `0` | 0 = omit token cap; otherwise `max_tokens = ceil(words × 4/3)` plus word-count instruction; same integer range. |
| `last_refresh` | — | Internal RFC3339 timestamp written after refresh, not part of `Settings::defaults()`. |

### Data directory layout

```text
~/.tyler-rss/
├── tyler.sqlite                  # Main SQLite database.
├── tyler.sqlite-wal              # WAL journal (when present).
├── tyler.sqlite-shm              # Shared-memory WAL file (when present).
└── media/
    ├── feed-icons/               # Cached feed icons.
    ├── covers/                   # Cached article cover images.
    └── articles/                 # Cached inline article images.
```

- Safety backups are created next to the data directory, e.g. `~/.tyler-rss.backup-20261102T120000Z-<uuid>/`. Only the newest copy is retained after a successful import; failed imports do not prune earlier copies.
- Media paths stored in SQLite are relative to the data directory and include `media/`, e.g. `media/covers/123-image.jpg`. Media URLs use `tyler-media://localhost/media/...`; the frontend converts these through Tauri for the current platform, and the article sanitizer permits only the generated local image URL format.
- The custom protocol and deletion helpers canonicalize paths and require targets to remain inside the library's media directory. Absolute paths, traversal, and symlinks leading outside that directory are rejected.
- New inline-image caching keeps the original remote URLs in stored HTML; `get_article` rewrites images whose cached files exist when rendering.

## 5. Notes for future developers and LLMs

- **Respect the local-first contract.** Do not add telemetry, accounts, cloud sync, or remote analytics. Network calls are limited to feed/media/OPML fetching, requested full articles/original pages/embeds, and explicitly requested LLM summaries through the user's configured endpoint. All persistent user data belongs under the data directory; summary responses remain in memory.
- **`App.jsx` is the frontend state hub.** Scope, filters, search, article list, selected detail, refresh state, and dialogs are coordinated there. Avoid creating duplicate article/read-state stores; use the existing API and patch helpers.
- **Pagination cursors are opaque.** `list_articles` accepts `cursor` and returns `nextCursor` (null at the end). Keep the returned cursor unchanged for load-more requests; reset it on scope/search/sort changes. Offset remains supported for older callers. Search rank is carried as a string to preserve its exact value through JavaScript and JSON.
- **IPC changes require four places:** a Rust command in `commands.rs`, `reader.rs`, or `desktop.rs`, registration in `lib.rs`, a wrapper/normalizer in `src/api.js`, and documentation in `CONTRACT.md` plus this file.
- **Keep the serde contract stable.** Models serialize with `#[serde(rename_all = "camelCase")]`; command arguments arrive as camelCase. `src/api.js` also normalizes snake_case/camelCase aliases defensively. Do not break either layer.
- **Database changes must be idempotent.** Add columns with the existing `add_column` helper or a guarded migration, bump `user_version` for structural changes, and rebuild FTS if its schema or triggers change. Existing users and imported backups must keep opening.
- **Settings changes touch several files.** Update `Settings` defaults in `models.rs`, validation/read/write logic in `settings.rs`, aliases in `src/api.js`, and the Settings dialog UI. Add the key to the schema/defaults table in this file.
- **Blocking work belongs in `spawn_blocking`.** `rusqlite` and `reqwest::blocking` are synchronous; command handlers wrap them via the local `blocking()` helper so they do not stall Tauri's async runtime.
- **Subscriptions return before fetching.** UI add commands use `feeds::subscribe` and enqueue the ID through `SubscriptionQueue`. `feeds::add_feed` remains the synchronous helper for OPML's blocking worker. Manual refresh skips pending/fetching subscriptions; restore refuses while either subscription queue is busy. Preserve this coordination when adding another background job.
- **Do not weaken media security.** Use the shared media containment helpers for serving, cache existence checks, and deletion. Never delete a database-supplied path by joining it directly to the data directory.
- **Keep library files guarded.** `ensure_db` returns a connection holding a shared library lock until SQLite closes. Filesystem-only media operations also need a shared lock. Restore takes the exclusive lock before moving live files; staged validation uses `prepare_database` without touching the live library.
- **CSP changes are deliberate.** Remote images/audio/video are allowed for feed media. Article scripts and objects are blocked; frames allow only the three approved YouTube/Vimeo hosts. Update `tauri.conf.json` and `devCsp` together only when a feature truly needs it.
- **Styling uses shared tokens.** Global tokens live in `src/styles.css`; dialogs are self-contained with `--d-*` fallbacks. Preserve light/dark themes, compact density, reduced motion, focus states, and keyboard accessibility.
- **The starter catalog is data, not code behavior.** `src/lib/feedStarters.js` currently contains 91 feeds. URLs can rot: validate occasionally and replace dead entries rather than removing the catalog concept. `sameFeedUrl` is intentionally loose (case, whitespace, trailing slash).
- **Regenerate icons instead of hand-editing them.** The canonical source is `src-tauri/icons/icon.svg`. Run `npx tauri icon src-tauri/icons/icon.svg`; commit the regenerated desktop/mobile assets and `public/tyler.svg`.
- **macOS is case-insensitive by default.** Keep import paths and file casing exact (for example `src/components/CommandPalette.jsx`). A mismatched casing can work locally and fail on Linux.
- **No formal test suite exists.** Use `npm run check` (frontend production build + `cargo check`). Manually exercise feed add/discovery, OPML file/link import, refresh, search, reader, and backup restore when touching those areas.
- **Release workflow.** `.github/workflows/release.yml` runs only on pushed `v*` tags and rejects tags other than `vMAJOR.MINOR.PATCH` or mismatched version metadata. It checks the frontend/Rust backend and builds native macOS Intel/Apple silicon DMGs, Windows x64/ARM64 EXE/MSI installers, and Linux x64/ARM64 AppImage/DEB/RPM packages. All twelve assets must be uploaded and nonempty before automatic publication; failures retain a reusable draft, and published releases cannot be overwritten. Release operations use the current repository and built-in token, including while developing in a temporary repository; public documentation links to `goodappsstore/tyler-rss`. macOS is ad-hoc signed without notarization; Windows is unsigned.
- **Native build requirements.** macOS bundles require 13.3 or later. Linux installers are built on Ubuntu 24.04 for x64 and ARM64 and target compatible distributions. `libfuse2t64` supports AppImage packaging on Ubuntu 24.04.
- **Version updates.** `npm run version:bump` prompts for a `vMAJOR.MINOR.PATCH` tag and updates the unprefixed version in `package.json`, `package-lock.json` (top level and root package), Tauri config, Cargo manifest, and Tyler's Cargo lock entry. It validates all edits before writing and never commits, creates tags, or pushes. The About dialog reads `package.json` directly. Run `npm run release:check -- vMAJOR.MINOR.PATCH` to validate release metadata locally before committing and manually creating/pushing the tag.
- **Generated directories are not source.** Never edit `node_modules/`, `dist/`, `src-tauri/target/`, or `src-tauri/gen/`. `src-tauri/Cargo.lock` and `package-lock.json` are managed by their package managers.
- **Archive counts exclude active-library counts.** Read/star edits on an archived article must not change active unread/star counts. Refresh bootstrap after archive/restore to reconcile feed/folder totals.
- **Preserve fetched full articles.** Feed ingestion must retain stored extracted content when `full_content_loaded = 1`. Schema version 4 adds this flag/enclosure storage and clears validators once so existing feeds are reparsed. Backups through version 4 are supported.
- **Native file drops and feed dragging coexist.** Tauri native drag/drop is enabled. Sidebar feed movement uses pointer events rather than HTML drag/drop, which native Windows file-drop handling intercepts.

## 6. Keeping this file current

**Instruction for LLMs and developers:** This file is part of the project source of truth. Whenever you change features, commands, file structure, database schema, settings, data locations, dependencies, build/release steps, or important conventions, update `PROJECT.md` in the same change. Keep it factual and current; remove stale claims when behavior changes. If a change affects only internals, update the relevant hierarchy/schema/notes section instead of appending a changelog entry. Prefer clear, concise descriptions over aspirational documentation.
