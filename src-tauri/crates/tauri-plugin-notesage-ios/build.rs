// No IPC commands of its own: the app crate's `ios_*` commands call this
// plugin's Rust API directly, so the frontend surface stays exactly as it was
// and no permission scaffolding is needed for a second command namespace.
const COMMANDS: &[&str] = &[];

fn main() {
    tauri_plugin::Builder::new(COMMANDS).ios_path("ios").build();
}
