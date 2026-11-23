use std::path::{Component, Path, PathBuf};
use std::sync::OnceLock;

/// Resolve the library location once so a failed Linux migration keeps using the same path.
pub fn data_dir() -> PathBuf {
    static DATA_DIR: OnceLock<PathBuf> = OnceLock::new();
    DATA_DIR.get_or_init(resolve_data_dir).clone()
}

fn resolve_data_dir() -> PathBuf {
    if let Ok(dir) = std::env::var("TYLER_DATA_DIR") {
        if !dir.trim().is_empty() {
            return PathBuf::from(dir);
        }
    }
    default_data_dir()
}

#[cfg(target_os = "linux")]
fn default_data_dir() -> PathBuf {
    let home = std::env::home_dir().filter(|path| path.is_absolute());
    let config_dir = std::env::var_os("XDG_CONFIG_HOME")
        .map(PathBuf::from)
        .filter(|path| path.is_absolute())
        .or_else(|| home.as_ref().map(|path| path.join(".config")))
        .unwrap_or_else(|| PathBuf::from(".config"));
    let data_dir = config_dir.join("tyler-rss");
    let Some(legacy_dir) = home.map(|path| path.join(".tyler-rss")) else {
        return data_dir;
    };

    if !legacy_dir.is_dir() {
        return data_dir;
    }
    match std::fs::symlink_metadata(&data_dir) {
        Ok(_) => return data_dir,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => {
            eprintln!("Tyler: could not check {}: {error}", data_dir.display());
            return legacy_dir;
        }
    }
    // A user-managed link can have a relative target that would break after a move.
    if legacy_dir.is_symlink() {
        return legacy_dir;
    }

    // Move the whole library together, including any SQLite sidecars and cached media.
    let result =
        std::fs::create_dir_all(&config_dir).and_then(|()| std::fs::rename(&legacy_dir, &data_dir));
    if let Err(error) = result {
        if legacy_dir.is_dir() {
            eprintln!(
                "Tyler: could not move the library to {}: {error}. Using {}.",
                data_dir.display(),
                legacy_dir.display()
            );
            return legacy_dir;
        }
    }
    data_dir
}

#[cfg(not(target_os = "linux"))]
fn default_data_dir() -> PathBuf {
    for key in ["HOME", "USERPROFILE"] {
        if let Ok(home) = std::env::var(key) {
            if !home.trim().is_empty() {
                return PathBuf::from(home).join(".tyler-rss");
            }
        }
    }
    std::env::current_dir()
        .unwrap_or_else(|_| PathBuf::from("."))
        .join(".tyler-rss")
}

pub fn db_path() -> PathBuf {
    data_dir().join("tyler.sqlite")
}

pub fn media_dir() -> PathBuf {
    data_dir().join("media")
}

pub fn ensure_base_dirs() -> std::io::Result<()> {
    std::fs::create_dir_all(data_dir())?;
    std::fs::create_dir_all(media_dir())?;
    std::fs::create_dir_all(media_dir().join("feed-icons"))?;
    std::fs::create_dir_all(media_dir().join("covers"))?;
    std::fs::create_dir_all(media_dir().join("articles"))?;
    Ok(())
}

/// Return a tyler-media URL for a path relative to the data directory.
pub fn media_url(relative: &str) -> String {
    let clean = relative.trim_start_matches('/').replace('\\', "/");
    format!("tyler-media://localhost/{clean}")
}

pub fn relative_from_url(url: &str) -> Option<String> {
    url.strip_prefix("tyler-media://localhost/")
        .map(|s| s.to_string())
}

/// Resolve an existing file or directory strictly inside this library's media folder.
pub fn existing_media_path(relative: &str) -> Option<PathBuf> {
    let normalized = relative.replace('\\', "/");
    let path = Path::new(&normalized);
    if !path
        .components()
        .all(|part| matches!(part, Component::Normal(_)))
        || !path.starts_with("media")
    {
        return None;
    }
    let data = data_dir().canonicalize().ok()?;
    let media = data.join("media").canonicalize().ok()?;
    let candidate = data.join(path).canonicalize().ok()?;
    if media.starts_with(&data) && candidate.starts_with(&media) && candidate != media {
        Some(candidate)
    } else {
        None
    }
}

pub fn remove_media_file(relative: &str) {
    if let Some(path) = existing_media_path(relative).filter(|path| path.is_file()) {
        let _ = std::fs::remove_file(path);
    }
}

pub fn remove_article_media(article_id: i64) {
    let relative = format!("media/articles/{article_id}");
    if let Some(path) = existing_media_path(&relative).filter(|path| path.is_dir()) {
        let _ = std::fs::remove_dir_all(path);
    }
}
