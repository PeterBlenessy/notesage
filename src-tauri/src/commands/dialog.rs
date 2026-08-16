use tauri::AppHandle;

#[cfg(desktop)]
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

/// iOS has no folder picker in `tauri-plugin-dialog` (`blocking_pick_folder`
/// is desktop-only). The mobile app doesn't use this: granting access to the
/// library folder goes through `ios_pick_library_folder`, which presents
/// `UIDocumentPickerViewController` and persists a security-scoped bookmark —
/// a different mechanism with a different security model, not a port of this.
#[cfg(mobile)]
#[tauri::command]
pub async fn open_folder_dialog(_app: AppHandle) -> Result<Option<String>, String> {
    Err("Folder picking on iOS goes through ios_pick_library_folder".to_string())
}

#[tauri::command]
pub async fn open_file_dialog(
    app: AppHandle,
    filter_name: Option<String>,
    filter_extensions: Option<Vec<String>>,
) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;

    let mut builder = app.dialog().file();

    if let (Some(name), Some(exts)) = (filter_name, filter_extensions) {
        let ext_refs: Vec<&str> = exts.iter().map(|s| s.as_str()).collect();
        builder = builder.add_filter(name, &ext_refs);
    }

    let file = builder.blocking_pick_file();

    match file {
        Some(path) => Ok(Some(path.to_string())),
        None => Ok(None),
    }
}

/// Build the osascript argv for opening Terminal.app and running `command`.
///
/// The command is passed as an argv-bound AppleScript argument (`item 1 of
/// argv`) instead of being interpolated into the script source (audit batch 3
/// fix #2). The old approach escaped for two quoting layers at once —
/// shell-style single-quote escaping that was never wrapped in single quotes,
/// followed by a separate double-quote escape into the AppleScript literal —
/// which was incoherent and mangled commands containing quotes/backslashes.
/// With argv binding there is exactly zero escaping: osascript hands the
/// string to AppleScript verbatim, and `do script` passes it to Terminal
/// unchanged. The trailing `--` keeps a command starting with `-` from being
/// parsed as an osascript option.
// Only invoked from the macOS branch below (and from tests on every platform),
// so non-macOS check builds would otherwise flag it dead.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
fn osascript_run_in_terminal_args(command: &str) -> Vec<String> {
    [
        "-e",
        "on run argv",
        "-e",
        "tell application \"Terminal\" to activate",
        "-e",
        "tell application \"Terminal\" to do script (item 1 of argv)",
        "-e",
        "end run",
        "--",
        command,
    ]
    .iter()
    .map(|s| s.to_string())
    .collect()
}

/// Open Terminal.app and run a command. Used for agent authentication flows
/// where the CLI needs interactive terminal access (e.g., browser OAuth).
#[tauri::command]
pub async fn run_in_terminal(command: String) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("osascript")
            .args(osascript_run_in_terminal_args(&command))
            .spawn()
            .map_err(|e| format!("Failed to open Terminal: {}", e))?;
        Ok(())
    }

    #[cfg(not(target_os = "macos"))]
    {
        let _ = command;
        Err("run_in_terminal is only supported on macOS".to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn command_is_bound_as_verbatim_argv_not_interpolated() {
        // Quotes, backslashes, and shell metacharacters must survive
        // untouched — no escaping layer is applied anywhere.
        let gnarly = r#"cd "/tmp/my dir" && echo 'it\'s' \\ "double" $HOME; gemini"#;
        let args = osascript_run_in_terminal_args(gnarly);
        assert_eq!(args.last().map(String::as_str), Some(gnarly));
        // The command must never appear inside any -e script source.
        for pair in args.chunks(2) {
            if pair[0] == "-e" {
                assert!(
                    !pair[1].contains("gemini"),
                    "command text leaked into script source: {}",
                    pair[1]
                );
            }
        }
    }

    #[test]
    fn argv_shape_binds_command_after_double_dash() {
        let args = osascript_run_in_terminal_args("-rf --looks-like-a-flag");
        // `--` must directly precede the command so a leading dash can't be
        // parsed as an osascript option.
        let dd = args.iter().position(|a| a == "--").expect("has --");
        assert_eq!(args[dd + 1], "-rf --looks-like-a-flag");
        assert_eq!(args.len(), dd + 2, "command is the final argument");
        // The script itself consumes argv, not an interpolated literal.
        assert!(args.iter().any(|a| a.contains("item 1 of argv")));
        assert!(args.iter().any(|a| a == "on run argv"));
    }
}
