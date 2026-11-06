use crate::db;
use crate::error::AppResult;
use crate::feeds;
use crate::models::*;
use crate::opml;
use crate::paths;
use crate::settings;
use crate::transfer;
use crate::AppState;
use chrono::{Duration, Utc};
use rusqlite::{params, Connection};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;
use std::sync::atomic::Ordering;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_opener::OpenerExt;
use walkdir::WalkDir;

fn fail(e: impl std::fmt::Display) -> String {
    e.to_string()
}

async fn blocking<T, F>(f: F) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, String> + Send + 'static,
{
    match tauri::async_runtime::spawn_blocking(f).await {
        Ok(result) => result,
        Err(e) => Err(format!("Background task failed: {e}")),
    }
}

#[tauri::command(rename_all = "camelCase")]
pub async fn generate_summary(
    app: AppHandle,
    article_id: i64,
) -> Result<crate::summaries::SummaryResult, String> {
    blocking(move || {
        crate::summaries::generate(&app.state::<AppState>().summaries, article_id).map_err(fail)
    })
    .await
}

pub fn build_bootstrap(conn: &Connection) -> AppResult<Bootstrap> {
    let feeds = feeds::list_feeds(conn)?;
    let tags = crate::articles::list_tags(conn)?;
    let counts = db::counts(conn)?;
    let settings = settings::get_settings(conn)?;
    let mut stmt = conn.prepare(
        "SELECT fo.id, fo.name, fo.position,
            (SELECT COUNT(*) FROM articles a JOIN feeds f ON f.id = a.feed_id
                WHERE f.folder_id = fo.id AND a.is_read = 0 AND a.is_archived = 0),
            (SELECT COUNT(*) FROM feeds f WHERE f.folder_id = fo.id)
         FROM folders fo ORDER BY fo.position ASC, fo.name COLLATE NOCASE ASC",
    )?;
    let folders = stmt
        .query_map([], |r| {
            Ok(Folder {
                id: r.get(0)?,
                name: r.get(1)?,
                position: r.get(2)?,
                unread_count: r.get(3)?,
                feed_count: r.get(4)?,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;

    let mut unread_by_feed: BTreeMap<String, i64> = BTreeMap::new();
    {
        let mut stmt = conn.prepare(
            "SELECT f.id, (SELECT COUNT(*) FROM articles a WHERE a.feed_id = f.id
                AND a.is_read = 0 AND a.is_archived = 0) FROM feeds f",
        )?;
        let rows = stmt.query_map([], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, i64>(1)?)))?;
        for row in rows.flatten() {
            unread_by_feed.insert(row.0.to_string(), row.1);
        }
    }
    let mut unread_by_folder: BTreeMap<String, i64> = BTreeMap::new();
    {
        let mut stmt = conn.prepare(
            "SELECT fo.id, (SELECT COUNT(*) FROM articles a JOIN feeds f ON f.id = a.feed_id
                WHERE f.folder_id = fo.id AND a.is_read = 0 AND a.is_archived = 0)
             FROM folders fo",
        )?;
        let rows = stmt.query_map([], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, i64>(1)?)))?;
        for row in rows.flatten() {
            unread_by_folder.insert(row.0.to_string(), row.1);
        }
    }

    Ok(Bootstrap {
        feeds,
        folders,
        tags,
        counts,
        settings,
        unread_by_feed,
        unread_by_folder,
        data_dir: paths::data_dir().to_string_lossy().to_string(),
        version: env!("CARGO_PKG_VERSION").to_string(),
    })
}

#[tauri::command(rename_all = "camelCase")]
pub async fn bootstrap() -> Result<Bootstrap, String> {
    blocking(move || {
        let conn = db::ensure_db().map_err(fail)?;
        build_bootstrap(&conn).map_err(fail)
    })
    .await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn list_articles(query: ArticleQuery) -> Result<ListArticlesResult, String> {
    blocking(move || {
        let conn = db::ensure_db().map_err(fail)?;
        crate::articles::list_articles(&conn, &query).map_err(fail)
    })
    .await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn get_article(id: i64) -> Result<ArticleDetail, String> {
    blocking(move || {
        let conn = db::ensure_db().map_err(fail)?;
        crate::articles::get_article(&conn, id).map_err(fail)
    })
    .await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn set_article_state(id: i64, patch: ArticleStatePatch) -> Result<Counts, String> {
    blocking(move || {
        let conn = db::ensure_db().map_err(fail)?;
        crate::articles::set_article_state(&conn, id, &patch).map_err(fail)
    })
    .await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn mark_all_read(scope: MarkAllScope) -> Result<Counts, String> {
    blocking(move || {
        let conn = db::ensure_db().map_err(fail)?;
        crate::articles::mark_all_read(&conn, &scope).map_err(fail)
    })
    .await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn discover_feeds(url: String) -> Result<DiscoverResult, String> {
    blocking(move || {
        let max_bytes = {
            let conn = db::ensure_db().map_err(fail)?;
            settings::feed_download_limit_bytes(&conn)
        };
        let candidates = feeds::discover(&url, max_bytes).map_err(fail)?;
        Ok(DiscoverResult { candidates })
    })
    .await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn add_feed(app: AppHandle, args: AddFeedArgs) -> Result<Feed, String> {
    blocking(move || {
        let state = app.state::<AppState>();
        let _transfer = state
            .transfer_lock
            .try_lock()
            .map_err(|_| "Wait for the current transfer to finish.".to_string())?;
        let conn = db::ensure_db().map_err(fail)?;
        let feed = feeds::subscribe(&conn, args).map_err(fail)?;
        if feed.last_status == "pending" {
            state.subscriptions.enqueue(feed.id).map_err(fail)?;
        }
        Ok(feed)
    })
    .await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn add_feeds(app: AppHandle, args: Vec<AddFeedArgs>) -> Result<AddFeedsResult, String> {
    blocking(move || {
        let state = app.state::<AppState>();
        let _transfer = state
            .transfer_lock
            .try_lock()
            .map_err(|_| "Wait for the current transfer to finish.".to_string())?;
        let conn = db::ensure_db().map_err(fail)?;
        let mut result = AddFeedsResult::default();
        for args in args {
            let url = args.url.clone();
            match feeds::subscribe(&conn, args) {
                Ok(feed) => {
                    if feed.last_status == "pending" {
                        if let Err(error) = state.subscriptions.enqueue(feed.id) {
                            result.failures.push(format!("{url}: {error}"));
                        }
                    }
                    result.feeds.push(feed);
                }
                Err(error) => result.failures.push(format!("{url}: {error}")),
            }
        }
        Ok(result)
    })
    .await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn update_feed(app: AppHandle, args: UpdateFeedArgs) -> Result<Feed, String> {
    blocking(move || {
        let state = app.state::<AppState>();
        let _transfer = state
            .transfer_lock
            .try_lock()
            .map_err(|_| "Wait for the current transfer to finish.".to_string())?;
        let conn = db::ensure_db().map_err(fail)?;
        let feed = feeds::update_feed(&conn, args).map_err(fail)?;
        if feed.last_status == "pending" {
            state.subscriptions.enqueue(feed.id).map_err(fail)?;
        }
        Ok(feed)
    })
    .await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn delete_feed(id: i64) -> Result<Counts, String> {
    blocking(move || {
        let conn = db::ensure_db().map_err(fail)?;
        feeds::delete_feed(&conn, id).map_err(fail)?;
        db::counts(&conn).map_err(fail)
    })
    .await
}

pub fn run_refresh(
    app: &AppHandle,
    state: &AppState,
    feed_id: Option<i64>,
    scheduled: bool,
) -> AppResult<RefreshResult> {
    let mut conn = db::ensure_db()?;
    let mut targets: Vec<(i64, String)> = Vec::new();
    if let Some(id) = feed_id {
        let feed = feeds::feed_by_id(&conn, id)?;
        if ["pending", "fetching"].contains(&feed.last_status.as_str()) {
            return Err(crate::error::AppError::Message(
                "This feed is already loading in the background.".into(),
            ));
        }
        let title: Option<String> = conn
            .query_row("SELECT title FROM feeds WHERE id = ?1", params![id], |r| {
                r.get(0)
            })
            .ok();
        if let Some(title) = title {
            targets.push((id, title));
        } else {
            return Err(crate::error::AppError::Message("Feed not found".into()));
        }
    } else {
        let mut stmt = conn.prepare(
            "SELECT id, title FROM feeds WHERE is_active = 1
             AND last_status NOT IN ('pending', 'fetching')
             AND (?1 = 0 OR julianday(last_fetched_at) IS NULL
                  OR julianday(last_fetched_at) + min(max(fetch_interval, 1), 10080) / 1440.0 <= julianday('now'))
             ORDER BY title COLLATE NOCASE ASC",
        )?;
        let rows = stmt.query_map(params![scheduled], |r| {
            Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?))
        })?;
        for row in rows.flatten() {
            targets.push(row);
        }
    }
    let total = targets.len() as i64;
    let mut result = RefreshResult::default();
    for (index, (feed_id, title)) in targets.iter().enumerate() {
        match feeds::refresh_one(&conn, *feed_id) {
            Ok(outcome) => {
                result.new_articles += outcome.new_articles;
                result.updated += outcome.updated;
                if !outcome.failures.is_empty() {
                    result.failed += 1;
                    result.failures.extend(outcome.failures);
                }
            }
            Err(e) => {
                let _ = feeds::set_feed_error(&conn, *feed_id, &e.to_string());
                result.failed += 1;
                result.failures.push(format!("{title}: {e}"));
            }
        }
        let _ = app.emit(
            "refresh:progress",
            json!({
                "done": (index as i64) + 1,
                "total": total,
                "feedId": feed_id,
                "title": title,
            }),
        );
    }
    let preferences = settings::get_settings(&conn)?;
    if preferences.retention_days > 0 {
        cleanup_with_connection(
            &mut conn,
            &CleanupArgs {
                older_than_days: preferences.retention_days,
                keep_starred: true,
                keep_unread: true,
            },
        )?;
    }
    crate::desktop::update_unread(app, db::counts(&conn)?.unread, preferences.unread_badge);
    if preferences.notifications_enabled && result.new_articles > 0 {
        use tauri_plugin_notification::NotificationExt;
        let _ = app
            .notification()
            .builder()
            .title("Tyler")
            .body(format!("{} new articles", result.new_articles))
            .show();
    }
    let now = db::now_iso();
    let _ = settings::set_last_refresh(&conn, &now);
    if let Ok(mut slot) = state.last_refresh.lock() {
        *slot = Some(now);
    }
    let _ = app.emit(
        "refresh:done",
        json!({
            "newArticles": result.new_articles,
            "updated": result.updated,
            "failed": result.failed,
            "failures": result.failures,
        }),
    );
    Ok(result)
}

#[tauri::command(rename_all = "camelCase")]
pub async fn refresh(
    app: AppHandle,
    feed_id: Option<i64>,
    scheduled: Option<bool>,
) -> Result<RefreshResult, String> {
    blocking(move || {
        let state = app.state::<AppState>();
        let Ok(_guard) = state.refresh_lock.try_lock() else {
            return Ok(RefreshResult {
                failures: vec!["Refresh already running".into()],
                ..Default::default()
            });
        };
        state.running.store(true, Ordering::SeqCst);
        let result = run_refresh(&app, &state, feed_id, scheduled.unwrap_or(false));
        state.running.store(false, Ordering::SeqCst);
        result.map_err(fail)
    })
    .await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn refresh_status(app: AppHandle) -> Result<RefreshStatus, String> {
    blocking(move || {
        let state = app.state::<AppState>();
        let running = state.running.load(Ordering::SeqCst);
        let memory = state.last_refresh.lock().ok().and_then(|slot| slot.clone());
        let last_run = if memory.is_some() {
            memory
        } else {
            let conn = db::ensure_db().map_err(fail)?;
            settings::last_refresh(&conn)
        };
        Ok(RefreshStatus { running, last_run })
    })
    .await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn create_folder(name: String) -> Result<Folder, String> {
    blocking(move || {
        let conn = db::ensure_db().map_err(fail)?;
        let name = name.trim();
        if name.is_empty() {
            return Err("Folder name is required".into());
        }
        let position: i64 = conn
            .query_row(
                "SELECT COALESCE(MAX(position), -1) + 1 FROM folders",
                [],
                |r| r.get(0),
            )
            .unwrap_or(0);
        conn.execute(
            "INSERT INTO folders(name, position, created_at) VALUES(?1, ?2, ?3)",
            params![name, position, db::now_iso()],
        )
        .map_err(|e| match &e {
            rusqlite::Error::SqliteFailure(err, _)
                if err.code == rusqlite::ErrorCode::ConstraintViolation =>
            {
                "A folder with that name already exists".to_string()
            }
            _ => e.to_string(),
        })?;
        let id = conn.last_insert_rowid();
        conn.query_row(
            "SELECT fo.id, fo.name, fo.position,
                (SELECT COUNT(*) FROM articles a JOIN feeds f ON f.id = a.feed_id
                    WHERE f.folder_id = fo.id AND a.is_read = 0 AND a.is_archived = 0),
                (SELECT COUNT(*) FROM feeds f WHERE f.folder_id = fo.id)
             FROM folders fo WHERE fo.id = ?1",
            params![id],
            |r| {
                Ok(Folder {
                    id: r.get(0)?,
                    name: r.get(1)?,
                    position: r.get(2)?,
                    unread_count: r.get(3)?,
                    feed_count: r.get(4)?,
                })
            },
        )
        .map_err(fail)
    })
    .await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn rename_folder(id: i64, name: String) -> Result<(), String> {
    blocking(move || {
        let conn = db::ensure_db().map_err(fail)?;
        let name = name.trim();
        if name.is_empty() {
            return Err("Folder name is required".into());
        }
        let changed = conn
            .execute(
                "UPDATE folders SET name = ?2 WHERE id = ?1",
                params![id, name],
            )
            .map_err(fail)?;
        if changed == 0 {
            return Err("Folder not found".into());
        }
        Ok(())
    })
    .await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn delete_folder(id: i64) -> Result<(), String> {
    blocking(move || {
        let conn = db::ensure_db().map_err(fail)?;
        conn.execute(
            "UPDATE feeds SET folder_id = NULL WHERE folder_id = ?1",
            params![id],
        )
        .map_err(fail)?;
        conn.execute("DELETE FROM folders WHERE id = ?1", params![id])
            .map_err(fail)?;
        Ok(())
    })
    .await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn create_tag(name: String, color: String) -> Result<Tag, String> {
    blocking(move || {
        let conn = db::ensure_db().map_err(fail)?;
        crate::articles::create_tag(&conn, &name, &color).map_err(fail)
    })
    .await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn create_tags(names: Vec<String>, color: String) -> Result<Vec<Tag>, String> {
    blocking(move || {
        let mut conn = db::ensure_db().map_err(fail)?;
        crate::articles::create_tags(&mut conn, &names, &color).map_err(fail)
    })
    .await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn rename_tag(id: i64, name: String, color: Option<String>) -> Result<(), String> {
    blocking(move || {
        let conn = db::ensure_db().map_err(fail)?;
        crate::articles::rename_tag(&conn, id, &name, color.as_deref()).map_err(fail)
    })
    .await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn delete_tag(id: i64) -> Result<(), String> {
    blocking(move || {
        let conn = db::ensure_db().map_err(fail)?;
        crate::articles::delete_tag(&conn, id).map_err(fail)
    })
    .await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn set_article_tags(article_id: i64, tag_ids: Vec<i64>) -> Result<Vec<Tag>, String> {
    blocking(move || {
        let mut conn = db::ensure_db().map_err(fail)?;
        crate::articles::set_article_tags(&mut conn, article_id, &tag_ids).map_err(fail)
    })
    .await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn list_tags() -> Result<Vec<Tag>, String> {
    blocking(move || {
        let conn = db::ensure_db().map_err(fail)?;
        crate::articles::list_tags(&conn).map_err(fail)
    })
    .await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn get_settings() -> Result<Settings, String> {
    blocking(move || {
        let conn = db::ensure_db().map_err(fail)?;
        settings::get_settings(&conn).map_err(fail)
    })
    .await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn set_settings(patch: Value) -> Result<Settings, String> {
    blocking(move || {
        let mut conn = db::ensure_db().map_err(fail)?;
        settings::set_settings(&mut conn, &patch).map_err(fail)
    })
    .await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn opml_import(path: String) -> Result<OpmlImportResult, String> {
    blocking(move || {
        let conn = db::ensure_db().map_err(fail)?;
        opml::import(&conn, &path).map_err(fail)
    })
    .await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn opml_import_url(url: String) -> Result<OpmlImportResult, String> {
    blocking(move || {
        let url = feeds::normalized_url(&url).map_err(fail)?;
        let max_bytes = {
            let conn = db::ensure_db().map_err(fail)?;
            settings::feed_download_limit_bytes(&conn)
        };
        let fetched = feeds::http_get(&url, None, None, false, max_bytes).map_err(fail)?;
        let bytes = match fetched {
            feeds::HttpResult::Ok(get) => get.bytes,
            feeds::HttpResult::NotModified => {
                return Err("The server returned no OPML content.".into())
            }
        };
        let text = String::from_utf8_lossy(&bytes);
        let conn = db::ensure_db().map_err(fail)?;
        opml::import_str(&conn, &text).map_err(fail)
    })
    .await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn opml_export(path: String) -> Result<OpmlExportResult, String> {
    blocking(move || {
        let conn = db::ensure_db().map_err(fail)?;
        opml::export(&conn, &path).map_err(fail)
    })
    .await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn export_backup(app: AppHandle, path: String) -> Result<BackupExportResult, String> {
    blocking(move || {
        let state = app.state::<AppState>();
        let Ok(_guard) = state.transfer_lock.try_lock() else {
            return Err("A backup or import is already running".into());
        };
        let conn = db::ensure_db().map_err(fail)?;
        transfer::export(&conn, &path).map_err(fail)
    })
    .await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn import_backup(app: AppHandle, path: String) -> Result<Bootstrap, String> {
    blocking(move || {
        let state = app.state::<AppState>();
        let Ok(_guard) = state.transfer_lock.try_lock() else {
            return Err("A backup or import is already running".into());
        };
        let Ok(_refresh_guard) = state.refresh_lock.try_lock() else {
            return Err("Wait for the current refresh to finish before importing".into());
        };
        if state.subscriptions.is_busy().map_err(fail)? {
            return Err("Wait for feeds and images to finish loading before importing.".into());
        }
        transfer::import(&path).map_err(fail)?;
        let conn = db::ensure_db().map_err(fail)?;
        if let Ok(mut slot) = state.last_refresh.lock() {
            *slot = settings::last_refresh(&conn);
        }
        build_bootstrap(&conn).map_err(fail)
    })
    .await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn data_info() -> Result<DataInfo, String> {
    blocking(move || {
        let conn = db::ensure_db().map_err(fail)?;
        let db_path = paths::db_path();
        let db_bytes = std::fs::metadata(&db_path).map(|m| m.len()).unwrap_or(0);
        let media_root = paths::media_dir();
        let mut media_bytes = 0u64;
        let mut media_files = 0u64;
        if media_root.exists() {
            for entry in WalkDir::new(&media_root)
                .follow_links(false)
                .into_iter()
                .flatten()
            {
                if entry.file_type().is_file() {
                    media_files += 1;
                    media_bytes += entry.metadata().map(|m| m.len()).unwrap_or(0);
                }
            }
        }
        let articles: i64 = conn
            .query_row("SELECT COUNT(*) FROM articles", [], |r| r.get(0))
            .unwrap_or(0);
        let feeds_count: i64 = conn
            .query_row("SELECT COUNT(*) FROM feeds", [], |r| r.get(0))
            .unwrap_or(0);
        Ok(DataInfo {
            data_dir: paths::data_dir().to_string_lossy().to_string(),
            db_path: db_path.to_string_lossy().to_string(),
            db_bytes,
            media_bytes,
            media_files,
            articles,
            feeds: feeds_count,
        })
    })
    .await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn cleanup_articles(args: CleanupArgs) -> Result<CleanupResult, String> {
    blocking(move || {
        let mut conn = db::ensure_db().map_err(fail)?;
        cleanup_with_connection(&mut conn, &args).map_err(fail)
    })
    .await
}

fn cleanup_with_connection(conn: &mut Connection, args: &CleanupArgs) -> AppResult<CleanupResult> {
    let days = args.older_than_days.clamp(1, 36500);
    let cutoff = (Utc::now() - Duration::days(days)).to_rfc3339();
    let mut sql = String::from("SELECT id FROM articles WHERE published_at < ?1");
    if args.keep_starred {
        sql.push_str(" AND is_starred = 0");
    }
    if args.keep_unread {
        sql.push_str(" AND is_read = 1");
    }
    let tx = conn.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
    let ids: Vec<i64> = {
        let mut stmt = tx.prepare(&sql)?;
        let rows = stmt
            .query_map(params![cutoff], |r| r.get(0))?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        rows
    };
    if ids.is_empty() {
        return Ok(CleanupResult { removed: 0 });
    }
    let mut files: Vec<String> = Vec::new();
    for id in &ids {
        let mut stmt = tx.prepare("SELECT local_path FROM media WHERE article_id = ?1")?;
        let rows = stmt.query_map(params![id], |r| r.get::<_, String>(0))?;
        for path in rows.flatten() {
            files.push(path);
        }
    }
    for id in &ids {
        tx.execute("DELETE FROM articles WHERE id = ?1", params![id])?;
    }
    tx.commit()?;
    for path in files {
        paths::remove_media_file(&path);
    }
    for id in &ids {
        paths::remove_article_media(*id);
    }
    Ok(CleanupResult {
        removed: ids.len() as i64,
    })
}

#[tauri::command(rename_all = "camelCase")]
pub async fn get_stats() -> Result<Stats, String> {
    blocking(move || {
        let conn = db::ensure_db().map_err(fail)?;
        let total_articles: i64 = conn
            .query_row("SELECT COUNT(*) FROM articles", [], |r| r.get(0))
            .unwrap_or(0);
        let unread: i64 = conn
            .query_row("SELECT COUNT(*) FROM articles WHERE is_read = 0", [], |r| {
                r.get(0)
            })
            .unwrap_or(0);
        let starred: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM articles WHERE is_starred = 1",
                [],
                |r| r.get(0),
            )
            .unwrap_or(0);
        let read: i64 = conn
            .query_row("SELECT COUNT(*) FROM articles WHERE is_read = 1", [], |r| {
                r.get(0)
            })
            .unwrap_or(0);
        let feed_count: i64 = conn
            .query_row("SELECT COUNT(*) FROM feeds", [], |r| r.get(0))
            .unwrap_or(0);
        let folder_count: i64 = conn
            .query_row("SELECT COUNT(*) FROM folders", [], |r| r.get(0))
            .unwrap_or(0);
        let tag_count: i64 = conn
            .query_row("SELECT COUNT(*) FROM tags", [], |r| r.get(0))
            .unwrap_or(0);
        let per_feed: Vec<FeedStat> = {
            let mut stmt = conn
                .prepare(
                    "SELECT f.id, f.title, COUNT(a.id), COALESCE(SUM(CASE WHEN a.is_read = 0 THEN 1 ELSE 0 END), 0)
                     FROM feeds f LEFT JOIN articles a ON a.feed_id = f.id
                     GROUP BY f.id ORDER BY COUNT(a.id) DESC, f.title COLLATE NOCASE ASC",
                )
                .map_err(fail)?;
            let rows = stmt
                .query_map([], |r| {
                    Ok(FeedStat {
                        feed_id: r.get(0)?,
                        title: r.get(1)?,
                        count: r.get(2)?,
                        unread: r.get(3)?,
                    })
                })
                .map_err(fail)?;
            rows.collect::<rusqlite::Result<Vec<_>>>().map_err(fail)?
        };
        let per_day: Vec<DayStat> = {
            let cutoff = (Utc::now() - Duration::days(30)).to_rfc3339();
            let mut stmt = conn
                .prepare(
                    "SELECT substr(published_at, 1, 10) AS day, COUNT(*) FROM articles
                     WHERE published_at >= ?1 GROUP BY day ORDER BY day ASC",
                )
                .map_err(fail)?;
            let rows = stmt
                .query_map(params![cutoff], |r| {
                    Ok(DayStat {
                        date: r.get(0)?,
                        count: r.get(1)?,
                    })
                })
                .map_err(fail)?;
            rows.collect::<rusqlite::Result<Vec<_>>>().map_err(fail)?
        };
        let oldest: Option<String> = conn
            .query_row("SELECT MIN(published_at) FROM articles", [], |r| r.get(0))
            .ok()
            .flatten();
        Ok(Stats {
            total_articles,
            unread,
            starred,
            read,
            feeds: feed_count,
            folders: folder_count,
            tags: tag_count,
            per_feed,
            per_day,
            oldest,
        })
    }).await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn cache_article_media(article_id: i64) -> Result<CacheMediaResult, String> {
    blocking(move || {
        let mut conn = db::ensure_db().map_err(fail)?;
        crate::articles::cache_article_media(&mut conn, article_id).map_err(fail)
    })
    .await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn save_image_from_url(url: String) -> Result<String, String> {
    blocking(move || {
        let _guard = db::library_read().map_err(fail)?;
        if url.starts_with("tyler-media://") {
            return Ok(url);
        }
        let mut hasher = Sha256::new();
        hasher.update(url.as_bytes());
        let hash = format!("{:x}", hasher.finalize());
        let stem = format!("saved-{}", &hash[..20]);
        let (relative, _mime, _bytes) =
            feeds::download_image(&url, "covers", &stem).map_err(fail)?;
        Ok(paths::media_url(&relative))
    })
    .await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn open_data_dir(app: AppHandle) -> Result<(), String> {
    blocking(move || {
        let _guard = db::library_read().map_err(fail)?;
        paths::ensure_base_dirs().map_err(fail)?;
        let dir = paths::data_dir().canonicalize().map_err(fail)?;
        app.opener()
            .open_path(dir.to_string_lossy().into_owned(), None::<&str>)
            .map_err(fail)
    })
    .await
}

#[tauri::command(rename_all = "camelCase")]
pub fn ping() -> Result<String, String> {
    Ok("pong".to_string())
}

/// Show the hidden window after its loading screen has loaded.
pub fn show_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.set_focus();
    }
}
