use tauri::AppHandle;

#[tauri::command]
pub async fn open_folder_dialog(app: AppHandle) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;

    let folder = app
        .dialog()
        .file()
        .blocking_pick_folder();

    match folder {
        Some(path) => Ok(Some(path.to_string())),
        None => Ok(None),
    }
}

/// Open Terminal.app and run a command. Used for agent authentication flows
/// where the CLI needs interactive terminal access (e.g., browser OAuth).
#[tauri::command]
pub async fn run_in_terminal(command: String) -> Result<(), String> {
    // Sanitize: escape single quotes for AppleScript
    let escaped = command.replace('\\', "\\\\").replace('\'', "'\\''");

    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("osascript")
            .args([
                "-e",
                &format!(
                    "tell application \"Terminal\"\n  activate\n  do script \"{}\"\nend tell",
                    escaped.replace('"', "\\\"")
                ),
            ])
            .spawn()
            .map_err(|e| format!("Failed to open Terminal: {}", e))?;
        Ok(())
    }

    #[cfg(not(target_os = "macos"))]
    {
        Err("run_in_terminal is only supported on macOS".to_string())
    }
}
