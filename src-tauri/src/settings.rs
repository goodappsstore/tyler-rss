use crate::db;
use crate::error::{AppError, AppResult};
use crate::models::Settings;
use rusqlite::{params, Connection};
use serde_json::Value;

fn store(conn: &Connection, key: &str, value: &Value) -> AppResult<()> {
    let encoded = serde_json::to_string(value)?;
    conn.execute(
        "INSERT INTO settings(key, value) VALUES(?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![key, encoded],
    )?;
    Ok(())
}

fn read(conn: &Connection, key: &str) -> Option<Value> {
    db::setting_raw(conn, key)
}

fn read_str(conn: &Connection, key: &str, default: &str) -> String {
    match read(conn, key) {
        Some(Value::String(s)) => s,
        Some(v) => v
            .as_str()
            .map(str::to_string)
            .unwrap_or_else(|| default.to_string()),
        None => default.to_string(),
    }
}

fn read_i64(conn: &Connection, key: &str, default: i64) -> i64 {
    match read(conn, key) {
        Some(Value::Number(n)) => n.as_i64().unwrap_or(default),
        Some(Value::String(s)) => s.parse().unwrap_or(default),
        _ => default,
    }
}

fn read_bool(conn: &Connection, key: &str, default: bool) -> bool {
    match read(conn, key) {
        Some(Value::Bool(b)) => b,
        Some(Value::String(s)) => matches!(s.as_str(), "1" | "true" | "yes"),
        Some(Value::Number(n)) => n.as_i64().unwrap_or(0) != 0,
        _ => default,
    }
}

fn one_of(value: &str, allowed: &[&str], default: &str) -> String {
    if allowed.contains(&value) {
        value.to_string()
    } else {
        default.to_string()
    }
}

fn feed_download_limit_mb(conn: &Connection) -> i64 {
    read_i64(
        conn,
        "feedDownloadLimitMb",
        Settings::default().feed_download_limit_mb,
    )
    .clamp(1, 100)
}

pub fn feed_download_limit_bytes(conn: &Connection) -> u64 {
    feed_download_limit_mb(conn) as u64 * 1024 * 1024
}

pub fn get_settings(conn: &Connection) -> AppResult<Settings> {
    let d = Settings::default();
    Ok(Settings {
        theme: one_of(
            &read_str(conn, "theme", &d.theme),
            &["system", "light", "dark"],
            &d.theme,
        ),
        font_size: read_i64(conn, "fontSize", d.font_size).clamp(14, 24),
        line_width: read_i64(conn, "lineWidth", d.line_width).clamp(520, 920),
        article_list_width: read_i64(conn, "articleListWidth", d.article_list_width).clamp(280, 600),
        density: one_of(
            &read_str(conn, "density", &d.density),
            &["comfortable", "compact"],
            &d.density,
        ),
        show_summaries: read_bool(conn, "showSummaries", d.show_summaries),
        mark_read_on_open: read_bool(conn, "markReadOnOpen", d.mark_read_on_open),
        load_full_article_by_default: read_bool(
            conn,
            "loadFullArticleByDefault",
            d.load_full_article_by_default,
        ),
        default_sort: one_of(
            &read_str(conn, "defaultSort", &d.default_sort),
            &["newest", "oldest"],
            &d.default_sort,
        ),
        refresh_minutes: read_i64(conn, "refreshMinutes", d.refresh_minutes).clamp(0, 10080),
        feed_download_limit_mb: feed_download_limit_mb(conn),
        retention_days: read_i64(conn, "retentionDays", d.retention_days).clamp(0, 36500),
        date_format: one_of(
            &read_str(conn, "dateFormat", &d.date_format),
            &["relative", "absolute"],
            &d.date_format,
        ),
        reader_font: one_of(
            &read_str(conn, "readerFont", &d.reader_font),
            &["serif", "sans"],
            &d.reader_font,
        ),
        reduce_motion: read_bool(conn, "reduceMotion", d.reduce_motion),
        open_links_in_app: read_bool(conn, "openLinksInApp", d.open_links_in_app),
        notifications_enabled: read_bool(conn, "notificationsEnabled", d.notifications_enabled),
        unread_badge: read_bool(conn, "unreadBadge", d.unread_badge),
        tts_enabled: read_bool(conn, "ttsEnabled", d.tts_enabled),
        tts_voice: {
            let voice = read_str(conn, "ttsVoice", &d.tts_voice);
            if crate::tts::valid_voice(&voice) {
                voice
            } else {
                d.tts_voice
            }
        },
        tts_keep_playing: read_bool(conn, "ttsKeepPlaying", d.tts_keep_playing),
        llm_enabled: read_bool(conn, "llmEnabled", d.llm_enabled),
        llm_base_url: read_str(conn, "llmBaseUrl", &d.llm_base_url),
        llm_api_key: read_str(conn, "llmApiKey", &d.llm_api_key),
        llm_model: read_str(conn, "llmModel", &d.llm_model),
        llm_prompt: read_str(conn, "llmPrompt", &d.llm_prompt),
        llm_max_input_words: read_i64(conn, "llmMaxInputWords", 0)
            .try_into()
            .unwrap_or(0),
        llm_max_output_words: read_i64(conn, "llmMaxOutputWords", 0)
            .try_into()
            .unwrap_or(0),
    })
}

fn number(value: &Value, key: &str) -> AppResult<i64> {
    value
        .as_i64()
        .or_else(|| value.as_f64().map(|f| f.round() as i64))
        .ok_or_else(|| AppError::Message(format!("Setting {key} must be a number")))
}

fn boolean(value: &Value, key: &str) -> AppResult<bool> {
    value
        .as_bool()
        .ok_or_else(|| AppError::Message(format!("Setting {key} must be a boolean")))
}

fn text(value: &Value, key: &str) -> AppResult<String> {
    value
        .as_str()
        .map(str::to_string)
        .ok_or_else(|| AppError::Message(format!("Setting {key} must be a string")))
}

pub fn set_settings(conn: &mut Connection, patch: &Value) -> AppResult<Settings> {
    let Value::Object(map) = patch else {
        return Err(AppError::Message("Settings patch must be an object".into()));
    };
    let tx = conn.transaction()?;
    for (key, value) in map {
        if value.is_null() {
            continue;
        }
        match key.as_str() {
            "theme" => {
                let v = text(value, key)?;
                if !["system", "light", "dark"].contains(&v.as_str()) {
                    return Err(AppError::Message("Invalid theme".into()));
                }
                store(&tx, key, &Value::String(v))?;
            }
            "density" => {
                let v = text(value, key)?;
                if !["comfortable", "compact"].contains(&v.as_str()) {
                    return Err(AppError::Message("Invalid density".into()));
                }
                store(&tx, key, &Value::String(v))?;
            }
            "defaultSort" => {
                let v = text(value, key)?;
                if !["newest", "oldest"].contains(&v.as_str()) {
                    return Err(AppError::Message("Invalid default sort".into()));
                }
                store(&tx, key, &Value::String(v))?;
            }
            "dateFormat" => {
                let v = text(value, key)?;
                if !["relative", "absolute"].contains(&v.as_str()) {
                    return Err(AppError::Message("Invalid date format".into()));
                }
                store(&tx, key, &Value::String(v))?;
            }
            "readerFont" => {
                let v = text(value, key)?;
                if !["serif", "sans"].contains(&v.as_str()) {
                    return Err(AppError::Message("Invalid reader font".into()));
                }
                store(&tx, key, &Value::String(v))?;
            }
            "fontSize" => {
                let v = number(value, key)?.clamp(14, 24);
                store(&tx, key, &Value::Number(v.into()))?;
            }
            "lineWidth" => {
                let v = number(value, key)?.clamp(520, 920);
                store(&tx, key, &Value::Number(v.into()))?;
            }
            "articleListWidth" => {
                let v = number(value, key)?.clamp(280, 600);
                store(&tx, key, &Value::Number(v.into()))?;
            }
            "refreshMinutes" => {
                let v = number(value, key)?.clamp(0, 10080);
                store(&tx, key, &Value::Number(v.into()))?;
            }
            "feedDownloadLimitMb" => {
                let limit = value
                    .as_i64()
                    .filter(|n| (1..=100).contains(n))
                    .ok_or_else(|| {
                        AppError::Message(
                            "Feed download limit must be a whole number from 1 to 100 MiB".into(),
                        )
                    })?;
                store(&tx, key, &Value::Number(limit.into()))?;
            }
            "retentionDays" => {
                let v = number(value, key)?.clamp(0, 36500);
                store(&tx, key, &Value::Number(v.into()))?;
            }
            "ttsVoice" => {
                let voice = text(value, key)?;
                if !crate::tts::valid_voice(&voice) {
                    return Err(AppError::Message("Unsupported Kokoro voice".into()));
                }
                store(&tx, key, &Value::String(voice))?;
            }
            "llmBaseUrl" | "llmApiKey" | "llmModel" | "llmPrompt" => {
                let v = text(value, key)?.trim().to_string();
                if key == "llmBaseUrl" && !v.is_empty() {
                    crate::summaries::completion_url(&v)?;
                }
                if key == "llmPrompt" && v.is_empty() {
                    return Err(AppError::Message("Summary prompt cannot be empty".into()));
                }
                store(&tx, key, &Value::String(v))?;
            }
            "llmMaxInputWords" | "llmMaxOutputWords" => {
                let v = value
                    .as_u64()
                    .filter(|n| *n <= u32::MAX as u64)
                    .ok_or_else(|| {
                        AppError::Message(format!(
                            "Setting {key} must be a non-negative whole number up to {}",
                            u32::MAX
                        ))
                    })?;
                store(&tx, key, &serde_json::json!(v))?;
            }
            "showSummaries"
            | "markReadOnOpen"
            | "loadFullArticleByDefault"
            | "reduceMotion"
            | "openLinksInApp"
            | "ttsEnabled"
            | "ttsKeepPlaying"
            | "llmEnabled"
            | "notificationsEnabled"
            | "unreadBadge" => {
                let v = boolean(value, key)?;
                store(&tx, key, &Value::Bool(v))?;
            }
            _ => {}
        }
    }
    tx.commit()?;
    get_settings(conn)
}

pub fn last_refresh(conn: &Connection) -> Option<String> {
    match read(conn, "last_refresh") {
        Some(Value::String(s)) => Some(s),
        _ => None,
    }
}

pub fn set_last_refresh(conn: &Connection, when: &str) -> AppResult<()> {
    store(conn, "last_refresh", &Value::String(when.to_string()))
}
