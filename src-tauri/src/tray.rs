//! System tray (desktop only).
//!
//! iOS has no menu bar and no tray: `tauri::menu` and `tauri::tray` do not
//! exist on that target, so the real implementation is gated to `desktop` and
//! the mobile build gets no-op stubs with identical signatures.
//!
//! Stubs rather than gating the module in `lib.rs` because the tray commands
//! are listed in `generate_handler!`, and cfg-ing individual entries there is
//! considerably more fragile than keeping one shape for both platforms.

#[cfg(desktop)]
mod imp {
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
        let menu = build_tray_menu(app.handle(), 0, &[], None)?;

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

    fn append_recent_items(
        app: &AppHandle,
        submenu: &Submenu<Wry>,
        files: &[RecentFile],
    ) -> Result<(), tauri::Error> {
        if files.is_empty() {
            let empty = MenuItem::with_id(app, "recent-empty", "No Recent Files", false, None::<&str>)?;
            submenu.append(&empty)?;
        } else {
            for file in files.iter().take(5) {
                let item = MenuItem::with_id(
                    app,
                    format!("recent-{}", file.path),
                    &file.name,
                    true,
                    None::<&str>,
                )?;
                submenu.append(&item)?;
            }
        }
        Ok(())
    }

    fn build_tray_menu(
        app: &AppHandle,
        badge_count: u32,
        recent_files: &[RecentFile],
        all_recent_files: Option<&[RecentFile]>,
    ) -> Result<Menu<Wry>, tauri::Error> {
        let actions_label = if badge_count > 0 {
            format!("Open Actions ({})", badge_count)
        } else {
            "Open Actions".to_string()
        };

        // Scoped recent submenu — filtered to the active chat's selected projects.
        let recent_submenu = Submenu::with_id(app, "recent", "Recent", true)?;
        append_recent_items(app, &recent_submenu, recent_files)?;

        // "All recent" is only shown when it would differ from the scoped list —
        // i.e. the frontend passed an explicit unfiltered superset. Keeps the menu
        // tidy when no project is selected (scoped == all).
        let all_recent_submenu = match all_recent_files {
            Some(all) if all.len() != recent_files.len() => {
                let sub = Submenu::with_id(app, "recent-all", "All Recent", true)?;
                append_recent_items(app, &sub, all)?;
                Some(sub)
            }
            _ => None,
        };

        let menu = Menu::new(app)?;
        menu.append(&MenuItem::with_id(app, "new-note", "New Note", true, Some("CmdOrCtrl+N"))?)?;
        menu.append(&PredefinedMenuItem::separator(app)?)?;
        menu.append(&MenuItem::with_id(app, "open-actions", &actions_label, true, None::<&str>)?)?;
        menu.append(&PredefinedMenuItem::separator(app)?)?;
        menu.append(&recent_submenu)?;
        if let Some(all_sub) = &all_recent_submenu {
            menu.append(all_sub)?;
        }
        menu.append(&PredefinedMenuItem::separator(app)?)?;
        menu.append(&MenuItem::with_id(app, "show-window", "Show Notesage", true, None::<&str>)?)?;
        menu.append(&PredefinedMenuItem::separator(app)?)?;
        menu.append(&MenuItem::with_id(app, "quit", "Quit Notesage", true, Some("CmdOrCtrl+Q"))?)?;

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
        let menu = build_tray_menu(&app, count, &recent, None).map_err(|e| e.to_string())?;
        if let Some(tray) = get_tray(&app) {
            tray.set_menu(Some(menu)).map_err(|e| e.to_string())?;
        }

        Ok(())
    }

    /// Update the tray recent files submenu.
    ///
    /// `files` is the scoped list (filtered by the active chat's selected projects).
    /// `all_files` is the unfiltered superset used to populate the "All Recent"
    /// submenu; when omitted or equal in size to `files`, the extra submenu is
    /// hidden.
    #[tauri::command]
    pub async fn update_tray_recent(
        app: AppHandle,
        files: Vec<RecentFile>,
        all_files: Option<Vec<RecentFile>>,
    ) -> Result<(), String> {
        let state = app.state::<TrayState>();
        let count = *state.badge_count.lock().map_err(|e| e.to_string())?;

        let menu = build_tray_menu(&app, count, &files, all_files.as_deref())
            .map_err(|e| e.to_string())?;
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

    /// Show the main window. Called from the frontend after React has painted the themed UI.
    #[tauri::command]
    pub async fn show_main_window_command(app: AppHandle) -> Result<(), String> {
        show_main_window(&app);
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

}

#[cfg(desktop)]
pub use imp::*;

/// Mobile no-ops. The frontend guards tray settings behind a desktop check, so
/// these should never be reached — they return `Ok(())` rather than an error
/// so a stray call cannot surface as a user-visible failure.
#[cfg(mobile)]
mod stub {
    use serde::Deserialize;
    use std::sync::Mutex;
    use tauri::AppHandle;

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

    impl Default for TrayState {
        fn default() -> Self {
            Self::new()
        }
    }

    #[derive(Debug, Clone, Deserialize)]
    pub struct RecentFile {
        pub name: String,
        pub path: String,
    }

    pub fn is_close_to_tray(_app: &AppHandle) -> bool {
        false
    }

    #[tauri::command]
    pub async fn update_tray_badge(_app: AppHandle, _count: u32) -> Result<(), String> {
        Ok(())
    }

    #[tauri::command]
    pub async fn update_tray_recent(
        _app: AppHandle,
        _files: Vec<RecentFile>,
    ) -> Result<(), String> {
        Ok(())
    }

    #[tauri::command]
    pub async fn set_close_to_tray(_app: AppHandle, _enabled: bool) -> Result<(), String> {
        Ok(())
    }

    #[tauri::command]
    pub async fn show_main_window_command(_app: AppHandle) -> Result<(), String> {
        Ok(())
    }

    #[tauri::command]
    pub async fn set_tray_visible(_app: AppHandle, _visible: bool) -> Result<(), String> {
        Ok(())
    }
}

#[cfg(mobile)]
pub use stub::*;
