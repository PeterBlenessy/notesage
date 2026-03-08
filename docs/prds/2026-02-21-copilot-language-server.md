# Copilot Language Server Integration — Inline Completions (Phase 6e)

**Status:** Implemented
**Date:** 2026-02-21
**Author:** Claude (with Peter)
**Depends on:** Phase 6a-6d (AI Provider Architecture v2) — completed
**Implemented:** 2026-02-21 (Tasks 1-10 complete, plus per-document toggle and status bar indicator)

## Problem

Notesage already supports multiple AI providers for chat and inline actions, but has no inline completion ("ghost text") feature. Users who have GitHub Copilot subscriptions through their workplace (often IDE-extension-only, no CLI access) cannot leverage those subscriptions for autocomplete suggestions while writing.

The `inline_completion` routing slot exists in the architecture but has no implementation behind it. Users must currently leave their editor flow to interact with AI — there's no keystroke-speed, low-friction suggestion path.

## Goals

1. **Ghost text completions** — Show inline AI suggestions as dimmed text ahead of the cursor, accept with Tab
2. **Copilot subscription reuse** — Users authenticate with their existing GitHub account (including Copilot for Business), no separate API key needed
3. **Sub-200ms perceived latency** — Completions must feel instant; pre-fetch and debounce to avoid lag
4. **Zero disruption** — Ghost text never interferes with normal typing; dismisses on any keystroke that doesn't accept
5. **Works with existing architecture** — Routes through the `inline_completion` slot, coexists with other providers for chat/agent tasks

## Non-Goals

- **Chat or inline actions via Copilot LSP** — Interactive features use ACP agents, not the LSP
- **Multi-line panel completions** — `copilotPanelCompletion` is out of scope; focus on inline ghost text only
- **Copilot for non-markdown files** — We only need completions for `.md` files (natural language writing, not code)
- **Free tier usage tracking UI** — Deferred; may add a subtle indicator later
- **Custom model selection** — Use whatever model Copilot provides by default
- **Copilot inline edits** — `copilotInlineEdit` ("next edit suggestions") is a separate feature, deferred

## User Stories

1. **As a writer with Copilot at work**, I want to see completion suggestions as I type so that I can write faster without leaving my editor flow.
2. **As a new user**, I want to connect my GitHub account once and have completions start working immediately, without configuring API keys or installing CLI tools.
3. **As a power user**, I want to assign Copilot to inline completions while using Claude for chat, so each AI does what it's best at.
4. **As a user who doesn't want completions**, I want to easily disable ghost text without affecting my other AI features.

## Technical Approach

### Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│ Frontend (React + Tiptap)                                   │
│                                                             │
│  Editor.tsx                                                 │
│    └─ GhostText extension (ProseMirror plugin)              │
│         ├─ On cursor move / typing pause → request          │
│         ├─ On response → show widget decoration             │
│         ├─ On Tab → accept (insert text, notify LSP)        │
│         └─ On any other key → dismiss                       │
│                                                             │
│  useCopilotCompletion hook                                  │
│    ├─ Manages LSP lifecycle (spawn, auth, shutdown)         │
│    ├─ Sends didOpen/didChange/didClose for active tab       │
│    ├─ Debounces completion requests (~150ms after pause)    │
│    └─ Listens for copilot-completion events                 │
│                                                             │
│  routing-store                                              │
│    └─ inline_completion → connection ID (GitHub/Copilot)    │
├─────────────────────────────────────────────────────────────┤
│ Tauri IPC                                                   │
├─────────────────────────────────────────────────────────────┤
│ Rust Backend                                                │
│                                                             │
│  commands/copilot_lsp.rs                                    │
│    ├─ copilot_lsp_start(working_dir)                        │
│    ├─ copilot_lsp_stop()                                    │
│    ├─ copilot_lsp_sign_in()                                 │
│    ├─ copilot_lsp_sign_out()                                │
│    ├─ copilot_lsp_status()                                  │
│    ├─ copilot_lsp_did_open(uri, content, version)           │
│    ├─ copilot_lsp_did_change(uri, changes, version)         │
│    ├─ copilot_lsp_did_close(uri)                            │
│    ├─ copilot_lsp_did_focus(uri)                            │
│    ├─ copilot_lsp_request_completion(uri, position, ctx)    │
│    └─ copilot_lsp_accept_completion(command)                │
│                                                             │
│  CopilotLspState (managed state)                            │
│    ├─ process: Child (stdio transport)                      │
│    ├─ connection: JSON-RPC reader/writer                    │
│    ├─ request_id: AtomicU64                                 │
│    ├─ pending_requests: HashMap<u64, oneshot::Sender>       │
│    └─ status: { authenticated, message, kind }              │
│                                                             │
│  LSP Thread                                                 │
│    ├─ Spawns copilot-language-server --stdio                │
│    ├─ Handles JSON-RPC 2.0 framing (Content-Length header)  │
│    ├─ Routes server→client notifications to Tauri events    │
│    └─ Routes command→response via pending_requests map      │
└─────────────────────────────────────────────────────────────┘
```

### Rust Backend — `commands/copilot_lsp.rs`

New command module following the pattern established by `acp.rs`.

**Process lifecycle:**

1. `copilot_lsp_start` — Resolves the `copilot-language-server` binary (npm global, local node_modules, or bundled), spawns with `--stdio`, sends `initialize` → `initialized` → `workspace/didChangeConfiguration`
2. LSP reader thread continuously reads JSON-RPC messages from stdout, dispatches responses to pending request channels and notifications to Tauri events
3. `copilot_lsp_stop` — Sends `shutdown` request, then `exit` notification, kills process

**Authentication:**

1. `copilot_lsp_sign_in` — Sends `signIn` request, receives `{ userCode, command }`
2. Emits `copilot-auth-device-code` event with the user code for UI display
3. Executes `workspace/executeCommand` with `github.copilot.finishDeviceFlow` — LSP opens browser via `window/showDocument`
4. LSP sends `didChangeStatus` notification when auth completes → emitted as `copilot-status-changed` event

**Completion flow:**

1. `copilot_lsp_request_completion` — Sends `textDocument/inlineCompletion` request with URI, position, context
2. Response contains `items[]` with `insertText`, `range`, and `command` (for acceptance tracking)
3. Returns items to frontend (or emits as event for async flow)

**Document sync:**

- `copilot_lsp_did_open` — Sends `textDocument/didOpen` with full content
- `copilot_lsp_did_change` — Sends `textDocument/didChange` with incremental changes
- `copilot_lsp_did_close` — Sends `textDocument/didClose`
- `copilot_lsp_did_focus` — Sends custom `textDocument/didFocus`

**JSON-RPC transport:**

Implement a minimal JSON-RPC 2.0 over stdio transport:
- Write: `Content-Length: {len}\r\n\r\n{json}`
- Read: Parse `Content-Length` header, read exact bytes, parse JSON
- Use `tokio::io::BufReader` / `BufWriter` on child process stdin/stdout

**Managed state:**

```rust
pub struct CopilotLspState {
    process: Mutex<Option<CopilotLspProcess>>,
}

struct CopilotLspProcess {
    child: tokio::process::Child,
    writer: Mutex<BufWriter<ChildStdin>>,
    next_id: AtomicU64,
    pending: Mutex<HashMap<u64, oneshot::Sender<serde_json::Value>>>,
    status: Mutex<CopilotStatus>,
}
```

### Frontend — Ghost Text Extension

New Tiptap extension: `src/components/editor/extensions/ghost-text.ts`

**ProseMirror plugin with widget decoration:**

- Stores current completion state: `{ text, from, to, command }` or null
- On state update (from hook), creates a `Decoration.widget()` at the cursor position
- Widget renders a `<span>` with ghost text styling (dimmed, italic)
- On `Tab` keypress: accept — insert text at position, send `didShowCompletion` + execute accept command, clear state
- On any other keypress / cursor move: dismiss — clear state

**Styling (editor.css):**

```css
.ghost-text {
  color: var(--muted-foreground);
  opacity: 0.5;
  font-style: italic;
  pointer-events: none;
  user-select: none;
}
```

**Keyboard shortcuts:**

| Key | Action |
|-----|--------|
| `Tab` | Accept full completion (insert text) |
| `Escape` | Dismiss completion |
| Any other key | Dismiss and process keystroke normally |

### Frontend — `useCopilotCompletion` Hook

New hook: `src/hooks/useCopilotCompletion.ts`

**Responsibilities:**

1. **Lifecycle management** — Start/stop LSP based on routing store (`inline_completion` slot)
2. **Document sync** — Track active tab, send `didOpen`/`didChange`/`didClose`/`didFocus`
3. **Completion requests** — Debounce cursor/content changes, request completions
4. **Event handling** — Listen for `copilot-status-changed`, `copilot-auth-device-code`

**Debouncing strategy:**

- After each keystroke, wait 150ms of inactivity before requesting a completion
- Cancel any in-flight request when the user types again (LSP handles this server-side too)
- Don't request completions when:
  - Selection is not empty (user is selecting text)
  - Cursor is at the start of a node (likely just pressed Enter)
  - Editor is not focused

**Document version tracking:**

- Maintain an incrementing version counter per file (LSP requires `textDocument.version`)
- Increment on every `didChange` call

### Frontend — Auth UI

Reuse the existing `ConnectAgent` flow in `ConnectionsSettings.tsx`:

- GitHub Copilot LSP uses the same connection card pattern
- When connecting: call `copilot_lsp_start` → `copilot_lsp_sign_in`
- Show device code to user ("Enter code ABCD-EFGH on github.com/login/device")
- Wait for `copilot-status-changed` event confirming auth
- Connection status indicator updates (green dot = connected)

### Incremental Document Sync

The LSP requires incremental text changes, not full document replacement. Two approaches:

**Option A — Full content on each change (simpler):**
Send the entire document content as a single change with range covering the whole document. Many LSP servers accept this even in incremental mode. Start with this.

**Option B — True incremental (if needed for performance):**
Track ProseMirror transactions, compute text-level diffs, send minimal change ranges. Only implement if Option A proves too slow.

## UI/UX

### Ghost Text Appearance

- Dimmed text (`opacity: 0.5`) in the same font as the editor content
- Italic to distinguish from real content
- Appears inline at the cursor position, continuing from where the user stopped typing
- Multi-line completions: show up to 3 lines, with a subtle "..." indicator if truncated
- Smooth fade-in (100ms `opacity` transition)

### Ghost Text Interaction

- **Tab**: Accept the completion — text becomes real content
- **Escape**: Dismiss without accepting
- **Any typing**: Ghost text disappears, new character is inserted normally
- **Arrow keys**: Ghost text disappears, cursor moves normally
- **No completion available**: Nothing shown (no loading indicator — must feel instant)

### Auth Flow UI

When adding a Copilot connection:

1. User clicks "Add Connection" → picks "GitHub Copilot"
2. App checks for `copilot-language-server` binary
3. If not found: show install instructions (same pattern as agent install wizard)
4. If found: "Connecting..." spinner
5. LSP starts, `signIn` returns device code
6. Show: "Enter code **ABCD-EFGH** on github.com/login/device" with a "Open GitHub" button
7. User authenticates in browser
8. Connection card shows green dot, "Connected"
9. `inline_completion` routing slot auto-assigned to this connection

### Settings

- **Enable/disable toggle**: In the routing section, user can set `inline_completion` to "None" to disable ghost text
- **No additional settings needed initially** — Copilot LSP handles model selection, context length, etc. internally

## Data Model

### New Tauri Commands

```rust
// Lifecycle
copilot_lsp_start(app: AppHandle, working_directory: String) -> Result<(), String>
copilot_lsp_stop(app: AppHandle) -> Result<(), String>
copilot_lsp_status(app: AppHandle) -> Result<CopilotStatus, String>

// Auth
copilot_lsp_sign_in(app: AppHandle) -> Result<SignInResponse, String>
copilot_lsp_sign_out(app: AppHandle) -> Result<(), String>

// Document sync
copilot_lsp_did_open(app: AppHandle, uri: String, content: String, version: u32) -> Result<(), String>
copilot_lsp_did_change(app: AppHandle, uri: String, content: String, version: u32) -> Result<(), String>
copilot_lsp_did_close(app: AppHandle, uri: String) -> Result<(), String>
copilot_lsp_did_focus(app: AppHandle, uri: String) -> Result<(), String>

// Completions
copilot_lsp_request_completion(
    app: AppHandle,
    uri: String,
    line: u32,
    character: u32,
    version: u32,
) -> Result<Vec<InlineCompletionItem>, String>

copilot_lsp_accept_completion(app: AppHandle, command: String, args: Vec<String>) -> Result<(), String>

// Binary check
copilot_lsp_check_availability(app: AppHandle) -> Result<bool, String>
```

### Tauri Events

| Event | Payload | Direction |
|-------|---------|-----------|
| `copilot-status-changed` | `{ message: string, kind: "Normal" \| "Error" \| "Warning" \| "Inactive" }` | Server → Frontend |
| `copilot-auth-device-code` | `{ userCode: string, verificationUri: string }` | Server → Frontend |

### TypeScript Types

```typescript
interface InlineCompletionItem {
  insertText: string;
  range: { start: { line: number; character: number }; end: { line: number; character: number } };
  command?: { command: string; arguments: string[] };
}

interface CopilotStatus {
  authenticated: boolean;
  message: string;
  kind: 'Normal' | 'Error' | 'Warning' | 'Inactive';
}
```

### Existing Types (already defined, no changes needed)

- `AICapability` includes `'inline_completion'`
- `UseCaseRouting.inline_completion` slot exists
- `PROVIDER_CAPABILITIES.github.agent_managed` includes `'inline_completion'`

## Dependencies

| Package | Purpose | Where |
|---------|---------|-------|
| `@github/copilot-language-server` | The LSP binary | User-installed globally via npm (or auto-install via install wizard) |
| `tokio` | Async process spawn + I/O | Already in Cargo.toml |
| `serde_json` | JSON-RPC message parsing | Already in Cargo.toml |

No new Rust crate dependencies needed — JSON-RPC 2.0 over stdio is simple enough to implement with existing deps. The LSP client is intentionally minimal (we only use ~10 methods).

## Quality Gates

### Functional

- [x] `copilot-language-server` binary detected when installed globally
- [x] LSP process starts and completes `initialize` handshake
- [x] OAuth device flow works — user can sign in via browser
- [x] `didChangeStatus` correctly updates connection status indicator
- [x] Document opens are synced to LSP when tab becomes active
- [x] Document changes are synced incrementally as user types
- [x] Completion request fires ~150ms after typing pause
- [x] Ghost text appears at cursor position with suggested text
- [x] Tab accepts the completion and inserts text
- [x] Escape dismisses the completion
- [x] Any keystroke dismisses the completion and processes normally
- [x] Ghost text does not appear during text selection
- [x] Ghost text does not interfere with slash commands or bubble menu
- [x] Completions work across tab switches (didClose old, didOpen new)
- [x] LSP process shuts down cleanly when app closes
- [x] LSP process restarts if it crashes
- [x] Works when Copilot is the only connection (no other providers configured)
- [x] Works alongside other providers (e.g., Claude for chat + Copilot for completions)

### Design

- [x] Ghost text is clearly distinguishable from real content (dimmed, italic)
- [x] Ghost text feels native — no jarring appearance/disappearance
- [x] Smooth fade-in transition (100ms)
- [x] No layout shift when ghost text appears/disappears
- [x] Auth flow reuses existing connection card design
- [x] Device code display is clear and prominent
- [x] Both light and dark mode look correct

### Performance

- [x] Completion request-to-display under 500ms in normal conditions
- [x] No visible editor lag while LSP is running
- [x] Document sync does not block the editor
- [x] Dismissed completions don't cause flickering

## Out of Scope

- **Panel completions** — Multi-suggestion panel (`copilotPanelCompletion`) is deferred
- **Inline edits** — `copilotInlineEdit` (AI-suggested deletions/rewrites) is deferred
- **Partial acceptance** — `didPartiallyAcceptCompletion` (accept word-by-word) is a nice-to-have, deferred
- **GitHub Enterprise configuration** — `github-enterprise.uri` setting, deferred
- **Proxy configuration** — `http.proxy` passthrough, deferred
- **Telemetry configuration** — Default to `off`, no UI for changing it
- **Free tier usage tracking** — Completions remaining counter, deferred
- **Auto-install of copilot-language-server** — Covered by the separate Agent Install Wizard PRD
