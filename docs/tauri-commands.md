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
async fn list_directory(path: String, show_hidden: Option<bool>, max_depth: Option<usize>) -> Result<Vec<FileEntry>, String>
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

`max_depth: 0` lists only the directory itself: each subfolder comes back with `truncated: true` and empty `children`, without being walked. The library's top-level project scan uses this; the default is the full depth-limited walk. Runs on a blocking thread.

### trash_paths

```rust
async fn trash_paths(paths: Vec<String>) -> Result<Vec<String>, String>
```

Moves several paths to the system Trash in one call and returns the paths that could not be trashed. The Inbox uses it for multi-select delete instead of one `trash_path` call per file.

### index_open

```rust
async fn index_open(project_paths: Vec<String>) -> Result<(), String>
```

Opens the global index database and each given project's database without indexing anything. Startup calls it before the file watchers start, because the index pass itself now runs in the background: a watcher event for a project whose database is not registered yet would otherwise be indexed into the global database and counted twice.

### index_init

```rust
async fn index_init(project_path: Option<String>) -> Result<IndexStats, String>
```

Opens one scope's index database and brings it up to date with the files on disk: the project at `project_path`, or the global `~/Notesage` library when it is `None`. Startup runs it once for the global scope and then once per project, in the background and in parallel; `useProjectIndexSync` runs it for a project that joins the workspace later.

**Events emitted** (the scope is `project_path`, `null` for the global pass, in both):

| Event | Payload | When |
| --- | --- | --- |
| `index-progress` | `{ project_path: string \| null, current: number, total: number }` | Once when the pass starts (`current: 0`, as soon as the directory has been scanned and `total` is known), every 50 files in between, and once when it ends (`current == total`). Every pass emits its first and last event whatever its size; a pass over an empty directory emits `0 / 0` twice. |
| `index-ready` | `{ project_path: string \| null }` | When the pass has finished successfully. **Not** emitted when the pass fails, so "is it still running" must not hang on this event alone. |

`current` and `total` count the files of that one pass. The payload used to have no `project_path` and was only sent for passes over 50 files, so the numbers restarted from zero for every project; the frontend now keeps the numbers per scope and adds them up (`src/lib/index-progress.ts`). No index lock is held while either event is emitted.

`useIndexProgressListener` (mounted once in `App.tsx`) is the only listener for `index-progress`; it feeds `index-progress-store`, which also hears from `initIndexWithRecovery` when each `index_init` call begins and returns. The index-backed views listen to `index-ready` to query again.


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
    doc_uri: Option<String>,
    doc_language_id: Option<String>,
) -> Result<Value, String>
```

**Parameters:**

- `message`: First user message to send
- `model`: Optional model ID (e.g., `"gpt-4o"`, `"claude-sonnet-4"`)
- `tools`: Optional array of tool definitions to register with the conversation
- `doc_uri`: Optional URI of the active document, attached as the conversation's `doc` context
- `doc_language_id`: Optional language id for that document (only used together with `doc_uri`)

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
    doc_uri: Option<String>,
    doc_language_id: Option<String>,
) -> Result<Value, String>
```

**Parameters:**

- `conversation_id`: ID returned from `copilot_lsp_conversation_create`
- `message`: User message to send
- `model`: Optional model ID override
- `doc_uri`: Optional URI of the active document, attached as the turn's `doc` context
- `doc_language_id`: Optional language id for that document (only used together with `doc_uri`)

**Returns:**

- `Ok(Value)`: The language server's raw `conversation/turn` result (arrives once the whole turn is over)
- `Err(String)`: Error message if the turn fails

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

Located in `src-tauri/src/commands/acp/mod.rs`. All four commands forward an `AgentCmd` to the agent thread (`acp/agent_thread.rs`), which sends the request over its `ConnectionTo<Agent>` handle; capability gating (`sessionCapabilities.{list, fork, resume, close}`) is done on the frontend — the backend is a passthrough.

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

## Local Model Fit

Located in `src-tauri/src/commands/model_fit/` (`mod.rs`, `hardware.rs`). Hardware-aware local model recommendation; the types (`HardwareProfile`, `ModelFitInput`, `ModelFitResult`, `GgufCapabilities`) live in `model_fit/types.rs`.

```rust
#[tauri::command]
pub async fn detect_hardware_profile() -> Result<HardwareProfile, String>

#[tauri::command]
pub async fn estimate_model_fit(
    candidates: Vec<ModelFitInput>,
    profile: HardwareProfile,
    planning_ctx: u32,
) -> Result<Vec<ModelFitResult>, String>

#[tauri::command]
pub async fn read_gguf_capabilities(
    resolve_url: Option<String>,
    local_path: Option<String>,
) -> Result<GgufCapabilities, String>
```

`commands/transcription_stub.rs` is the mobile stand-in for `transcription.rs`: it registers the same recording / Whisper command names on mobile targets, where each one returns an "unavailable" error (those features are desktop-only).

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
pub async fn ai_generate_text(
    request: AIRequest,
    state: tauri::State<'_, super::local_inference::LocalInferenceState>,
) -> Result<String, String>
```

**Parameters:**

- `request`: AIRequest struct (see below)
- `state`: Managed local-inference state (injected automatically)

**Returns:**

- `Ok(String)`: Generated text from AI
- `Err(String)`: Error message if generation fails

### ai_chat

Multi-turn chat with an AI provider (non-streaming).

```rust
#[tauri::command]
pub async fn ai_chat(
    messages: Vec<ChatMessage>,
    provider: AIProviderType,
    api_key: Option<String>,
    connection_id: Option<String>,
    ollama_url: Option<String>,
    model: Option<String>,
    temperature: Option<f64>,
    max_tokens: Option<u32>,
    base_url: Option<String>,
    state: tauri::State<'_, super::local_inference::LocalInferenceState>,
) -> Result<String, String>
```

**Parameters:**

- `messages`: Array of ChatMessage structs
- `provider`: `AIProviderType` enum — on the wire `"anthropic"`, `"openai"`, `"ollama"`, `"openai_compatible"` or `"local_bundled"`. An unknown value is rejected at deserialization
- `api_key`: Last-resort fallback only, for callers with no `connection_id` (the current frontend never sends it)
- `connection_id`: The connection whose API key is resolved from the OS keychain inside the backend. The keychain is authoritative and is consulted first, so keys do not transit IPC
- `ollama_url`: Ollama server URL (Ollama only)
- `model`: Optional model ID
- `temperature`: Optional sampling temperature
- `max_tokens`: Optional output-token cap
- `base_url`: Optional provider base URL override (OpenAI-compatible endpoints, proxies)
- `state`: Managed local-inference state (injected automatically; used by `local_bundled`)

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
    provider: AIProviderType,
    api_key: Option<String>,
    connection_id: Option<String>,
    ollama_url: Option<String>,
    web_search_enabled: Option<bool>,
    tools: Option<Vec<ToolDefinition>>,
    model: Option<String>,
    temperature: Option<f64>,
    max_tokens: Option<u32>,
    base_url: Option<String>,
    response_format: Option<serde_json::Value>,
    stream_id: Option<String>,
    state: tauri::State<'_, super::local_inference::LocalInferenceState>,
    stream_state: tauri::State<'_, AiStreamState>,
) -> Result<(), String>
```

**Parameters:**

- `window`: Tauri window handle (injected automatically)
- `messages`: Array of ChatMessage structs
- `provider`: `AIProviderType` enum — on the wire `"anthropic"`, `"openai"`, `"ollama"`, `"openai_compatible"` or `"local_bundled"`
- `api_key`: Last-resort fallback only, for callers with no `connection_id` (the current frontend never sends it)
- `connection_id`: The connection whose API key is resolved from the OS keychain inside the backend (authoritative, consulted first)
- `ollama_url`: Ollama server URL (Ollama only)
- `web_search_enabled`: Enable server-side web search (Anthropic/OpenAI only, ignored for Ollama)
- `tools`: Optional array of tool definitions for client-side tool calling
- `model`: Optional model ID
- `temperature`: Optional sampling temperature
- `max_tokens`: Optional output-token cap
- `base_url`: Optional provider base URL override
- `state` / `stream_state`: Managed local-inference state and the in-flight stream registry used by `ai_chat_stream_cancel` (both injected automatically)
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
    pub provider: AIProviderType,      // "anthropic" | "openai" | "ollama" | "openai_compatible" | "local_bundled"
    pub prompt: String,
    pub api_key: Option<String>,       // Fallback only — see connection_id
    pub connection_id: Option<String>, // Key resolved from the OS keychain in the backend
    pub ollama_url: Option<String>,    // For Ollama
    pub stream: bool,
    pub model: Option<String>,
    pub temperature: Option<f64>,
    pub max_tokens: Option<u32>,
    pub base_url: Option<String>,
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
    project_root: Option<String>,
    typography: Option<TypographyPresets>,
    page_settings: Option<DocumentPageSettings>,
    embedded_svgs: Option<Vec<String>>,
) -> Result<Vec<u8>, String>
```

**Parameters:**

- `markdown`: Full markdown content (including frontmatter if present)
- `title`: Document title (used in headers/footers and title pages)
- `template`: Template preset — `"clean"`, `"academic"`, or `"report"`
- `include_toc`: Whether to generate a table of contents
- `include_page_numbers`: Whether to show page numbers
- `page_size`: Page dimensions — `"a4"`, `"letter"`, or `"a5"`
- `project_root`: Optional project root path for resolving drawing SVG files
- `typography`: Optional `TypographyPresets` (camelCase JSON from the editor's typography settings). `None` uses the defaults
- `page_settings`: Optional `DocumentPageSettings` (custom header/footer)
- `embedded_svgs`: Optional pre-rendered SVG strings for inline chart / Excalidraw blocks, in document order

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
    typography: Option<TypographyPresets>,
    page_settings: Option<DocumentPageSettings>,
    embedded_svgs: Option<Vec<String>>,
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
- `typography`: Optional `TypographyPresets` (camelCase JSON from the editor's typography settings). `None` uses the defaults
- `page_settings`: Optional `DocumentPageSettings` (custom header/footer)
- `embedded_svgs`: Optional pre-rendered SVG strings for inline chart / Excalidraw blocks, in document order

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
    typography: Option<TypographyPresets>,
    page_settings: Option<DocumentPageSettings>,
    embedded_svgs: Option<Vec<String>>,
) -> Result<String, String>
```

**Parameters:**

- `markdown`: Full markdown content (including frontmatter if present)
- `title`: Document title (used in `<title>` tag)
- `theme`: `"light"` or `"dark"` — controls syntax highlighting theme and CSS
- `include_styles`: `true` for standalone HTML document, `false` for clipboard body fragment
- `project_root`: Optional project root path for resolving drawing SVG sidecar files
- `typography`: Optional `TypographyPresets` (camelCase JSON from the editor's typography settings). `None` uses the defaults
- `page_settings`: Optional `DocumentPageSettings` (custom header/footer)
- `embedded_svgs`: Optional pre-rendered SVG strings for inline chart / Excalidraw blocks, in document order

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

### get_library_container_path

Notesage's OWN iCloud container — not Apple's generic `com~apple~CloudDocs`. `None` unless it exists; Phase 2 never creates it, because an unentitled Mac that made the directory anyway would produce a folder that never syncs.

```rust
#[tauri::command]
pub async fn get_library_container_path() -> Result<Option<String>, String>
```

### read_library_marker

A library's `<root>/.notesage/library.json`. `None` for a library with no marker — the ordinary state of today's CloudDocs folder — and `None` for a malformed one, since "no marker" means "not migrated" and refusing to start over a hand-edited file would be worse.

```rust
#[tauri::command]
pub async fn read_library_marker(root: String) -> Result<Option<LibraryMarker>, String>

pub struct LibraryMarker {
    pub version: u32,
    pub kind: String,          // "container"
    pub created_by: String,    // "ios" | "macos"
    pub created_at: String,
    pub migrated_from: Option<String>,
    pub migrated_at: Option<String>,
    pub migrated_by: Option<String>,
}
```

### migrate_library_entry

Move ONE entry into the new library, returning where it landed. **Never overwrites**: a destination that exists is an error, so every collision is settled by the migration plan rather than by the order steps happened to run in. Refuses a source outside a plausible library root, so a bad path cannot turn it into a general move-anything command. `rename(2)`, falling back to copy-verify-delete across volumes; a symlink is moved as a link, not followed.

```rust
#[tauri::command]
pub async fn migrate_library_entry(src: String, dst: String) -> Result<String, String>
```

### list_evicted_placeholders

Every undownloaded file under a library root, as absolute paths — the input to the migration's materialise-first pre-flight. iCloud leaves a `.<name>.icloud` stub beside a missing `<name>`; this returns the path of the **missing file**, which is what `icloud_ensure_downloaded` takes and whose arrival the caller waits for. A root that does not exist is an empty list (the container may legitimately not be there yet); a subtree that cannot be read is an error, never an empty result — a swallowed listing reads as "nothing undownloaded, safe to move", which is the fail-open this guard exists to prevent. Read-only and strictly less capable than `list_directory`, so unlike `migrate_library_entry` it carries no root guard.

```rust
#[tauri::command]
pub async fn list_evicted_placeholders(root: String) -> Result<Vec<String>, String>
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

## Meeting Recording Operations

Located in `src-tauri/src/commands/recording/` (managed state: `RecordingState`). Capture is separate from transcription: samples go to a file and nothing else happens to them until the recording has stopped. On mobile targets the same command names come from `commands/transcription_stub.rs` and return an "unavailable" error.

| Module | Holds |
| --- | --- |
| `wav.rs` | Streaming 16-bit WAV writer (header patchable at any time, write failures surfaced, 4 GiB guard), header repair from file length, streaming reader |
| `ring.rs` | Lock-free SPSC ring between the audio callback and the capture thread |
| `mix.rs` | Downmix, streaming sample-rate conversion, the mono mix of two tracks |
| `monitor.rs` | Pure rules: level metering (10/s), silence, stall watchdog, pause clock, timeline padding, drift, disk thresholds |
| `track.rs` | Ring → mono → WAV for one track |
| `owner.rs` | `CaptureOwner` (bounded stop) and the state shared with the capture thread |
| `session.rs` | The capture thread's loop, against an abstract audio backend (tested with simulated devices) |
| `capture.rs` | The cpal backend: the only code that touches the audio stack |
| `staging.rs` | Staging bundles, finalize into the library, orphan recovery |
| `encode.rs` | WAV → AAC (`afconvert`) after stop, verified before the WAV is deleted |
| `finish.rs` | The stop path once the audio thread has let go |
| `preflight.rs` | Microphone authorisation, system-audio support, free space |
| `state.rs` | `RecordingState` and the admission rules (#264) |

**Where a recording lives.** `start_recording` records into a LOCAL staging bundle, `~/.notesage/recordings-staging/Recording <YYYY-MM-DD HH-MM-SS>/` (folders `0700`, files `0600`), never into iCloud. After `stop_recording` the frontend writes `recording.json` into that folder and calls `finalize_recording_bundle`, which moves the whole folder into `<library>/Recordings/`. Whatever is still in staging at the next launch is returned by `recover_orphan_recordings`.

**Sources and files.** `"microphone"` and `"system"` write one track straight to `audio.wav`. `"both"` writes `mic.wav` and `system.wav`, padded so both start at the same instant, and `stop_recording` mixes them into `audio.wav`. Every file is mono at the device's native rate. On macOS each WAV is then encoded to AAC (`.m4a`, 64 kbit/s at 44.1 kHz and above) and removed once the encode has been read back and its duration matches; on any doubt the WAV is kept.

**System audio** uses cpal's CoreAudio process-tap loopback (an input stream on the default OUTPUT device). It needs macOS 14.2+ and `NSAudioCaptureUsageDescription` (`src-tauri/Info.plist`). macOS has no public API to read that permission and a denied tap delivers silence, so denial shows up as a `silence` warning on the system source, not as an error.

All result structs serialize with snake_case field names. Arguments follow Tauri's default (camelCase in JS → snake_case in Rust).

### recording_preflight

```rust
#[tauri::command]
pub async fn recording_preflight(
    state: State<'_, RecordingState>,
    source: String,
) -> Result<RecordingPreflight, String>

pub struct RecordingPreflight {
    pub microphone: String,     // "granted" | "denied" | "undetermined" | "unknown"
    pub system_audio: String,   // "available" | "unsupported" | "unknown"
    pub input_device: Option<String>,
    pub output_device: Option<String>,
    pub free_bytes: u64,        // on the staging volume
}
```

Never prompts. `system_audio` is `"unsupported"` below macOS 14.2 and off macOS; it is never `"denied"` (see above).

### start_recording

```rust
#[tauri::command]
pub async fn start_recording(
    app: AppHandle,
    state: State<'_, RecordingState>,
    source: String,   // "microphone" | "system" | "both"
) -> Result<(), String>
```

Opens the stream(s) off the async runtime. Only one recording may be active; a start is refused (`Recording already in progress`) while one is active, while another start is still opening its streams, or while a stop is tearing down (#264). Fails rather than record less than asked: if any requested source cannot be opened, nothing is recorded and the staging bundle is removed.

Errors (exact, or exact prefix): `Recording already in progress`, `Unknown recording source: …`, `No microphone available`, `Microphone access is denied…`, `System audio recording requires macOS 14.2 or later`, `System audio recording is not available on this platform`, `No audio output device available`, `System audio cannot be captured from this output device…` (the output device also has inputs, so cpal would record its input instead), `Not enough free disk space to record…` (< 200 MB), `The previous recording is still shutting down…`, `Failed to …`.

### pause_recording / resume_recording

```rust
pub async fn pause_recording(state: State<'_, RecordingState>) -> Result<(), String>
pub async fn resume_recording(state: State<'_, RecordingState>) -> Result<(), String>
```

Idempotent. While paused the audio callbacks discard their samples; the streams stay open. Error: `No recording in progress`.

### stop_recording

```rust
#[tauri::command]
pub async fn stop_recording(
    state: State<'_, RecordingState>,
) -> Result<RecordingResult, String>

pub struct RecordingResult {
    pub bundle_dir: String,        // the staging bundle
    pub audio_path: String,        // audio.m4a, or audio.wav when not encoded
    pub tracks: Vec<TrackRef>,     // [{ role: "mic" | "system", path }] for "both"; empty otherwise
    pub duration_secs: f64,        // from samples that reached the file
    pub peak: f32,
    pub sample_rate: u32,
    pub dropped_frames: u64,
    pub warnings: Vec<String>,     // codes, see below
    pub path: String,              // same as audio_path (older callers)
    pub source: String,
    pub rms: f32,
    pub track_peaks: TrackPeaks,   // { mic: Option<f32>, system: Option<f32> }
}
```

Waits (up to 10 s) for the capture thread to drop its streams and finalise the files, then mixes and encodes. **Can take seconds to tens of seconds** for an hour of audio; all of it runs off the async workers. A new recording may start as soon as the teardown phase is over.

`warnings` codes, optionally followed by `: detail`: `mic-silent`, `system-silent`, `dropped-frames`, `drift` (the two tracks disagree with the clock by more than 100 ms), `device-changed`, `track-lost`, `track-unreadable`, `write-error`, `mix-failed`, `encode-failed` (WAV kept), `stop-timeout`, `stopped-early`.

Errors: `No recording in progress`; `Recording could not be finalised: …` when no track is a readable WAV (the bundle is left in staging for recovery).

### discard_recording

```rust
pub async fn discard_recording(
    state: State<'_, RecordingState>,
    bundle_dir: Option<String>,
) -> Result<(), String>
```

Without `bundle_dir`: stops the live recording, if any, and deletes its staging bundle (no live recording is not an error). With `bundle_dir`: deletes that staging bundle; anything that is not a direct child of the staging root is refused (`Not a staging recording: …`).

### finalize_recording_bundle

```rust
pub async fn finalize_recording_bundle(
    state: State<'_, RecordingState>,
    staging_dir: String,
    dest_recordings_dir: String,
) -> Result<FinalizedBundle, String>   // { bundle_dir, audio_path, tracks }
```

Moves a stopped staging bundle into `dest_recordings_dir` (created if missing) under a non-colliding name (`<name>`, `<name> (2)`, …). A rename is tried first; otherwise the bundle is copied to a hidden `.<name>.partial-<pid>` folder inside the destination, every file size is verified, and only then is it renamed into place and the staging copy deleted. A failure leaves the staging bundle intact and nothing visible in the destination. Call it after writing `recording.json` into the staging bundle.

### recover_orphan_recordings

```rust
pub async fn recover_orphan_recordings(
    state: State<'_, RecordingState>,
) -> Result<Vec<OrphanRecording>, String>

pub struct OrphanRecording {
    pub bundle_dir: String,
    pub audio_path: String,
    pub tracks: Vec<TrackRef>,
    pub duration_secs: f64,
    pub started_at: Option<String>,   // RFC 3339
    pub source: Option<String>,
    pub has_manifest: bool,
}
```

Returns staging bundles left by a crash or quit, skipping the live recording and bundles this session has stopped but not yet finalised. WAV headers are repaired from the file length, zero-data files and empty bundles are deleted, a missing mix is produced from the two tracks. Nothing is encoded or moved.

### get_recording_state

```rust
pub async fn get_recording_state(
    state: State<'_, RecordingState>,
) -> Result<RecordingStateInfo, String>
// { recording, paused, source, started_at_ms, elapsed_recorded_ms, fatal }
```

`elapsed_recorded_ms` comes from samples written, so it excludes pauses. `fatal` means the backend stopped capturing by itself; call `stop_recording` to collect the result.

### Events

- `recording-level`: `{ mic: number | null, system: number | null }`, the peak (0..1) since the previous event; `null` for a source that is not being recorded. At most 10 per second, never while paused.
- `recording-warning`: `{ kind, message, fatal, source? }` with `kind` one of `silence`, `device-lost`, `device-changed`, `write-error`, `low-disk`, `dropped-frames`. `source` (`"microphone"` or `"system"`) is present when the warning concerns one source, and `message` (English) then starts with `mic: ` or `system: `. `fatal: true` means the recording has been stopped and finalised by the backend.
  - `silence`: nothing above 0.0002 on a source for the first 5 s, or for 30 s after signal.
  - `device-lost`: no audio callbacks for 2 s (6 s for a stream that has not delivered yet); the stream is reopened on the current default device, and `device-changed` follows when audio arrives. The gap is written as silence so timestamps stay true. Fatal when no source could be reopened for 30 s. A change of the default output device re-opens the system tap and emits only `device-changed`.
  - `low-disk`: below 500 MB (warning), below 50 MB (fatal).

### App exit

`RunEvent::Exit` calls `RecordingState::stop_for_exit`, which stops a live capture and leaves its WAV valid, waiting at most 3 s for the audio thread. Nothing is encoded; the bundle is returned by `recover_orphan_recordings` on the next launch. Independently of that, the WAV header is patched every 10 s while recording, so a crash or force-quit costs seconds.

## Meeting Recording & Transcription Operations

Located in `src-tauri/src/commands/transcription.rs`

### transcribe_file

Transcribes a finalized audio file, or the separately recorded tracks of one. The pipeline lives in `src-tauri/src/commands/transcribe/` (the command is a thin wrapper):

- **Streaming decode.** The file is decoded packet by packet (symphonia; CoreAudio fallback on macOS), downmixed and band-limited-resampled to 16 kHz mono as it goes. The file is never held at its native rate.
- **Parts.** Audio is transcribed in parts of about ten minutes, cut at the quietest half second near the end of each part, and released afterwards. Memory is flat (about 150 MB beyond the model) whatever the length of the recording. Timestamps are offset by each part's exact start.
- **Silence and level.** Silences of two seconds or more that are far below the speech level are skipped (energy gate; timestamps are mapped back to original time) and quiet input is raised (at most 20 dB, never clipping).
- **Queue.** Jobs run one at a time and wait for their turn *before* touching the file. The model is loaded and used under one lock, and unloaded after 10 idle minutes.
- **Language.** `language` pins the language. Without it the language is detected once (first part with speech) and kept for the rest of the job, including the other track.
- **Evicted audio.** A file iCloud has evicted (dataless, or a `.name.icloud` placeholder) is requested and waited for (5 minutes) on a blocking thread before decoding.

```rust
#[tauri::command]
pub async fn transcribe_file(
    app: AppHandle,
    state: State<'_, TranscriptionState>,
    job_id: Option<String>,
    path: String,
    model: String,
    language: Option<String>,
    tracks: Option<Vec<TranscribeTrack>>, // { role: "mic" | "system", path }
) -> Result<TranscriptionResult, String>
```

**Parameters** (camelCase over IPC: `jobId`, `path`, `model`, `language`, `tracks`):

- `job_id`: Optional caller-generated id, echoed in progress events and accepted by `cancel_transcription`
- `path`: Absolute path to the audio (any format the decoder reads). Also the `audio_path` of the job's events
- `model`: Whisper model — `"large-v3-turbo-q5_0"` (default) or `"small"`. Older names still work if the file is on disk
- `language`: Optional language code (e.g., `"en"`, `"sv"`). `None`, `""` or `"auto"` for auto-detection
- `tracks`: Optional. When given (a recording made with source "both"), each track is transcribed separately and the segments are merged by start time with `speaker` `"me"` (role `mic`) or `"others"` (role `system`). A `me` segment that repeats what `others` said at the same moment (the microphone hearing the loudspeakers) is dropped

**Returns:**

- `Ok(TranscriptionResult)`: Segments ordered by start, duration, and the language used
- `Err("Transcription cancelled")`: exactly this string when the job was cancelled, waiting or running
- `Err(String)`: `Audio file not found: …`, `Model '…' not downloaded. …`, `The audio file is still in iCloud and could not be downloaded: …`, or a decode error

**Events emitted:**

- `transcription-progress` (`{ job_id: string | null, audio_path: string, stage: "loading" | "decoding" | "transcribing" | "finishing", percent: number }`): `percent` is an integer 0..100 for the whole job (all tracks), never decreases, and is emitted only when it or the stage changes. No transcript text. A waiting job emits nothing; the first event is `loading` 0 and the last, on success, `finishing` 100

**TranscriptionResult struct** (serializes with snake_case field names):

```rust
pub struct TranscriptionResult {
    pub segments: Vec<TranscriptSegment>,
    pub duration_secs: f64,
    pub language: String,             // the pinned language, or the detected one
    pub decoder: String,              // "symphonia" | "coreaudio"
}

pub struct TranscriptSegment {
    pub start: f64,                   // seconds from the start of the audio
    pub end: f64,
    pub text: String,
    pub speaker: Option<String>,      // "me" | "others" with `tracks`; key omitted otherwise
    pub speaker_id: Option<String>,   // reserved for future diarization; always None
    pub speaker_name: Option<String>, // reserved for future naming pass; always None
}
```

### cancel_transcription

Stops a transcription (or an `import_media`) that is waiting for its turn or running. A waiting job never starts; a running one stops within one Whisper step and releases its audio and the model lock.

```rust
#[tauri::command]
pub async fn cancel_transcription(
    job_id: Option<String>,
    audio_path: Option<String>,
) -> Result<bool, String>
```

**Parameters:** a job matches when `job_id` equals its id, or `audio_path` equals the `path` it was started with (for an import: its `source_path`).

**Returns:** `true` when at least one job matched. The cancelled `transcribe_file` rejects with `Transcription cancelled`, a cancelled `import_media` with `Import cancelled`.

### import_media

Extracts the audio of a video or audio file (a Teams or Zoom `.mp4`, `.mov`, `.m4a`, `.mp3`, `.wav`, …) into a new recording bundle. The source is not copied.

```rust
#[tauri::command]
pub async fn import_media(
    app: AppHandle,
    source_path: String,
    dest_recordings_dir: String,
) -> Result<ImportResult, String>

pub struct ImportResult {             // snake_case over IPC
    pub bundle_dir: String,
    pub audio_path: String,
    pub duration_secs: f64,
    pub original_name: String,        // the source's file name, with extension
}
```

- The bundle is `dest_recordings_dir/Import <sanitised stem> <YYYY-MM-DD HHMMSS>` (a number is appended if taken), mode 0700; the audio 0600. The caller writes `recording.json` afterwards.
- On macOS the audio is `audio.m4a` (AAC, mono, 64 kbit/s) made by `/usr/bin/afconvert` reading the source directly, and checked (it must open and be as long as the source). Everywhere else, and whenever that fails, it is a 16 kHz mono `audio.wav` (115 MB per hour) from the streaming decoder.
- Extraction happens in `~/.notesage/import-staging/`; the bundle appears in the library only when its audio is complete. A failed or cancelled import leaves nothing behind.
- Readable sources: what symphonia is built with (WAV, MP3, AAC or ALAC in MP4/M4A/MOV, FLAC, Ogg Vorbis, AIFF, CAF) plus, on macOS, anything CoreAudio opens. WebM/Opus and Matroska are not supported.

**Events emitted:** `import-progress` (`{ source_path: string, percent: number }`, integer, on change).

**Errors:** `Import cancelled`, `Source file not found: …`, `The file is still in iCloud and could not be downloaded: …`, `No audio track found in <name>`, `Unsupported media format: <name> (…)`, `Cannot write to <dir>: …`.

### audio_file_status

Located in `src-tauri/src/commands/file.rs`. Whether an audio file exists, its size, and whether its content is on this machine, without reading it (so it never triggers an iCloud download).

```rust
#[tauri::command]
pub async fn audio_file_status(path: String) -> Result<AudioFileStatus, String>

pub struct AudioFileStatus { pub exists: bool, pub size: u64, pub local: bool }
```

`local` is `false` for a file iCloud has evicted: a dataless file (exists, full size, no content) or a missing file with a `.name.icloud` placeholder (then `exists` is `false` too). A missing file is a status, not an error. `file_size` fails for a dataless file (`File is not downloaded from iCloud: …`) and `icloud_ensure_downloaded` requests it and answers `downloading`.

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

The file is written to `ggml-<name>.bin.downloading` and renamed when complete and verified. A partial file is kept after a failure or a quit and continued with an HTTP `Range` request on the next attempt (an explicit cancel deletes it). The download fails if no data arrives for 30 seconds (`Download stalled: …`) or the disk lacks room (`Not enough free disk space: …`). Before the rename the file must have the length the server announced and the ggml magic number; a catalogue entry with a `sha256` is also checked against that hash and its exact size (`Downloaded file failed verification (…). It was removed; try again.`). The revision and hashes are in `transcribe/model_download.rs` (`MODEL_REVISION`) and `KNOWN_MODELS`; they are not pinned yet.

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

- `model-download-progress` (`{ model: string, downloaded: number, total: number }`): bytes on disk so far and the full size (`total` is 0 when the server does not say), at most about ten per second. A resumed download starts at the bytes already there

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

Deletes a downloaded Whisper model file from disk. Fails with `Model '<name>' is in use by a running transcription. Try again when it finishes.` while a transcription is running with, or waiting for, that model; it never waits for the model lock.

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
listen<{ model: string; downloaded: number; total: number }>('model-download-progress', (event) => {
  const { model, downloaded, total } = event.payload;
  console.log(`${model}: ${total > 0 ? Math.round((downloaded / total) * 100) : 0}%`);
});

// Cancel a download
await tauriApi.cancelModelDownload('small');

// Record a meeting, then transcribe the finalized file as a background job
await tauriApi.startRecording('microphone');
// ... meeting happens ...
const rec = await tauriApi.stopRecording();   // { path, duration_secs, ... }
const jobId = crypto.randomUUID();
listen<{ job_id: string | null; audio_path: string; stage: string; percent: number }>(
  'transcription-progress',
  (event) => {
    if (event.payload.job_id === jobId) updateProgress(event.payload.stage, event.payload.percent);
  },
);
const result = await tauriApi.transcribeFile(jobId, rec.path, 'small', 'en');
// ... or stop it: transcribeFile then rejects with "Transcription cancelled"
await invoke('cancel_transcription', { jobId, audioPath: null });
```

### TranscriptionState (Managed State)

```rust
pub struct TranscriptionState {
    models_dir: PathBuf,
    download_cancels: Mutex<HashMap<String, Arc<AtomicBool>>>,
}
```

**Fields:**

- `models_dir`: Path to `~/.notesage/whisper-models/`
- `download_cancels`: Per-model cancel signals for concurrent downloads

## MCP Operations

Located in `src-tauri/src/commands/mcp/mod.rs` (helpers in `mcp/{transport,launch,state,types,config,validation,catalog,stderr_drain}.rs`) and `mcp_oauth.rs`. See `docs/features/ai-workflows.md` for the feature overview.

| Command | Signature (abridged) | Purpose |
| --- | --- | --- |
| `mcp_start_server` | `(config: McpServerConfig) -> McpServerInfo` | Connect (stdio spawn or http) → `initialize` → discover tools (all `tools/list` pages); register in `McpState`. Resolves secret env/header refs from the keychain. A failed start rejects with the error (server output included), emits `error`, and stays registered as `error` so it can be restarted. |
| `mcp_validate_server` | `(config) -> McpValidationResult` | Dry run (connect → handshake → `tools/list` → stop) without registering, 120 s budget. Returns `{ ok, tools, server_info, error, error_kind, stderr_tail }`; `error_kind` ∈ `binary_not_found \| spawn_failed \| init_failed \| timeout \| blocked_command`. |
| `mcp_stop_server` | `(server_id)` | Stop and unregister. Emits `stopped` only. http servers have no child process. |
| `mcp_restart_server` | `(server_id) -> McpServerInfo` | Stop, then start again. Works for a server that failed, exited or was stopped: the config comes from its handle, else from the last start in this session, else from `~/.notesage/mcp.json`. |
| `mcp_list_tools` | `(server_id, refresh?)` | Cache-first read-through: returns the handle's cached tools when non-empty; live `tools/list` (updating the cache) when empty or `refresh: true`. Rejects for a server that is not running. |
| `mcp_call_tool` | `(server_id, tool_name, arguments, timeout_ms?)` | Call a tool on a running server. |
| `mcp_get_server_status` | `() -> Vec<McpServerInfo>` | Snapshot of all registered servers, including ones in `error` (failed start, exited process). Wired to the Settings > MCP "Refresh status" button, which reconciles each card's running/stopped/tool-count state. |
| `mcp_catalog_list` | `() -> Vec<McpCatalogItem>` | Curated catalog manifest (embedded `mcp-catalog.json`). |
| `mcp_discover_configs` | `(base_dirs: Vec<String>) -> Vec<McpServerConfig>` | The servers in each project's `.notesage/mcp.json` and the global `~/.notesage/mcp.json`. Tolerant: an entry that cannot be read is left out, the rest of the file still loads. Always `enabled: false` (the frontend's enable override decides). |
| `mcp_config_problems` | `(project_paths: Vec<String>) -> Vec<McpConfigProblem>` | What discovery left out and why: `{ name, source, reason }` per bad entry (`name` = server key) or per unreadable file (`name` = file path); `source` ∈ `notesage_project \| notesage_global`. Empty when everything loaded. |
| `mcp_import_configs` / `mcp_check_import_sources` | `(source)` / `()` | Import sources: `claude-desktop` (`~/Library/Application Support/Claude/claude_desktop_config.json` on macOS; `%APPDATA%`/`~/.config` elsewhere), `cursor` (`~/.cursor/mcp.json`), `vscode` (`User/mcp.json` key `servers`, plus the legacy `settings.json` key `mcp.servers`). JSONC (comments, trailing commas) is accepted; imported entries keep `transport`/`url`/`headers`. |
| `mcp_save_config` | `(path, configs: Map<String, JSON object>)` | Write `configs` as the file's `mcpServers`. Entries are written verbatim (unknown keys and entries the app cannot parse survive); other top-level keys of the file are kept. |
| `mcp_oauth_authorize` | `(server_id, server_url, scope?) -> OAuthStatus` | Full browser OAuth: discovery (RFC 9728→8414) → DCR (RFC 7591) → PKCE → loopback callback → token exchange → keychain store. |
| `mcp_oauth_status` | `(server_id) -> OAuthStatus` | `{ authorized, expires_at }` — never returns token material. |
| `mcp_oauth_logout` | `(server_id)` | Clear stored tokens. |

**`McpServerConfig` / `McpServerInfo`** (snake_case fields): `id, name, command, args, env, source, enabled, transport ("stdio" \| "http"), url, headers, cwd` (+ `status, error, tools` on the info). `headers` (remote only) has the same value shape as `env`; `cwd` (stdio only, `~` allowed) defaults to the user's home directory when absent.

**`McpEnvValue`** (a value in `env` or `headers`): a bare JSON string is inline plaintext; `{ "secret": true }` is a keychain reference (value at `notesage:mcp:<server_id>:<KEY or Header-Name>`, resolved only when the server is started). Values are never logged.

**`mcp.json` entry:** `{ command, args, env, disabled, transport, type, url, headers, cwd }`, all optional. `transport` (`stdio` \| `http`) is what the app writes; on read, `type` (`stdio` \| `http` \| `streamable-http` \| `sse`) is accepted when `transport` is absent (the last two mean `http`), and an entry with only a `url` is remote.

**Wire format:** stdio servers speak newline-delimited JSON (one JSON-RPC message per line), not LSP's `Content-Length` framing; non-JSON lines on stdout are skipped. Server-initiated requests are answered (`ping` → `{}`, anything else → JSON-RPC "method not found"). Remote servers: Streamable HTTP only, with the configured headers, the OAuth bearer (unless `headers` sets `Authorization`) and `MCP-Protocol-Version` after `initialize`; a legacy HTTP+SSE endpoint is reported as unsupported.

**Spawn environment (stdio):** `~` is expanded in `command`, `cwd` and any argument that is `~` or starts with `~/`, then the launch guard runs on the result; PATH is the login shell's (or the inherited one plus the usual tool directories when the shell did not answer).

**Event `mcp-server-status`:** `{ serverId, status: "starting" \| "running" \| "stopped" \| "error", error?, tools? }`. When a running server's process exits, the backend marks it `error` in `McpState` (no tools) and emits `error` with the exit code and the server's last output.

**Deep link:** `notesage://mcp/install?...` (scheme via `tauri-plugin-deep-link`) opens the validate-first Add dialog pre-filled — parsed by `src/lib/mcp/deeplink.ts`, surfaced by `McpDeepLinkInstaller`.

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