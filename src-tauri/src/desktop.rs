use crate::{commands, AppState};
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager,
};

pub fn queue_open_requests(app: &AppHandle, requests: impl IntoIterator<Item = String>) {
    let state = app.state::<AppState>();
    let mut queued = false;
    if let Ok(mut pending) = state.open_requests.lock() {
        for request in requests {
            let request = url::Url::parse(&request)
                .ok()
                .filter(|url| url.scheme() == "file")
                .and_then(|url| url.to_file_path().ok())
                .map(|path| path.to_string_lossy().into_owned())
                .unwrap_or(request);
            let lower = request.to_ascii_lowercase();
            if lower.starts_with("feed:") || lower.ends_with(".opml") {
                if !pending.contains(&request) {
                    pending.push(request);
                    queued = true;
                }
            }
        }
    }
    if queued {
        commands::show_main_window(app);
        let _ = app.emit("desktop:open", ());
    }
}

#[tauri::command]
pub fn take_open_requests(app: AppHandle) -> Vec<String> {
    app.state::<AppState>()
        .open_requests
        .lock()
        .map(|mut pending| std::mem::take(&mut *pending))
        .unwrap_or_default()
}

pub fn update_unread(app: &AppHandle, unread: i64, badge: bool) {
    if let Some(window) = app.get_webview_window("main") {
        #[cfg(not(target_os = "windows"))]
        let _ = window.set_badge_count(if badge && unread > 0 {
            Some(unread)
        } else {
            None
        });
        let title = if unread > 0 {
            format!("Tyler — {unread} unread")
        } else {
            "Tyler".into()
        };
        let _ = window.set_title(&title);
    }
    if let Some(tray) = app.tray_by_id("tyler") {
        let _ = tray.set_tooltip(Some(format!("Tyler — {unread} unread")));
    }
    let _ = badge;
}

#[tauri::command(rename_all = "camelCase")]
pub fn update_unread_badge(app: AppHandle, unread: i64, enabled: bool) {
    update_unread(&app, unread.max(0), enabled);
}

pub fn setup(app: &AppHandle) -> tauri::Result<()> {
    let show = MenuItem::with_id(app, "show", "Open Tyler", true, None::<&str>)?;
    let refresh = MenuItem::with_id(app, "refresh", "Refresh feeds", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit Tyler", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &refresh, &quit])?;
    let mut tray = TrayIconBuilder::with_id("tyler")
        .menu(&menu)
        .tooltip("Tyler")
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show" => commands::show_main_window(app),
            "refresh" => {
                let app = app.clone();
                tauri::async_runtime::spawn(async move {
                    let _ = commands::refresh(app, None, None).await;
                });
            }
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if matches!(
                event,
                TrayIconEvent::Click {
                    button: MouseButton::Left,
                    button_state: MouseButtonState::Up,
                    ..
                }
            ) {
                commands::show_main_window(tray.app_handle());
            }
        });
    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }
    tray.build(app)?;
    Ok(())
}
