# Tauri Commands

All frontend-to-backend communication uses Tauri IPC commands. These are defined in `src-tauri/src/commands/` and invoked from the frontend via `@tauri-apps/api/core`.

> **Note:** This document covers a subset of commonly used commands. See `docs/architecture.md` for the full command module inventory.

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
async fn list_directory(path: String, show_hidden: Option<bool>) -> Result<Vec<FileEntry>, String>
```

**Parameters:**

- `path`: Absolute path to the directory
- `show_hidden`: Optional. When `true`, includes dotfiles and dot-directories. Default `false` (hides entries starting with `.`). Even when `true`, `.DS_Store` and `.git/objects|pack|logs` are always excluded.

**Returns:**

- `Ok(Vec<FileEntry>)`: Array of file entries with nested children. Hidden entries sorted after regular entries within each directory level.
- `Err(String)`: Error message if directory cannot be read

**Frontend usage:**

```typescript
const entries = await invoke<FileEntry[]>('list_directory', { path: '/path/to/project', showHidden: true });
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

### file_size

On-disk size of a file in bytes, without reading it. The recordings scanner's partial-download gate (PRD `2026-09-05-ios-recordings`): a phone bundle is transcribed only once `file_size(audio.m4a)` equals the `audio.bytes` its `recording.json` recorded at stop time.

```rust
#[tauri::command]
async fn file_size(path: String) -> Result<u64, String>
```

**Parameters:**

- `path`: Absolute path to the file

**Returns:**

- `Ok(u64)`: Size in bytes
- `Err(String)`: The path is missing (including an evicted iCloud placeholder — see `icloud_ensure_downloaded`) or is not a regular file

**Frontend usage:**

```typescript
const bytes = await tauriApi.fileSize('/path/to/Recording 2026-09-05 14-02-11/audio.m4a');
```

### get_device_name

This machine's user-facing name — `"Peter's MacBook Pro"` — the label the Mac writes into a recording manifest's `transcription.device` when it claims or finishes a transcription, so the phone can say *Transcribing on Peter's Mac…*. macOS reads the computer name from System Settings > General > About (`scutil --get ComputerName`); other platforms use the hostname without its domain suffix. Never empty.

```rust
#[tauri::command]
async fn get_device_name() -> Result<String, String>
```

**Frontend usage:**

```typescript
const device = await tauriApi.getDeviceName();
```

## FileEntry Struct

Used by `list_directory` to represent the file tree structure.

```rust
#[derive(Serialize, Deserialize)]
pub struct FileEntry {
    pub name: String,
    pub path: String,
    pub is_directory: bool,
    pub children: Option<Vec<FileEntry>>,
    pub hidden: bool,
}
```

**Fields:**

- `name`: Filename or directory name (not full path)
- `path`: Absolute path to the file/directory
- `is_directory`: `true` if this is a directory, `false` if file
- `children`: For directories, contains nested FileEntry array. For files, this is `None`.
- `hidden`: `true` if the entry name starts with `.`. Always populated regardless of `show_hidden` — used by the frontend for dimmed styling.

**TypeScript interface:**

```typescript
interface FileEntry {
  name: string;
  path: string;
  is_directory: boolean;
  children?: FileEntry[];
  hidden: boolean;
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

Opens Terminal.app (macOS) and runs a command. Used for agent authentication flows where the CLI needs interactive terminal access: Gemini CLI Google OAuth at initial registration, and the re-authentication flow (`src/lib/ai/reauth.ts → reauthenticateAgent`) which uses the same `getAuthGuide()` command that drives initial sign-in. Graceful fallback: frontend copies the command to the clipboard if the invoke rejects.

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

## Copilot LSP Conversation Operations

Located in `src-tauri/src/commands/copilot_lsp.rs`

### copilot_lsp_conversation_create

Creates a new conversation and sends the first message. Streaming response arrives via Tauri events (`copilot-chat-chunk`, `copilot-chat-thinking`, `copilot-chat-done`).

```rust
#[tauri::command]
pub async fn copilot_lsp_conversation_create(
    state: State<'_, CopilotLspState>,
    message: String,
    model: Option<String>,
    tools: Option<Vec<Value>>,
) -> Result<Value, String>
```

**Parameters:**

- `message`: First user message to send
- `model`: Optional model ID (e.g., `"gpt-4o"`, `"claude-sonnet-4"`)
- `tools`: Optional array of tool definitions to register with the conversation

**Returns:**

- `Ok(Value)`: JSON object containing `conversationId` for subsequent turns
- `Err(String)`: Error message if conversation creation fails

### copilot_lsp_conversation_turn

Sends a follow-up message in an existing conversation. Streaming response arrives via Tauri events.

```rust
#[tauri::command]
pub async fn copilot_lsp_conversation_turn(
    state: State<'_, CopilotLspState>,
    conversation_id: String,
    message: String,
    model: Option<String>,
) -> Result<(), String>
```

**Parameters:**

- `conversation_id`: ID returned from `copilot_lsp_conversation_create`
- `message`: User message to send
- `model`: Optional model ID override

### copilot_lsp_conversation_destroy

Destroys a conversation session and frees server-side resources.

```rust
#[tauri::command]
pub async fn copilot_lsp_conversation_destroy(
    state: State<'_, CopilotLspState>,
    conversation_id: String,
) -> Result<(), String>
```

### copilot_lsp_conversation_models

Lists available models for Copilot chat. Falls back to a hardcoded list if the LSP doesn't support `copilot/models`.

```rust
#[tauri::command]
pub async fn copilot_lsp_conversation_models(
    state: State<'_, CopilotLspState>,
) -> Result<Vec<CopilotModel>, String>
```

**Returns:**

- `Ok(Vec<CopilotModel>)`: Array of available models with `id`, `name`, and `provider` fields

**Events emitted during conversations:**

- `copilot-chat-chunk` (`{ text: string }`): Text delta to append
- `copilot-chat-thinking` (`{ text: string }`): Thinking/reasoning delta
- `copilot-chat-done` (`{}`): Stream completed
- `copilot-tool-call` (`{ requestId: string, id: string, name: string, arguments: object }`): LSP requests tool execution
- `copilot-tool-confirmation` (`{ requestId: string, name: string, arguments: object }`): LSP requests user approval before tool execution
- `copilot-context-request` (`{ requestId: string }`): LSP requests editor context

**Frontend usage:**

```typescript
// Create a conversation with the first message
const result = await tauriApi.copilotLspConversationCreate('Hello', 'gpt-4o', tools);
const conversationId = result.conversationId;

// Send follow-up messages
await tauriApi.copilotLspConversationTurn(conversationId, 'Tell me more', 'gpt-4o');

// Listen for streaming chunks
listen<{ text: string }>('copilot-chat-chunk', (event) => {
  appendText(event.payload.text);
});

// Clean up when done
await tauriApi.copilotLspConversationDestroy(conversationId);
```

## ACP Session Lifecycle

Located in `src-tauri/src/commands/acp.rs`. All four commands forward directly to the ACP `ClientSideConnection`; capability gating (`sessionCapabilities.{list, fork, resume, close}`) is done on the frontend — the backend is a passthrough.

### acp_session_close

Close an existing ACP session. Best-effort — agents without `session_capabilities.close` will error; the frontend swallows errors since closing is cleanup.

```rust
#[tauri::command]
pub async fn acp_session_close(
    state: State<'_, AcpState>,
    instance_id: String,
    session_id: String,
) -> Result<(), String>
```

### acp_session_list

List sessions owned by the agent. Optional `cwd` filter and pagination cursor.

```rust
#[tauri::command]
pub async fn acp_session_list(
    state: State<'_, AcpState>,
    instance_id: String,
    cwd: Option<String>,
    cursor: Option<String>,
) -> Result<AcpListResult, String>

pub struct AcpSessionInfo {
    pub session_id: String,
    pub cwd: Option<String>,
}

pub struct AcpListResult {
    pub sessions: Vec<AcpSessionInfo>,
    pub next_cursor: Option<String>,
}
```

### acp_session_resume

Resume a live agent-side session. Lightweight alternative to `session/load` when the agent still has the session in memory.

```rust
#[tauri::command]
pub async fn acp_session_resume(
    state: State<'_, AcpState>,
    instance_id: String,
    session_id: String,
    working_directory: String,
) -> Result<SessionResult, String>
```

### acp_session_fork

Fork an existing session, returning a new session ID that inherits the current agent state.

```rust
#[tauri::command]
pub async fn acp_session_fork(
    state: State<'_, AcpState>,
    instance_id: String,
    session_id: String,
    working_directory: String,
) -> Result<SessionResult, String>
```

**Frontend usage:**

```typescript
// Restoration preference chain lives in `restoreOrCreateAcpSession`:
//   resume → load → list (sanity check) → new
const session = await restoreOrCreateAcpSession({
  instanceId,
  cwd,
  storedSessionId: conv.acpSessionId,
  capabilities: acpAgent.capabilities,
});

// Fork a branch from the current leaf (only activates when the agent has fork capability)
const forked = await tauriApi.acpSessionFork(instanceId, currentSessionId, cwd);
chatStore.branchFromMessage(messageTimestamp, forked.session_id);

// Close on conversation delete (best-effort, fire-and-forget)
await tauriApi.acpSessionClose(instanceId, sessionId);
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

Streaming multi-turn chat with an AI provider. Emits events: `ai-stream-chunk` (text delta), `ai-stream-thinking-chunk` (thinking/reasoning delta), `ai-stream-image` (image content block), `ai-stream-done` (completion), `ai-tool-call` (tool call request), `ai-tool-use` (tool status), `ai-citation` (web search citations).

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
    response_format: Option<serde_json::Value>,
    stream_id: Option<String>,
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
- `response_format`: Optional OpenAI-style structured-output envelope, e.g. `{ "type": "json_schema", "json_schema": { "name": "...", "schema": {...}, "strict": true } }`. Forwarded verbatim to `local_bundled` (llama-server converts the schema to GBNF — invalid tokens get `-inf` logits, so output is guaranteed to satisfy the schema) and `openai_compatible`. Unwrapped to Ollama's bare-schema `format` field by `ollama_response_format`. Ignored for `anthropic` / `openai` (the OpenAI Responses API uses a different envelope and Anthropic has no equivalent). Not sent together with `tools` for `local_bundled`: llama-server treats them as mutually exclusive grammar sources, and the tool autoparser already constrains tool-call output via the model's Jinja template. Frontend callers should use the `generateStructured()` helper in `src/lib/ai/structured.ts` rather than building the envelope by hand.
- `stream_id`: Optional per-request correlation id. When present, every event below is emitted on the **suffixed** name `<event>:<stream_id>` (e.g. `ai-stream-chunk:6f2c…`) instead of the bare global name. Each frontend caller (`useDirectApiChat`, `generateStructured`, `useAgentTaskOperations`) generates a unique id and listens only on its own suffixed channel, so concurrent generations can't cross-contaminate the global event bus (a structured/intent call firing during a chat stream, two background agent tasks, etc.). Omitted/empty → legacy global names. Backend mirror: `stream_event(base, stream_id)` in `ai_streaming.rs`; frontend mirror: `streamEvent()` in `src/lib/ai/stream-events.ts`.

**Returns:**

- `Ok(())`: Stream completed successfully (content delivered via events)
- `Err(String)`: Error message if streaming fails

**Events emitted** (each suffixed with `:<stream_id>` when a `stream_id` is supplied — see the `stream_id` parameter above):

- `ai-stream-chunk` (String): Text delta to append
- `ai-stream-thinking-chunk` (String): Thinking/reasoning delta (for Ollama thinking models). Emitted when the model produces reasoning traces — either via native `message.thinking` field (`think: true`) or via tag-based parsing (`<think>...</think>` and similar tags detected from the model template at runtime)
- `ai-stream-image` ({ data: string, mimeType: string }): Image content block (Anthropic image blocks, OpenAI image output items)
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

### ai_chat_stream_cancel

Aborts an in-flight `ai_chat_stream` by its `stream_id`.

```rust
#[tauri::command]
pub async fn ai_chat_stream_cancel(
    stream_id: String,
    stream_state: tauri::State<'_, AiStreamState>,
) -> Result<(), String>
```

**Parameters:**

- `stream_id`: The correlation id passed to the original `ai_chat_stream` call.

**Returns:**

- `Ok(())`: Best-effort and idempotent — returns `Ok` even when the stream already finished or the id is unknown.

**Behavior:** `AiStreamState` keeps a registry of in-flight streams keyed by `stream_id`, each holding a `tokio::sync::Notify`. `ai_chat_stream` races its provider future against `notify.notified()` via `tokio::select!`; cancelling fires the notify, the select drops the streaming future, and the underlying reqwest byte-stream is dropped — closing the connection so the provider stops generating (and billing). No `ai-stream-done` is emitted on cancel (the frontend tears its listeners down itself). This replaces the previous "cancel" that only removed frontend listeners while the backend kept streaming (audit C2).

**Frontend usage:**

```typescript
// useDirectApiChat.cancelDirectChat — best-effort, fire-and-forget:
await invoke('ai_chat_stream_cancel', { streamId }).catch(() => {});
```

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

Located in `src-tauri/src/commands/web_search.rs`

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

### export_docx

Converts markdown to a styled DOCX file using the `docx-rs` crate.

```rust
#[tauri::command]
pub async fn export_docx(
    markdown: String,
    title: String,
    template: String,
    include_toc: bool,
    include_page_numbers: bool,
    page_size: String,
    project_root: Option<String>,
) -> Result<Vec<u8>, String>
```

**Parameters:**

- `markdown`: Full markdown content (including frontmatter if present)
- `title`: Document title (used in headers/footers and title pages)
- `template`: Template preset — `"clean"`, `"academic"`, or `"report"`
- `include_toc`: Whether to generate a Word TOC field
- `include_page_numbers`: Whether to show page numbers in the footer
- `page_size`: Page dimensions — `"a4"`, `"letter"`, or `"a5"`
- `project_root`: Optional project root path for resolving images and drawing SVGs

**Returns:**

- `Ok(Vec<u8>)`: DOCX file as raw bytes
- `Err(String)`: Error message if generation fails

**Frontend usage:**

```typescript
const docxBytes = await invoke<number[]>('export_docx', {
  markdown: '# Hello\n\nWorld',
  title: 'Hello',
  template: 'clean',
  includeToc: false,
  includePageNumbers: false,
  pageSize: 'a4',
  projectRoot: null,
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

- `file-changed-batch` (`{ path: String, kind: String }[]`): Emitted when one or more files are created, modified, or deleted. `kind` is one of `"create"`, `"modify"`, or `"delete"`. Batched per debounce window (500ms).
- `file-renamed` (`{ old_path: String, new_path: String, is_directory: Boolean }`): Emitted for same-volume renames where the watcher knows both the old and new path in a single event (`Modify(Name(Both))`). Not emitted for cross-volume moves (those arrive as a separate create + delete pair). `is_directory` is `true` when the new path is a directory.

**Filtering applied before emission:**

- `.git/` internals and `.DS_Store` files silently dropped
- Self-written files suppressed from `file-changed-batch` (see `mark_self_write`) but still trigger SQLite reindex
- Directory events skipped for `file-changed-batch` (except deletes)
- macOS: `modify` events for paths that no longer exist reclassified as `delete`
- Rename-both events are routed exclusively to `file-renamed` and never appear in `file-changed-batch`

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

// Listen for external file changes (batched)
listen<{ path: string; kind: string }[]>('file-changed-batch', (event) => {
  for (const { path, kind } of event.payload) {
    // Handle create/modify/delete...
  }
});

// Listen for renames (same-volume, knows both paths)
listen<{ old_path: string; new_path: string; is_directory: boolean }>('file-renamed', (event) => {
  const { old_path, new_path, is_directory } = event.payload;
  // Update open documents, sidebar, pinned files...
});
```

## iCloud Sync Operations

Located in `src-tauri/src/commands/sync.rs`. Besides the sync-settings and migration commands (`get_icloud_path`, `read_sync_settings`, `write_sync_settings`, `migrate_to_icloud`, `migrate_from_icloud`, `migrate_quick_notes`), one command backs the recordings scanner:

### icloud_ensure_downloaded

Make sure an iCloud Drive file is materialized on disk. iCloud can evict a synced file, leaving `.<name>.icloud` beside a missing `<name>`; `file_size` on the real name then fails. This asks iCloud to download the item and reports where things stand — the caller waits for the watcher's `create` event the arriving file produces rather than polling.

```rust
#[tauri::command]
async fn icloud_ensure_downloaded(path: String) -> Result<DownloadState, String>

#[serde(rename_all = "lowercase")]
pub enum DownloadState { Ready, Downloading, Failed }
```

**Parameters:**

- `path`: Absolute path of the file itself (not of the `.icloud` placeholder)

**Returns:**

- `Ok("ready")`: The file is on disk
- `Ok("downloading")`: A placeholder was found and `NSFileManager.startDownloadingUbiquitousItem(at:)` accepted the request (macOS)
- `Ok("failed")`: No file and no placeholder, or the download request was refused; on non-macOS platforms anything but an existing file

**Frontend usage:**

```typescript
const state = await tauriApi.icloudEnsureDownloaded(audioPath); // "ready" | "downloading" | "failed"
```

## Research Operations

Located in `src-tauri/src/index/mod.rs` (part of the SQLite document index — the legacy filesystem-scanning `search_research` command was removed when research search moved to the index).

### index_search_research

Searches indexed research files across the given project scopes, matching against title/URL/snippet (`query`) and tags (`tag`). SQL-backed (per-scope `index.db`), designed for real-time command palette filtering (ResearchMode, `?` prefix).

```rust
#[tauri::command]
pub async fn index_search_research(
    state: tauri::State<'_, IndexState>,
    project_paths: Vec<String>,
    query: Option<String>,
    tag: Option<String>,
    limit: Option<usize>,
) -> Result<Vec<ResearchResult>, String>
```

**Parameters:**

- `project_paths`: Project roots whose index databases to query (`camelCase` `projectPaths` over IPC)
- `query`: Optional substring matched against title, source URL, and snippet (SQL `LIKE`)
- `tag`: Optional substring matched against the research entry's tags (SQL `LIKE`)
- `limit`: Maximum results to return (default 50)

**Returns:**

- `Ok(Vec<ResearchResult>)`: Matched entries sorted by `date_saved` descending
- `Err(String)`: Error message

**ResearchResult struct** (`src-tauri/src/index/queries.rs`; frontend type `IndexResearchResult` in `src/lib/tauri.ts`):

```rust
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct ResearchResult {
    pub file: String,
    pub title: String,
    pub tags: Vec<String>,
    pub source_url: String,
    pub snippet: String,
    pub date_saved: String,
    pub word_count: usize,
    pub project_name: Option<String>,
}
```

**Frontend usage:**

```typescript
const results = await tauriApi.indexSearchResearch(
  ['/path/to/project', '/Users/me/Notesage'],  // project roots (not research/ subdirs)
  'climate policy',  // query
  'climate',         // tag
  20                 // limit
);
```

## Meeting Recording & Transcription Operations

Located in `src-tauri/src/commands/transcription.rs`

### start_recording

Starts microphone capture, streaming samples to a WAV file in the recordings inbox (`~/Notesage/Recordings/Recording <YYYY-MM-DD HH-MM-SS>/audio.wav`). A single capture-owner thread owns the `cpal` stream (which is `!Send`) and the WAV writer; only one recording may be active at a time. Emits `recording-level` events while capturing. Capture can be paused/resumed (`pause_recording` / `resume_recording`) without tearing down the stream — paused samples are discarded, so the recorded length is pause-aware.

```rust
#[tauri::command]
pub async fn start_recording(
    app: AppHandle,
    state: State<'_, TranscriptionState>,
    source: String,
) -> Result<(), String>
```

**Parameters:**

- `source`: Audio source — `"microphone"` (only supported value; `"system"`/`"both"` are not yet implemented)

**Returns:**

- `Ok(())`: Recording started (WAV file created)
- `Err(String)`: Error if already recording or no microphone available

### stop_recording

Stops capture and **awaits full teardown** — the capture thread drops the `cpal` stream and finalizes the WAV file before this returns, so a rapid stop→start can never overlap two CoreAudio streams (the root cause of the old dictation hang, #264). Returns the finalized WAV path plus capture metadata.

```rust
#[tauri::command]
pub async fn stop_recording(
    state: State<'_, TranscriptionState>,
) -> Result<RecordingResult, String>
```

**Returns:**

- `Ok(RecordingResult)`: Finalized WAV path + metadata (`rms`/`peak` let the frontend warn on silence)
- `Err(String)`: Error if not currently recording

**RecordingResult struct** (serializes with snake_case field names):

```rust
pub struct RecordingResult {
    pub path: String,
    pub duration_secs: f64,
    pub sample_rate: u32,
    pub source: String,
    pub rms: f32,
    pub peak: f32,
}
```

### transcribe_file

Transcribes a finalized audio file in a single whole-file Whisper pass (no real-time chunking — quality over latency). Reads the WAV at `path`, resamples to 16kHz mono, and returns ordered timestamped segments. Emits `transcription-progress` events carrying `jobId` so concurrent jobs can be told apart.

```rust
#[tauri::command]
pub async fn transcribe_file(
    app: AppHandle,
    state: State<'_, TranscriptionState>,
    job_id: String,
    path: String,
    model: String,
    language: Option<String>,
) -> Result<TranscriptionResult, String>
```

**Parameters:**

- `job_id`: Caller-generated id echoed back in progress events (`jobId` over IPC)
- `path`: Absolute path to the finalized WAV (from `stop_recording`)
- `model`: Whisper model — `"large-v3-turbo-q5_0"` (default) or `"small"`. Older names still work if the file is on disk
- `language`: Optional language code (e.g., `"en"`, `"sv"`, `"fr"`). `None` for auto-detection.

**Returns:**

- `Ok(TranscriptionResult)`: Segments with timestamps, duration, and detected language
- `Err(String)`: Error if the file cannot be read or the model is not found

**Events emitted:**

- `transcription-progress` (`{ jobId: string, percent: number, segment?: string }`): Progress updates during transcription

**TranscriptionResult struct** (serializes with snake_case field names):

```rust
pub struct TranscriptionResult {
    pub segments: Vec<TranscriptSegment>,
    pub duration_secs: f64,
    pub language: String,
}

pub struct TranscriptSegment {
    pub start: f64,
    pub end: f64,
    pub text: String,
    pub speaker_id: Option<String>,   // reserved for future diarization; None in v1
    pub speaker_name: Option<String>, // reserved for future naming pass; None in v1
}
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
    pub name: String,        // e.g., "large-v3-turbo-q5_0", "small"
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

- `size`: Model name — `"large-v3-turbo-q5_0"` or `"small"`

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

// Record a meeting, then transcribe the finalized file as a background job
await tauriApi.startRecording('microphone');
// ... meeting happens ...
const rec = await tauriApi.stopRecording();   // { path, duration_secs, ... }
const jobId = crypto.randomUUID();
listen<{ jobId: string; percent: number }>('transcription-progress', (event) => {
  if (event.payload.jobId === jobId) updateProgress(event.payload.percent);
});
const result = await tauriApi.transcribeFile(jobId, rec.path, 'small', 'en');
```

### TranscriptionState (Managed State)

```rust
pub struct TranscriptionState {
    models_dir: PathBuf,
    recordings_dir: PathBuf,
    capture: Mutex<Option<CaptureOwner>>,
    download_cancels: Mutex<HashMap<String, Arc<AtomicBool>>>,
}
```

**Fields:**

- `models_dir`: Path to `~/.notesage/whisper-models/`
- `recordings_dir`: Path to `~/Notesage/Recordings/` (the recording-bundle inbox)
- `capture`: The single active capture owner (`cpal` stream + WAV writer + stop signal + join handle); `Some` only while a recording is in progress. Taking it out of the mutex enforces one stream at a time and is the synchronization point for the awaited teardown
- `download_cancels`: Per-model cancel signals for concurrent downloads

## MCP Operations

Located in `src-tauri/src/commands/mcp.rs` and `mcp_oauth.rs`. See `docs/features/ai-workflows.md` for the feature overview.

| Command | Signature (abridged) | Purpose |
| --- | --- | --- |
| `mcp_start_server` | `(config: McpServerConfig) -> McpServerInfo` | Connect (stdio spawn or http) → `initialize` → discover tools; register in `McpState`. Resolves secret env refs from the keychain at spawn. |
| `mcp_validate_server` | `(config) -> McpValidationResult` | Dry run (connect → handshake → `tools/list` → stop) without registering. Returns `{ ok, tools, server_info, error, error_kind, stderr_tail }`; `error_kind` ∈ `binary_not_found \| spawn_failed \| init_failed \| timeout`. |
| `mcp_stop_server` / `mcp_restart_server` | `(server_id)` | Lifecycle. http servers have no child process. |
| `mcp_list_tools` | `(server_id, refresh?)` | Cache-first read-through: returns the handle's cached tools when non-empty; live `tools/list` (updating the cache) when empty or `refresh: true`. |
| `mcp_call_tool` | `(server_id, …)` | Call a tool on a running server. |
| `mcp_get_server_status` | `() -> Vec<McpServerInfo>` | Snapshot of all servers. Wired to the Settings > MCP "Refresh status" button, which reconciles each card's running/stopped/tool-count state. |
| `mcp_catalog_list` | `() -> Vec<McpCatalogItem>` | Curated catalog manifest (embedded `mcp-catalog.json`). |
| `mcp_discover_configs` / `mcp_import_configs` / `mcp_save_config` / `mcp_check_import_sources` | — | Read/import/write `mcp.json`; import sources (Claude Desktop, Cursor, VS Code). |
| `mcp_oauth_authorize` | `(server_id, server_url, scope?) -> OAuthStatus` | Full browser OAuth: discovery (RFC 9728→8414) → DCR (RFC 7591) → PKCE → loopback callback → token exchange → keychain store. |
| `mcp_oauth_status` | `(server_id) -> OAuthStatus` | `{ authorized, expires_at }` — never returns token material. |
| `mcp_oauth_logout` | `(server_id)` | Clear stored tokens. |

**`McpEnvValue`** (env value in `McpServerConfig`/`McpServerInfo`/`McpConfigEntry`): a bare JSON string is inline plaintext; `{ "secret": true }` is a keychain reference (value at `notesage:mcp:<server_id>:<KEY>`, resolved only at spawn).

**Deep link:** `notesage://mcp/install?...` (scheme via `tauri-plugin-deep-link`) opens the validate-first Add dialog pre-filled — parsed by `src/lib/mcp/deeplink.ts`, surfaced by `McpDeepLinkInstaller`.

## Alpha Update Operations

Located in `src-tauri/src/commands/alpha_update.rs`

The app ships on an alpha pre-release channel. Tauri's `tauri-plugin-updater` `check()` JS API has no per-call `url` override, so the alpha channel is driven from Rust via `UpdaterBuilder::endpoints(...)` against a runtime-supplied endpoint. The pubkey from `tauri.conf.json` still verifies manifest signatures regardless of which endpoint produced them.

### alpha_check

Checks the alpha-channel update endpoint and, if an update is available, inserts the `Update` into Tauri's resource table so the frontend can wrap it (`new Update(metadata)`) and call `.downloadAndInstall(...)` — which routes back to the plugin's stock signature-verified `download` / `install` handlers via the returned `rid`.

```rust
#[tauri::command]
pub async fn alpha_check<R: Runtime>(
    webview: Webview<R>,
    url: String,
) -> Result<Option<AlphaUpdateMetadata>, String>
```

**Parameters:**

- `webview`: Tauri webview handle (injected automatically)
- `url`: The alpha update manifest endpoint URL

**Returns:**

- `Ok(Some(AlphaUpdateMetadata))`: An update is available
- `Ok(None)`: Already up to date
- `Err(String)`: Invalid URL, updater config/build failure, or check failure

**AlphaUpdateMetadata struct** (serializes with camelCase field names):

```rust
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AlphaUpdateMetadata {
    rid: ResourceId,            // resource-table handle for `new Update(metadata)`
    current_version: String,
    version: String,
    date: Option<String>,       // RFC3339
    body: Option<String>,
    raw_json: serde_json::Value,
}
```

**Frontend usage:**

```typescript
import { invoke } from '@tauri-apps/api/core';
import { Update } from '@tauri-apps/plugin-updater';

const metadata = await invoke<AlphaUpdateMetadata | null>('alpha_check', {
  url: ALPHA_UPDATE_ENDPOINT,
});
if (metadata) {
  const update = new Update(metadata);
  await update.downloadAndInstall();
}
```

## Preview Operations

Located in `src-tauri/src/commands/preview.rs`

Backs the large-file instant-load pipeline (`docs/prds/2026-05-03-large-file-instant-load.md`). Renders a markdown file to an HTML body fragment so the frontend can show an instant preview inside a `.ProseMirror` wrapper before the Tiptap editor finishes hydrating.

### render_markdown_preview

Reads a markdown file, strips leading YAML frontmatter (mirroring `src/lib/frontmatter.ts:parseFrontmatter`), and runs the comrak pipeline (`crate::export::markdown_to_html`) to produce an HTML body fragment.

```rust
#[tauri::command]
pub async fn render_markdown_preview(
    path: String,
    project_root: Option<String>,
    theme: String,
) -> Result<String, String>
```

**Parameters:**

- `path`: Absolute path to the markdown file
- `project_root`: Optional project root path for resolving relative resources
- `theme`: `"light"` or `"dark"` — controls syntax-highlighting theme

**Returns:**

- `Ok(String)`: HTML body fragment
- `Err(String)`: Error message if the file cannot be read

**Notes:** Embedded SVGs (drawings/charts) are intentionally not resolved here — they render as syntax-highlighted code blocks during the brief preview window and are replaced by their real node-views once the editor hydrates, keeping first-paint within the latency budget.

**Frontend usage:**

```typescript
const bodyHtml = await invoke<string>('render_markdown_preview', {
  path: '/path/to/large-note.md',
  projectRoot: null,
  theme: 'light',
});
```

## iOS Library & Capture Operations

Located in `src-tauri/src/commands/ios_library.rs` (with the pure capture-note
formatter in the `notesage-capture` workspace crate). These back the iOS mobile app — a
reader and note editor over the iCloud-synced Notesage library plus
share-sheet link capture (PRD `docs/prds/2026-06-28-ios-mobile-app.md`;
create/edit is issue #586). They are registered on every
platform so the frontend surface is uniform, but the real work is **iOS-only**:
on non-iOS targets every command returns an error. The native bridge
(security-scoped bookmark + `NSFileCoordinator`) is wired during `tauri ios
init` on a Mac — see `src-tauri/ios/README.md`.

**Path contract:** every `relPath` is **relative to the granted library root**
(`""` = root). The Rust layer (`sanitize_rel_path`) rejects absolute paths and
`..` traversal before the native bridge runs.

| Command | Signature (abridged) | Purpose |
| --- | --- | --- |
| `ios_pick_library_folder` | `() -> LibraryGrant` | Present the folder picker (pre-pointed at `iCloud Drive/Notesage`) and persist a security-scoped bookmark. |
| `ios_get_library_grant` | `() -> LibraryGrant` | Resolve the persisted grant; `granted: false` when none / stale. |
| `ios_clear_library_grant` | `() -> ()` | Forget the persisted bookmark (re-grant / sign-out). |
| `ios_list_directory` | `(relPath) -> Vec<FileEntry>` | List a directory under the granted root. |
| `ios_read_file` | `(relPath) -> String` | Read a UTF-8 file under the granted root. |
| `ios_read_binary` | `(relPath) -> Vec<u8>` | Read a binary file (image/PDF/…) under the granted root. |
| `ios_ensure_downloaded` | `(relPath) -> DownloadState` | Trigger/await iCloud download; returns `ready` \| `downloading` \| `failed`. |
| `ios_share_file` | `(relPath) -> ()` | Present the native share sheet over a temp copy of the file (share targets can't read through the security-scoped grant; the copy's per-invocation temp dir is deleted when the share completes). |
| `ios_write_file` | `(relPath, content) -> ()` | Overwrite (or create) a UTF-8 file — the mobile editor's save path. Coordinated atomic `.forReplacing` write. |
| `ios_create_file` | `(relPath, content) -> String` | Create a new UTF-8 file; the name is deduped natively (`note.md` → `note-1.md`). Returns the rel path actually created. |
| `ios_create_directory` | `(relPath) -> String` | Create a new folder, name deduped. Returns the rel path actually created. |
| `ios_rename_file` | `(relPath, newName) -> String` | Rename WITHIN the directory (single validated name segment — the title-becomes-filename primitive, not a move). Deduped; returns the final rel path. |
| `ios_move_file` | `(relPath, destDir) -> String` | Move a FILE into another folder under the library root (#754). Files only; `destDir` must already exist (`""` = root); BOTH paths sanitized. Deduped; returns the final rel path. |
| `ios_stat_file` | `(relPath) -> FileStat { sizeBytes }` | On-disk file size without reading content. Called before `ios_read_file` for text/markdown/html so the reader can decline an oversized file instead of freezing the WebView on a giant JSON read (issue #616). |
| `ios_text_prompt` | `(title, placeholder, confirmLabel) -> Option<String>` | Native single-line `UIAlertController` text prompt (the create flow's name entry). `None` = cancelled. Pure UI, no filesystem. |
| `ios_recording_start` | `(language?) -> ()` | Record from the microphone into the app's container (AAC, mono, 48 kHz, 64 kbps); the bundle reaches the library on stop. Errors `microphone-denied`, `low-disk-space`, `recording-in-progress`. |
| `ios_recording_pause` / `ios_recording_resume` | `() -> ()` | Pause-aware; an interruption (a call) pauses natively. |
| `ios_recording_stop` | `(discard?) -> { relPath, manifest }` | Finalise into `Recordings/Recording <stamp>/` (`audio.m4a` + `recording.json`), or discard. |
| `ios_recording_state` | `() -> { status, elapsedSecs, level, interrupted, micPermission, orphan? }` | The recorder, and any staging folder a force-quit left behind. |
| `ios_recording_recover` | `(action: keep \| discard, dir) -> Option<relPath>` | Keep (finalise) or discard an orphan. |
| `ios_notification_status` | `() -> NotificationStatus` | Authorization (`notDetermined` \| `denied` \| `authorized`), Background App Refresh (`available` \| `denied` \| `restricted`), and the badge / new-items preferences. |
| `ios_notification_request` | `() -> NotificationStatus` | The one system prompt (badge + alert, no sound). |
| `ios_notification_set_prefs` | `(badge?, newItems?, templates?) -> NotificationStatus` | Preferences plus the localised banner strings the native side posts with. `badge: false` clears the icon badge at once. |
| `ios_inbox_unread_count` | `(markSeen?) -> u32` | Recount the unread Inbox from disk (the shared `reading-progress.json` rule) and refresh the icon badge; with `markSeen` (the Inbox listing only) record the items as seen. No path argument. |
| `ios_consume_launch_route` | `() -> Option<String>` | `"inbox"` once after a notification tap, then `None`. |
| `ios_open_settings` | `() -> ()` | Open the Settings app at Notesage's page. |

```rust
#[serde(rename_all = "camelCase")]
pub struct LibraryGrant { pub display_name: String, pub granted: bool }

#[serde(rename_all = "lowercase")]
pub enum DownloadState { Ready, Downloading, Failed }
```

The capture note format (frontmatter `type: capture` / `source_url` / `title` /
`date_saved` / `tags`, body = the link plus any shared selection, filename
`Inbox/<Note Title>.md`, readable and undated — dedupe on collision) is
produced by the shared, unit-tested
`notesage-capture` crate, which the Share Extension calls over its C ABI —
capture happens only in the extension's process. In-app writes are the
three allowlisted note-editing commands above (#586) — library-root-confined
relative paths, no delete, no move. On iOS the invoke handler registers ONLY
this mobile surface (plus `render_markdown_fragment`, the `html_preview_*`
pair, `log_frontend` and `set_log_level`) — the desktop's broad
write/exec/credential commands are compiled out of the iOS binary.

**Frontend usage** (via `src/lib/ios-api.ts`):

```typescript
import { iosGetLibraryGrant, iosListDirectory, iosReadFile } from '@/lib/ios-api';

const grant = await iosGetLibraryGrant();
if (grant.granted) {
  const entries = await iosListDirectory('');      // library root
  const text = await iosReadFile('notes/today.md');
}
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
- **API keys in OS keychain**: Keys stored in macOS Keychain via `keyring` crate, never in localStorage. Backend resolves keys from keychain using `connection_id` — `resolve_api_key` consults the keychain FIRST (authoritative) and only falls back to an explicit `api_key` IPC parameter when no keychain entry exists, so a key passed over IPC can never shadow the keychain-resolved key
- **No direct filesystem access via plugins**: The renderer never imports `@tauri-apps/plugin-fs` (no `fs:allow-*` capability is granted) — all file I/O goes through the vetted Rust commands in `commands/file.rs`
- **Renderer is trusted; file commands do NOT self-validate paths**: `read_file`/`write_file`/`delete_path` operate in the main (unsandboxed) process on whatever absolute path the renderer passes — they do NOT restrict to a workspace root. The boundary against a *renderer compromise* is the live-window CSP + the XSS-hardening of every HTML sink, not per-command allow-listing. Per-scope path gating exists only at the AI/agent call sites (`tool-executor.ts`, Copilot LSP, Seatbelt writable paths). The one runtime FS-scope widener, `allow_asset_dir`, IS validated (`validate_asset_dir` rejects `/`, `$HOME` & ancestors, `..`, and sensitive subtrees)

## IPC Performance

- Commands are async and non-blocking
- Large file operations (&gt;1MB) may take time - show loading indicators in UI
- Consider debouncing rapid file operations (e.g., auto-save)
- Use batch operations where possible (e.g., read multiple files in one call)