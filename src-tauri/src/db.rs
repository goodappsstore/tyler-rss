use crate::error::{AppError, AppResult};
use crate::models::Settings;
use crate::paths;
use chrono::{Local, TimeZone, Utc};
use rusqlite::{params, Connection};
use std::ops::{Deref, DerefMut};
use std::path::Path;
use std::sync::{RwLock, RwLockReadGuard, RwLockWriteGuard};

static LIBRARY_LOCK: RwLock<()> = RwLock::new(());

pub fn library_read() -> AppResult<RwLockReadGuard<'static, ()>> {
    LIBRARY_LOCK.try_read().map_err(|_| {
        AppError::Message("A library restore is running. Try again when it finishes.".into())
    })
}

pub fn library_write() -> AppResult<RwLockWriteGuard<'static, ()>> {
    LIBRARY_LOCK.try_write().map_err(|_| {
        AppError::Message("Wait for current library operations to finish before importing.".into())
    })
}

// Drop the SQLite connection before releasing the lock that protects its files.
pub struct LibraryConnection {
    conn: Connection,
    _guard: RwLockReadGuard<'static, ()>,
}

impl Deref for LibraryConnection {
    type Target = Connection;

    fn deref(&self) -> &Connection {
        &self.conn
    }
}

impl DerefMut for LibraryConnection {
    fn deref_mut(&mut self) -> &mut Connection {
        &mut self.conn
    }
}

pub fn now_iso() -> String {
    Utc::now().to_rfc3339()
}

pub fn today_iso() -> String {
    let now = Local::now();
    let midnight = now
        .date_naive()
        .and_hms_opt(0, 0, 0)
        .and_then(|naive| Local.from_local_datetime(&naive).earliest())
        .map(|dt| dt.with_timezone(&Utc))
        .unwrap_or_else(|| {
            Utc.from_utc_datetime(&now.date_naive().and_hms_opt(0, 0, 0).unwrap_or_default())
        });
    midnight.to_rfc3339()
}

fn configure(conn: &Connection) -> AppResult<()> {
    conn.execute_batch(
        "PRAGMA journal_mode=WAL;
         PRAGMA foreign_keys=ON;
         PRAGMA busy_timeout=5000;
         PRAGMA synchronous=NORMAL;",
    )?;
    Ok(())
}

const SCHEMA: &str = r#"
CREATE TABLE IF NOT EXISTS folders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL COLLATE NOCASE UNIQUE,
    position INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS feeds (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL DEFAULT '',
    url TEXT NOT NULL UNIQUE,
    site_url TEXT,
    description TEXT,
    icon_url TEXT,
    icon_remote TEXT,
    folder_id INTEGER REFERENCES folders(id) ON DELETE SET NULL,
    last_fetched_at TEXT,
    last_status TEXT NOT NULL DEFAULT 'never',
    error TEXT,
    fetch_interval INTEGER NOT NULL DEFAULT 30,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    etag TEXT,
    last_modified TEXT
);

CREATE TABLE IF NOT EXISTS articles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    article_id INTEGER GENERATED ALWAYS AS (id) VIRTUAL,
    feed_id INTEGER NOT NULL REFERENCES feeds(id) ON DELETE CASCADE,
    guid TEXT NOT NULL,
    title TEXT NOT NULL DEFAULT '',
    url TEXT,
    author TEXT,
    summary TEXT NOT NULL DEFAULT '',
    content_html TEXT NOT NULL DEFAULT '',
    content_text TEXT NOT NULL DEFAULT '',
    feed_title TEXT NOT NULL DEFAULT '',
    published_at TEXT NOT NULL,
    fetched_at TEXT NOT NULL,
    is_read INTEGER NOT NULL DEFAULT 0,
    is_starred INTEGER NOT NULL DEFAULT 0,
    is_archived INTEGER NOT NULL DEFAULT 0,
    reading_time INTEGER NOT NULL DEFAULT 1,
    image_url TEXT,
    UNIQUE(feed_id, guid)
);

CREATE TABLE IF NOT EXISTS article_enclosures (
    article_id INTEGER NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
    url TEXT NOT NULL,
    mime TEXT NOT NULL,
    PRIMARY KEY(article_id, url)
);

CREATE TABLE IF NOT EXISTS tags (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL COLLATE NOCASE UNIQUE,
    color TEXT NOT NULL DEFAULT '#c2410c',
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS article_tags (
    article_id INTEGER NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
    tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
    PRIMARY KEY (article_id, tag_id)
);

CREATE TABLE IF NOT EXISTS media (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    article_id INTEGER NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
    url TEXT NOT NULL,
    local_path TEXT NOT NULL,
    mime TEXT,
    bytes INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    UNIQUE(article_id, url)
);

CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
"#;

const INDEXES: &str = "
CREATE INDEX IF NOT EXISTS idx_articles_feed ON articles(feed_id);
CREATE INDEX IF NOT EXISTS idx_articles_published ON articles(published_at DESC);
CREATE INDEX IF NOT EXISTS idx_articles_unread ON articles(is_read, is_archived);
CREATE INDEX IF NOT EXISTS idx_articles_starred ON articles(is_starred);
CREATE INDEX IF NOT EXISTS idx_articles_archived ON articles(is_archived);
CREATE INDEX IF NOT EXISTS idx_article_tags_tag ON article_tags(tag_id);
CREATE INDEX IF NOT EXISTS idx_media_article ON media(article_id);
";

pub fn ensure_db() -> AppResult<LibraryConnection> {
    let guard = library_read()?;
    paths::ensure_base_dirs()?;
    let conn = prepare_database(&paths::db_path())?;
    Ok(LibraryConnection {
        conn,
        _guard: guard,
    })
}

/// Prepare a staged database without opening or changing the live library.
pub(crate) fn prepare_database(path: &Path) -> AppResult<Connection> {
    let conn = Connection::open(path)?;
    configure(&conn)?;
    let version: i64 = conn
        .query_row("PRAGMA user_version", [], |r| r.get(0))
        .unwrap_or(0);
    conn.execute_batch(SCHEMA)?;
    migrate(&conn)?;
    conn.execute_batch(INDEXES)?;
    if version < 2 {
        let _ = conn.execute_batch(
            "UPDATE articles SET feed_title = COALESCE((SELECT title FROM feeds WHERE feeds.id = articles.feed_id), '')
             WHERE feed_title = ''",
        );
    }
    ensure_fts(&conn, version < 2)?;
    if version < 3 {
        migrate_media_paths(&conn)?;
    }
    seed_settings(&conn)?;
    if version < 4 {
        // Reparse existing feeds once to populate enclosure metadata.
        conn.execute("UPDATE feeds SET etag = NULL, last_modified = NULL", [])?;
        conn.pragma_update(None, "user_version", 4)?;
    }
    Ok(conn)
}

fn ensure_fts(conn: &Connection, force_rebuild: bool) -> AppResult<()> {
    let existing: Option<String> = conn
        .query_row(
            "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'articles_fts'",
            [],
            |r| r.get(0),
        )
        .ok()
        .flatten();
    let columns = conn
        .prepare("PRAGMA table_info(articles_fts)")?
        .query_map([], |row| row.get::<_, String>(1))?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    let expected = [
        "article_id",
        "title",
        "content_text",
        "author",
        "feed_title",
    ];
    let recreate = match existing.as_deref() {
        Some(sql) => {
            columns != expected
                || !(sql.contains("content='articles'") || sql.contains("content=\"articles\""))
                || sql.contains("columnsize=0")
        }
        None => true,
    };
    if recreate {
        conn.execute_batch(
            "DROP TABLE IF EXISTS articles_fts;
             DROP TRIGGER IF EXISTS articles_fts_ai;
             DROP TRIGGER IF EXISTS articles_fts_ad;
             DROP TRIGGER IF EXISTS articles_fts_au;",
        )?;
    }
    conn.execute_batch(
        "CREATE VIRTUAL TABLE IF NOT EXISTS articles_fts USING fts5(
            article_id UNINDEXED,
            title,
            content_text,
            author,
            feed_title,
            content='articles',
            content_rowid='id'
        );
        CREATE TRIGGER IF NOT EXISTS articles_fts_ai AFTER INSERT ON articles BEGIN
            INSERT INTO articles_fts(rowid, article_id, title, content_text, author, feed_title)
            VALUES (new.id, new.id, new.title, new.content_text, COALESCE(new.author, ''), new.feed_title);
        END;
        CREATE TRIGGER IF NOT EXISTS articles_fts_ad AFTER DELETE ON articles BEGIN
            INSERT INTO articles_fts(articles_fts, rowid, article_id, title, content_text, author, feed_title)
            VALUES ('delete', old.id, old.id, old.title, old.content_text, COALESCE(old.author, ''), old.feed_title);
        END;
        CREATE TRIGGER IF NOT EXISTS articles_fts_au AFTER UPDATE OF title, content_text, author, feed_title ON articles BEGIN
            INSERT INTO articles_fts(articles_fts, rowid, article_id, title, content_text, author, feed_title)
            VALUES ('delete', old.id, old.id, old.title, old.content_text, COALESCE(old.author, ''), old.feed_title);
            INSERT INTO articles_fts(rowid, article_id, title, content_text, author, feed_title)
            VALUES (new.id, new.id, new.title, new.content_text, COALESCE(new.author, ''), new.feed_title);
        END;",
    )?;
    let articles: i64 = conn.query_row("SELECT COUNT(*) FROM articles", [], |r| r.get(0))?;
    // COUNT(*) on the external-content table reads articles, not the index.
    let indexed: i64 = conn.query_row("SELECT COUNT(*) FROM articles_fts_docsize", [], |r| {
        r.get(0)
    })?;
    if recreate || force_rebuild || articles != indexed {
        rebuild_fts(conn)?;
    }
    Ok(())
}

fn has_column(conn: &Connection, table: &str, column: &str) -> bool {
    let sql = format!("PRAGMA table_xinfo({table})");
    let Ok(mut stmt) = conn.prepare(&sql) else {
        return false;
    };
    let rows = stmt.query_map([], |r| r.get::<_, String>(1));
    match rows {
        Ok(rows) => rows.flatten().any(|name| name == column),
        Err(_) => false,
    }
}

fn add_column(conn: &Connection, table: &str, column: &str, decl: &str) {
    if !has_column(conn, table, column) {
        let sql = format!("ALTER TABLE {table} ADD COLUMN {column} {decl}");
        let _ = conn.execute_batch(&sql);
    }
}

fn migrate(conn: &Connection) -> AppResult<()> {
    // Tolerate databases produced by earlier builds or imported backups.
    add_column(conn, "feeds", "etag", "TEXT");
    add_column(conn, "feeds", "last_modified", "TEXT");
    add_column(conn, "feeds", "icon_remote", "TEXT");
    add_column(
        conn,
        "feeds",
        "fetch_interval",
        "INTEGER NOT NULL DEFAULT 30",
    );
    add_column(conn, "feeds", "is_active", "INTEGER NOT NULL DEFAULT 1");
    add_column(conn, "articles", "content_text", "TEXT NOT NULL DEFAULT ''");
    add_column(
        conn,
        "articles",
        "full_content_loaded",
        "INTEGER NOT NULL DEFAULT 0",
    );
    add_column(
        conn,
        "articles",
        "reading_time",
        "INTEGER NOT NULL DEFAULT 1",
    );
    add_column(conn, "articles", "image_url", "TEXT");
    add_column(conn, "articles", "summary", "TEXT NOT NULL DEFAULT ''");
    add_column(
        conn,
        "articles",
        "is_archived",
        "INTEGER NOT NULL DEFAULT 0",
    );
    add_column(conn, "articles", "feed_title", "TEXT NOT NULL DEFAULT ''");
    add_column(
        conn,
        "articles",
        "article_id",
        "INTEGER GENERATED ALWAYS AS (id) VIRTUAL",
    );
    Ok(())
}

fn migrate_media_paths(conn: &Connection) -> AppResult<()> {
    let tx = conn.unchecked_transaction()?;
    for directory in ["feed-icons", "covers", "articles"] {
        tx.execute(
            "UPDATE media SET local_path = 'media/' || local_path WHERE local_path LIKE ?1",
            params![format!("{directory}/%")],
        )?;
        let old = format!("tyler-media://localhost/{directory}/");
        let new = format!("tyler-media://localhost/media/{directory}/");
        tx.execute(
            "UPDATE feeds SET icon_url = replace(icon_url, ?1, ?2)",
            params![old, new],
        )?;
        tx.execute(
            "UPDATE articles SET image_url = replace(image_url, ?1, ?2),
                content_html = replace(content_html, ?1, ?2)",
            params![old, new],
        )?;
    }
    tx.commit()?;
    Ok(())
}

fn seed_settings(conn: &Connection) -> AppResult<()> {
    for (key, value) in Settings::defaults() {
        conn.execute(
            "INSERT OR IGNORE INTO settings(key, value) VALUES(?1, ?2)",
            params![
                key,
                serde_json::to_string(&value).unwrap_or_else(|_| "null".into())
            ],
        )?;
    }
    Ok(())
}

pub fn rebuild_fts(conn: &Connection) -> AppResult<()> {
    conn.execute(
        "INSERT INTO articles_fts(articles_fts) VALUES('rebuild')",
        [],
    )?;
    Ok(())
}

pub fn counts(conn: &Connection) -> AppResult<crate::models::Counts> {
    let today = today_iso();
    let all: i64 = conn.query_row(
        "SELECT COUNT(*) FROM articles WHERE is_archived = 0",
        [],
        |r| r.get(0),
    )?;
    let unread: i64 = conn.query_row(
        "SELECT COUNT(*) FROM articles WHERE is_archived = 0 AND is_read = 0",
        [],
        |r| r.get(0),
    )?;
    let starred: i64 = conn.query_row(
        "SELECT COUNT(*) FROM articles WHERE is_archived = 0 AND is_starred = 1",
        [],
        |r| r.get(0),
    )?;
    let today_count: i64 = conn.query_row(
        "SELECT COUNT(*) FROM articles WHERE is_archived = 0 AND published_at >= ?1",
        params![today],
        |r| r.get(0),
    )?;
    Ok(crate::models::Counts {
        all,
        unread,
        starred,
        today: today_count,
        archived: conn.query_row(
            "SELECT COUNT(*) FROM articles WHERE is_archived = 1",
            [],
            |r| r.get(0),
        )?,
    })
}

pub fn setting_raw(conn: &Connection, key: &str) -> Option<serde_json::Value> {
    let raw: Option<String> = conn
        .query_row(
            "SELECT value FROM settings WHERE key = ?1",
            params![key],
            |r| r.get(0),
        )
        .ok();
    let raw = raw?;
    serde_json::from_str::<serde_json::Value>(&raw)
        .ok()
        .or_else(|| Some(serde_json::Value::String(raw)))
}
