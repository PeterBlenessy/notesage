// Commands exposed over the plugin's own IPC namespace. Kept in sync with the
// `#[tauri::command]` fns in src/lib.rs — `tauri-plugin` generates the
// permission scaffolding from this list at build time.
const COMMANDS: &[&str] = &["ping"];

fn main() {
    tauri_plugin::Builder::new(COMMANDS)
        .ios_path("ios")
        .build();
}
