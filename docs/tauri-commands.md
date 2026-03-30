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

### run_in_terminal

Opens Terminal.app (macOS) and runs a command. Used for agent authentication flows where the CLI needs interactive terminal access (e.g., Gemini CLI Google OAuth).

```rust
#[tauri::command]
async fn run_in_terminal(command: String) -> Result<(), String>
```

**Parameters:**

- `command`: Shell command to execute in Terminal.app

**Returns:**

- `Ok(())`: Terminal opened successfully
- `Err(String)`: Error message (only supported on macOS)

**Frontend usage:**

```typescript
await invoke('run_in_terminal', { command: 'cd /tmp && gemini' });
```

### copilot_lsp_finish_auth

Executes the stashed `finishDeviceFlow` command from the Copilot LSP sign-in response. Called by the frontend when the user clicks "Open GitHub" — this starts OAuth polling and the LSP opens the browser internally.

```rust
#[tauri::command]
async fn copilot_lsp_finish_auth(
    state: State<'_, CopilotLspState>,
) -> Result<(), String>
```

**Returns:**

- `Ok(())`: Command dispatched (fire-and-forget, polls GitHub in background)
- `Err(String)`: LSP not running

**Frontend usage:**

```typescript
// User clicks "Open GitHub" after seeing the device code
await invoke('copilot_lsp_finish_auth');
window.open('https://github.com/login/device', '_blank');
```

## Credential Operations

Located in `src-tauri/src/commands/credentials.rs`

API keys are stored in the OS credential manager (macOS Keychain) instead of localStorage. AI commands resolve keys from the keychain using a `connection_id` — keys never transit through Tauri IPC.

### store_credential

Stores an API key in the OS keychain.

```rust
#[tauri::command]
async fn store_credential(service: String, key: String) -> Result<(), String>
```

**Parameters:**

- `service`: Keychain service identifier (e.g., `"notesage:conn-abc123"`)
- `key`: The API key to store

### get_credential

Retrieves an API key from the OS keychain.

```rust
#[tauri::command]
async fn get_credential(service: String) -> Result<Option<String>, String>
```

**Parameters:**

- `service`: Keychain service identifier

**Returns:**

- `Ok(Some(String))`: The stored key
- `Ok(None)`: No entry found for this service
- `Err(String)`: Keychain access error

### delete_credential

Removes an API key from the OS keychain.

```rust
#[tauri::command]
async fn delete_credential(service: String) -> Result<(), String>
```

### migrate_credentials

One-time migration: parses the raw `notesage-connections` localStorage JSON, extracts plaintext API keys, and stores them in the keychain. Called automatically on first launch after upgrade.

```rust
#[tauri::command]
async fn migrate_credentials(connections_json: String) -> Result<u32, String>
```

**Parameters:**

- `connections_json`: Raw value of `localStorage.getItem('notesage-connections')`

**Returns:**

- `Ok(u32)`: Number of credentials migrated
- `Err(String)`: Error if migration fails

**Frontend usage:**

```typescript
// Credentials are managed automatically by connections-store:
// - addConnection() stores the key in keychain and strips it from localStorage
// - removeConnection() deletes the keychain entry
// - On rehydration, existing plaintext keys are migrated to keychain

// AI commands receive connectionId instead of apiKey:
await invoke('ai_chat_stream', {
  messages,
  provider: 'anthropic',
  connectionId: 'conn-abc123',  // Rust resolves key from keychain
  // ...
});
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

Streaming multi-turn chat with an AI provider. Emits events: `ai-stream-chunk` (text delta), `ai-stream-thinking-chunk` (thinking/reasoning delta), `ai-stream-done` (completion), `ai-tool-call` (tool call request), `ai-tool-use` (tool status), `ai-citation` (web search citations).

```rust
#[tauri::command]
pub async fn ai_chat_stream(
    window: tauri::Window,
    messages: Vec<ChatMessage>,
    provider: String,
    api_key: Option<String>,
    ollama_url: Option<String>,
    web_search_enabled: Option<bool>,
    tools: Option<Vec<ToolDefinition>>,
) -> Result<(), String>
```

**Parameters:**

- `window`: Tauri window handle (injected automatically)
- `messages`: Array of ChatMessage structs
- `provider`: "anthropic", "openai", or "ollama"
- `api_key`: API key for Anthropic/OpenAI (None for Ollama)
- `ollama_url`: Ollama server URL (None for Anthropic/OpenAI)
- `web_search_enabled`: Enable server-side web search (Anthropic/OpenAI only, ignored for Ollama)
- `tools`: Optional array of tool definitions for client-side tool calling

**Returns:**

- `Ok(())`: Stream completed successfully (content delivered via events)
- `Err(String)`: Error message if streaming fails

**Events emitted:**

- `ai-stream-chunk` (String): Text delta to append
- `ai-stream-thinking-chunk` (String): Thinking/reasoning delta (for Ollama thinking models). Emitted when the model produces reasoning traces — either via native `message.thinking` field (`think: true`) or via tag-based parsing (`<think>...</think>` and similar tags detected from the model template at runtime)
- `ai-stream-done` (()): Stream completed
- `ai-tool-call` ({ id: string, name: string, arguments: object }): Model requests a tool call — frontend handles execution and continuation
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
    pub role: String,                       // "user" | "assistant" | "system" | "tool"
    pub content: String,
    pub tool_calls: Option<Vec<ToolCall>>,  // For assistant messages with tool use
    pub tool_call_id: Option<String>,       // For tool result messages (role: "tool")
}
```

### ToolDefinition Struct

```rust
#[derive(Serialize, Deserialize)]
pub struct ToolDefinition {
    pub name: String,
    pub description: String,
    pub input_schema: serde_json::Value,
}
```

### ToolCall Struct

```rust
#[derive(Serialize, Deserialize)]
pub struct ToolCall {
    pub id: String,
    pub name: String,
    pub arguments: serde_json::Value,
}
```

## Web Search Operations

Located in `src-tauri/src/commands/ai.rs`

### web_search

Searches the web using DuckDuckGo's HTML endpoint. No API key required. Used by the client-side `web_search` tool during AI tool calling.

```rust
#[tauri::command]
pub async fn web_search(
    query: String,
    max_results: Option<usize>,
) -> Result<Vec<SearchResult>, String>
```

**Parameters:**

- `query`: Search query string
- `max_results`: Maximum number of results to return (default: 5)

**Returns:**

- `Ok(Vec<SearchResult>)`: Array of search results
- `Err(String)`: Error message if search fails

**SearchResult struct:**

```rust
#[derive(Serialize, Deserialize)]
pub struct SearchResult {
    pub title: String,
    pub url: String,
    pub snippet: String,
}
```

**Frontend usage:**

```typescript
const results = await invoke<SearchResult[]>('web_search', {
  query: 'rust async programming',
  maxResults: 5,
});
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

### render_html

Renders markdown to a complete HTML document or body-only fragment.

```rust
#[tauri::command]
pub async fn render_html(
    markdown: String,
    title: String,
    theme: String,
    include_styles: bool,
    project_root: Option<String>,
) -> Result<String, String>
```

**Parameters:**

- `markdown`: Full markdown content (including frontmatter if present)
- `title`: Document title (used in `<title>` tag)
- `theme`: `"light"` or `"dark"` — controls syntax highlighting theme and CSS
- `include_styles`: `true` for standalone HTML document, `false` for clipboard body fragment
- `project_root`: Optional project root path for resolving drawing SVG sidecar files

**Returns:**

- `Ok(String)`: Complete HTML document (when `include_styles` is true) or body fragment (when false)
- `Err(String)`: Error message if rendering fails

**Pipeline:** markdown → pre-process (extract table metadata, resolve drawings) → comrak parse (GFM + syntect highlighting) → post-process (callouts, link previews, sparklines, table footers) → wrap in HTML document with embedded CSS.

**Frontend usage:**

```typescript
// Full standalone document
const htmlDoc = await invoke<string>('render_html', {
  markdown: '# Hello\n\nWorld',
  title: 'Hello',
  theme: 'light',
  includeStyles: true,
  projectRoot: null,
});

// Body fragment for clipboard
const bodyHtml = await invoke<string>('render_html', {
  markdown: '# Hello',
  title: 'Hello',
  theme: 'light',
  includeStyles: false,
  projectRoot: null,
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

## Research Operations

Located in `src-tauri/src/commands/file.rs`

### search_research

Searches research files (.md) in given directories by parsing YAML frontmatter and matching against query/tag filters. Designed for real-time command palette filtering.

```rust
#[tauri::command]
pub async fn search_research(
    dirs: Vec<String>,
    query: Option<String>,
    tag: Option<String>,
    limit: Option<usize>,
) -> Result<Vec<ResearchSearchResult>, String>
```

**Parameters:**

- `dirs`: Array of directory paths to search (e.g., project `.notesage/research/` paths)
- `query`: Optional case-insensitive substring to match against title, body, source URL, and tags
- `tag`: Optional exact tag match (case-insensitive) against the tags array
- `limit`: Maximum results to return (default 50)

**Returns:**

- `Ok(Vec<ResearchSearchResult>)`: Matched files sorted by relevance descending
- `Err(String)`: Error message

**ResearchSearchResult struct:**

```rust
#[derive(Serialize, Deserialize, Clone)]
pub struct ResearchSearchResult {
    pub file: String,
    pub title: String,
    pub tags: Vec<String>,
    pub source_url: String,
    pub snippet: String,
    pub relevance: f32,
    pub date_saved: String,
    pub word_count: usize,
}
```

**Relevance scoring:**

- Title match: 1.0
- Tag match: 0.8
- URL match: 0.6
- Body match: 0.5

**Frontend usage:**

```typescript
const results = await tauriApi.searchResearch(
  ['/path/to/project/.notesage/research', '/Users/me/Notesage/.notesage/research'],
  'climate policy',  // query
  'climate',         // tag
  20                 // limit
);
```

## Voice Transcription Operations

Located in `src-tauri/src/commands/transcription.rs`

### start_recording

Starts audio capture from the specified source. Spawns a dedicated recording thread (cpal `Stream` is `!Send`). Audio is captured at the device's native sample rate and channel count.

```rust
#[tauri::command]
pub async fn start_recording(
    app: AppHandle,
    state: State<'_, TranscriptionState>,
    source: String,
) -> Result<(), String>
```

**Parameters:**

- `source`: Audio source — `"microphone"` (only supported value currently)

**Returns:**

- `Ok(())`: Recording started
- `Err(String)`: Error if already recording or device unavailable

### stop_recording

Stops audio capture, resamples the buffer to 16kHz mono, and returns metadata about the recording.

```rust
#[tauri::command]
pub async fn stop_recording(
    state: State<'_, TranscriptionState>,
) -> Result<AudioBufferInfo, String>
```

**Returns:**

- `Ok(AudioBufferInfo)`: Recording metadata (duration, sample count, sample rate, source)
- `Err(String)`: Error if not currently recording

**AudioBufferInfo struct:**

```rust
pub struct AudioBufferInfo {
    pub duration_secs: f64,
    pub sample_count: usize,
    pub sample_rate: u32,
    pub source: String,
}
```

### transcribe

Runs Whisper transcription on the last recorded audio buffer. Emits `transcription-progress` events during processing.

```rust
#[tauri::command]
pub async fn transcribe(
    app: AppHandle,
    state: State<'_, TranscriptionState>,
    model: String,
    language: Option<String>,
) -> Result<TranscriptionResult, String>
```

**Parameters:**

- `model`: Whisper model size — `"tiny"`, `"base"`, `"small"`, `"medium"`, or `"large-v3"`
- `language`: Optional language code (e.g., `"en"`, `"sv"`, `"fr"`). `None` for auto-detection.

**Returns:**

- `Ok(TranscriptionResult)`: Segments with timestamps, duration, and detected language
- `Err(String)`: Error if no audio buffer or model not found

**Events emitted:**

- `transcription-progress` (`{ percent: number, segment?: string }`): Progress updates during transcription

**TranscriptionResult struct:**

```rust
pub struct TranscriptionResult {
    pub segments: Vec<TranscriptionSegment>,
    pub duration_secs: f64,
    pub language: String,
}

pub struct TranscriptionSegment {
    pub start: f64,
    pub end: f64,
    pub text: String,
    pub speaker: Option<String>,
}
```

### start_dictation

Starts live dictation — captures audio in ~3-second chunks, transcribes each chunk through Whisper, and streams results as events. Includes silence detection, hallucination filtering, and consecutive duplicate removal.

```rust
#[tauri::command]
pub async fn start_dictation(
    app: AppHandle,
    state: State<'_, TranscriptionState>,
    language: Option<String>,
) -> Result<(), String>
```

**Parameters:**

- `language`: Optional language code for Whisper. `None` for auto-detection.

**Events emitted:**

- `dictation-result` (`{ text: string, is_final: boolean, error?: string }`): Transcribed text chunks. `is_final: true` signals dictation has ended.

### stop_dictation

Stops an active dictation session.

```rust
#[tauri::command]
pub async fn stop_dictation(
    state: State<'_, TranscriptionState>,
) -> Result<(), String>
```

### list_whisper_models

Lists all available Whisper model sizes with download status and file size.

```rust
#[tauri::command]
pub async fn list_whisper_models(
    state: State<'_, TranscriptionState>,
) -> Result<Vec<ModelInfo>, String>
```

**Returns:**

- `Ok(Vec<ModelInfo>)`: Array of model entries

**ModelInfo struct:**

```rust
pub struct ModelInfo {
    pub name: String,        // e.g., "tiny", "base", "large-v3"
    pub size_bytes: u64,     // File size on disk (0 if not downloaded)
    pub downloaded: bool,    // Whether the model file exists
    pub path: Option<String>, // Absolute path if downloaded
}
```

### download_whisper_model

Downloads a Whisper GGML model from Hugging Face. Supports concurrent downloads. Emits progress events. Can be cancelled via `cancel_model_download`.

```rust
#[tauri::command]
pub async fn download_whisper_model(
    app: AppHandle,
    state: State<'_, TranscriptionState>,
    size: String,
) -> Result<(), String>
```

**Parameters:**

- `size`: Model size — `"tiny"`, `"base"`, `"small"`, `"medium"`, or `"large-v3"`

**Events emitted:**

- `model-download-progress` (`{ model: string, percent: number }`): Download progress updates

### cancel_model_download

Cancels an in-progress model download.

```rust
#[tauri::command]
pub async fn cancel_model_download(
    state: State<'_, TranscriptionState>,
    size: String,
) -> Result<(), String>
```

**Parameters:**

- `size`: Model size to cancel

### delete_whisper_model

Deletes a downloaded Whisper model file from disk.

```rust
#[tauri::command]
pub async fn delete_whisper_model(
    state: State<'_, TranscriptionState>,
    size: String,
) -> Result<(), String>
```

**Parameters:**

- `size`: Model size to delete

**Frontend usage:**

```typescript
// List available models
const models = await tauriApi.listWhisperModels();

// Download a model (fire-and-forget — progress via events)
await tauriApi.downloadWhisperModel('small');

// Listen for download progress
listen<{ model: string; percent: number }>('model-download-progress', (event) => {
  console.log(`${event.payload.model}: ${event.payload.percent}%`);
});

// Cancel a download
await tauriApi.cancelModelDownload('small');

// Record and transcribe
await tauriApi.startRecording('microphone');
// ... user speaks ...
const info = await tauriApi.stopRecording();
const result = await tauriApi.transcribe('small', 'en');

// Live dictation
await tauriApi.startDictation('en');
listen<{ text: string; is_final: boolean }>('dictation-result', (event) => {
  if (event.payload.text) insertText(event.payload.text);
});
await tauriApi.stopDictation();
```

### TranscriptionState (Managed State)

```rust
pub struct TranscriptionState {
    models_dir: PathBuf,
    recording: Mutex<Option<RecordingHandle>>,
    last_recording_buffer: Mutex<Option<(Vec<f32>, String, u32)>>,
    dictation_cancel: Mutex<Option<Arc<AtomicBool>>>,
    download_cancels: Mutex<HashMap<String, Arc<AtomicBool>>>,
}
```

**Fields:**

- `models_dir`: Path to `~/.notesage/whisper-models/`
- `recording`: Active recording handle (stop signal, buffer, thread)
- `last_recording_buffer`: Audio data from last recording (samples, source, sample rate)
- `dictation_cancel`: Cancel signal for active dictation session
- `download_cancels`: Per-model cancel signals for concurrent downloads

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
- **API keys in OS keychain**: Keys stored in macOS Keychain via `keyring` crate, never in localStorage. Backend resolves keys from keychain using `connection_id` — keys never transit through IPC or appear in frontend console
- **No direct filesystem access**: Frontend cannot read/write files directly, must use Tauri commands
- **Permission boundaries**: Tauri enforces filesystem permissions, commands cannot access files outside allowed directories

## IPC Performance

- Commands are async and non-blocking
- Large file operations (&gt;1MB) may take time - show loading indicators in UI
- Consider debouncing rapid file operations (e.g., auto-save)
- Use batch operations where possible (e.g., read multiple files in one call)