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

#[derive(Serialize, Deserialize)]
pub struct FileEntry {
    pub name: String,
    pub path: String,
    pub is_directory: bool,
    pub children: Option<Vec<FileEntry>>,
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

Commands must be registered in `src-tauri/src/lib.rs`:

```rust
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            // File operations
            commands::read_file,
            commands::write_file,
            commands::list_directory,
            commands::create_file,
            commands::create_directory,
            commands::rename_path,
            commands::delete_path,
            commands::path_exists,
            // Dialog operations
            commands::open_folder_dialog,
            // AI operations
            commands::ai_generate_text,
            commands::ai_chat,
            // Add your new commands here
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

## Frontend Calling Pattern

### Typed Wrappers (Recommended)

Create typed wrappers in `src/lib/tauri.ts`:

```typescript
import { invoke } from '@tauri-apps/api/core';

export interface FileEntry {
  name: string;
  path: string;
  is_directory: boolean;
  children?: FileEntry[];
}

export async function readFile(path: string): Promise<string> {
  return await invoke<string>('read_file', { path });
}

export async function writeFile(path: string, content: string): Promise<void> {
  await invoke('write_file', { path, content });
}

export async function listDirectory(path: string): Promise<FileEntry[]> {
  return await invoke<FileEntry[]>('list_directory', { path });
}
```

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

### HTTP Requests (for AI APIs)

```rust
use reqwest;

#[tauri::command]
pub async fn fetch_data(url: String) -> Result<String, String> {
    let response = reqwest::get(&url)
        .await
        .map_err(|e| format!("HTTP request failed: {}", e))?;

    let text = response.text()
        .await
        .map_err(|e| format!("Failed to read response: {}", e))?;

    Ok(text)
}
```

### AppHandle for Dialogs

```rust
#[tauri::command]
pub async fn open_folder_dialog(app: tauri::AppHandle) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;

    let folder = app.dialog()
        .file()
        .pick_folder()
        .map_err(|e| format!("Dialog failed: {}", e))?;

    Ok(folder.map(|p| p.to_string_lossy().to_string()))
}
```

## Dependencies

Add to `Cargo.toml` as needed:

```toml
[dependencies]
serde = { version = "1.0", features = ["derive"] }
serde_json = "1.0"
reqwest = { version = "0.12", features = ["json"] }  # For HTTP
tokio = { version = "1", features = ["full"] }       # For async
tauri-plugin-dialog = "2.0"                          # For dialogs
tauri-plugin-fs = "2.0"                               # For filesystem
```

## Security Considerations

1. **Validate inputs** - Never trust frontend data
2. **Check paths** - Prevent directory traversal attacks
3. **API keys** - Keep in backend, never log
4. **Permissions** - Use Tauri's capability system
5. **Error messages** - Don't leak sensitive info

### Example: Path Validation

```rust
#[tauri::command]
pub async fn read_file(path: String) -> Result<String, String> {
    // Validate path is absolute
    if !Path::new(&path).is_absolute() {
        return Err("Path must be absolute".to_string());
    }

    // Check file exists
    if !Path::new(&path).exists() {
        return Err(format!("File not found: {}", path));
    }

    // Read file
    std::fs::read_to_string(&path)
        .map_err(|e| format!("Failed to read file: {}", e))
}
```

## Performance Tips

1. **Use async for I/O** - Don't block the main thread
2. **Batch operations** - Combine multiple file reads
3. **Stream large data** - Don't load huge files into memory
4. **Debounce rapid calls** - Frontend should debounce auto-save

### Example: Batch File Reading

```rust
#[tauri::command]
pub async fn read_files(paths: Vec<String>) -> Result<Vec<String>, String> {
    let mut results = Vec::new();

    for path in paths {
        let content = std::fs::read_to_string(&path)
            .map_err(|e| format!("Failed to read {}: {}", path, e))?;
        results.push(content);
    }

    Ok(results)
}
```

## Reference

Read @docs/tauri-commands.md for:
- All current command signatures
- FileEntry struct definition
- Complete IPC patterns
- Frontend usage examples
- Error handling strategies
