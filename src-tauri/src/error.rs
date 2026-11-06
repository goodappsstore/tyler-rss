use std::fmt;

pub type AppResult<T> = Result<T, AppError>;

#[derive(Debug)]
pub enum AppError {
    Db(rusqlite::Error),
    Io(std::io::Error),
    Http(reqwest::Error),
    Json(serde_json::Error),
    Zip(zip::result::ZipError),
    Xml(roxmltree::Error),
    Url(url::ParseError),
    DownloadTooLarge { host: String, limit_bytes: u64 },
    Message(String),
}

impl fmt::Display for AppError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            AppError::Db(e) => write!(f, "Database error: {e}"),
            AppError::Io(e) => write!(f, "File error: {e}"),
            AppError::Http(e) => write!(f, "Network error: {e}"),
            AppError::Json(e) => write!(f, "Data error: {e}"),
            AppError::Zip(e) => write!(f, "Archive error: {e}"),
            AppError::Xml(e) => write!(f, "XML error: {e}"),
            AppError::Url(e) => write!(f, "Invalid URL: {e}"),
            AppError::DownloadTooLarge { host, limit_bytes } => write!(
                f,
                "Download from {host} exceeds the {} MiB limit. Increase Feed download limit in Settings → Feeds & storage, then retry.",
                limit_bytes / (1024 * 1024)
            ),
            AppError::Message(m) => write!(f, "{m}"),
        }
    }
}

impl std::error::Error for AppError {}

impl From<rusqlite::Error> for AppError {
    fn from(e: rusqlite::Error) -> Self {
        AppError::Db(e)
    }
}
impl From<std::io::Error> for AppError {
    fn from(e: std::io::Error) -> Self {
        AppError::Io(e)
    }
}
impl From<reqwest::Error> for AppError {
    fn from(e: reqwest::Error) -> Self {
        AppError::Http(e)
    }
}
impl From<serde_json::Error> for AppError {
    fn from(e: serde_json::Error) -> Self {
        AppError::Json(e)
    }
}
impl From<zip::result::ZipError> for AppError {
    fn from(e: zip::result::ZipError) -> Self {
        AppError::Zip(e)
    }
}
impl From<roxmltree::Error> for AppError {
    fn from(e: roxmltree::Error) -> Self {
        AppError::Xml(e)
    }
}
impl From<url::ParseError> for AppError {
    fn from(e: url::ParseError) -> Self {
        AppError::Url(e)
    }
}
