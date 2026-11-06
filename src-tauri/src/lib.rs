mod articles;
mod commands;
mod db;
mod desktop;
mod error;
mod feeds;
mod models;
mod opml;
mod paths;
mod reader;
mod settings;
mod subscriptions;
mod summaries;
mod transfer;

use std::sync::atomic::AtomicBool;
use std::sync::Mutex;
use tauri::http::{header, Response, StatusCode};
use tauri::{webview::PageLoadEvent, Manager};

#[derive(Default)]
pub struct AppState {
    pub subscriptions: subscriptions::SubscriptionQueue,
    pub refresh_lock: Mutex<()>,
    pub running: AtomicBool,
    pub last_refresh: Mutex<Option<String>>,
    pub transfer_lock: Mutex<()>,
    pub summaries: summaries::SummaryCache,
    pub open_requests: Mutex<Vec<String>>,
}

fn media_response(raw_path: &str) -> Response<Vec<u8>> {
    let decoded = percent_encoding::percent_decode_str(raw_path)
        .decode_utf8_lossy()
        .to_string();
    let body = |status: StatusCode, content_type: &str, bytes: Vec<u8>| {
        Response::builder()
            .status(status)
            .header(header::CONTENT_TYPE, content_type)
            .header(header::CACHE_CONTROL, "no-cache")
            .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
            .body(bytes)
            .unwrap_or_else(|_| Response::new(Vec::new()))
    };
    let Ok(_guard) = db::library_read() else {
        return body(
            StatusCode::SERVICE_UNAVAILABLE,
            "text/plain",
            b"Library restore in progress".to_vec(),
        );
    };
    let safe =
        paths::existing_media_path(decoded.trim_start_matches('/')).filter(|path| path.is_file());
    match safe {
        Some(file) => match std::fs::read(&file) {
            Ok(bytes) => {
                let mime = mime_guess::from_path(&file)
                    .first_or_octet_stream()
                    .essence_str()
                    .to_string();
                body(StatusCode::OK, &mime, bytes)
            }
            Err(_) => body(
                StatusCode::INTERNAL_SERVER_ERROR,
                "text/plain; charset=utf-8",
                b"Could not read media".to_vec(),
            ),
        },
        None => body(
            StatusCode::NOT_FOUND,
            "text/plain; charset=utf-8",
            b"Not found".to_vec(),
        ),
    }
}

pub fn run() {
    use tauri_plugin_deep_link::DeepLinkExt;
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, args, cwd| {
            let requests = args.into_iter().skip(1).map(|arg| {
                if arg.starts_with("feed:") || std::path::Path::new(&arg).is_absolute() {
                    arg
                } else {
                    std::path::Path::new(&cwd)
                        .join(arg)
                        .to_string_lossy()
                        .into_owned()
                }
            });
            desktop::queue_open_requests(app, requests);
        }))
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(AppState::default())
        .register_asynchronous_uri_scheme_protocol("tyler-media", |_ctx, request, responder| {
            let path = request.uri().path().to_string();
            std::thread::spawn(move || {
                responder.respond(media_response(&path));
            });
        })
        .setup(|app| {
            if let Err(e) = db::ensure_db() {
                eprintln!("Tyler: could not prepare database: {e}");
            }
            if let Err(e) = subscriptions::start(app.handle()) {
                eprintln!("Tyler: could not start feed loading: {e}");
            }
            if let Err(error) = desktop::setup(app.handle()) {
                eprintln!("Tyler: could not create tray: {error}");
            }
            let handle = app.handle().clone();
            app.deep_link().on_open_url(move |event| {
                desktop::queue_open_requests(
                    &handle,
                    event.urls().into_iter().map(|url| url.to_string()),
                );
            });
            #[cfg(any(target_os = "linux", target_os = "windows"))]
            if let Err(error) = app.deep_link().register_all() {
                eprintln!("Tyler: could not register feed links: {error}");
            }
            desktop::queue_open_requests(app.handle(), std::env::args().skip(1));
            Ok(())
        })
        .on_window_event(|window, event| {
            if window.label() == "main" && window.app_handle().tray_by_id("tyler").is_some() {
                if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                    // The tray keeps refresh and notifications available after closing the reader.
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .on_page_load(|webview, payload| {
            if webview.label() == "main" && payload.event() == PageLoadEvent::Finished {
                commands::show_main_window(webview.app_handle());
            }
        })
        .invoke_handler(tauri::generate_handler![
            reader::fetch_article_source,
            reader::save_full_article,
            reader::export_article_markdown,
            reader::print_article,
            reader::open_article_link,
            desktop::take_open_requests,
            desktop::update_unread_badge,
            commands::bootstrap,
            commands::list_articles,
            commands::get_article,
            commands::generate_summary,
            commands::set_article_state,
            commands::mark_all_read,
            commands::discover_feeds,
            commands::add_feed,
            commands::add_feeds,
            commands::update_feed,
            commands::delete_feed,
            commands::refresh,
            commands::refresh_status,
            commands::create_folder,
            commands::rename_folder,
            commands::delete_folder,
            commands::create_tag,
            commands::create_tags,
            commands::rename_tag,
            commands::delete_tag,
            commands::set_article_tags,
            commands::list_tags,
            commands::get_settings,
            commands::set_settings,
            commands::opml_import,
            commands::opml_import_url,
            commands::opml_export,
            commands::export_backup,
            commands::import_backup,
            commands::data_info,
            commands::cleanup_articles,
            commands::get_stats,
            commands::cache_article_media,
            commands::save_image_from_url,
            commands::open_data_dir,
            commands::ping,
        ])
        .build(tauri::generate_context!())
        .expect("error while building Tyler")
        .run(|app, event| {
            #[cfg(target_os = "macos")]
            if matches!(&event, tauri::RunEvent::Reopen { .. }) {
                commands::show_main_window(app);
            }
            #[cfg(any(target_os = "macos", target_os = "ios"))]
            if let tauri::RunEvent::Opened { urls } = event {
                desktop::queue_open_requests(
                    app,
                    urls.into_iter().map(|url| {
                        url.to_file_path()
                            .map(|p| p.to_string_lossy().into_owned())
                            .unwrap_or_else(|_| url.to_string())
                    }),
                );
            }
            #[cfg(not(any(target_os = "macos", target_os = "ios")))]
            let _ = (app, event);
        });
}
