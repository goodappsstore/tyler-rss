use crate::{articles, db, feeds, models::ArticleDetail};
use reqwest::blocking::Client;
use rusqlite::params;
use serde::Serialize;
use std::{io::Read, time::Duration};
use tauri::{AppHandle, Manager};
use url::Url;

const MAX_SOURCE_BYTES: usize = 5 * 1024 * 1024;

#[derive(Serialize)]
pub struct ArticleSource {
    html: String,
    url: String,
}

#[tauri::command(rename_all = "camelCase")]
pub async fn fetch_article_source(article_id: i64) -> Result<ArticleSource, String> {
    tauri::async_runtime::spawn_blocking(move || {
        // Hold the library guard so a restore cannot change the article during the fetch.
        let conn = db::ensure_db().map_err(|e| e.to_string())?;
        let article = articles::get_article(&conn, article_id).map_err(|e| e.to_string())?;
        let url = article.url.ok_or("This article has no source URL")?;
        let url = feeds::normalized_url(&url).map_err(|e| e.to_string())?;
        let client = Client::builder()
            .user_agent(feeds::USER_AGENT)
            .timeout(Duration::from_secs(20))
            .build()
            .map_err(|e| e.to_string())?;
        let response = client
            .get(feeds::content_request_url(&url).map_err(|e| e.to_string())?)
            .header("Accept", "text/html,application/xhtml+xml")
            .send()
            .and_then(|r| r.error_for_status())
            .map_err(|e| e.to_string())?;
        let final_url = response.url().to_string();
        let content_type = response
            .headers()
            .get("content-type")
            .and_then(|v| v.to_str().ok())
            .unwrap_or("")
            .to_string();
        if !content_type.contains("text/html") && !content_type.contains("application/xhtml+xml") {
            return Err("The source did not return an HTML article".into());
        }
        let charset = content_type
            .split(';')
            .find_map(|part| {
                let (key, value) = part.trim().split_once('=')?;
                if key.eq_ignore_ascii_case("charset") {
                    encoding_rs::Encoding::for_label(
                        value.trim().trim_matches(['\"', '\'']).as_bytes(),
                    )
                } else {
                    None
                }
            })
            .unwrap_or(encoding_rs::UTF_8);
        let mut bytes = Vec::new();
        response
            .take((MAX_SOURCE_BYTES + 1) as u64)
            .read_to_end(&mut bytes)
            .map_err(|e| e.to_string())?;
        if bytes.len() > MAX_SOURCE_BYTES {
            return Err("This page is too large to extract".into());
        }
        Ok(ArticleSource {
            html: charset.decode(&bytes).0.into_owned(),
            url: final_url,
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command(rename_all = "camelCase")]
pub async fn save_full_article(
    article_id: i64,
    html: String,
    source_url: String,
    expected_url: String,
) -> Result<ArticleDetail, String> {
    tauri::async_runtime::spawn_blocking(move || {
        if html.len() > MAX_SOURCE_BYTES { return Err("Extracted article is too large".into()); }
        let conn = db::ensure_db().map_err(|e| e.to_string())?;
        let source = feeds::normalized_url(&source_url).map_err(|e| e.to_string())?;
        let html = feeds::sanitize_html(&html, &source);
        let text = feeds::strip_html(&html);
        if text.split_whitespace().count() < 20 {
            return Err("Could not extract enough article text. Try opening the original.".into());
        }
        let minutes = ((text.split_whitespace().count() as i64 + 219) / 220).max(1);
        let changed = conn.execute("UPDATE articles SET content_html = ?2, content_text = ?3, reading_time = ?4, full_content_loaded = 1 WHERE id = ?1 AND url = ?5",
            params![article_id, html, text, minutes, expected_url]).map_err(|e| e.to_string())?;
        if changed == 0 { return Err("The article changed or is no longer in the library".into()); }
        articles::get_article(&conn, article_id).map_err(|e| e.to_string())
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command(rename_all = "camelCase")]
pub async fn export_article_markdown(path: String, markdown: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        if !path.to_ascii_lowercase().ends_with(".md") {
            return Err("Choose a Markdown (.md) file".into());
        }
        std::fs::write(path, markdown).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn print_article(app: AppHandle) -> Result<(), String> {
    app.get_webview_window("main")
        .ok_or("Reader window is unavailable")?
        .print()
        .map_err(|e| e.to_string())
}

#[tauri::command(rename_all = "camelCase")]
pub async fn open_article_link(app: AppHandle, url: String) -> Result<(), String> {
    let parsed = Url::parse(&url).map_err(|e| e.to_string())?;
    if !matches!(parsed.scheme(), "http" | "https" | "mailto") {
        return Err("Unsupported link scheme".into());
    }
    let in_app = tauri::async_runtime::spawn_blocking(|| {
        let conn = db::ensure_db().map_err(|e| e.to_string())?;
        crate::settings::get_settings(&conn)
            .map(|s| s.open_links_in_app)
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())??;
    if in_app && matches!(parsed.scheme(), "http" | "https") {
        // Remote windows receive no main-window capabilities or IPC permissions.
        tauri::WebviewWindowBuilder::new(
            &app,
            format!("article-{}", uuid::Uuid::new_v4()),
            tauri::WebviewUrl::External(parsed),
        )
        .title("Tyler — Original article")
        .inner_size(1100.0, 800.0)
        .on_navigation(|url| matches!(url.scheme(), "http" | "https"))
        .build()
        .map_err(|e| e.to_string())?;
    } else {
        use tauri_plugin_opener::OpenerExt;
        app.opener()
            .open_url(url, None::<&str>)
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}
