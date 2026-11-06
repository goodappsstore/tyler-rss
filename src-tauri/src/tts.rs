use crate::{db, paths, settings, AppState};
use serde::Deserialize;
use sha2::{Digest, Sha256};
use std::io::{Read, Write};
use std::path::PathBuf;
use std::time::{Duration, Instant};
use tauri::http::{header, Response, StatusCode};
use tauri::{AppHandle, Emitter, Manager};

const REVISION: &str = "1939ad2a8e416c0acfeecc08a694d14ef25f2231";
const MODEL_ID: &str = "onnx-community/Kokoro-82M-v1.0-ONNX";

#[derive(Deserialize)]
struct Asset {
    path: String,
    size: u64,
    sha256: String,
}

fn assets() -> Vec<Asset> {
    serde_json::from_str(include_str!("tts-assets.json")).expect("valid bundled Kokoro manifest")
}

pub fn valid_voice(voice: &str) -> bool {
    assets()
        .iter()
        .any(|asset| asset.path == format!("voices/{voice}.bin"))
}

fn cache_dir() -> PathBuf {
    paths::data_dir().join("tts").join(REVISION)
}

fn enabled(conn: &rusqlite::Connection) -> Result<(), String> {
    if settings::get_settings(conn)
        .map_err(|e| e.to_string())?
        .tts_enabled
    {
        Ok(())
    } else {
        Err("Text to speech is disabled in settings.".into())
    }
}

fn prepare(app: &AppHandle, voice: &str) -> Result<(), String> {
    let state = app.state::<AppState>();
    let _lock = state.tts_download.lock().map_err(|e| e.to_string())?;
    let conn = db::ensure_db().map_err(|e| e.to_string())?;
    enabled(&conn)?;
    if !valid_voice(voice) {
        return Err("Unsupported Kokoro voice".into());
    }
    let client = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(600))
        .connect_timeout(Duration::from_secs(20))
        .build()
        .map_err(|e| e.to_string())?;
    for asset in assets().into_iter().filter(|asset| {
        !asset.path.starts_with("voices/") || asset.path == format!("voices/{voice}.bin")
    }) {
        enabled(&conn)?;
        let target = cache_dir().join(&asset.path);
        if let Ok(bytes) = std::fs::read(&target) {
            if bytes.len() as u64 == asset.size
                && format!("{:x}", Sha256::digest(&bytes)) == asset.sha256
            {
                continue;
            }
        }
        std::fs::create_dir_all(target.parent().ok_or("Invalid model path")?)
            .map_err(|e| e.to_string())?;
        let partial = target.with_extension("partial");
        let download = || -> Result<(), String> {
            let url = format!(
                "https://huggingface.co/{MODEL_ID}/resolve/{REVISION}/{}",
                asset.path
            );
            let mut response = client
                .get(url)
                .send()
                .and_then(|r| r.error_for_status())
                .map_err(|e| e.to_string())?;
            let mut file = std::fs::File::create(&partial).map_err(|e| e.to_string())?;
            let mut hash = Sha256::new();
            let mut received = 0u64;
            let mut last_progress = Instant::now() - Duration::from_secs(1);
            let mut buffer = [0u8; 64 * 1024];
            loop {
                let count = response.read(&mut buffer).map_err(|e| e.to_string())?;
                if count == 0 {
                    break;
                }
                received += count as u64;
                if received > asset.size {
                    return Err("Unexpected Kokoro download size".into());
                }
                file.write_all(&buffer[..count])
                    .map_err(|e| e.to_string())?;
                hash.update(&buffer[..count]);
                if last_progress.elapsed() >= Duration::from_millis(200) {
                    enabled(&conn)?;
                    let _ = app.emit(
                        "tts:download",
                        serde_json::json!({
                            "file": asset.path, "received": received, "total": asset.size
                        }),
                    );
                    last_progress = Instant::now();
                }
            }
            if received != asset.size || format!("{:x}", hash.finalize()) != asset.sha256 {
                return Err("Kokoro download failed its integrity check. Please retry.".into());
            }
            file.sync_all().map_err(|e| e.to_string())?;
            drop(file);
            if target.exists() {
                std::fs::remove_file(&target).map_err(|e| e.to_string())?;
            }
            std::fs::rename(&partial, &target).map_err(|e| e.to_string())?;
            Ok(())
        };
        if let Err(error) = download() {
            let _ = std::fs::remove_file(&partial);
            return Err(error);
        }
    }
    Ok(())
}

#[tauri::command(rename_all = "camelCase")]
pub async fn prepare_tts(app: AppHandle, voice: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || prepare(&app, &voice))
        .await
        .map_err(|e| e.to_string())?
}

pub fn cached_asset(relative: &str) -> Result<PathBuf, String> {
    let asset = assets()
        .into_iter()
        .find(|asset| asset.path == relative)
        .ok_or("Unknown Kokoro asset.")?;
    let data = paths::data_dir()
        .canonicalize()
        .map_err(|e| e.to_string())?;
    let root = cache_dir().canonicalize().map_err(|e| e.to_string())?;
    let target = root
        .join(&asset.path)
        .canonicalize()
        .map_err(|e| e.to_string())?;
    if !root.starts_with(&data)
        || !target.starts_with(&root)
        || target.metadata().map_err(|e| e.to_string())?.len() != asset.size
    {
        return Err("Invalid Kokoro cache file. Retry the download in settings.".into());
    }
    Ok(target)
}

// Only manifest entries are served; the protocol never downloads or exposes arbitrary paths.
pub fn asset_response(raw_path: &str) -> Response<Vec<u8>> {
    let relative = raw_path.trim_start_matches('/');
    let relative = relative
        .strip_prefix(&format!("{MODEL_ID}/"))
        .unwrap_or(relative);
    let result = (|| {
        let conn = db::ensure_db().ok()?;
        enabled(&conn).ok()?;
        let asset = assets().into_iter().find(|asset| asset.path == relative)?;
        let root = cache_dir().canonicalize().ok()?;
        let target = root.join(&asset.path).canonicalize().ok()?;
        if !target.starts_with(&root) {
            return None;
        }
        let bytes = std::fs::read(target).ok()?;
        if bytes.len() as u64 != asset.size {
            return None;
        }
        Some(bytes)
    })();
    let (status, bytes) = match result {
        Some(bytes) => (StatusCode::OK, bytes),
        None => (StatusCode::NOT_FOUND, Vec::new()),
    };
    Response::builder()
        .status(status)
        .header(
            header::CONTENT_TYPE,
            if relative.ends_with(".json") {
                "application/json"
            } else {
                "application/octet-stream"
            },
        )
        .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
        .header(header::CACHE_CONTROL, "no-store")
        .body(bytes)
        .unwrap_or_default()
}
