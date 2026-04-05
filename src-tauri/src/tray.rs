use serde::Deserialize;
use std::sync::Mutex;
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem, Submenu},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager, WebviewWindow, Wry,
};

/// State for dynamic tray updates (badge count, close-to-tray).
pub struct TrayState {
    pub badge_count: Mutex<u32>,
    pub close_to_tray: Mutex<bool>,
}

impl TrayState {
    pub fn new() -> Self {
        Self {
            badge_count: Mutex::new(0),
            close_to_tray: Mutex::new(false),
        }
    }
}

#[derive(Debug, Deserialize)]
pub struct RecentFile {
    pub name: String,
    pub path: String,
}

/// Set up the system tray icon and menu. Called from `lib.rs` setup.
pub fn setup_tray(app: &tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    let menu = build_tray_menu(app.handle(), 0, &[])?;

    // Load the "N" tray icon as a macOS template image.
    // Template images are tinted by the system to match the menu bar (light/dark).
    let icon_bytes = include_bytes!("../icons/tray-icon@2x.png");
    let icon = tauri::image::Image::from_bytes(icon_bytes)
        .unwrap_or_else(|_| app.default_window_icon().unwrap().clone());

    TrayIconBuilder::with_id("main")
        .icon(icon)
        .icon_as_template(true)
        .menu(&menu)
        .tooltip("Notesage")
        .on_menu_event(handle_menu_event)
        .on_tray_icon_event(handle_tray_icon_event)
        .build(app)?;

    // Register global shortcut for quick capture (Cmd+Shift+Space)
    use tauri_plugin_global_shortcut::GlobalShortcutExt;
    let _ = app.global_shortcut().on_shortcut("CmdOrCtrl+Shift+Space", |app, _shortcut, event| {
        if event.state == tauri_plugin_global_shortcut::ShortcutState::Pressed {
            let app = app.clone();
            tauri::async_runtime::spawn(async move {
                let _ = show_quick_capture(app).await;
            });
        }
    });

    Ok(())
}

fn handle_menu_event(app: &AppHandle<Wry>, event: tauri::menu::MenuEvent) {
    let id = event.id().as_ref();
    log::debug!(target: "notesage::tray", "Tray menu event: {}", id);

    match id {
        "new-note" => {
            show_main_window(app);
            let _ = app.emit("tray-new-note", ());
        }
        "new-quick-note" => {
            let app = app.clone();
            tauri::async_runtime::spawn(async move {
                let _ = show_quick_capture(app).await;
            });
        }
        "open-actions" => {
            show_main_window(app);
            let _ = app.emit("tray-open-actions", ());
        }
        "show-window" => {
            show_main_window(app);
        }
        "quit" => {
            log::info!(target: "notesage::tray", "Quit from tray menu");
            app.exit(0);
        }
        other => {
            if let Some(path) = other.strip_prefix("recent-") {
                show_main_window(app);
                let _ = app.emit("tray-open-file", path.to_string());
            }
        }
    }
}

fn handle_tray_icon_event(tray: &tauri::tray::TrayIcon<Wry>, event: TrayIconEvent) {
    if let TrayIconEvent::Click {
        button: MouseButton::Left,
        button_state: MouseButtonState::Up,
        ..
    } = event
    {
        let app = tray.app_handle();
        if let Some(window) = app.get_webview_window("main") {
            let w: &WebviewWindow = &window;
            if w.is_visible().unwrap_or(false) {
                let _ = w.hide();
            } else {
                let _ = w.show();
                let _ = w.set_focus();
            }
        }
    }
}

fn build_tray_menu(
    app: &AppHandle,
    badge_count: u32,
    recent_files: &[RecentFile],
) -> Result<Menu<Wry>, tauri::Error> {
    let actions_label = if badge_count > 0 {
        format!("Open Actions ({})", badge_count)
    } else {
        "Open Actions".to_string()
    };

    // Build recent files submenu
    let recent_submenu = Submenu::with_id(app, "recent", "Recent", true)?;
    if recent_files.is_empty() {
        let empty = MenuItem::with_id(app, "recent-empty", "No Recent Files", false, None::<&str>)?;
        recent_submenu.append(&empty)?;
    } else {
        for file in recent_files.iter().take(5) {
            let item = MenuItem::with_id(
                app,
                format!("recent-{}", file.path),
                &file.name,
                true,
                None::<&str>,
            )?;
            recent_submenu.append(&item)?;
        }
    }

    let menu = Menu::with_items(
        app,
        &[
            &MenuItem::with_id(app, "new-note", "New Note", true, Some("CmdOrCtrl+N"))?,
            &MenuItem::with_id(app, "new-quick-note", "New Quick Note", true, None::<&str>)?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "open-actions", &actions_label, true, None::<&str>)?,
            &PredefinedMenuItem::separator(app)?,
            &recent_submenu,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "show-window", "Show Notesage", true, None::<&str>)?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "quit", "Quit Notesage", true, Some("CmdOrCtrl+Q"))?,
        ],
    )?;

    Ok(menu)
}

fn show_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.set_focus();
    }
}

fn get_tray(app: &AppHandle) -> Option<tauri::tray::TrayIcon<Wry>> {
    app.tray_by_id("main")
}

/// Check if close-to-tray is enabled (called from window close handler in lib.rs).
pub fn is_close_to_tray(app: &AppHandle) -> bool {
    app.try_state::<TrayState>()
        .map(|s| *s.close_to_tray.lock().unwrap_or_else(|e| e.into_inner()))
        .unwrap_or(false)
}

// -- Tauri commands --

/// Update the tray badge count (tooltip + menu item text).
#[tauri::command]
pub async fn update_tray_badge(app: AppHandle, count: u32) -> Result<(), String> {
    let state = app.state::<TrayState>();
    *state.badge_count.lock().map_err(|e| e.to_string())? = count;

    if let Some(tray) = get_tray(&app) {
        let tooltip = if count > 0 {
            format!("Notesage \u{2014} {} open actions", count)
        } else {
            "Notesage".to_string()
        };
        tray.set_tooltip(Some(&tooltip)).map_err(|e| e.to_string())?;
    }

    // Rebuild menu with updated badge count
    let recent: Vec<RecentFile> = Vec::new();
    let menu = build_tray_menu(&app, count, &recent).map_err(|e| e.to_string())?;
    if let Some(tray) = get_tray(&app) {
        tray.set_menu(Some(menu)).map_err(|e| e.to_string())?;
    }

    Ok(())
}

/// Update the tray recent files submenu.
#[tauri::command]
pub async fn update_tray_recent(app: AppHandle, files: Vec<RecentFile>) -> Result<(), String> {
    let state = app.state::<TrayState>();
    let count = *state.badge_count.lock().map_err(|e| e.to_string())?;

    let menu = build_tray_menu(&app, count, &files).map_err(|e| e.to_string())?;
    if let Some(tray) = get_tray(&app) {
        tray.set_menu(Some(menu)).map_err(|e| e.to_string())?;
    }

    Ok(())
}

/// Sync the close-to-tray setting from the frontend.
#[tauri::command]
pub async fn set_close_to_tray(app: AppHandle, enabled: bool) -> Result<(), String> {
    let state = app.state::<TrayState>();
    *state.close_to_tray.lock().map_err(|e| e.to_string())? = enabled;
    Ok(())
}

/// Show the quick capture window. Creates it if it doesn't exist.
#[tauri::command]
pub async fn show_quick_capture(app: AppHandle) -> Result<(), String> {
    use tauri::WebviewUrl;

    if let Some(window) = app.get_webview_window("quick-capture") {
        window.show().map_err(|e| e.to_string())?;
        window.set_focus().map_err(|e| e.to_string())?;
        return Ok(());
    }

    // Create a new quick capture window
    let _window = tauri::WebviewWindowBuilder::new(
        &app,
        "quick-capture",
        WebviewUrl::App("index.html?window=quick-capture".into()),
    )
    .title("Quick Note")
    .inner_size(480.0, 320.0)
    .resizable(false)
    .always_on_top(true)
    .center()
    .decorations(true)
    .visible(true)
    .focused(true)
    .skip_taskbar(true)
    .build()
    .map_err(|e| e.to_string())?;

    Ok(())
}

/// Hide the quick capture window.
#[tauri::command]
pub async fn hide_quick_capture(app: AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("quick-capture") {
        window.hide().map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Show or hide the tray icon.
#[tauri::command]
pub async fn set_tray_visible(app: AppHandle, visible: bool) -> Result<(), String> {
    if let Some(tray) = get_tray(&app) {
        tray.set_visible(visible).map_err(|e| e.to_string())?;
    }
    Ok(())
}
