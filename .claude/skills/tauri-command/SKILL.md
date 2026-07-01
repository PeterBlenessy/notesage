---
name: tauri-command
description: Use when adding new Tauri IPC commands (Rust backend functions callable from the frontend), modifying existing commands, or working with Tauri plugins.
---

# Tauri Command Development

## Command Structure

All Tauri commands follow this pattern:

```rust
#[tauri::command]
pub async fn command_name(param: String) -> Result<ReturnType, String> {
    // Implementation
    Ok(result)
}
```

### Key Requirements

1. **`#[tauri::command]` attribute** - Required for IPC exposure
2. **Async functions** - Use `async fn` for I/O operations
3. **Result<T, String>** - Always return Result with String errors
4. **Serialization** - All types must derive `Serialize` (and `Deserialize` if input)

## File Location

Commands are organized by domain:

```
src-tauri/src/commands/
├── mod.rs          # Module exports
├── file.rs         # File operations (read, write, list, etc.)
├── dialog.rs       # Native dialogs (open folder, save file)
├── ai.rs           # AI provider operations
└── new_domain.rs   # Your new command domain
```

### File Structure

```rust
// src-tauri/src/commands/file.rs
use serde::{Deserialize, Serialize};
use std::path::Path;

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct FileEntry {
    pub name: String,
    pub path: String,
    pub is_directory: bool,
    pub children: Option<Vec<FileEntry>>,
    pub hidden: bool, // true when name starts with '.' — used for dimmed styling
}

#[tauri::command]
pub async fn read_file(path: String) -> Result<String, String> {
    std::fs::read_to_string(&path)
        .map_err(|e| format!("Failed to read file {}: {}", path, e))
}

#[tauri::command]
pub async fn write_file(path: String, content: String) -> Result<(), String> {
    std::fs::write(&path, content)
        .map_err(|e| format!("Failed to write file {}: {}", path, e))
}
```

### Module Export

```rust
// src-tauri/src/commands/mod.rs
pub mod file;
pub mod dialog;
pub mod ai;

// Re-export all commands
pub use file::*;
pub use dialog::*;
pub use ai::*;
```

## Registration

Commands must be registered in `src-tauri/src/lib.rs`. The real builder
registers many plugins (`opener`, `fs`, `dialog`, `window-state`, `updater`,
`process`, `http`, `notification`, `autostart`, `log`), manages a large set of
state structs (`WatcherState`, `AcpState`, `CopilotLspState`, `McpState`,
`IndexState`, …), and lists ~150 commands in a single `generate_handler!`.
The sketch below is **illustrative only** — read `src-tauri/src/lib.rs` for the
authoritative list before adding a command.

```rust
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init());
        // ...many more plugins (see lib.rs)

    builder
        .manage(WatcherState::new())
        // ...many more .manage(...) state structs (see lib.rs)
        .invoke_handler(tauri::generate_handler![
            // commands are imported via `use commands::*;` so they appear
            // unqualified (NOT `commands::read_file`)
            read_file,
            write_file,
            list_directory,
            open_folder_dialog,
            // ...add your new command here
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

## Frontend Calling Pattern

### Typed Wrappers (Recommended)

`src/lib/tauri.ts` exposes a single `tauriApi` object — add your wrapper as a
method on it, NOT as a free-standing `export async function`. Interfaces that
mirror Rust structs live at the top of the same file.

```typescript
import { invoke } from '@tauri-apps/api/core';

export interface FileEntry {
  name: string;
  path: string;
  is_directory: boolean;
  children?: FileEntry[];
  hidden: boolean;
}

export const tauriApi = {
  async readFile(path: string): Promise<string> {
    return await invoke<string>('read_file', { path });
  },

  async writeFile(path: string, content: string): Promise<void> {
    await invoke('write_file', { path, content });
  },

  // optional camelCase args are forwarded as-is; Tauri maps them to the
  // command's snake_case params (showHidden → show_hidden)
  async listDirectory(path: string, showHidden?: boolean): Promise<FileEntry[]> {
    return await invoke<FileEntry[]>('list_directory', { path, showHidden });
  },
  // ...add your new wrapper method here
};
```

Call sites use `tauriApi.readFile(path)`, etc.

### Direct Usage

```typescript
import { invoke } from '@tauri-apps/api/core';

try {
  const content = await invoke<string>('read_file', { path: '/path/to/file.md' });
  console.log(content);
} catch (error) {
  console.error('Failed to read file:', error);
}
```

## Error Handling

### Backend (Rust)

Map all errors to String with context:

```rust
#[tauri::command]
pub async fn risky_operation(path: String) -> Result<Data, String> {
    let file = std::fs::read(&path)
        .map_err(|e| format!("Failed to read {}: {}", path, e))?;

    let data = parse_data(&file)
        .map_err(|e| format!("Failed to parse {}: {}", path, e))?;

    Ok(data)
}
```

### Frontend (TypeScript)

Show toast notifications for user-facing errors:

```typescript
import { toast } from 'sonner';

try {
  await writeFile(path, content);
  toast.success('File saved');
} catch (error) {
  toast.error(`Failed to save file: ${error}`);
  console.error('Save error:', error);
}
```

## Serialization with Serde

All types crossing the IPC boundary must derive Serialize/Deserialize:

```rust
use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct ChatMessage {
    pub role: String,    // "user" | "assistant" | "system"
    pub content: String,
}

#[derive(Serialize, Deserialize)]
pub struct AIRequest {
    pub provider: String,
    pub prompt: String,
    pub api_key: Option<String>,
    pub ollama_url: Option<String>,
    pub stream: bool,
}

#[tauri::command]
pub async fn ai_chat(
    messages: Vec<ChatMessage>,
    provider: String,
    api_key: Option<String>,
) -> Result<String, String> {
    // Implementation
}
```

### TypeScript Types

Mirror Rust types in TypeScript:

```typescript
export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface AIRequest {
  provider: string;
  prompt: string;
  api_key?: string;
  ollama_url?: string;
  stream: boolean;
}
```

## Common Patterns

### File Operations

```rust
use std::fs;
use std::path::Path;

#[tauri::command]
pub async fn file_exists(path: String) -> Result<bool, String> {
    Ok(Path::new(&path).exists())
}

#[tauri::command]
pub async fn delete_file(path: String) -> Result<(), String> {
    fs::remove_file(&path)
        .map_err(|e| format!("Failed to delete {}: {}", path, e))
}
```

### AppHandle for Dialogs

`blocking_pick_folder()` (and `blocking_pick_file()`) return an `Option<FilePath>`
directly — NOT a `Result`. There is no error to `?` or `map_err`; `None` means
the user cancelled. The real `dialog.rs` matches on the `Option`:

```rust
#[tauri::command]
pub async fn open_folder_dialog(app: tauri::AppHandle) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;

    let folder = app.dialog().file().blocking_pick_folder();

    match folder {
        Some(path) => Ok(Some(path.to_string())),
        None => Ok(None),
    }
}
```

## Credentials — Keychain Pattern (load-bearing)

API keys are **never passed across IPC and never stored in localStorage.** They
live in the OS keychain (macOS Keychain via the `keyring` crate). AI commands
take a `connection_id` and resolve the key from the keychain inside Rust — the
key never transits the IPC boundary or appears in the frontend console.

```rust
// AI commands receive connectionId, NOT apiKey:
#[tauri::command]
pub async fn ai_chat_stream(/* ... */ connection_id: Option<String> /* ... */) {
    // backend resolves the key from the keychain using connection_id
}
```

The credential commands live in `src-tauri/src/commands/credentials.rs`
(`store_credential`, `get_credential`, `delete_credential`, `migrate_credentials`).
When you add a command that needs a provider key, take `connection_id` and
resolve via the keychain — do NOT add an `api_key: String` parameter.

## Security Considerations

1. **Validate inputs** — never trust frontend data; paths must be absolute
2. **Filesystem boundaries** — Seatbelt sandbox enforces writable paths per
   connection; see `src-tauri/src/commands/sandbox.rs` and the Security Model
   in `CLAUDE.md`
3. **No `fs:allow-*` capabilities** — the renderer never imports
   `@tauri-apps/plugin-fs`; all file I/O goes through vetted Rust commands
4. **Credentials** — keychain only, resolved by `connection_id` (see above)
5. **Error messages** — don't leak sensitive info

## Reference

Read `docs/tauri-commands.md` for:
- All current command signatures
- FileEntry struct definition
- Complete IPC patterns
- Frontend usage examples
- Error handling strategies

And `src-tauri/src/lib.rs` for the authoritative plugin / state / command list.
