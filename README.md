# Tyler

**Your feeds. Your pace. Your machine.**

Tyler is a beautiful, lightweight RSS reader for macOS, Windows, and Linux. Follow your favorite publications, read full articles offline, listen with local text to speech, and keep a searchable library of stories worth saving.

Your subscriptions, articles, reading state, and cached images live on your computer. No account, no cloud sync service, no telemetry. Free and open source under the [MIT license](LICENSE).

[Get started](#get-started) · [Features](#features) · [Privacy](#privacy-and-network-access) · [Build from source](#build-from-source) · [Contribute](#contributing)

## Why Tyler?

- **A reader you want to spend time in.** A considered three-pane layout, warm typography, light and dark themes, and adjustable reading controls put your articles first.
- **Small on disk, rich in features.** Built with Tauri and Rust, Tyler uses your system webview to keep the application footprint small. Optional speech models download separately, only when you enable read aloud.
- **A library you own.** Read saved articles offline, search locally, and move your subscriptions or entire library whenever you choose.
- **Useful from the first launch.** Pick from 90+ curated publications, paste a site URL, or import your existing subscriptions with OPML.
- **Listen and summarize on your terms.** Speech runs locally. Optional summaries use an endpoint and model you choose, including a compatible local server.

## Features

### Make yourself at home

- Subscribe to **RSS, Atom, and JSON feeds** by feed URL or let Tyler discover feeds from a website.
- Browse a searchable starter catalog and subscribe to multiple publications at once.
- Organize subscriptions into folders with drag and drop; edit titles, URLs, and individual refresh intervals.
- Keep track with **All, Unread, Starred, Today, and Archive** views, live counts, filters, and sorting.
- Apply color-coded tags, mark articles read or unread, and archive stories for later.
- Mark a view, feed, folder, tag, or search as read in one action, and explore reading statistics with an activity chart and per-feed breakdown.
- Search titles, article text, authors, and feed names with **local full-text search** powered by SQLite FTS5.

### Enjoy the reading

- Resize the article list and choose your typeface, font size, line width, and comfortable or compact density.
- Use light, dark, or system-following themes, with reduced-motion support.
- **Load full articles** on demand or automatically when opened; extracted text is saved for offline reading and search.
- Cache feed icons, covers, and inline article images locally.
- Find text within an article, export it as **Markdown**, or print/save as **PDF** through the system print dialog.
- Play podcast and video enclosures, with support for YouTube and Vimeo embeds.
- Navigate with keyboard shortcuts and a searchable command palette.

### Keep it yours

- Import OPML from a file or link; export subscriptions with their folder structure.
- Export a **portable `.tyler.zip` backup** of your library and cached media. Restore validates and migrates the backup before replacing your library, with rollback and a safety copy.
- Set automatic retention or clean up old articles manually; unread and starred articles are preserved.
- Use tray controls, unread Dock/supported taskbar badges, optional system notifications, OPML file opening, and `feed:` links.
- Enable **local read aloud** with 28 American and British English voices, or **optional summaries** through your own OpenAI-compatible endpoint.

## Get started

Check the repository's [Releases page](https://github.com/goodappsstore/tyler-rss/releases) for available packaged builds, or [build Tyler from source](#build-from-source).

1. Launch Tyler and paste a website/feed URL, select publications from the starter catalog, or import an OPML file through **Transfer**.
2. Open a story to read it. Choose **Load full article** when a feed only provides an excerpt.
3. Adjust the theme and typography in **Settings → Reading**, then organize your library with folders, stars, and tags.

Feeds and images load in the background while you read. You can select several starter publications and add them to the same folder together. Drop an `.opml` file anywhere in the app to import subscriptions.

Closing the reader keeps Tyler running in the tray for refreshes and notifications. Choose **Quit Tyler** in the tray menu to exit.

### Reading and feed settings

**Settings → Reading → Load full article by default** fetches full text when you open an article and reuses previously saved text. It is off by default. **Open links in Tyler** opens original pages and article links in a separate Tyler window.

Automatic refresh respects each feed's **Fetch interval** in Manage feeds. The global Auto-refresh setting controls periodic checks; **Manual** disables those checks. Startup refresh fetches only feeds that are due. The Refresh button, `r`, and tray refresh fetch immediately.

**Settings → Feeds & storage** controls retention, notifications, unread badges, and the feed download limit. The limit defaults to **20 MiB** per feed, discovery page, or OPML link, measured after decompression, and can be adjusted from 1–100 MiB. Oversized feeds show an error so you can raise the limit and retry.

### Local read aloud

Enable **Settings → Read aloud** and choose a voice. Tyler downloads its Kokoro speech model once, approximately **92 MB**, plus approximately **0.5 MB** per selected voice. Downloads show progress and can be retried. These optional files are separate from the application install.

Use the play/pause and stop controls beside the command palette to listen to the selected article. Load the full article first if the feed only includes an excerpt. Speech works offline after the model and voice have downloaded, and speech generation keeps article text on your machine. Native ONNX Runtime ships with Tyler; no Python or separate speech runtime installation is needed.

Enable **Keep speaking when switching articles** to continue listening while browsing. Voice changes apply to the next playback; disabling read aloud stops speech and retains downloaded files.

### Optional article summaries

Open **Settings → LLM summaries**, enable summaries, and enter your OpenAI-compatible API base URL, API key, and model ID. Customize the prompt if you like, then choose **Save LLM settings**. Tyler appends `/chat/completions` to the base URL.

Click **Summarize** in the reader to generate a summary while you keep reading or browse another article. The result stays attached to its source article in a dismissible panel with a **Copy** button. Matching results are reused for the current app session; generated summaries are kept in memory and are never saved to the library or backups.

Input and output word limits are optional; blank or `0` means unlimited. The input limit clips the article title and body before sending. The output limit adds a word-count instruction and an approximate token budget; actual output length depends on the model and provider limits. Very small budgets may return no visible text, so increase or remove the limit if needed.

**Article text is sent to your configured endpoint only when you request a summary.** Use a compatible local endpoint to keep summarization on your machine. Your endpoint, API key, model, prompt, and limits are saved in local settings and included in exported backups.

## Keyboard shortcuts

Use `⌘` on macOS and `Ctrl` on Windows/Linux.

| Key | Action |
| --- | --- |
| `⌘K` / `Ctrl+K` | Open the command palette |
| `/` | Focus library search |
| `↓` / `↑` | Next / previous article |
| `m` | Toggle read/unread |
| `u` | Mark unread |
| `s` | Toggle star |
| `r` | Refresh all feeds |
| `⌘F` / `Ctrl+F` | Find in the current article |
| `Enter` / `Shift+Enter` | Next / previous find match |
| `⌘P` / `Ctrl+P` | Print article / save as PDF |
| `⌘+` / `Ctrl++` | Increase reader font size (`⌘=` / `Ctrl+=` also works) |
| `⌘-` / `Ctrl+-` | Decrease reader font size |
| `Ctrl+N` / `Ctrl+P` | Next / previous result while the command palette is open |
| `?` | Open the shortcut reference |
| `Esc` | Dismiss the current overlay or clear search |

Article navigation and action shortcuts pause while typing in a field or using an overlay. Font shortcuts adjust the saved reader size from 14–24 px.

## Privacy and network access

Tyler stores your library locally and has **no telemetry or analytics**. Reading, organization, search, and speech generation run on your machine.

Network access supports the content and optional features you use:

- Fetching feeds, discovering subscriptions, downloading images, importing OPML links, and loading full articles contacts the relevant websites.
- Original pages, streamed audio/video, and embedded players contact their providers and may use those providers' tracking or cookies.
- Enabling read aloud downloads the model and selected voices from Hugging Face; subsequent speech generation runs locally.
- Requesting a summary sends the article title and text, subject to your configured input limit, to your chosen endpoint.

Feed/discovery requests, OPML-link imports, and full-article fetches add the shared `ref=tyler-rss.com` query parameter when no `ref` parameter is present. Existing values are preserved. This identifies the application to the destination website; it contains no per-user identifier.

## Data and backups

Persistent app data lives in your home directory on every supported platform:

```text
~/.tyler-rss/
├── tyler.sqlite   # subscriptions, articles, reading state, tags, settings, search index
├── media/         # cached feed icons, covers, and inline images
└── tts/           # optional downloaded speech model and voices
```

On Windows, the default folder is `%USERPROFILE%\.tyler-rss`. Set `TYLER_DATA_DIR` before launching Tyler to use another location. Open the current folder with **Settings → Feeds & storage → Open**.

Use **Transfer → Export backup** to move your library to another machine. Backups include local settings, including any configured summary API key. TTS model and voice files are excluded; they are retained when restoring on the same machine and downloaded again when needed on a new machine.

Wait for refreshes and image downloads to finish before restoring. Invalid backups leave your current library and previous safety copy in place. Safety copies are stored beside the data folder; the newest copy is retained after a successful import.

### Offline reading and content support

Saved article text and cached images are available offline. Full-article extraction works with public HTML pages; paywalls, sign-in pages, and pages rendered entirely by JavaScript may require **Open original**. Streamed media and embedded players need a network connection and codecs supported by your system webview. PDF output depends on your operating system's print support.

## Build from source

Tyler uses **Tauri 2, Rust, React 19, Vite, and SQLite**.

### Prerequisites

- Node.js **20.19+ within the 20.x line, or 22.12+**, with npm, as required by the locked Vite version.
- Rust **1.90+** and Cargo.
- The [Tauri 2 platform prerequisites](https://v2.tauri.app/start/prerequisites/) for your operating system, including native build tools and webview dependencies.

From a checkout of this repository:

```bash
npm ci
npm run tauri dev
```

This launches the desktop app with frontend hot reload. Development uses the normal data directory; set `TYLER_DATA_DIR` to a separate folder if you want an isolated development library.

To check the frontend and Rust backend:

```bash
npm run check
```

To build a packaged application on your platform:

```bash
npm run tauri build
```

Bundles are written under `src-tauri/target/release/bundle/`. The first Rust build downloads the native ONNX Runtime CPU library for supported targets. The optional speech model and voices are downloaded separately when read aloud is enabled.

macOS bundles require macOS 13.3 or later, matching the speech runtime's build target. On Intel macOS, build ONNX Runtime 1.24.2 from source and set `ORT_LIB_PATH` to its static library build directory before building Tyler; the release workflow handles this automatically.

`npm run build` builds only the frontend. Use `npm run tauri dev` to run the complete reader with its Rust backend.

### Versions and releases

Run the interactive version updater and enter the tag you plan to use, such as `v0.2.0`:

```bash
npm run version:bump
```

It writes `0.2.0` (without `v`) to `package.json`, both root version entries in `package-lock.json`, `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`, and Tyler's entry in `src-tauri/Cargo.lock`. The About dialog reads its version from `package.json`. The script only updates files; it does not commit, create a Git tag, or push anything. It also works when called from another directory with `node /path/to/tyler-rss/scripts/bump-version.mjs`.

Review the changes and run `npm run release:check -- v0.2.0` and `npm run check`, then commit the version changes yourself. When ready to release, create and push the matching `v0.2.0` tag yourself.

GitHub Actions runs **only when a `v*` tag is pushed**, and validates the exact `vMAJOR.MINOR.PATCH` format against all version files before building. Branch pushes, pull requests, and manual dispatches do not start CI/CD. The workflow checks the frontend and Rust backend, builds the following native installers, and uploads them to a draft release:

| Platform | Architectures | Installers |
| --- | --- | --- |
| macOS | Intel, Apple silicon | DMG |
| Windows | x64, ARM64 | NSIS EXE, MSI |
| Linux | x64, ARM64 | AppImage, DEB, RPM |

The release is published automatically only after all six builds pass and all twelve installers are verified as uploaded and nonempty. Failed builds leave a draft that can be reused by rerunning the failed workflow jobs. Published release assets are not replaced; use a new version and tag for a new release. Installer names include the app, version, platform, architecture, and bundle type, for example `Tyler-v0.2.0-windows-x64-nsis-setup.exe`.

The workflow uses the running repository and its built-in `GITHUB_TOKEN`, so it works in a temporary development repository and in `goodappsstore/tyler-rss` without changing workflow settings or adding a personal access token. GitHub Actions must be enabled and repository policy must allow `contents: write`. macOS builds use ad-hoc signing without notarization; Windows installers are unsigned. No signing secrets are required.

Tyler's pinned speech runtime has prebuilt static libraries for five targets. Intel macOS builds compile and cache ONNX Runtime 1.24.2 from source, so the first build takes longer. See the [ONNX Runtime build guide](https://onnxruntime.ai/docs/build/inferencing.html) and [ort linking guide](https://ort.pyke.io/setup/linking) for that build path.

### Project structure

| Path | Purpose |
| --- | --- |
| `src/` | React interface, reader, command palette, dialogs, and speech playback |
| `src-tauri/src/` | Rust backend: feeds, SQLite/FTS5, media, article extraction, speech inference, summaries, and backups |
| `src-tauri/tauri.conf.json` | Desktop application and bundling configuration |
| `public/` | App icon and early theme initialization |
| `.github/workflows/release.yml` | Tag-only checks, native builds, installer verification, and release publication |
| `.github/scripts/` | Release metadata/asset validation and Intel macOS speech-runtime build |
| `scripts/bump-version.mjs` | Interactive version-file updater; never creates or pushes Git tags |
| [PROJECT.md](PROJECT.md) | Detailed feature inventory, architecture, database schema, and maintenance notes |
| [CONTRACT.md](CONTRACT.md) | Backend/frontend interface and design contract |

## AI Assistance

AI-assisted development. Not vibe-coded slop. Thoroughly reviewed, and tested.

A few edge cases might still be there, which any software product has. Use github issues for same. I'll try to fix those asap.

AI-haters stay away please. Let others who find value in this use it.

## Contributing

Bug reports, feature ideas, documentation improvements, and pull requests are welcome. Use the repository's [issue tracker](https://github.com/goodappsstore/tyler-rss/issues) for reproducible bugs and focused feature requests. For bugs, include your operating system, Tyler version, reproduction steps, and any relevant error message.

Before changing code, read [AGENTS.md](AGENTS.md), [PROJECT.md](PROJECT.md), and [CONTRACT.md](CONTRACT.md). Keep changes focused, prefer readable code, and preserve Tyler's local-first behavior and existing libraries. Update the relevant documentation when behavior changes.

There is no formal test suite. Run `npm run check` for code changes and manually exercise the affected workflows. For interface changes, check light and dark themes, keyboard navigation, and reduced motion.

## License

Copyright (c) 2026 Nitin Bansal. Tyler is released under the [MIT license](LICENSE).

Third-party dependencies, fonts, and optional speech assets retain their respective licenses.
