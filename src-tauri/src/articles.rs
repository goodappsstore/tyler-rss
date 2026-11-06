use crate::db::{self, now_iso, today_iso};
use crate::error::{AppError, AppResult};
use crate::feeds;
use crate::models::{
    ArticleCursor, ArticleDetail, ArticleQuery, ArticleStatePatch, ArticleSummary,
    CacheMediaResult, Counts, ListArticlesResult, MarkAllScope, Tag,
};
use crate::paths;
use regex::Regex;
use rusqlite::types::Value;
use rusqlite::{params, params_from_iter, Connection};
use sha2::{Digest, Sha256};
use std::collections::{HashMap, HashSet};
use std::sync::OnceLock;

const SUMMARY_SELECT: &str = "SELECT a.id, a.feed_id, f.title, f.icon_url, a.title, a.url,
    a.author, a.summary, a.published_at, a.fetched_at, a.is_read, a.is_starred, a.is_archived,
    a.reading_time, a.image_url,
    COALESCE((SELECT group_concat(t.name, char(31)) FROM article_tags at
        JOIN tags t ON t.id = at.tag_id WHERE at.article_id = a.id), '')";

fn split_tags(raw: String) -> Vec<String> {
    raw.split('\u{1f}')
        .filter(|s| !s.is_empty())
        .map(str::to_string)
        .collect()
}

fn map_summary(row: &rusqlite::Row<'_>) -> rusqlite::Result<ArticleSummary> {
    Ok(ArticleSummary {
        id: row.get(0)?,
        feed_id: row.get(1)?,
        feed_title: row.get(2)?,
        feed_icon: row.get(3)?,
        title: row.get(4)?,
        url: row.get(5)?,
        author: row.get(6)?,
        summary: row.get(7)?,
        published_at: row.get(8)?,
        fetched_at: row.get(9)?,
        is_read: row.get::<_, i64>(10)? != 0,
        is_starred: row.get::<_, i64>(11)? != 0,
        is_archived: row.get::<_, i64>(12)? != 0,
        reading_time: row.get(13)?,
        image_url: row.get(14)?,
        tag_names: split_tags(row.get(15)?),
    })
}

fn like_pattern(raw: &str) -> String {
    let escaped = raw
        .replace('\\', "\\\\")
        .replace('%', "\\%")
        .replace('_', "\\_");
    format!("%{escaped}%")
}

fn clean_token(raw: &str) -> String {
    raw.chars()
        .filter(|c| c.is_alphanumeric() || *c == '_' || *c == '-')
        .collect::<String>()
        .trim_matches('-')
        .to_string()
}

/// Build a safe FTS5 prefix query. Quoted phrases stay exact; other terms get *.
fn fts_query(raw: &str) -> Option<String> {
    let mut tokens: Vec<String> = Vec::new();
    let mut buf = String::new();
    let mut quoted = false;
    let flush = |buf: &mut String, quoted: bool, tokens: &mut Vec<String>| {
        if buf.trim().is_empty() {
            buf.clear();
            return;
        }
        let cleaned = clean_token(buf);
        buf.clear();
        if cleaned.is_empty() {
            return;
        }
        if quoted {
            tokens.push(format!("\"{cleaned}\""));
        } else {
            tokens.push(format!("\"{cleaned}\"*"));
        }
    };
    for ch in raw.chars() {
        match ch {
            '"' => {
                flush(&mut buf, quoted, &mut tokens);
                quoted = !quoted;
            }
            c if c.is_whitespace() => flush(&mut buf, quoted, &mut tokens),
            c => buf.push(c),
        }
    }
    flush(&mut buf, quoted, &mut tokens);
    if tokens.is_empty() {
        None
    } else {
        Some(tokens.join(" "))
    }
}

struct Parts {
    from: String,
    sql: String,
    params: Vec<Value>,
    is_fts: bool,
}

fn build_parts(query: &ArticleQuery, force_unread: bool, force_archived_excluded: bool) -> Parts {
    let mut from = String::from("FROM articles a JOIN feeds f ON f.id = a.feed_id");
    let mut sql = String::from(" WHERE 1=1");
    let mut values: Vec<Value> = Vec::new();
    let filter = query.filter.as_str();
    let archived = if filter == "archived" {
        Some(1)
    } else if force_archived_excluded || !query.include_archived.unwrap_or(false) {
        Some(0)
    } else {
        None
    };
    if let Some(flag) = archived {
        sql.push_str(" AND a.is_archived = ?");
        values.push(Value::Integer(flag));
    }
    if force_unread || filter == "unread" {
        sql.push_str(" AND a.is_read = 0");
    }
    if filter == "starred" {
        sql.push_str(" AND a.is_starred = 1");
    }
    if filter == "today" {
        sql.push_str(" AND a.published_at >= ?");
        values.push(Value::Text(today_iso()));
    }
    if let Some(feed_id) = query.feed_id {
        sql.push_str(" AND a.feed_id = ?");
        values.push(Value::Integer(feed_id));
    }
    if let Some(folder_id) = query.folder_id {
        sql.push_str(" AND f.folder_id = ?");
        values.push(Value::Integer(folder_id));
    }
    if let Some(tag_id) = query.tag_id {
        sql.push_str(" AND a.id IN (SELECT article_id FROM article_tags WHERE tag_id = ?)");
        values.push(Value::Integer(tag_id));
    }
    let mut is_fts = false;
    if let Some(search) = query
        .search
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
    {
        if search.chars().count() < 2 {
            append_like(&mut sql, &mut values, search);
        } else if let Some(fts) = fts_query(search) {
            from.push_str(" JOIN articles_fts ON articles_fts.rowid = a.id");
            sql.push_str(" AND articles_fts MATCH ?");
            values.push(Value::Text(fts));
            is_fts = true;
        } else {
            append_like(&mut sql, &mut values, search);
        }
    }
    Parts {
        from,
        sql,
        params: values,
        is_fts,
    }
}

fn append_like(sql: &mut String, values: &mut Vec<Value>, search: &str) {
    let pattern = like_pattern(search);
    sql.push_str(
        " AND (a.title LIKE ? ESCAPE '\\' OR a.content_text LIKE ? ESCAPE '\\'
           OR COALESCE(a.author,'') LIKE ? ESCAPE '\\' OR f.title LIKE ? ESCAPE '\\')",
    );
    for _ in 0..4 {
        values.push(Value::Text(pattern.clone()));
    }
}

pub fn list_articles(conn: &Connection, query: &ArticleQuery) -> AppResult<ListArticlesResult> {
    let mut parts = build_parts(query, false, false);
    let count_sql = format!("SELECT COUNT(DISTINCT a.id) {}", parts.from);
    let total: i64 = conn.query_row(
        &format!("{count_sql}{}", parts.sql),
        params_from_iter(parts.params.iter()),
        |r| r.get(0),
    )?;

    let limit = query.limit.unwrap_or(50).clamp(1, 200);
    let offset = if query.cursor.is_some() {
        0
    } else {
        query.offset.unwrap_or(0).max(0)
    };
    let sort = query.sort.as_deref().unwrap_or("newest");
    if let Some(cursor) = &query.cursor {
        let published = Value::Text(cursor.published_at.clone());
        let id = Value::Integer(cursor.id);
        if parts.is_fts {
            let rank = cursor
                .rank
                .as_deref()
                .and_then(|rank| rank.parse::<f64>().ok())
                .filter(|rank| rank.is_finite())
                .ok_or_else(|| {
                    AppError::Message("Invalid search cursor. Reload the article list.".into())
                })?;
            parts.sql.push_str(
                " AND (bm25(articles_fts) > ? OR (bm25(articles_fts) = ? AND
                    (a.published_at < ? OR (a.published_at = ? AND a.id < ?))))",
            );
            parts.params.extend([
                Value::Real(rank),
                Value::Real(rank),
                published.clone(),
                published,
                id,
            ]);
        } else if sort == "feed" {
            let title = Value::Text(cursor.feed_title.clone());
            parts.sql.push_str(
                " AND (f.title COLLATE NOCASE > ? OR (f.title COLLATE NOCASE = ? AND
                    (a.published_at < ? OR (a.published_at = ? AND a.id < ?))))",
            );
            parts
                .params
                .extend([title.clone(), title, published.clone(), published, id]);
        } else {
            let comparison = if sort == "oldest" { ">" } else { "<" };
            parts.sql.push_str(&format!(
                " AND (a.published_at {comparison} ? OR (a.published_at = ? AND a.id {comparison} ?))",
            ));
            parts.params.extend([published.clone(), published, id]);
        }
    }
    let order = if parts.is_fts {
        "bm25(articles_fts) ASC, a.published_at DESC, a.id DESC".to_string()
    } else {
        match sort {
            "oldest" => "a.published_at ASC, a.id ASC".to_string(),
            "feed" => "f.title COLLATE NOCASE ASC, a.published_at DESC, a.id DESC".to_string(),
            _ => "a.published_at DESC, a.id DESC".to_string(),
        }
    };
    let rank = if parts.is_fts {
        "bm25(articles_fts)"
    } else {
        "NULL"
    };
    let sql = format!(
        "{SUMMARY_SELECT}, {rank} {}{} ORDER BY {order} LIMIT ? OFFSET ?",
        parts.from, parts.sql
    );
    let mut values = parts.params;
    // One extra row tells the UI whether another page exists.
    values.push(Value::Integer(limit + 1));
    values.push(Value::Integer(offset));
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(params_from_iter(values.iter()), |row| {
        Ok((map_summary(row)?, row.get::<_, Option<f64>>(16)?))
    })?;
    let mut rows = rows.collect::<rusqlite::Result<Vec<_>>>()?;
    let has_more = rows.len() > limit as usize;
    rows.truncate(limit as usize);
    let next_cursor = if has_more {
        rows.last().map(|(article, rank)| ArticleCursor {
            id: article.id,
            published_at: article.published_at.clone(),
            feed_title: article.feed_title.clone(),
            rank: rank.map(|rank| rank.to_string()),
        })
    } else {
        None
    };
    let articles = rows.into_iter().map(|(article, _)| article).collect();
    Ok(ListArticlesResult {
        articles,
        total,
        next_cursor,
    })
}

fn tags_for_article(conn: &Connection, article_id: i64) -> AppResult<Vec<Tag>> {
    let mut stmt = conn.prepare(
        "SELECT t.id, t.name, t.color,
            (SELECT COUNT(*) FROM article_tags x WHERE x.tag_id = t.id)
         FROM tags t JOIN article_tags at ON at.tag_id = t.id
         WHERE at.article_id = ?1 ORDER BY t.name COLLATE NOCASE ASC",
    )?;
    let rows = stmt.query_map(params![article_id], |r| {
        Ok(Tag {
            id: r.get(0)?,
            name: r.get(1)?,
            color: r.get(2)?,
            count: r.get(3)?,
        })
    })?;
    Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
}

pub fn get_article(conn: &Connection, id: i64) -> AppResult<ArticleDetail> {
    let row = conn.query_row(
        "SELECT a.id, a.feed_id, f.title, f.icon_url, a.title, a.url, a.author, a.summary,
            a.published_at, a.fetched_at, a.is_read, a.is_starred, a.is_archived,
            a.reading_time, a.image_url, a.content_html, a.content_text, f.site_url, fo.name, a.full_content_loaded
         FROM articles a JOIN feeds f ON f.id = a.feed_id
         LEFT JOIN folders fo ON fo.id = f.folder_id
         WHERE a.id = ?1",
        params![id],
        |r| {
            Ok((
                r.get::<_, i64>(0)?,
                r.get::<_, i64>(1)?,
                r.get::<_, String>(2)?,
                r.get::<_, Option<String>>(3)?,
                r.get::<_, String>(4)?,
                r.get::<_, Option<String>>(5)?,
                r.get::<_, Option<String>>(6)?,
                r.get::<_, String>(7)?,
                r.get::<_, String>(8)?,
                r.get::<_, String>(9)?,
                r.get::<_, i64>(10)? != 0,
                r.get::<_, i64>(11)? != 0,
                r.get::<_, i64>(12)? != 0,
                r.get::<_, i64>(13)?,
                r.get::<_, Option<String>>(14)?,
                r.get::<_, String>(15)?,
                r.get::<_, String>(16)?,
                r.get::<_, Option<String>>(17)?,
                r.get::<_, Option<String>>(18)?,
                r.get::<_, bool>(19)?,
            ))
        },
    )?;
    let tags = tags_for_article(conn, id)?;
    let tag_names = tags.iter().map(|t| t.name.clone()).collect();
    let prev_id: Option<i64> = conn
        .query_row(
            "SELECT id FROM articles WHERE is_archived = ?3 AND
                (published_at > ?1 OR (published_at = ?1 AND id > ?2))
             ORDER BY published_at ASC, id ASC LIMIT 1",
            params![row.8, id, row.12],
            |r| r.get(0),
        )
        .ok();
    let next_id: Option<i64> = conn
        .query_row(
            "SELECT id FROM articles WHERE is_archived = ?3 AND
                (published_at < ?1 OR (published_at = ?1 AND id < ?2))
             ORDER BY published_at DESC, id DESC LIMIT 1",
            params![row.8, id, row.12],
            |r| r.get(0),
        )
        .ok();
    let content_html = rewrite_media_html(conn, id, &row.15)?;
    Ok(ArticleDetail {
        id: row.0,
        feed_id: row.1,
        feed_title: row.2,
        feed_icon: row.3,
        title: row.4,
        url: row.5,
        author: row.6,
        summary: row.7,
        published_at: row.8,
        fetched_at: row.9,
        is_read: row.10,
        is_starred: row.11,
        is_archived: row.12,
        reading_time: row.13,
        image_url: row.14,
        tag_names,
        full_content_loaded: row.19,
        enclosures: {
            let mut stmt = conn.prepare(
                "SELECT url, mime FROM article_enclosures WHERE article_id = ?1 ORDER BY url",
            )?;
            let rows = stmt.query_map(params![id], |r| {
                Ok(crate::models::Enclosure {
                    url: r.get(0)?,
                    mime: r.get(1)?,
                })
            })?;
            rows.collect::<rusqlite::Result<Vec<_>>>()?
        },
        content_html,
        content_text: row.16,
        site_url: row.17,
        folder_name: row.18,
        tags,
        prev_id,
        next_id,
    })
}

fn media_map(conn: &Connection, article_id: i64) -> AppResult<HashMap<String, String>> {
    let mut map = HashMap::new();
    let mut stmt = conn.prepare("SELECT url, local_path FROM media WHERE article_id = ?1")?;
    let rows = stmt.query_map(params![article_id], |r| {
        Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))
    })?;
    for (url, local) in rows.flatten() {
        if !paths::existing_media_path(&local).is_some_and(|path| path.is_file()) {
            continue;
        }
        let media_url = paths::media_url(&local);
        map.insert(url.clone(), media_url.clone());
        map.insert(
            html_escape::encode_double_quoted_attribute(&url).to_string(),
            media_url,
        );
    }
    Ok(map)
}

fn rewrite_media_html(conn: &Connection, article_id: i64, html: &str) -> AppResult<String> {
    let map = media_map(conn, article_id)?;
    if map.is_empty() || html.is_empty() {
        return Ok(html.to_string());
    }
    static IMG_SRC: OnceLock<Regex> = OnceLock::new();
    let re = IMG_SRC
        .get_or_init(|| Regex::new(r#"(?is)(<img[^>]*?src\s*=\s*["'])([^"']+)(["'])"#).unwrap());
    let replaced = re.replace_all(html, |caps: &regex::Captures<'_>| {
        let prefix = caps.get(1).map(|m| m.as_str()).unwrap_or("");
        let src = caps.get(2).map(|m| m.as_str()).unwrap_or("");
        let suffix = caps.get(3).map(|m| m.as_str()).unwrap_or("");
        if let Some(local) = map.get(src) {
            format!("{prefix}{local}{suffix}")
        } else {
            format!("{prefix}{src}{suffix}")
        }
    });
    Ok(replaced.to_string())
}

pub fn set_article_state(
    conn: &Connection,
    id: i64,
    patch: &ArticleStatePatch,
) -> AppResult<Counts> {
    let mut sets: Vec<String> = Vec::new();
    let mut values: Vec<Value> = Vec::new();
    if let Some(v) = patch.is_read {
        sets.push("is_read = ?".into());
        values.push(Value::Integer(if v { 1 } else { 0 }));
    }
    if let Some(v) = patch.is_starred {
        sets.push("is_starred = ?".into());
        values.push(Value::Integer(if v { 1 } else { 0 }));
    }
    if let Some(v) = patch.is_archived {
        sets.push("is_archived = ?".into());
        values.push(Value::Integer(if v { 1 } else { 0 }));
    }
    if !sets.is_empty() {
        let sql = format!("UPDATE articles SET {} WHERE id = ?", sets.join(", "));
        values.push(Value::Integer(id));
        let changed = conn.execute(&sql, params_from_iter(values.iter()))?;
        if changed == 0 {
            return Err(AppError::Message("Article not found".into()));
        }
    }
    db::counts(conn)
}

pub fn mark_all_read(conn: &Connection, scope: &MarkAllScope) -> AppResult<Counts> {
    let query = ArticleQuery {
        filter: "all".into(),
        feed_id: scope.feed_id,
        folder_id: scope.folder_id,
        tag_id: scope.tag_id,
        search: scope.search.clone(),
        sort: None,
        limit: None,
        offset: None,
        cursor: None,
        include_archived: Some(false),
    };
    let parts = build_parts(&query, true, true);
    let sql = format!(
        "UPDATE articles SET is_read = 1 WHERE id IN (SELECT a.id {}{})",
        parts.from, parts.sql
    );
    conn.execute(&sql, params_from_iter(parts.params.iter()))?;
    db::counts(conn)
}

pub fn list_tags(conn: &Connection) -> AppResult<Vec<Tag>> {
    let mut stmt = conn.prepare(
        "SELECT t.id, t.name, t.color,
            (SELECT COUNT(*) FROM article_tags at WHERE at.tag_id = t.id)
         FROM tags t ORDER BY t.name COLLATE NOCASE ASC",
    )?;
    let rows = stmt.query_map([], |r| {
        Ok(Tag {
            id: r.get(0)?,
            name: r.get(1)?,
            color: r.get(2)?,
            count: r.get(3)?,
        })
    })?;
    Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
}

pub fn create_tag(conn: &Connection, name: &str, color: &str) -> AppResult<Tag> {
    let name = name.trim();
    if name.is_empty() {
        return Err(AppError::Message("Tag name is required".into()));
    }
    let color = if color.trim().is_empty() {
        "#c2410c"
    } else {
        color.trim()
    };
    conn.execute(
        "INSERT INTO tags(name, color, created_at) VALUES(?1, ?2, ?3)",
        params![name, color, now_iso()],
    )
    .map_err(|e| match e {
        rusqlite::Error::SqliteFailure(err, _)
            if err.code == rusqlite::ErrorCode::ConstraintViolation =>
        {
            AppError::Message("A tag with that name already exists".into())
        }
        other => AppError::Db(other),
    })?;
    Ok(Tag {
        id: conn.last_insert_rowid(),
        name: name.to_string(),
        color: color.to_string(),
        count: 0,
    })
}

pub fn create_tags(conn: &mut Connection, names: &[String], color: &str) -> AppResult<Vec<Tag>> {
    let tx = conn.transaction()?;
    let mut available = list_tags(&tx)?;
    let mut result: Vec<Tag> = Vec::new();
    for name in names {
        let name = name.trim();
        if name.is_empty() {
            continue;
        }
        let tag = match available
            .iter()
            .find(|tag| tag.name.eq_ignore_ascii_case(name))
        {
            Some(tag) => tag.clone(),
            None => {
                let tag = create_tag(&tx, name, color)?;
                available.push(tag.clone());
                tag
            }
        };
        if !result.iter().any(|existing| existing.id == tag.id) {
            result.push(tag);
        }
    }
    tx.commit()?;
    Ok(result)
}

pub fn rename_tag(conn: &Connection, id: i64, name: &str, color: Option<&str>) -> AppResult<()> {
    let name = name.trim();
    if name.is_empty() {
        return Err(AppError::Message("Tag name is required".into()));
    }
    let changed = if let Some(color) = color.map(str::trim).filter(|c| !c.is_empty()) {
        conn.execute(
            "UPDATE tags SET name = ?2, color = ?3 WHERE id = ?1",
            params![id, name, color],
        )?
    } else {
        conn.execute("UPDATE tags SET name = ?2 WHERE id = ?1", params![id, name])?
    };
    if changed == 0 {
        return Err(AppError::Message("Tag not found".into()));
    }
    Ok(())
}

pub fn delete_tag(conn: &Connection, id: i64) -> AppResult<()> {
    conn.execute("DELETE FROM tags WHERE id = ?1", params![id])?;
    Ok(())
}

pub fn set_article_tags(
    conn: &mut Connection,
    article_id: i64,
    tag_ids: &[i64],
) -> AppResult<Vec<Tag>> {
    let exists: i64 = conn.query_row(
        "SELECT COUNT(*) FROM articles WHERE id = ?1",
        params![article_id],
        |r| r.get(0),
    )?;
    if exists == 0 {
        return Err(AppError::Message("Article not found".into()));
    }
    let tx = conn.transaction()?;
    tx.execute(
        "DELETE FROM article_tags WHERE article_id = ?1",
        params![article_id],
    )?;
    let mut seen = HashSet::new();
    for tag_id in tag_ids {
        if !seen.insert(*tag_id) {
            continue;
        }
        let valid: i64 = tx.query_row(
            "SELECT COUNT(*) FROM tags WHERE id = ?1",
            params![tag_id],
            |r| r.get(0),
        )?;
        if valid > 0 {
            tx.execute(
                "INSERT OR IGNORE INTO article_tags(article_id, tag_id) VALUES(?1, ?2)",
                params![article_id, tag_id],
            )?;
        }
    }
    tx.commit()?;
    tags_for_article(conn, article_id)
}

fn img_sources(html: &str) -> Vec<String> {
    static IMG_SRC: OnceLock<Regex> = OnceLock::new();
    let re =
        IMG_SRC.get_or_init(|| Regex::new(r#"(?is)<img[^>]+src\s*=\s*["']([^"']+)["']"#).unwrap());
    let mut seen = HashSet::new();
    let mut out = Vec::new();
    for cap in re.captures_iter(html) {
        if let Some(src) = cap.get(1) {
            let src = html_escape::decode_html_entities(src.as_str()).to_string();
            if (src.starts_with("http://") || src.starts_with("https://"))
                && seen.insert(src.clone())
            {
                out.push(src);
            }
        }
    }
    out
}

pub fn cache_article_media(conn: &mut Connection, article_id: i64) -> AppResult<CacheMediaResult> {
    let content_html: String = conn
        .query_row(
            "SELECT content_html FROM articles WHERE id = ?1",
            params![article_id],
            |r| r.get(0),
        )
        .map_err(|_| AppError::Message("Article not found".into()))?;
    let sources = img_sources(&content_html);
    let mut cached = 0;
    let mut failed = 0;
    let mut downloaded: Vec<(String, String, String, u64)> = Vec::new();
    for url in sources.iter().take(25) {
        let already: Option<String> = conn
            .query_row(
                "SELECT local_path FROM media WHERE article_id = ?1 AND url = ?2",
                params![article_id, url],
                |r| r.get(0),
            )
            .ok();
        if let Some(local) = already {
            if paths::existing_media_path(&local).is_some_and(|path| path.is_file()) {
                cached += 1;
                continue;
            }
        }
        let mut hasher = Sha256::new();
        hasher.update(url.as_bytes());
        let stem = format!("{:x}", hasher.finalize());
        match feeds::download_image(url, &format!("articles/{article_id}"), &stem) {
            Ok((rel, mime, bytes)) => {
                downloaded.push((url.clone(), rel, mime, bytes));
                cached += 1;
            }
            Err(_) => failed += 1,
        }
    }
    let tx = conn.transaction()?;
    for (url, rel, mime, bytes) in downloaded {
        tx.execute(
            "INSERT OR REPLACE INTO media(article_id, url, local_path, mime, bytes, created_at)
             VALUES(?1, ?2, ?3, ?4, ?5, ?6)",
            params![article_id, url, rel, mime, bytes as i64, now_iso()],
        )?;
    }
    tx.commit()?;
    Ok(CacheMediaResult { cached, failed })
}
