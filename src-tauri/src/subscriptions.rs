use crate::db;
use crate::error::{AppError, AppResult};
use crate::feeds;
use crate::AppState;
use serde_json::json;
use std::collections::HashSet;
use std::sync::{mpsc, Mutex};
use tauri::{AppHandle, Emitter, Manager};

#[derive(Default)]
struct QueueState {
    sender: Option<mpsc::Sender<i64>>,
    media_sender: Option<mpsc::Sender<i64>>,
    pending: HashSet<i64>,
    media_pending: usize,
}

#[derive(Default)]
pub struct SubscriptionQueue {
    state: Mutex<QueueState>,
}

impl SubscriptionQueue {
    pub fn enqueue(&self, feed_id: i64) -> AppResult<()> {
        let mut state = self
            .state
            .lock()
            .map_err(|_| AppError::Message("Feed queue is unavailable.".into()))?;
        if state.pending.contains(&feed_id) {
            return Ok(());
        }
        let sender = state
            .sender
            .as_ref()
            .ok_or_else(|| AppError::Message("Feed queue is not ready.".into()))?
            .clone();
        sender.send(feed_id).map_err(|_| {
            AppError::Message("Feed queue has stopped. Restart Tyler to resume loading.".into())
        })?;
        state.pending.insert(feed_id);
        Ok(())
    }

    pub fn is_busy(&self) -> AppResult<bool> {
        let state = self
            .state
            .lock()
            .map_err(|_| AppError::Message("Feed queue is unavailable.".into()))?;
        Ok(!state.pending.is_empty() || state.media_pending > 0)
    }

    fn enqueue_media(&self, feed_id: i64) -> AppResult<()> {
        let mut state = self
            .state
            .lock()
            .map_err(|_| AppError::Message("Feed queue is unavailable.".into()))?;
        state
            .media_sender
            .as_ref()
            .ok_or_else(|| AppError::Message("Image queue is not ready.".into()))?
            .send(feed_id)
            .map_err(|_| AppError::Message("Image queue has stopped.".into()))?;
        state.media_pending += 1;
        Ok(())
    }
}

/// Separate text and media workers keep slow images from delaying other subscriptions.
pub fn start(app: &AppHandle) -> AppResult<()> {
    let (sender, receiver) = mpsc::channel();
    let (media_sender, media_receiver) = mpsc::channel();
    {
        let state = app.state::<AppState>();
        let mut queue = state
            .subscriptions
            .state
            .lock()
            .map_err(|_| AppError::Message("Feed queue is unavailable.".into()))?;
        queue.sender = Some(sender);
        queue.media_sender = Some(media_sender);
    }
    let worker_app = app.clone();
    std::thread::Builder::new().name("tyler-subscriptions".into()).spawn(move || {
        for feed_id in receiver {
            let result = (|| -> AppResult<()> {
                let conn = db::ensure_db()?;
                let _ = worker_app.emit("feed:updated", json!({ "feedId": feed_id, "loading": true }));
                feeds::fetch_subscription(&conn, feed_id)?;
                worker_app.state::<AppState>().subscriptions.enqueue_media(feed_id)?;
                Ok(())
            })();
            let failure = result.as_ref().err().map(ToString::to_string);
            if let Err(error) = result {
                eprintln!("Tyler: could not load feed {feed_id}: {error}");
                if let Ok(conn) = db::ensure_db() {
                    let _ = conn.execute("UPDATE feeds SET last_status = 'error', error = ?2 WHERE id = ?1 AND last_status IN ('pending', 'fetching')", rusqlite::params![feed_id, error.to_string()]);
                }
            }
            let state = worker_app.state::<AppState>();
            if let Ok(mut queue) = state.subscriptions.state.lock() {
                queue.pending.remove(&feed_id);
            }
            let _ = worker_app.emit("feed:updated", json!({ "feedId": feed_id, "loading": false, "error": failure }));
        }
    })?;

    let media_app = app.clone();
    std::thread::Builder::new()
        .name("tyler-feed-media".into())
        .spawn(move || {
            for feed_id in media_receiver {
                if let Ok(conn) = db::ensure_db() {
                    let _ = feeds::cache_feed_media(&conn, feed_id);
                }
                let state = media_app.state::<AppState>();
                if let Ok(mut queue) = state.subscriptions.state.lock() {
                    queue.media_pending = queue.media_pending.saturating_sub(1);
                }
                let _ = media_app.emit(
                    "feed:updated",
                    json!({ "feedId": feed_id, "loading": false }),
                );
            }
        })?;

    // Resume subscriptions interrupted by closing the app during their first fetch.
    let conn = db::ensure_db()?;
    let mut statement = conn
        .prepare("SELECT id FROM feeds WHERE last_status IN ('pending', 'fetching') ORDER BY id")?;
    let ids = statement
        .query_map([], |row| row.get::<_, i64>(0))?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    for id in ids {
        app.state::<AppState>().subscriptions.enqueue(id)?;
    }
    Ok(())
}
