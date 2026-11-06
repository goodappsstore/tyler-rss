use crate::db::now_iso;
use crate::error::{AppError, AppResult};
use crate::models::{AddFeedArgs, Candidate, Feed, UpdateFeedArgs};
use crate::paths;
use chrono::{DateTime, Utc};
use feed_rs::model::{Entry, Feed as ParsedFeed, FeedType};
use regex::Regex;
use reqwest::blocking::Client;
use rusqlite::{params, Connection, Transaction, TransactionBehavior};
use scraper::{Html, Selector};
use sha2::{Digest, Sha256};
use std::io::Read;
use std::sync::OnceLock;
use std::time::Duration;
use url::Url;

pub const USER_AGENT: &str = "Tyler/0.1 (+https://tyler.app)";
const MAX_IMAGE_BYTES: usize = 5 * 1024 * 1024;

fn feed_client() -> &'static Client {
    static CLIENT: OnceLock<Client> = OnceLock::new();
    CLIENT.get_or_init(|| {
        Client::builder()
            .user_agent(USER_AGENT)
            .timeout(Duration::from_secs(20))
            .build()
            .unwrap_or_else(|_| Client::new())
    })
}

fn discovery_client() -> &'static Client {
    static CLIENT: OnceLock<Client> = OnceLock::new();
    CLIENT.get_or_init(|| {
        Client::builder()
            .user_agent(USER_AGENT)
            .timeout(Duration::from_secs(8))
            .build()
            .unwrap_or_else(|_| Client::new())
    })
}

fn image_client() -> &'static Client {
    static CLIENT: OnceLock<Client> = OnceLock::new();
    CLIENT.get_or_init(|| {
        Client::builder()
            .user_agent(USER_AGENT)
            .timeout(Duration::from_secs(10))
            .build()
            .unwrap_or_else(|_| Client::new())
    })
}

#[derive(Debug)]
pub struct HttpGet {
    pub bytes: Vec<u8>,
    pub final_url: String,
    pub etag: Option<String>,
    pub last_modified: Option<String>,
}

pub enum HttpResult {
    NotModified,
    Ok(HttpGet),
}

fn header(resp: &reqwest::blocking::Response, name: &str) -> Option<String> {
    resp.headers()
        .get(name)
        .and_then(|v| v.to_str().ok())
        .map(str::to_string)
}

pub fn normalized_url(raw: &str) -> AppResult<String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err(AppError::Message("Enter a feed or site URL".into()));
    }
    let with_scheme = if trimmed.contains("://") {
        trimmed.to_string()
    } else if trimmed.starts_with("//") {
        format!("https:{trimmed}")
    } else {
        format!("https://{trimmed}")
    };
    let mut url = Url::parse(&with_scheme)?;
    if !matches!(url.scheme(), "http" | "https") {
        return Err(AppError::Message(
            "Only http and https URLs are supported".into(),
        ));
    }
    url.set_fragment(None);
    Ok(url.to_string())
}

pub fn content_request_url(raw: &str) -> AppResult<Url> {
    let mut url = Url::parse(raw)?;
    if !url.query_pairs().any(|(key, _)| key == "ref") {
        url.query_pairs_mut().append_pair("ref", "tyler-rss.com");
    }
    Ok(url)
}

fn origin_of(url: &str) -> Option<String> {
    let parsed = Url::parse(url).ok()?;
    let host = parsed.host_str()?;
    Some(format!("{}://{}", parsed.scheme(), host))
}

fn favicon_for(site_url: Option<&str>) -> Option<String> {
    let mut url = Url::parse(site_url?).ok()?;
    url.set_path("/favicon.ico");
    url.set_query(None);
    url.set_fragment(None);
    Some(url.to_string())
}

fn resolve_url(base: &str, href: &str) -> Option<String> {
    let href = href.trim();
    if href.is_empty() || href.starts_with("data:") || href.starts_with("mailto:") {
        return None;
    }
    let accept = |url: Url| {
        if matches!(url.scheme(), "http" | "https") {
            Some(url.to_string())
        } else {
            None
        }
    };
    if href.starts_with("//") {
        if let Ok(base_url) = Url::parse(base) {
            if let Ok(url) = Url::parse(&format!("{}:{}", base_url.scheme(), href)) {
                return accept(url);
            }
        }
    }
    Url::parse(href)
        .ok()
        .and_then(accept)
        .or_else(|| Url::parse(base).ok()?.join(href).ok().and_then(accept))
}

pub fn http_get(
    url: &str,
    etag: Option<&str>,
    last_modified: Option<&str>,
    discovery: bool,
    max_bytes: u64,
) -> AppResult<HttpResult> {
    let client = if discovery {
        discovery_client()
    } else {
        feed_client()
    };
    let request_url = content_request_url(url)?;
    let mut req = client
        .get(request_url.clone())
        .header(
            "Accept",
            "application/rss+xml, application/atom+xml, application/feed+json, application/xml, text/xml, text/html;q=0.8, */*;q=0.5",
        );
    if let Some(etag) = etag {
        if !etag.is_empty() {
            req = req.header("If-None-Match", etag);
        }
    }
    if let Some(lm) = last_modified {
        if !lm.is_empty() {
            req = req.header("If-Modified-Since", lm);
        }
    }
    let resp = req.send()?;
    if resp.status() == reqwest::StatusCode::NOT_MODIFIED {
        return Ok(HttpResult::NotModified);
    }
    if !resp.status().is_success() {
        return Err(AppError::Message(format!(
            "HTTP {} {}",
            resp.status().as_u16(),
            resp.status().canonical_reason().unwrap_or("")
        )));
    }
    // Keep request attribution out of discovered feed URLs unless the site redirects.
    let final_url = if resp.url() == &request_url {
        url.to_string()
    } else {
        resp.url().to_string()
    };
    let etag = header(&resp, "etag");
    let last_modified = header(&resp, "last-modified");
    let size_error = AppError::DownloadTooLarge {
        host: resp.url().host_str().unwrap_or("this server").to_string(),
        limit_bytes: max_bytes,
    };
    if resp
        .content_length()
        .is_some_and(|length| length > max_bytes)
    {
        return Err(size_error);
    }
    // reqwest decompresses before Read; also bound chunked responses without a length.
    let mut bytes = Vec::new();
    resp.take(max_bytes + 1).read_to_end(&mut bytes)?;
    if bytes.len() as u64 > max_bytes {
        return Err(size_error);
    }
    Ok(HttpResult::Ok(HttpGet {
        bytes,
        final_url,
        etag,
        last_modified,
    }))
}

fn parse_feed(bytes: &[u8]) -> AppResult<ParsedFeed> {
    feed_rs::parser::parse(bytes)
        .map_err(|e| AppError::Message(format!("Could not parse feed: {e}")))
}

pub fn kind_of(feed: &ParsedFeed) -> &'static str {
    match feed.feed_type {
        FeedType::Atom => "atom",
        FeedType::JSON => "json",
        _ => "rss",
    }
}

fn text_of(value: Option<&feed_rs::model::Text>) -> Option<String> {
    value
        .map(|t| t.content.trim().to_string())
        .filter(|s| !s.is_empty())
}

fn feed_site_url(feed: &ParsedFeed, feed_url: &str) -> Option<String> {
    for link in &feed.links {
        if link.rel.as_deref() == Some("self") {
            continue;
        }
        let rel_ok = link
            .rel
            .as_deref()
            .map(|r| r == "alternate" || r.is_empty())
            .unwrap_or(true);
        let html = link
            .media_type
            .as_deref()
            .map(|m| m.contains("html"))
            .unwrap_or(true);
        if rel_ok && html {
            if let Some(url) = resolve_url(feed_url, &link.href) {
                return Some(url);
            }
        }
    }
    origin_of(feed_url)
}

fn truncate_chars(input: &str, max: usize) -> String {
    let trimmed = input.trim();
    let mut chars = trimmed.chars();
    let taken: String = chars.by_ref().take(max).collect();
    if chars.next().is_some() {
        format!("{}…", taken.trim_end())
    } else {
        taken
    }
}

pub fn strip_html(html: &str) -> String {
    if html.trim().is_empty() {
        return String::new();
    }
    let fragment = Html::parse_fragment(html);
    let text: String = fragment.root_element().text().collect::<Vec<_>>().join(" ");
    let collapsed = whitespace_re().replace_all(&text, " ");
    collapsed.trim().to_string()
}

fn whitespace_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"\s+").unwrap())
}

pub fn sanitize_html(html: &str, base_url: &str) -> String {
    let mut builder = ammonia::Builder::default();
    builder.link_rel(Some("noopener noreferrer"));
    builder.rm_clean_content_tags(&["iframe"]);
    builder.add_tags(&["audio", "video", "source", "iframe"]);
    builder.add_tag_attributes("audio", &["src", "controls", "preload"]);
    builder.add_tag_attributes("video", &["src", "controls", "preload", "poster"]);
    builder.add_tag_attributes("source", &["src", "type"]);
    builder.add_tag_attributes("iframe", &["src", "title"]);
    builder.attribute_filter(|tag, attr, value| {
        if tag == "iframe" && attr == "src" && !allowed_embed(value) {
            return None;
        }
        Some(std::borrow::Cow::Borrowed(value))
    });
    if let Ok(base) = Url::parse(base_url) {
        builder.url_relative(ammonia::UrlRelative::RewriteWithBase(base));
    }
    let clean = builder.clean(html).to_string();
    force_link_targets(&clean)
}

fn force_link_targets(html: &str) -> String {
    static ANCHOR: OnceLock<Regex> = OnceLock::new();
    static TARGET: OnceLock<Regex> = OnceLock::new();
    static REL: OnceLock<Regex> = OnceLock::new();
    let anchor = ANCHOR.get_or_init(|| Regex::new(r"(?is)<a\s([^>]*)>").unwrap());
    let target = TARGET
        .get_or_init(|| Regex::new(r#"(?i)\s+target\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)"#).unwrap());
    let rel =
        REL.get_or_init(|| Regex::new(r#"(?i)\s+rel\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)"#).unwrap());
    anchor
        .replace_all(html, |caps: &regex::Captures<'_>| {
            let attrs = caps.get(1).map(|m| m.as_str()).unwrap_or("");
            if !attrs.to_ascii_lowercase().contains("href=") {
                return caps
                    .get(0)
                    .map(|m| m.as_str().to_string())
                    .unwrap_or_default();
            }
            let attrs = target.replace_all(attrs, "");
            let attrs = rel.replace_all(&attrs, "");
            format!(
                "<a {} target=\"_blank\" rel=\"noopener noreferrer\">",
                attrs.trim()
            )
        })
        .to_string()
}

pub fn first_image_url(html: &str, base_url: &str) -> Option<String> {
    static IMG: OnceLock<Regex> = OnceLock::new();
    let re = IMG.get_or_init(|| Regex::new(r#"(?is)<img[^>]+src\s*=\s*["']([^"']+)["']"#).unwrap());
    for cap in re.captures_iter(html) {
        if let Some(raw) = cap.get(1) {
            let decoded = html_escape::decode_html_entities(raw.as_str()).to_string();
            if let Some(url) = resolve_url(base_url, &decoded) {
                if url.starts_with("http://") || url.starts_with("https://") {
                    return Some(url);
                }
            }
        }
    }
    None
}

fn entry_url(entry: &Entry, base: &str) -> Option<String> {
    for link in &entry.links {
        let rel_ok = link
            .rel
            .as_deref()
            .map(|r| r == "alternate" || r == "self" || r.is_empty())
            .unwrap_or(true);
        if rel_ok {
            if let Some(url) = resolve_url(base, &link.href) {
                return Some(url);
            }
        }
    }
    None
}

fn entry_media_image(entry: &Entry) -> Option<String> {
    for media in &entry.media {
        for content in &media.content {
            if let Some(url) = &content.url {
                let is_image = content
                    .content_type
                    .as_ref()
                    .map(|t| t.as_str().starts_with("image/"))
                    .unwrap_or(false);
                if is_image && matches!(url.scheme(), "http" | "https") {
                    return Some(url.to_string());
                }
            }
        }
        for thumb in &media.thumbnails {
            if let Ok(url) = Url::parse(&thumb.image.uri) {
                if matches!(url.scheme(), "http" | "https") {
                    return Some(url.to_string());
                }
            }
        }
    }
    None
}

fn entry_author(entry: &Entry, feed: &ParsedFeed) -> Option<String> {
    let person = entry
        .authors
        .first()
        .or_else(|| entry.contributors.first())
        .or_else(|| feed.authors.first());
    person.and_then(|p| {
        p.name
            .clone()
            .filter(|n| !n.trim().is_empty())
            .or_else(|| p.email.clone().filter(|e| !e.trim().is_empty()))
    })
}

fn guid_for(entry: &Entry, url: Option<&str>, title: &str, published: &str) -> String {
    if !entry.id.trim().is_empty() {
        return entry.id.trim().to_string();
    }
    if let Some(url) = url {
        return url.to_string();
    }
    let mut hasher = Sha256::new();
    hasher.update(title.as_bytes());
    hasher.update(published.as_bytes());
    format!("{:x}", hasher.finalize())
}

fn content_parts(entry: &Entry) -> (String, bool) {
    if let Some(content) = &entry.content {
        if let Some(body) = &content.body {
            let plain = content.content_type.as_str() == "text/plain";
            return (body.clone(), plain);
        }
    }
    if let Some(summary) = &entry.summary {
        let plain = summary.content_type.as_str() == "text/plain";
        return (summary.content.clone(), plain);
    }
    (String::new(), true)
}

fn published_at(entry: &Entry) -> Option<DateTime<Utc>> {
    entry.published.or(entry.updated)
}

fn reading_time(text: &str) -> i64 {
    let words = text.split_whitespace().count() as i64;
    ((words + 219) / 220).max(1)
}

#[derive(Debug, Default)]
pub struct FeedRefreshOutcome {
    pub new_articles: i64,
    pub updated: i64,
    pub failures: Vec<String>,
}

struct InternalFeed {
    title: String,
    url: String,
    icon_url: Option<String>,
    etag: Option<String>,
    last_modified: Option<String>,
}

fn internal_feed(conn: &Connection, id: i64) -> AppResult<InternalFeed> {
    Ok(conn.query_row(
        "SELECT title, url, icon_url, etag, last_modified FROM feeds WHERE id = ?1",
        params![id],
        |r| {
            Ok(InternalFeed {
                title: r.get(0)?,
                url: r.get(1)?,
                icon_url: r.get(2)?,
                etag: r.get(3)?,
                last_modified: r.get(4)?,
            })
        },
    )?)
}

pub(crate) fn set_feed_error(conn: &Connection, id: i64, message: &str) -> AppResult<()> {
    conn.execute(
        "UPDATE feeds SET last_status = 'error', error = ?2, last_fetched_at = ?3 WHERE id = ?1",
        params![id, message, now_iso()],
    )?;
    Ok(())
}

pub fn refresh_one(conn: &Connection, feed_id: i64) -> AppResult<FeedRefreshOutcome> {
    let feed = internal_feed(conn, feed_id)?;
    let response = match http_get(
        &feed.url,
        feed.etag.as_deref(),
        feed.last_modified.as_deref(),
        false,
        crate::settings::feed_download_limit_bytes(conn),
    ) {
        Ok(r) => r,
        Err(e) => {
            let msg = e.to_string();
            set_feed_error(conn, feed_id, &msg)?;
            return Ok(FeedRefreshOutcome {
                failures: vec![format!("{}: {}", feed.title, msg)],
                ..Default::default()
            });
        }
    };
    let body = match response {
        HttpResult::NotModified => {
            conn.execute(
                "UPDATE feeds SET last_status = 'ok', error = NULL, last_fetched_at = ?2 WHERE id = ?1",
                params![feed_id, now_iso()],
            )?;
            cache_feed_media(conn, feed_id)?;
            return Ok(FeedRefreshOutcome::default());
        }
        HttpResult::Ok(body) => body,
    };
    let parsed = match parse_feed(&body.bytes) {
        Ok(p) => p,
        Err(e) => {
            let msg = e.to_string();
            set_feed_error(conn, feed_id, &msg)?;
            return Ok(FeedRefreshOutcome {
                failures: vec![format!("{}: {}", feed.title, msg)],
                ..Default::default()
            });
        }
    };

    let site_url = feed_site_url(&parsed, &body.final_url);
    let description =
        text_of(parsed.description.as_ref()).map(|d| truncate_chars(&strip_html(&d), 500));
    let icon_remote = parsed
        .icon
        .as_ref()
        .map(|i| i.uri.clone())
        .or_else(|| parsed.logo.as_ref().map(|i| i.uri.clone()))
        .and_then(|u| resolve_url(&body.final_url, &u))
        .or_else(|| favicon_for(site_url.as_deref()));

    // Acquire the writer before reading article state, avoiding WAL snapshot upgrades.
    // Validators and articles must succeed or roll back together.
    let tx = Transaction::new_unchecked(conn, TransactionBehavior::Immediate)?;
    let outcome = ingest_feed(&tx, feed_id, &parsed, &body.final_url)?;
    let etag = body.etag;
    let last_modified = body.last_modified;
    tx.execute(
        "UPDATE feeds SET last_fetched_at = ?2, last_status = 'ok', error = NULL,
             etag = ?3, last_modified = ?4,
             site_url = COALESCE(?5, site_url),
             description = COALESCE(?6, description),
             icon_remote = COALESCE(?7, icon_remote)
         WHERE id = ?1",
        params![
            feed_id,
            now_iso(),
            etag,
            last_modified,
            site_url,
            description,
            icon_remote
        ],
    )?;

    tx.commit()?;
    cache_feed_media(conn, feed_id)?;
    Ok(outcome)
}

// Callers own the transaction so source metadata and validators commit with articles.
fn ingest_feed(
    conn: &Connection,
    feed_id: i64,
    feed: &ParsedFeed,
    feed_url: &str,
) -> AppResult<FeedRefreshOutcome> {
    let site = feed_site_url(feed, feed_url);
    let base = site.clone().unwrap_or_else(|| feed_url.to_string());
    let feed_title: String = conn.query_row(
        "SELECT title FROM feeds WHERE id = ?1",
        params![feed_id],
        |r| r.get(0),
    )?;
    let mut outcome = FeedRefreshOutcome::default();
    for entry in &feed.entries {
        let link = entry_url(entry, &base);
        let raw_title = text_of(entry.title.as_ref()).unwrap_or_default();
        let title = if raw_title.is_empty() {
            "Untitled".to_string()
        } else {
            truncate_chars(&strip_html(&raw_title), 500)
        };
        let published = published_at(entry).map(|d| d.to_rfc3339());
        let fallback_time = published.clone().unwrap_or_else(now_iso);
        let guid = guid_for(entry, link.as_deref(), &title, &fallback_time);
        let author = entry_author(entry, feed);
        let (raw_content, plain) = content_parts(entry);
        let raw_content = if plain {
            format!("<p>{}</p>", html_escape::encode_text(&raw_content))
        } else {
            raw_content
        };
        let summary_source = entry
            .summary
            .as_ref()
            .map(|s| s.content.clone())
            .unwrap_or_else(|| raw_content.clone());
        let summary_text = truncate_chars(&strip_html(&summary_source), 260);
        let entry_base = link.clone().unwrap_or_else(|| base.clone());
        let content_html = sanitize_html(&raw_content, &entry_base);
        let mut content_text = strip_html(&content_html);
        if content_text.is_empty() {
            content_text = summary_text.clone();
        }
        let rt = reading_time(&content_text);
        let cover =
            entry_media_image(entry).or_else(|| first_image_url(&content_html, &entry_base));

        let existing: Option<(i64, String)> = conn
            .query_row(
                "SELECT id, published_at FROM articles WHERE feed_id = ?1 AND guid = ?2",
                params![feed_id, guid],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .ok();

        if let Some((article_id, old_published)) = existing {
            let published_value = published.unwrap_or(old_published);
            conn.execute(
                "UPDATE articles SET title = ?2, url = ?3, author = ?4, summary = ?5,
                    content_html = CASE WHEN full_content_loaded = 0 THEN ?6 ELSE content_html END,
                    content_text = CASE WHEN full_content_loaded = 0 THEN ?7 ELSE content_text END, published_at = ?8, fetched_at = ?9,
                    reading_time = CASE WHEN full_content_loaded = 0 THEN ?10 ELSE reading_time END, image_url = COALESCE(?11, image_url), feed_title = ?12
                 WHERE id = ?1",
                params![
                    article_id,
                    title,
                    link,
                    author,
                    summary_text,
                    content_html,
                    content_text,
                    published_value,
                    now_iso(),
                    rt,
                    cover,
                    feed_title
                ],
            )?;
            outcome.updated += 1;
        } else {
            conn.execute(
                "INSERT INTO articles(feed_id, guid, title, url, author, summary, content_html,
                    content_text, feed_title, published_at, fetched_at, reading_time, image_url)
                 VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)",
                params![
                    feed_id,
                    guid,
                    title,
                    link,
                    author,
                    summary_text,
                    content_html,
                    content_text,
                    feed_title,
                    fallback_time,
                    now_iso(),
                    rt,
                    cover
                ],
            )?;
            outcome.new_articles += 1;
        }
        let article_id: i64 = conn.query_row(
            "SELECT id FROM articles WHERE feed_id = ?1 AND guid = ?2",
            params![feed_id, guid],
            |r| r.get(0),
        )?;
        conn.execute(
            "DELETE FROM article_enclosures WHERE article_id = ?1",
            params![article_id],
        )?;
        let mut enclosures = Vec::new();
        for link in &entry.links {
            if link.rel.as_deref() == Some("enclosure") {
                enclosures.push((
                    link.href.clone(),
                    link.media_type.clone().unwrap_or_default(),
                ));
            }
        }
        for media in &entry.media {
            for content in &media.content {
                if let Some(url) = &content.url {
                    enclosures.push((
                        url.to_string(),
                        content
                            .content_type
                            .as_ref()
                            .map(|m| m.to_string())
                            .unwrap_or_default(),
                    ));
                }
            }
        }
        for (url, mime) in enclosures {
            let mime = if mime.is_empty() {
                mime_guess::from_path(url.split('?').next().unwrap_or(&url))
                    .first_or_octet_stream()
                    .to_string()
            } else {
                mime
            };
            if mime.starts_with("audio/") || mime.starts_with("video/") {
                if let Some(url) = resolve_url(&entry_base, &url) {
                    conn.execute("INSERT OR IGNORE INTO article_enclosures(article_id, url, mime) VALUES(?1, ?2, ?3)", params![article_id, url, mime])?;
                }
            }
        }
    }
    Ok(outcome)
}

/// Cache media after article ingestion, without holding a SQLite write transaction.
pub fn cache_feed_media(conn: &Connection, feed_id: i64) -> AppResult<()> {
    let feed = internal_feed(conn, feed_id)?;
    let (remote, site): (Option<String>, Option<String>) = conn.query_row(
        "SELECT icon_remote, site_url FROM feeds WHERE id = ?1",
        params![feed_id],
        |row| Ok((row.get(0)?, row.get(1)?)),
    )?;
    let icon_exists = feed
        .icon_url
        .as_deref()
        .and_then(paths::relative_from_url)
        .and_then(|relative| paths::existing_media_path(&relative))
        .is_some_and(|path| path.is_file());
    if !icon_exists {
        if let Some(remote) = remote {
            let _ = cache_feed_icon(conn, feed_id, &remote, site.as_deref());
        }
    }
    let mut statement = conn.prepare("SELECT id, image_url FROM articles WHERE feed_id = ?1 AND (image_url LIKE 'http://%' OR image_url LIKE 'https://%')")?;
    let covers = statement
        .query_map(params![feed_id], |row| {
            Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?))
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    drop(statement);
    for (article_id, remote) in covers {
        let _ = cache_cover(conn, article_id, Some(&remote));
    }
    Ok(())
}

pub fn cache_feed_icon(
    conn: &Connection,
    feed_id: i64,
    remote: &str,
    site_url: Option<&str>,
) -> Option<String> {
    let remote =
        resolve_url(site_url.unwrap_or(remote), remote).unwrap_or_else(|| remote.to_string());
    if !(remote.starts_with("http://") || remote.starts_with("https://")) {
        return None;
    }
    let (rel, _mime, _bytes) = download_image(&remote, "feed-icons", &feed_id.to_string()).ok()?;
    let url = paths::media_url(&rel);
    let _ = conn.execute(
        "UPDATE feeds SET icon_url = ?2 WHERE id = ?1 AND icon_remote = ?3",
        params![feed_id, url, remote],
    );
    Some(url)
}

fn cache_cover(conn: &Connection, article_id: i64, remote: Option<&str>) -> Option<String> {
    let remote = remote?;
    if remote.starts_with("tyler-media://")
        || !(remote.starts_with("http://") || remote.starts_with("https://"))
    {
        return None;
    }
    if let Ok(local) = conn.query_row(
        "SELECT local_path FROM media WHERE article_id = ?1 AND url = ?2",
        params![article_id, remote],
        |r| r.get::<_, String>(0),
    ) {
        if paths::existing_media_path(&local).is_some_and(|path| path.is_file()) {
            let url = paths::media_url(&local);
            let _ = conn.execute(
                "UPDATE articles SET image_url = ?2 WHERE id = ?1",
                params![article_id, url],
            );
            return Some(url);
        }
    }
    let mut hasher = Sha256::new();
    hasher.update(remote.as_bytes());
    let hash = format!("{:x}", hasher.finalize());
    let stem = format!("{article_id}-{}", &hash[..12]);
    let (rel, mime, bytes) = download_image(remote, "covers", &stem).ok()?;
    let _ = conn.execute(
        "INSERT INTO media(article_id, url, local_path, mime, bytes, created_at)
         VALUES(?1, ?2, ?3, ?4, ?5, ?6)
         ON CONFLICT(article_id, url) DO UPDATE SET local_path = excluded.local_path,
            mime = excluded.mime, bytes = excluded.bytes",
        params![article_id, remote, rel, mime, bytes as i64, now_iso()],
    );
    let url = paths::media_url(&rel);
    let _ = conn.execute(
        "UPDATE articles SET image_url = ?2 WHERE id = ?1",
        params![article_id, url],
    );
    Some(url)
}

pub fn download_image(url: &str, dir_rel: &str, stem: &str) -> AppResult<(String, String, u64)> {
    let parsed = Url::parse(url)?;
    if !matches!(parsed.scheme(), "http" | "https") {
        return Err(AppError::Message("Unsupported image URL".into()));
    }
    let resp = image_client().get(url).send()?;
    if !resp.status().is_success() {
        return Err(AppError::Message(format!(
            "Image request failed: HTTP {}",
            resp.status().as_u16()
        )));
    }
    if let Some(len) = resp.content_length() {
        if len as usize > MAX_IMAGE_BYTES {
            return Err(AppError::Message("Image is too large".into()));
        }
    }
    let content_type = header(&resp, "content-type").unwrap_or_default();
    let mut bytes = Vec::new();
    resp.take((MAX_IMAGE_BYTES + 1) as u64)
        .read_to_end(&mut bytes)?;
    if bytes.is_empty() {
        return Err(AppError::Message("Image was empty".into()));
    }
    if bytes.len() > MAX_IMAGE_BYTES {
        return Err(AppError::Message("Image is too large".into()));
    }
    if content_type.to_ascii_lowercase().contains("text/html") || looks_like_html(&bytes) {
        return Err(AppError::Message("Response was not an image".into()));
    }
    if !content_type.to_ascii_lowercase().starts_with("image/") && !looks_like_image(&bytes) {
        return Err(AppError::Message("Response was not an image".into()));
    }
    let ext = extension_for(&content_type, &parsed);
    let safe_stem = stem
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' || c == '_' {
                c
            } else {
                '-'
            }
        })
        .collect::<String>();
    let relative = format!("{dir_rel}/{safe_stem}.{ext}");
    let absolute = paths::media_dir().join(&relative);
    if let Some(parent) = absolute.parent() {
        std::fs::create_dir_all(parent)?;
    }
    std::fs::write(&absolute, &bytes)?;
    let mime = if content_type.starts_with("image/") {
        content_type
            .split(';')
            .next()
            .unwrap_or("image/jpeg")
            .trim()
            .to_string()
    } else {
        mime_guess::from_path(&absolute)
            .first_or_octet_stream()
            .essence_str()
            .to_string()
    };
    Ok((format!("media/{relative}"), mime, bytes.len() as u64))
}

fn looks_like_html(bytes: &[u8]) -> bool {
    let prefix = String::from_utf8_lossy(&bytes[..bytes.len().min(64)]).to_ascii_lowercase();
    prefix.trim_start().starts_with("<!doctype html") || prefix.trim_start().starts_with("<html")
}

fn looks_like_image(bytes: &[u8]) -> bool {
    if bytes.len() < 4 {
        return false;
    }
    let b = bytes;
    b.starts_with(&[0xFF, 0xD8, 0xFF])
        || b.starts_with(&[0x89, 0x50, 0x4E, 0x47])
        || b.starts_with(b"GIF8")
        || (b.starts_with(b"RIFF") && b.len() > 12 && &b[8..12] == b"WEBP")
        || b.starts_with(&[0, 0, 1, 0])
        || b.starts_with(b"BM")
        || b.starts_with(b"\x1f\x8b")
        || String::from_utf8_lossy(&b[..b.len().min(32)])
            .to_ascii_lowercase()
            .contains("<svg")
}

fn extension_for(content_type: &str, url: &Url) -> &'static str {
    let ct = content_type
        .split(';')
        .next()
        .unwrap_or("")
        .trim()
        .to_ascii_lowercase();
    match ct.as_str() {
        "image/jpeg" | "image/jpg" | "image/pjpeg" => return "jpg",
        "image/png" => return "png",
        "image/gif" => return "gif",
        "image/webp" => return "webp",
        "image/avif" => return "avif",
        "image/svg+xml" => return "svg",
        "image/bmp" => return "bmp",
        "image/x-icon" | "image/vnd.microsoft.icon" => return "ico",
        "image/tiff" => return "tiff",
        _ => {}
    }
    let path = url.path().to_ascii_lowercase();
    for ext in [
        "jpg", "jpeg", "png", "gif", "webp", "avif", "svg", "bmp", "ico", "tiff",
    ] {
        if path.ends_with(&format!(".{ext}")) {
            return match ext {
                "jpeg" => "jpg",
                "tiff" => "tiff",
                other => other,
            };
        }
    }
    "jpg"
}

fn html_candidates(html: &str, base_url: &str) -> Vec<Candidate> {
    let Ok(selector) = Selector::parse("link[rel~=\"alternate\"]") else {
        return Vec::new();
    };
    let doc = Html::parse_document(html);
    let base = Url::parse(base_url)
        .ok()
        .map(|u| {
            let mut origin = u.clone();
            origin.set_path("");
            origin.set_query(None);
            origin.set_fragment(None);
            origin.to_string()
        })
        .unwrap_or_else(|| base_url.to_string());
    let mut out = Vec::new();
    for element in doc.select(&selector) {
        let kind_type = element
            .value()
            .attr("type")
            .unwrap_or("")
            .to_ascii_lowercase();
        let kind = if kind_type.contains("atom") {
            "atom"
        } else if kind_type.contains("json") {
            "json"
        } else if kind_type.contains("rss") || kind_type.contains("xml") {
            "rss"
        } else {
            continue;
        };
        let Some(href) = element.value().attr("href") else {
            continue;
        };
        let Some(url) = resolve_url(base_url, href) else {
            continue;
        };
        let title = element
            .value()
            .attr("title")
            .map(str::to_string)
            .filter(|t| !t.trim().is_empty())
            .unwrap_or_else(|| url.clone());
        out.push(Candidate {
            title,
            url,
            site_url: Some(base.clone()),
            description: None,
            kind: kind.to_string(),
        });
    }
    out
}

fn candidate_from_feed(feed: &ParsedFeed, url: &str) -> Candidate {
    Candidate {
        title: text_of(feed.title.as_ref())
            .map(|t| truncate_chars(&strip_html(&t), 300))
            .filter(|t| !t.is_empty())
            .unwrap_or_else(|| url.to_string()),
        url: url.to_string(),
        site_url: feed_site_url(feed, url),
        description: text_of(feed.description.as_ref())
            .map(|d| truncate_chars(&strip_html(&d), 300)),
        kind: kind_of(feed).to_string(),
    }
}

fn suffix_urls(base_url: &str) -> Vec<String> {
    let Ok(url) = Url::parse(base_url) else {
        return Vec::new();
    };
    let paths = [
        "/feed",
        "/rss",
        "/rss.xml",
        "/atom.xml",
        "/index.xml",
        "/feed.xml",
        "/feeds/all.atom.xml",
    ];
    paths
        .iter()
        .filter_map(|p| {
            let mut candidate = url.clone();
            candidate.set_path(p);
            candidate.set_query(None);
            candidate.set_fragment(None);
            Some(candidate.to_string())
        })
        .collect()
}

pub fn discover(url: &str, max_bytes: u64) -> AppResult<Vec<Candidate>> {
    let normalized = normalized_url(url)?;
    let first = match http_get(&normalized, None, None, true, max_bytes)? {
        HttpResult::Ok(body) => body,
        HttpResult::NotModified => return Ok(Vec::new()),
    };
    if let Ok(feed) = parse_feed(&first.bytes) {
        return Ok(vec![candidate_from_feed(&feed, &first.final_url)]);
    }
    let html = String::from_utf8_lossy(&first.bytes).to_string();
    let mut candidates = html_candidates(&html, &first.final_url);
    dedup_candidates(&mut candidates);
    if !candidates.is_empty() {
        candidates.truncate(8);
        return Ok(candidates);
    }
    for suffix in suffix_urls(&first.final_url) {
        if candidates.len() >= 8 {
            break;
        }
        if candidates.iter().any(|c| c.url == suffix) {
            continue;
        }
        let body = match http_get(&suffix, None, None, true, max_bytes) {
            Ok(HttpResult::Ok(body)) => body,
            Err(error @ AppError::DownloadTooLarge { .. }) => return Err(error),
            _ => continue,
        };
        if let Ok(feed) = parse_feed(&body.bytes) {
            let candidate = candidate_from_feed(&feed, &body.final_url);
            if !candidates.iter().any(|c| c.url == candidate.url) {
                candidates.push(candidate);
            }
        }
    }
    candidates.truncate(8);
    Ok(candidates)
}

fn dedup_candidates(candidates: &mut Vec<Candidate>) {
    let mut seen = std::collections::HashSet::new();
    candidates.retain(|c| seen.insert(c.url.clone()));
}

/// Save a subscription without making any network requests.
pub fn subscribe(conn: &Connection, args: AddFeedArgs) -> AppResult<Feed> {
    let url = normalized_url(&args.url)?;
    if let Ok(existing) = feed_by_url(conn, &url) {
        return Ok(existing);
    }
    if let Some(folder_id) = args.folder_id {
        folder_exists(conn, folder_id)?;
    }
    let title = args
        .title
        .as_deref()
        .map(str::trim)
        .filter(|title| !title.is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| feed_host(&url).unwrap_or_else(|| "New feed".into()));
    conn.execute(
        "INSERT OR IGNORE INTO feeds(title, url, site_url, folder_id, last_status, created_at)
         VALUES(?1, ?2, ?3, ?4, 'pending', ?5)",
        params![title, url, origin_of(&url), args.folder_id, now_iso()],
    )?;
    feed_by_url(conn, &url)
}

/// OPML imports use the same subscription/fetch logic inside their blocking worker.
pub fn add_feed(conn: &Connection, args: AddFeedArgs) -> AppResult<Feed> {
    let feed = subscribe(conn, args)?;
    if feed.last_status == "pending" {
        // A failed first fetch still leaves the subscription available for editing/retry.
        if fetch_subscription(conn, feed.id).is_ok() {
            let _ = cache_feed_media(conn, feed.id);
        }
    }
    feed_by_id(conn, feed.id)
}

pub fn fetch_subscription(conn: &Connection, feed_id: i64) -> AppResult<Feed> {
    let feed = internal_feed(conn, feed_id)?;
    conn.execute(
        "UPDATE feeds SET last_status = 'fetching', error = NULL WHERE id = ?1",
        params![feed_id],
    )?;
    let result = fetch_subscription_inner(conn, feed_id, &feed.url);
    if let Err(error) = &result {
        set_feed_error(conn, feed_id, &error.to_string())?;
    }
    result
}

fn fetch_subscription_inner(conn: &Connection, feed_id: i64, input: &str) -> AppResult<Feed> {
    let max_bytes = crate::settings::feed_download_limit_bytes(conn);
    let mut body = match http_get(input, None, None, false, max_bytes)? {
        HttpResult::Ok(body) => body,
        HttpResult::NotModified => {
            return Err(AppError::Message(
                "The server returned no feed content.".into(),
            ))
        }
    };
    let mut parsed = parse_feed(&body.bytes).ok();
    if parsed.is_none() {
        let html = String::from_utf8_lossy(&body.bytes);
        let mut candidates: Vec<String> = html_candidates(&html, &body.final_url)
            .into_iter()
            .map(|candidate| candidate.url)
            .collect();
        candidates.extend(suffix_urls(&body.final_url));
        let mut seen = std::collections::HashSet::new();
        for candidate in candidates
            .into_iter()
            .filter(|url| seen.insert(url.clone()))
        {
            let candidate_body = match http_get(&candidate, None, None, true, max_bytes) {
                Ok(HttpResult::Ok(body)) => body,
                Err(error @ AppError::DownloadTooLarge { .. }) => return Err(error),
                _ => continue,
            };
            if let Ok(feed) = parse_feed(&candidate_body.bytes) {
                body = candidate_body;
                parsed = Some(feed);
                break;
            }
        }
    }
    let parsed = parsed
        .ok_or_else(|| AppError::Message("No RSS, Atom or JSON feed found at this URL".into()))?;
    let tx = Transaction::new_unchecked(conn, TransactionBehavior::Immediate)?;
    if let Ok(existing) = feed_by_url(&tx, &body.final_url) {
        if existing.id != feed_id {
            return Err(AppError::Message(format!(
                "Already subscribed to this feed as {}",
                existing.title
            )));
        }
    }
    let title = text_of(parsed.title.as_ref())
        .map(|title| truncate_chars(&strip_html(&title), 500))
        .filter(|title| !title.is_empty())
        .unwrap_or_else(|| feed_host(&body.final_url).unwrap_or_else(|| "Untitled feed".into()));
    let site_url = feed_site_url(&parsed, &body.final_url);
    let description =
        text_of(parsed.description.as_ref()).map(|text| truncate_chars(&strip_html(&text), 500));
    let icon_remote = parsed
        .icon
        .as_ref()
        .map(|icon| icon.uri.clone())
        .or_else(|| parsed.logo.as_ref().map(|icon| icon.uri.clone()))
        .and_then(|url| resolve_url(&body.final_url, &url))
        .or_else(|| favicon_for(site_url.as_deref()));
    tx.execute(
        "UPDATE feeds SET title = CASE WHEN title = ?2 THEN ?3 ELSE title END,
            url = ?4, site_url = ?5, description = ?6, icon_remote = ?7 WHERE id = ?1",
        params![
            feed_id,
            feed_host(input).unwrap_or_default(),
            title,
            body.final_url,
            site_url,
            description,
            icon_remote
        ],
    )?;
    ingest_feed(&tx, feed_id, &parsed, &body.final_url)?;
    tx.execute(
        "UPDATE feeds SET last_status = 'ok', error = NULL, last_fetched_at = ?2,
            etag = ?3, last_modified = ?4 WHERE id = ?1",
        params![feed_id, now_iso(), body.etag, body.last_modified],
    )?;
    tx.commit()?;
    feed_by_id(conn, feed_id)
}

fn feed_host(url: &str) -> Option<String> {
    Url::parse(url)
        .ok()
        .and_then(|u| u.host_str().map(str::to_string))
}

fn folder_exists(conn: &Connection, id: i64) -> AppResult<()> {
    let exists: i64 = conn.query_row(
        "SELECT COUNT(*) FROM folders WHERE id = ?1",
        params![id],
        |r| r.get(0),
    )?;
    if exists == 0 {
        return Err(AppError::Message("Folder not found".into()));
    }
    Ok(())
}

const FEED_SELECT: &str = "SELECT f.id, f.title, f.url, f.site_url, f.description, f.icon_url,
    f.folder_id, fo.name,
    (SELECT COUNT(*) FROM articles a WHERE a.feed_id = f.id AND a.is_read = 0 AND a.is_archived = 0),
    f.last_fetched_at, f.last_status, f.error, f.fetch_interval, f.is_active, f.created_at
    FROM feeds f LEFT JOIN folders fo ON fo.id = f.folder_id";

fn map_feed(row: &rusqlite::Row<'_>) -> rusqlite::Result<Feed> {
    Ok(Feed {
        id: row.get(0)?,
        title: row.get(1)?,
        url: row.get(2)?,
        site_url: row.get(3)?,
        description: row.get(4)?,
        icon_url: row.get(5)?,
        folder_id: row.get(6)?,
        folder_name: row.get(7)?,
        unread_count: row.get(8)?,
        last_fetched_at: row.get(9)?,
        last_status: row.get(10)?,
        error: row.get(11)?,
        fetch_interval: row.get(12)?,
        is_active: row.get::<_, i64>(13)? != 0,
        created_at: row.get(14)?,
    })
}

pub fn list_feeds(conn: &Connection) -> AppResult<Vec<Feed>> {
    let sql = format!("{FEED_SELECT} ORDER BY f.title COLLATE NOCASE ASC");
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map([], map_feed)?;
    Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
}

pub fn feed_by_id(conn: &Connection, id: i64) -> AppResult<Feed> {
    let sql = format!("{FEED_SELECT} WHERE f.id = ?1");
    Ok(conn.query_row(&sql, params![id], map_feed)?)
}

fn feed_by_url(conn: &Connection, url: &str) -> AppResult<Feed> {
    let sql = format!("{FEED_SELECT} WHERE f.url = ?1");
    Ok(conn.query_row(&sql, params![url], map_feed)?)
}

pub fn update_feed(conn: &Connection, args: UpdateFeedArgs) -> AppResult<Feed> {
    let tx = conn.unchecked_transaction()?;
    let old = feed_by_id(&tx, args.id)?;
    let title = args.title.as_deref().unwrap_or(&old.title).trim();
    if title.is_empty() {
        return Err(AppError::Message("A feed title cannot be empty.".into()));
    }
    let url = match args.url.as_deref() {
        Some(url) => normalized_url(url)?,
        None => old.url.clone(),
    };
    let url_changed = url != old.url;
    if url_changed && old.last_status == "fetching" {
        return Err(AppError::Message(
            "This feed is loading. Wait for it to finish before changing its URL.".into(),
        ));
    }
    if url_changed {
        if let Ok(existing) = feed_by_url(&tx, &url) {
            if existing.id != args.id {
                return Err(AppError::Message(
                    "Another subscription already uses this feed URL.".into(),
                ));
            }
        }
    }
    let folder_id = args.folder_id.unwrap_or(old.folder_id);
    if let Some(folder_id) = folder_id {
        folder_exists(&tx, folder_id)?;
    }
    tx.execute(
        "UPDATE feeds SET title = ?2, url = ?3, folder_id = ?4, fetch_interval = ?5, is_active = ?6,
            etag = CASE WHEN ?7 THEN NULL ELSE etag END,
            last_modified = CASE WHEN ?7 THEN NULL ELSE last_modified END,
            last_fetched_at = CASE WHEN ?7 THEN NULL ELSE last_fetched_at END,
            last_status = CASE WHEN ?7 THEN 'pending' ELSE last_status END,
            error = CASE WHEN ?7 THEN NULL ELSE error END,
            icon_url = CASE WHEN ?7 THEN NULL ELSE icon_url END,
            icon_remote = CASE WHEN ?7 THEN NULL ELSE icon_remote END,
            description = CASE WHEN ?7 THEN NULL ELSE description END,
            site_url = CASE WHEN ?7 THEN ?8 ELSE site_url END WHERE id = ?1",
        params![args.id, title, url, folder_id,
            args.fetch_interval.unwrap_or(old.fetch_interval).clamp(1, 10080),
            args.is_active.unwrap_or(old.is_active), url_changed, origin_of(&url)],
    )?;
    if title != old.title {
        tx.execute(
            "UPDATE articles SET feed_title = ?2 WHERE feed_id = ?1",
            params![args.id, title],
        )?;
    }
    let feed = feed_by_id(&tx, args.id)?;
    tx.commit()?;
    Ok(feed)
}

pub fn delete_feed(conn: &Connection, id: i64) -> AppResult<()> {
    let mut files: Vec<String> = Vec::new();
    if let Ok(icon) = conn.query_row(
        "SELECT icon_url FROM feeds WHERE id = ?1",
        params![id],
        |r| r.get::<_, Option<String>>(0),
    ) {
        if let Some(icon) = icon.and_then(|u| paths::relative_from_url(&u)) {
            files.push(icon);
        }
    }
    {
        let mut stmt = conn.prepare("SELECT local_path FROM media WHERE article_id IN (SELECT id FROM articles WHERE feed_id = ?1)")?;
        let rows = stmt.query_map(params![id], |r| r.get::<_, String>(0))?;
        for path in rows.flatten() {
            files.push(path);
        }
    }
    let article_ids: Vec<i64> = {
        let mut stmt = conn.prepare("SELECT id FROM articles WHERE feed_id = ?1")?;
        let rows = stmt.query_map(params![id], |r| r.get::<_, i64>(0))?;
        rows.flatten().collect()
    };
    conn.execute("DELETE FROM feeds WHERE id = ?1", params![id])?;
    for file in files {
        paths::remove_media_file(&file);
    }
    for article_id in article_ids {
        paths::remove_article_media(article_id);
    }
    Ok(())
}

// Keep this allowlist aligned with ArticleContent and the frame-src CSP.
pub fn allowed_embed(value: &str) -> bool {
    let Ok(url) = Url::parse(value) else {
        return false;
    };
    if url.scheme() != "https"
        || !url.username().is_empty()
        || url.password().is_some()
        || url.port().is_some()
    {
        return false;
    }
    match url.host_str().unwrap_or("") {
        "www.youtube.com" | "www.youtube-nocookie.com" => url.path().starts_with("/embed/"),
        "player.vimeo.com" => url.path().starts_with("/video/"),
        _ => false,
    }
}
