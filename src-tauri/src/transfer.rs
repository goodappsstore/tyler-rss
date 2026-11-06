use crate::db;
use crate::error::{AppError, AppResult};
use crate::models::BackupExportResult;
use crate::paths;
use rusqlite::Connection;
use std::fs::{self, File};
use std::io::Read;
use std::path::{Component, Path, PathBuf};
use walkdir::WalkDir;
use zip::write::SimpleFileOptions;
use zip::{CompressionMethod, ZipArchive, ZipWriter};

struct TempDir {
    path: PathBuf,
}

impl TempDir {
    fn new(label: &str) -> AppResult<Self> {
        Self::new_in(&std::env::temp_dir(), label)
    }

    fn new_in(parent: &Path, label: &str) -> AppResult<Self> {
        let path = parent.join(format!("tyler-{label}-{}", uuid::Uuid::new_v4()));
        fs::create_dir(&path)?;
        Ok(TempDir { path })
    }
}

impl Drop for TempDir {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.path);
    }
}

fn add_dir_to_zip(zip: &mut ZipWriter<File>, root: &Path, prefix: &str) -> AppResult<()> {
    if !root.exists() {
        return Ok(());
    }
    let options = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);
    for entry in WalkDir::new(root).follow_links(false) {
        let entry = match entry {
            Ok(e) => e,
            Err(_) => continue,
        };
        if !entry.file_type().is_file() {
            continue;
        }
        let rel = match entry.path().strip_prefix(root) {
            Ok(r) => r,
            Err(_) => continue,
        };
        let name = format!("{prefix}/{}", rel.to_string_lossy().replace('\\', "/"));
        zip.start_file(name, options)?;
        let mut file = File::open(entry.path())?;
        std::io::copy(&mut file, zip)?;
    }
    Ok(())
}

fn vacuum_into(conn: &Connection, target: &Path) -> AppResult<()> {
    let path = target.to_string_lossy().replace('\'', "''");
    conn.execute_batch(&format!("VACUUM INTO '{path}'"))?;
    Ok(())
}

pub fn export(conn: &Connection, path: &str) -> AppResult<BackupExportResult> {
    let temp = TempDir::new("export")?;
    let snapshot = temp.path.join("tyler.sqlite");
    vacuum_into(conn, &snapshot)?;
    let mut destination = PathBuf::from(path);
    if destination.extension().is_none() {
        let name = destination
            .file_name()
            .map(|n| format!("{}.tyler.zip", n.to_string_lossy()))
            .unwrap_or_else(|| "tyler-backup.tyler.zip".into());
        destination.set_file_name(name);
    }
    if let Some(parent) = destination.parent() {
        if !parent.as_os_str().is_empty() {
            fs::create_dir_all(parent)?;
        }
    }
    let file = File::create(&destination)?;
    let mut zip = ZipWriter::new(file);
    let options = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);
    zip.start_file("tyler.sqlite", options)?;
    let mut db_file = File::open(&snapshot)?;
    std::io::copy(&mut db_file, &mut zip)?;
    add_dir_to_zip(&mut zip, &paths::media_dir(), "media")?;
    zip.finish()?;
    let bytes = fs::metadata(&destination).map(|m| m.len()).unwrap_or(0);
    Ok(BackupExportResult {
        path: destination.to_string_lossy().to_string(),
        bytes,
    })
}

fn safe_zip_path(name: &str) -> Option<PathBuf> {
    let normalized = name.replace('\\', "/");
    let path = Path::new(&normalized);
    for component in path.components() {
        match component {
            Component::Normal(_) => {}
            _ => return None,
        }
    }
    Some(path.to_path_buf())
}

fn validate_database(path: &Path) -> AppResult<()> {
    let conn = Connection::open(path)?;
    let tables: i64 = conn.query_row(
        "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table'
            AND name IN ('feeds', 'articles', 'folders', 'settings')",
        [],
        |row| row.get(0),
    )?;
    if tables != 4 {
        return Err(AppError::Message(
            "Backup does not contain a Tyler library.".into(),
        ));
    }
    let integrity: String = conn.query_row("PRAGMA quick_check", [], |row| row.get(0))?;
    if integrity != "ok" {
        return Err(AppError::Message(format!(
            "Backup database is damaged: {integrity}"
        )));
    }
    let version: i64 = conn.query_row("PRAGMA user_version", [], |row| row.get(0))?;
    if version > 4 {
        return Err(AppError::Message(
            "This backup needs a newer version of Tyler.".into(),
        ));
    }
    drop(conn);

    let conn = db::prepare_database(path)?;
    if conn.prepare("PRAGMA foreign_key_check")?.exists([])? {
        return Err(AppError::Message(
            "Backup database has invalid references.".into(),
        ));
    }
    // Check the same queries used to open the restored library, before replacement.
    crate::commands::build_bootstrap(&conn)?;
    let query = serde_json::from_value(serde_json::json!({ "limit": 1 }))?;
    let page = crate::articles::list_articles(&conn, &query)?;
    if let Some(article) = page.articles.first() {
        crate::articles::get_article(&conn, article.id)?;
    }
    if conn
        .execute(
            "INSERT INTO articles_fts(articles_fts, rank) VALUES('integrity-check', 1)",
            [],
        )
        .is_err()
    {
        db::rebuild_fts(&conn)?;
        conn.execute(
            "INSERT INTO articles_fts(articles_fts, rank) VALUES('integrity-check', 1)",
            [],
        )?;
    }
    // Fold the staged WAL into the main file before moving it into place.
    conn.pragma_update(None, "journal_mode", "DELETE")?;
    conn.close().map_err(|(_, error)| AppError::Db(error))?;
    Ok(())
}

fn prune_backups(data_dir: &Path, keep: &Path) {
    let Some(parent) = data_dir.parent() else {
        return;
    };
    let Some(name) = data_dir.file_name() else {
        return;
    };
    let prefix = format!("{}.backup-", name.to_string_lossy());
    let Ok(entries) = fs::read_dir(parent) else {
        return;
    };
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        let Some(suffix) = name.strip_prefix(&prefix) else {
            continue;
        };
        let (stamp, unique) = suffix.split_once('-').unwrap_or((suffix, ""));
        let valid_stamp = chrono::NaiveDateTime::parse_from_str(stamp, "%Y%m%dT%H%M%SZ").is_ok();
        let valid_unique = unique.is_empty() || uuid::Uuid::parse_str(unique).is_ok();
        if valid_stamp
            && valid_unique
            && entry.path() != keep
            && entry.file_type().is_ok_and(|kind| kind.is_dir())
        {
            let _ = fs::remove_dir_all(entry.path());
        }
    }
}

/// Validate in staging, then replace the library while no command has it open.
pub fn import(path: &str) -> AppResult<()> {
    let file = File::open(path)?;
    let mut archive = ZipArchive::new(file)?;
    {
        let _guard = db::library_read()?;
        paths::ensure_base_dirs()?;
    }
    let data_dir = paths::data_dir().canonicalize()?;
    let parent = data_dir
        .parent()
        .ok_or_else(|| AppError::Message("Invalid data directory".into()))?;
    // Same filesystem as the library so installation and rollback use renames.
    let temp = TempDir::new_in(parent, "import")?;
    let temp_db = temp.path.join("tyler.sqlite");

    {
        let mut entry = archive
            .by_name("tyler.sqlite")
            .map_err(|_| AppError::Message("Backup does not contain tyler.sqlite".into()))?;
        let mut out = File::create(&temp_db)?;
        std::io::copy(&mut entry, &mut out)?;
    }
    {
        let mut header = [0u8; 16];
        let mut f = File::open(&temp_db)?;
        let read = f.read(&mut header)?;
        if read < 16 || &header[..16] != b"SQLite format 3\0" {
            return Err(AppError::Message(
                "Backup database is not a valid SQLite file".into(),
            ));
        }
    }

    let temp_media = temp.path.join("media");
    fs::create_dir_all(&temp_media)?;
    for index in 0..archive.len() {
        let mut entry = archive.by_index(index)?;
        let Some(enclosed) = entry.enclosed_name() else {
            continue;
        };
        let name = enclosed.to_string_lossy().replace('\\', "/");
        if name == "tyler.sqlite" || !name.starts_with("media/") || name.ends_with('/') {
            continue;
        }
        let Some(relative) = safe_zip_path(&name) else {
            continue;
        };
        let Ok(relative) = relative.strip_prefix("media") else {
            continue;
        };
        let target = temp_media.join(relative);
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent)?;
        }
        let mut out = File::create(&target)?;
        std::io::copy(&mut entry, &mut out)?;
    }

    drop(archive);
    validate_database(&temp_db)?;

    let _guard = db::library_write()?;
    let name = data_dir
        .file_name()
        .ok_or_else(|| AppError::Message("Invalid data directory".into()))?;
    let stamp = chrono::Utc::now().format("%Y%m%dT%H%M%SZ");
    let backup = parent.join(format!(
        "{}.backup-{stamp}-{}",
        name.to_string_lossy(),
        uuid::Uuid::new_v4()
    ));
    fs::create_dir(&backup)?;
    let mut saved = Vec::new();
    let mut installed = Vec::new();
    let result = (|| -> AppResult<()> {
        // Preserve WAL/SHM too, including recovery state from an interrupted session.
        for name in [
            "tyler.sqlite",
            "tyler.sqlite-wal",
            "tyler.sqlite-shm",
            "media",
        ] {
            let source = data_dir.join(name);
            if source.try_exists()? {
                fs::rename(&source, backup.join(name))?;
                saved.push(name);
            }
        }
        for name in ["tyler.sqlite", "media"] {
            fs::rename(temp.path.join(name), data_dir.join(name))?;
            installed.push(name);
        }
        Ok(())
    })();
    if let Err(error) = result {
        let rollback = (|| -> AppResult<()> {
            for name in installed.iter().rev() {
                fs::rename(data_dir.join(name), temp.path.join(name))?;
            }
            for name in saved.iter().rev() {
                fs::rename(backup.join(name), data_dir.join(name))?;
            }
            Ok(())
        })();
        if let Err(rollback_error) = rollback {
            return Err(AppError::Message(format!(
                "Restore failed: {error}. Could not restore the previous library: {rollback_error}. Previous files are in {}.",
                backup.display()
            )));
        }
        let _ = fs::remove_dir(&backup);
        return Err(error);
    }
    // Keep all older safety copies until the new library is fully installed.
    prune_backups(&data_dir, &backup);
    Ok(())
}
