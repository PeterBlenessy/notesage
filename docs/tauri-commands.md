# Tauri Commands

All frontend-to-backend communication uses Tauri IPC commands. These are defined in `src-tauri/src/commands/` and invoked from the frontend via `@tauri-apps/api/core`.

## File Operations

Located in `src-tauri/src/commands/file.rs`

### read_file

Reads a file from the filesystem.

```rust
#[tauri::command]
async fn read_file(path: String) -> Result<String, String>
```

**Parameters:**

- `path`: Absolute path to the file

**Returns:**

- `Ok(String)`: File contents as UTF-8 string
- `Err(String)`: Error message if file cannot be read

**Frontend usage:**

```typescript
import { invoke } from '@tauri-apps/api/core';

const content = await invoke<string>('read_file', { path: '/path/to/file.md' });
```

### write_file

Writes content to a file.

```rust
#[tauri::command]
async fn write_file(path: String, content: String) -> Result<(), String>
```

**Parameters:**

- `path`: Absolute path to the file
- `content`: File contents to write

**Returns:**

- `Ok(())`: Success
- `Err(String)`: Error message if file cannot be written

**Frontend usage:**

```typescript
await invoke('write_file', { path: '/path/to/file.md', content: '# Hello' });
```

### list_directory

Lists all files and folders in a directory, recursively.

```rust
#[tauri::command]
async fn list_directory(path: String) -> Result<Vec<FileEntry>, String>
```

**Parameters:**

- `path`: Absolute path to the directory

**Returns:**

- `Ok(Vec<FileEntry>)`: Array of file entries with nested children
- `Err(String)`: Error message if directory cannot be read

**Frontend usage:**

```typescript
const entries = await invoke<FileEntry[]>('list_directory', { path: '/path/to/project' });
```

### create_file

Creates a new empty file.

```rust
#[tauri::command]
async fn create_file(path: String) -> Result<(), String>
```

**Parameters:**

- `path`: Absolute path to the new file

**Returns:**

- `Ok(())`: Success
- `Err(String)`: Error message if file cannot be created

### create_directory

Creates a new directory.

```rust
#[tauri::command]
async fn create_directory(path: String) -> Result<(), String>
```

**Parameters:**

- `path`: Absolute path to the new directory

**Returns:**

- `Ok(())`: Success
- `Err(String)`: Error message if directory cannot be created

### rename_path

Renames a file or directory.

```rust
#[tauri::command]
async fn rename_path(old_path: String, new_path: String) -> Result<(), String>
```

**Parameters:**

- `old_path`: Current absolute path
- `new_path`: New absolute path

**Returns:**

- `Ok(())`: Success
- `Err(String)`: Error message if path cannot be renamed

### copy_directory

Recursively copies a directory and all its contents to a new location. Works across filesystem boundaries (unlike `rename_path` which may fail for cross-device moves).

```rust
#[tauri::command]
async fn copy_directory(source: String, destination: String) -> Result<(), String>
```

**Parameters:**

- `source`: Absolute path to the source directory
- `destination`: Absolute path to the destination directory (must not exist)

**Returns:**

- `Ok(())`: Success
- `Err(String)`: Error message if copy fails

**Frontend usage:**

```typescript
await invoke('copy_directory', { source: '/path/to/skill', destination: '/new/path/to/skill' });
```

### delete_path

Deletes a file or directory.

```rust
#[tauri::command]
async fn delete_path(path: String) -> Result<(), String>
```

**Parameters:**

- `path`: Absolute path to delete

**Returns:**

- `Ok(())`: Success
- `Err(String)`: Error message if path cannot be deleted

**Warning:** This is a permanent deletion. Frontend should show confirmation dialog.

### path_exists

Checks if a path exists.

```rust
#[tauri::command]
async fn path_exists(path: String) -> Result<bool, String>
```

**Parameters:**

- `path`: Absolute path to check

**Returns:**

- `Ok(true)`: Path exists
- `Ok(false)`: Path does not exist
- `Err(String)`: Error message if check fails

## FileEntry Struct

Used by `list_directory` to represent the file tree structure.

```rust
#[derive(Serialize, Deserialize)]
pub struct FileEntry {
    pub name: String,
    pub path: String,
    pub is_directory: bool,
    pub children: Option<Vec<FileEntry>>,
}
```

**Fields:**

- `name`: Filename or directory name (not full path)
- `path`: Absolute path to the file/directory
- `is_directory`: `true` if this is a directory, `false` if file
- `children`: For directories, contains nested FileEntry array. For files, this is `None`.

**TypeScript interface:**

```typescript
interface FileEntry {
  name: string;
  path: string;
  is_directory: boolean;
  children?: FileEntry[];
}
```

## Dialog Operations

Located in `src-tauri/src/commands/dialog.rs`

### open_folder_dialog

Shows native folder picker dialog.

```rust
#[tauri::command]
async fn open_folder_dialog(app: tauri::AppHandle) -> Result<Option<String>, String>
```

**Parameters:**

- `app`: Tauri AppHandle (automatically injected by Tauri)

**Returns:**

- `Ok(Some(String))`: User selected a folder, returns absolute path
- `Ok(None)`: User cancelled the dialog
- `Err(String)`: Error message if dialog fails

**Frontend usage:**

```typescript
const folderPath = await invoke<string | null>('open_folder_dialog');
if (folderPath) {
  // User selected a folder
}
```

## AI Operations

Located in `src-tauri/src/commands/ai.rs`

### ai_generate_text

Generates text using an AI provider.

```rust
#[tauri::command]
pub async fn ai_generate_text(request: AIRequest) -> Result<String, String>
```

**Parameters:**

- `request`: AIRequest struct (see below)

**Returns:**

- `Ok(String)`: Generated text from AI
- `Err(String)`: Error message if generation fails

### ai_chat

Multi-turn chat with an AI provider (non-streaming).

```rust
#[tauri::command]
pub async fn ai_chat(
    messages: Vec<ChatMessage>,
    provider: String,
    api_key: Option<String>,
    ollama_url: Option<String>,
) -> Result<String, String>
```

**Parameters:**

- `messages`: Array of ChatMessage structs
- `provider`: "anthropic", "openai", or "ollama"
- `api_key`: API key for Anthropic/OpenAI (None for Ollama)
- `ollama_url`: Ollama server URL (None for Anthropic/OpenAI)

**Returns:**

- `Ok(String)`: AI response message
- `Err(String)`: Error message if chat fails

### ai_chat_stream

Streaming multi-turn chat with an AI provider. Emits events: `ai-stream-chunk` (text delta), `ai-stream-thinking-chunk` (thinking/reasoning delta), `ai-stream-done` (completion), `ai-tool-use` (tool status), `ai-citation` (web search citations).

```rust
#[tauri::command]
pub async fn ai_chat_stream(
    window: tauri::Window,
    messages: Vec<ChatMessage>,
    provider: String,
    api_key: Option<String>,
    ollama_url: Option<String>,
    web_search_enabled: Option<bool>,
) -> Result<(), String>
```

**Parameters:**

- `window`: Tauri window handle (injected automatically)
- `messages`: Array of ChatMessage structs
- `provider`: "anthropic", "openai", or "ollama"
- `api_key`: API key for Anthropic/OpenAI (None for Ollama)
- `ollama_url`: Ollama server URL (None for Anthropic/OpenAI)
- `web_search_enabled`: Enable server-side web search (Anthropic/OpenAI only, ignored for Ollama)

**Returns:**

- `Ok(())`: Stream completed successfully (content delivered via events)
- `Err(String)`: Error message if streaming fails

**Events emitted:**

- `ai-stream-chunk` (String): Text delta to append
- `ai-stream-thinking-chunk` (String): Thinking/reasoning delta (for Ollama thinking models). Emitted when the model produces reasoning traces — either via native `message.thinking` field (`think: true`) or via tag-based parsing (`<think>...</think>` and similar tags detected from the model template at runtime)
- `ai-stream-done` (()): Stream completed
- `ai-tool-use` ({ tool: string, status: string }): Tool usage (e.g., web_search started)
- `ai-citation` ({ url: string, title: string, cited_text: string }): Citation from web search

**Ollama thinking model detection:**

Before streaming, the Ollama backend calls `/api/show` to detect thinking support at runtime:
1. If the model's capabilities include `"thinking"` → sends `think: true`, uses native `message.thinking` field
2. If the model template contains `{{.Thinking}}` → extracts opening/closing tags from template text
3. If the model name/family contains reasoning indicators (e.g., `reason`, `think`, `deepseek-r1`) → uses `<think>...</think>` as fallback
4. Otherwise → no tag parsing, all content emitted as `ai-stream-chunk`

This avoids hardcoding model-specific tag patterns and follows the same detection strategy as Ollama itself (`thinking/template.go` → `InferTags()`).

### AIRequest Struct

```rust
#[derive(Serialize, Deserialize)]
pub struct AIRequest {
    pub provider: String,        // "anthropic" | "openai" | "ollama"
    pub prompt: String,
    pub api_key: Option<String>, // For Anthropic/OpenAI
    pub ollama_url: Option<String>, // For Ollama
    pub stream: bool,
}
```

### ChatMessage Struct

```rust
#[derive(Serialize, Deserialize)]
pub struct ChatMessage {
    pub role: String,    // "user" | "assistant" | "system"
    pub content: String,
}
```

## Export Operations

Located in `src-tauri/src/commands/export.rs`

### export_pdf

Converts markdown to a styled PDF using the embedded Typst typesetting engine.

```rust
#[tauri::command]
pub async fn export_pdf(
    markdown: String,
    title: String,
    template: String,
    include_toc: bool,
    include_page_numbers: bool,
    page_size: String,
) -> Result<Vec<u8>, String>
```

**Parameters:**

- `markdown`: Full markdown content (including frontmatter if present)
- `title`: Document title (used in headers/footers and title pages)
- `template`: Template preset — `"clean"`, `"academic"`, or `"report"`
- `include_toc`: Whether to generate a table of contents
- `include_page_numbers`: Whether to show page numbers
- `page_size`: Page dimensions — `"a4"`, `"letter"`, or `"a5"`

**Returns:**

- `Ok(Vec<u8>)`: PDF file as raw bytes
- `Err(String)`: Error message if compilation fails

**Pipeline:** markdown → `markdown_to_typst()` → Typst markup → `apply_template()` → Typst compiler (`NotesageWorld`) → `typst_pdf::pdf()` → PDF bytes.

**Frontend usage:**

```typescript
const pdfBytes = await invoke<number[]>('export_pdf', {
  markdown: '# Hello\n\nWorld',
  title: 'Hello',
  template: 'clean',
  includeToc: false,
  includePageNumbers: false,
  pageSize: 'a4',
});
```

### save_binary_file

Writes raw bytes to a file on disk. Used for saving generated PDFs (the existing `write_file` command only handles UTF-8 strings).

```rust
#[tauri::command]
pub async fn save_binary_file(path: String, data: Vec<u8>) -> Result<(), String>
```

**Parameters:**

- `path`: Absolute path to the output file
- `data`: File contents as raw bytes

**Returns:**

- `Ok(())`: Success
- `Err(String)`: Error message if file cannot be written

**Frontend usage:**

```typescript
await invoke('save_binary_file', { path: '/path/to/output.pdf', data: pdfBytes });
```

## Filesystem Watcher Operations

Located in `src-tauri/src/commands/watcher.rs`

### watch_directory

Starts recursive filesystem watching on a directory. Can be called multiple times to watch additional directories. A single debounced watcher instance is shared across all watched paths.

```rust
#[tauri::command]
pub async fn watch_directory(app: AppHandle, path: String) -> Result<(), String>
```

**Parameters:**

- `app`: Tauri AppHandle (automatically injected)
- `path`: Absolute path to a directory to watch

**Returns:**

- `Ok(())`: Watching started (or already watching this path)
- `Err(String)`: Error if path is not a directory or watcher creation fails

**Events emitted:**

- `file-changed` (`{ path: String, kind: String }`): Emitted when a file is created, modified, or deleted. `kind` is one of `"create"`, `"modify"`, or `"delete"`.

**Filtering applied before emission:**

- `.git/` internals and `.DS_Store` files silently dropped
- Self-written files suppressed (see `mark_self_write`)
- Directory events skipped (except deletes)
- macOS: `modify` events for paths that no longer exist reclassified as `delete`

### unwatch_directory

Stops all filesystem watching and clears all state.

```rust
#[tauri::command]
pub async fn unwatch_directory(app: AppHandle) -> Result<(), String>
```

**Returns:**

- `Ok(())`: All watchers stopped

### mark_self_write

Marks a file path as a self-write so change events for it are suppressed for 5 seconds. Call this **before** writing a file from the frontend to prevent the watcher from emitting a false external change event.

```rust
#[tauri::command]
pub async fn mark_self_write(app: AppHandle, path: String) -> Result<(), String>
```

**Parameters:**

- `path`: Absolute path to the file being written

**Implementation notes:**

- Path is canonicalized for consistent comparison with `notify` event paths
- TTL is 5 seconds, covering: 500ms debounce window + macOS FSEvents re-reporting (~3s) + iCloud sync latency
- Expired entries are pruned on each `is_self_write` check

### clear_self_write

Removes a file path from the self-write filter. Call this if a write was cancelled or failed.

```rust
#[tauri::command]
pub async fn clear_self_write(app: AppHandle, path: String) -> Result<(), String>
```

### WatcherState (Managed State)

```rust
pub struct WatcherState {
    watcher: Mutex<Option<Debouncer<RecommendedWatcher, FileIdMap>>>,
    watched_paths: Mutex<HashSet<PathBuf>>,
    self_writes: Mutex<HashMap<PathBuf, Instant>>,
}
```

**Fields:**

- `watcher`: Single debounced watcher instance (lazy-initialized on first `watch_directory` call)
- `watched_paths`: Set of directories currently being watched (prevents duplicate watches)
- `self_writes`: Map of recently-written file paths → timestamp (for self-write suppression)

**Frontend usage:**

```typescript
// Start watching when a project or explorer folder is opened
await invoke('watch_directory', { path: '/path/to/project' });

// Before saving a file, mark it as self-write
await invoke('mark_self_write', { path: '/path/to/file.md' });
await invoke('write_file', { path: '/path/to/file.md', content });

// Listen for external changes
listen<{ path: string; kind: string }>('file-changed', (event) => {
  const { path, kind } = event.payload;
  // Handle create/modify/delete...
});
```

## Error Handling

All Tauri commands return `Result<T, String>`. The frontend should:

1. Wrap calls in try/catch
2. Display error messages to the user via toast notifications (use `sonner`)
3. Log errors to console for debugging

**Example:**

```typescript
try {
  await invoke('write_file', { path, content });
  toast.success('File saved');
} catch (error) {
  toast.error(`Failed to save file: ${error}`);
  console.error('Save error:', error);
}
```

## Security Considerations

- **All file paths are absolute**: Frontend must never construct paths from user input without validation
- **API keys handled securely**: All AI API calls go through Rust backend, keys never exposed in frontend console
- **No direct filesystem access**: Frontend cannot read/write files directly, must use Tauri commands
- **Permission boundaries**: Tauri enforces filesystem permissions, commands cannot access files outside allowed directories

## IPC Performance

- Commands are async and non-blocking
- Large file operations (&gt;1MB) may take time - show loading indicators in UI
- Consider debouncing rapid file operations (e.g., auto-save)
- Use batch operations where possible (e.g., read multiple files in one call)