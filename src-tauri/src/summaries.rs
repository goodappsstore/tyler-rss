use crate::error::{AppError, AppResult};
use crate::{db, settings};
use reqwest::blocking::Client;
use serde::Serialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use url::Url;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SummaryResult {
    pub text: String,
    pub cached: bool,
    pub truncated: bool,
}

// Each request has its own lock, so concurrent requests cannot send it twice.
type CacheEntry = Arc<Mutex<Option<SummaryResult>>>;

#[derive(Default)]
pub struct SummaryCache {
    entries: Mutex<HashMap<String, CacheEntry>>,
}

pub fn completion_url(base_url: &str) -> AppResult<Url> {
    let invalid = || {
        AppError::Message("LLM base URL must be an HTTP(S) URL without credentials, query parameters, or a fragment".into())
    };
    let mut url = Url::parse(base_url.trim()).map_err(|_| invalid())?;
    if !["http", "https"].contains(&url.scheme())
        || url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return Err(invalid());
    }
    url.set_path(&format!(
        "{}/chat/completions",
        url.path().trim_end_matches('/')
    ));
    Ok(url)
}

fn clip_words(text: &str, limit: u32) -> String {
    if limit == 0 {
        return text.to_string();
    }
    // Slice at the next word's start to preserve the source's paragraphs and spacing.
    let mut words = 0;
    let mut in_word = false;
    for (index, ch) in text.char_indices() {
        if ch.is_whitespace() {
            in_word = false;
        } else if !in_word {
            if words == limit {
                return text[..index].trim_end().to_string();
            }
            words += 1;
            in_word = true;
        }
    }
    text.to_string()
}

fn send_completion(
    client: &Client,
    url: &Url,
    api_key: &str,
    request: &Value,
) -> AppResult<(reqwest::StatusCode, Value)> {
    let response = client
        .post(url.clone())
        .bearer_auth(api_key.trim())
        .header(reqwest::header::CONTENT_TYPE, "application/json")
        .body(serde_json::to_vec(request)?)
        .send()
        .map_err(|err| {
            AppError::Message(format!("Summary request failed: {}", err.without_url()))
        })?;
    let status = response.status();
    let body = response.text()?;
    Ok((status, serde_json::from_str(&body).unwrap_or(Value::Null)))
}

pub fn generate(cache: &SummaryCache, article_id: i64) -> AppResult<SummaryResult> {
    // Close the connection before waiting for the endpoint or an in-flight request.
    let (config, title, content) = {
        let conn = db::ensure_db()?;
        let config = settings::get_settings(&conn)?;
        if !config.llm_enabled {
            return Err(AppError::Message(
                "Enable LLM summaries in Settings first".into(),
            ));
        }
        let (title, body, summary): (String, String, String) = conn.query_row(
            "SELECT title, content_text, summary FROM articles WHERE id = ?1",
            [article_id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )?;
        let content = if body.trim().is_empty() {
            summary
        } else {
            body
        };
        (config, title, content)
    };
    if config.llm_base_url.trim().is_empty()
        || config.llm_api_key.trim().is_empty()
        || config.llm_model.trim().is_empty()
        || config.llm_prompt.trim().is_empty()
    {
        return Err(AppError::Message(
            "Set the LLM base URL, API key, model, and summary prompt in Settings".into(),
        ));
    }
    if content.trim().is_empty() {
        return Err(AppError::Message(
            "This article has no text to summarize".into(),
        ));
    }
    let url = completion_url(&config.llm_base_url)?;
    let mut prompt = config.llm_prompt.trim().to_string();
    if config.llm_max_output_words > 0 {
        prompt.push_str(&format!(
            "\n\nUse at most {} words in your summary.",
            config.llm_max_output_words
        ));
    }
    // The input budget covers all article material (title and body), excluding instructions.
    let article_text = clip_words(&format!("{title}\n\n{content}"), config.llm_max_input_words);
    let mut request = json!({
        "model": config.llm_model.trim(),
        "messages": [
            { "role": "system", "content": prompt },
            { "role": "user", "content": article_text }
        ]
    });
    if config.llm_max_output_words > 0 {
        let tokens = (u64::from(config.llm_max_output_words) * 4).div_ceil(3);
        request["max_tokens"] = json!(tokens);
    }
    // Hash credentials and request data so cache keys never hold plaintext secrets.
    let key = format!(
        "{:x}",
        Sha256::digest(serde_json::to_vec(&json!([
            article_id,
            title,
            content,
            url.as_str(),
            config.llm_api_key,
            config.llm_max_input_words,
            config.llm_max_output_words,
            request
        ]))?)
    );
    let entry = {
        let mut entries = cache
            .entries
            .lock()
            .map_err(|_| AppError::Message("Summary cache is unavailable".into()))?;
        Arc::clone(
            entries
                .entry(key)
                .or_insert_with(|| Arc::new(Mutex::new(None))),
        )
    };
    let mut result = entry
        .lock()
        .map_err(|_| AppError::Message("Summary cache is unavailable".into()))?;
    if let Some(saved) = result.as_ref() {
        return Ok(SummaryResult {
            cached: true,
            ..saved.clone()
        });
    }

    let client = Client::builder()
        .connect_timeout(Duration::from_secs(15))
        .timeout(Duration::from_secs(180))
        .redirect(reqwest::redirect::Policy::none())
        .build()?;
    let (mut status, mut data) = send_completion(&client, &url, &config.llm_api_key, &request)?;
    let message = data
        .pointer("/error/message")
        .and_then(Value::as_str)
        .unwrap_or("");
    // Some models explicitly require the newer completion-token parameter.
    // Retry only a rejected request that names that replacement, never a successful one.
    if matches!(status.as_u16(), 400 | 422)
        && message.contains("max_tokens")
        && message.contains("max_completion_tokens")
    {
        if let Some(tokens) = request
            .as_object_mut()
            .and_then(|body| body.remove("max_tokens"))
        {
            request["max_completion_tokens"] = tokens;
            (status, data) = send_completion(&client, &url, &config.llm_api_key, &request)?;
        }
    }
    if !status.is_success() {
        let message = data
            .pointer("/error/message")
            .and_then(Value::as_str)
            .unwrap_or(
                "The endpoint rejected the request. Check the URL, API key, model, and limits.",
            );
        let message = message.replace(config.llm_api_key.trim(), "[redacted]");
        return Err(AppError::Message(format!(
            "LLM endpoint returned {status}: {}",
            message.chars().take(500).collect::<String>()
        )));
    }
    let text = data
        .pointer("/choices/0/message/content")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .ok_or_else(|| AppError::Message(
            "The endpoint returned no summary text. Check the model or increase the output limit.".into()
        ))?;
    let summary = SummaryResult {
        text: text.to_string(),
        cached: false,
        truncated: data
            .pointer("/choices/0/finish_reason")
            .and_then(Value::as_str)
            == Some("length"),
    };
    *result = Some(summary.clone());
    Ok(summary)
}
