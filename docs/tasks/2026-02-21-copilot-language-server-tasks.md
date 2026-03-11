# Copilot Language Server Integration — Task Breakdown

**PRD:** [2026-02-21-copilot-language-server.md](2026-02-21-copilot-language-server.md)
**Total:** 10 tasks — 3S, 4M, 3L + 1 bonus task
**Status:** ✅ Complete (2026-02-21)
**Estimated phases:** Backend plumbing (Tasks 1-5) → Frontend integration (Tasks 6-10) → Polish (Task 11)

## Summary

| \# | Title | Complexity | Category | Dependencies | Status |
| --- | --- | --- | --- | --- | --- |
| 1 | Add JSON-RPC transport layer | M | backend | — | Done |
| 2 | Add CopilotLspState and process lifecycle | L | backend | #1 | Done |
| 3 | Implement LSP initialization and auth commands | M | backend | #2 | Done |
| 4 | Implement document sync commands | S | backend | #2 | Done |
| 5 | Implement completion request/accept commands | M | backend | #2 | Done |
| 6 | Create GhostText Tiptap extension | L | frontend | — | Done |
| 7 | Create useCopilotCompletion hook | L | frontend | #5, #6 | Done |
| 8 | Add Copilot LSP auth flow to ConnectionsSettings | M | frontend | #3 | Done |
| 9 | Wire GhostText into Editor.tsx | S | frontend | #6, #7 | Done |
| 10 | Add ghost text styles and polish | S | frontend | #9 | Done |
| 11 | Status bar indicator and per-doc toggle | S | frontend | #9 | Done |

---

## Task 1: Add JSON-RPC transport layer

**Complexity:** M | **Category:** backend | **Dependencies:** none

### Description

Implement a minimal JSON-RPC 2.0 over stdio transport in Rust. This is the foundation for all LSP communication.

### Files

- `src-tauri/src/commands/copilot_lsp.rs` (new file — transport module section)

### Acceptance Criteria

- Struct `JsonRpcTransport` that wraps `BufReader<ChildStdout>` and `BufWriter<ChildStdin>`
- `send_request(method, params) -> Result<Value>` — writes `Content-Length` header + JSON body, tracks request ID, waits for response via oneshot channel
- `send_notification(method, params)` — writes without expecting response
- Reader loop that:
  - Parses `Content-Length` header from each message
  - Reads exact byte count
  - Dispatches responses to pending request channels by ID
  - Dispatches notifications (method calls from server) to a callback/channel
- Handles `window/showDocument` requests (for auth browser opening) by emitting Tauri events
- Handles `window/showMessageRequest` by auto-dismissing (log only)
- Handles `didChangeStatus` notifications by emitting `copilot-status-changed` Tauri event
- All server-to-client messages logged at debug level via `window/logMessage`

### Implementation Notes

- Use `AtomicU64` for request ID generation
- Use `HashMap<u64, oneshot::Sender<Value>>` for pending request tracking
- Reader runs on a separate `tokio::spawn` task
- Follow the thread pattern from `acp.rs` but adapted for LSP framing

---

## Task 2: Add CopilotLspState and process lifecycle

**Complexity:** L | **Category:** backend | **Dependencies:** #1

### Description

Create the managed Tauri state and commands for starting/stopping the Copilot LSP process.

### Files

- `src-tauri/src/commands/copilot_lsp.rs` (state + lifecycle)
- `src-tauri/src/commands/mod.rs` (add `pub mod copilot_lsp;`)
- `src-tauri/src/lib.rs` (add commands to `generate_handler![]`, add managed state)

### Acceptance Criteria

- `CopilotLspState` struct with `Mutex<Option<CopilotLspProcess>>`
- `resolve_copilot_binary()` function:
  - Checks PATH for `copilot-language-server`
  - Checks common npm global paths (`/opt/homebrew/lib/node_modules`, `/usr/local/lib/node_modules`, `~/.npm/...`)
  - Returns path to the binary or error
- `copilot_lsp_check_availability` command — returns `bool` (binary found)
- `copilot_lsp_start(working_directory)` command:
  - Resolves binary
  - Spawns process with `--stdio` flag
  - Creates `JsonRpcTransport`
  - Sends `initialize` request with editor info (`{ name: "Notesage", version: "0.13.0" }`)
  - Sends `initialized` notification
  - Sends `workspace/didChangeConfiguration` with default settings (telemetry off)
  - Stores process in state
- `copilot_lsp_stop` command:
  - Sends `shutdown` request
  - Sends `exit` notification
  - Kills process if still alive after 3s timeout
  - Clears state
- `copilot_lsp_status` command — returns current status (authenticated, message, kind)
- Process crash detection: reader task detects EOF, emits `copilot-status-changed` with kind `Error`

### Implementation Notes

- Read app version from `AppHandle` for editor info
- Follow the ACP binary resolution pattern from `acp.rs`
- Use `tokio::process::Command` for async process management
- The working directory is passed to `initialize` as `workspaceFolders`

---

## Task 3: Implement LSP initialization and auth commands

**Complexity:** M | **Category:** backend | **Dependencies:** #2

### Description

Add the authentication Tauri commands that handle the OAuth device flow.

### Files

- `src-tauri/src/commands/copilot_lsp.rs` (auth commands)
- `src-tauri/src/lib.rs` (add commands to `generate_handler![]`)

### Acceptance Criteria

- `copilot_lsp_sign_in` command:
  - Sends `signIn` request to LSP
  - Receives `{ userCode, command }` response
  - Emits `copilot-auth-device-code` Tauri event with `{ userCode, verificationUri }`
  - Sends `workspace/executeCommand` with `github.copilot.finishDeviceFlow` to trigger browser open
  - Returns the user code to the frontend (for UI display)
- `copilot_lsp_sign_out` command:
  - Sends `signOut` request to LSP
  - Returns success/error
- Handle `window/showDocument` request from LSP during auth:
  - LSP sends this to open the GitHub login page in browser
  - Use `tauri_plugin_opener` to open the URL
  - Return `{ success: true }` to LSP
- `didChangeStatus` notification handling:
  - When auth completes, LSP sends status update
  - Emit `copilot-status-changed` event
  - Update internal status in `CopilotLspProcess`

### Implementation Notes

- The auth flow is async — `signIn` returns immediately with the device code, the actual auth completes later via `didChangeStatus`
- The `window/showDocument` handler needs to be in the reader loop (Task 1) but the logic lives here
- Test with both personal and business GitHub accounts

---

## Task 4: Implement document sync commands

**Complexity:** S | **Category:** backend | **Dependencies:** #2

### Description

Add Tauri commands for LSP document synchronization.

### Files

- `src-tauri/src/commands/copilot_lsp.rs` (document sync commands)
- `src-tauri/src/lib.rs` (add commands to `generate_handler![]`)

### Acceptance Criteria

- `copilot_lsp_did_open(uri, content, version)` — sends `textDocument/didOpen` notification with `{ textDocument: { uri, languageId: "markdown", version, text: content } }`
- `copilot_lsp_did_change(uri, content, version)` — sends `textDocument/didChange` notification with full content replacement (single change covering entire document range)
- `copilot_lsp_did_close(uri)` — sends `textDocument/didClose` notification
- `copilot_lsp_did_focus(uri)` — sends custom `textDocument/didFocus` notification
- URI construction: convert file path to `file:///` URI (handle macOS paths correctly)
- All commands are fire-and-forget notifications (no response expected)

### Implementation Notes

- Start with full-content didChange (Option A from PRD) — send entire content as one change
- `languageId` should be `"markdown"` for all files in Notesage
- Version must be monotonically increasing per file — frontend manages this

---

## Task 5: Implement completion request/accept commands

**Complexity:** M | **Category:** backend | **Dependencies:** #2

### Description

Add Tauri commands for requesting and accepting inline completions.

### Files

- `src-tauri/src/commands/copilot_lsp.rs` (completion commands)
- `src-tauri/src/lib.rs` (add commands to `generate_handler![]`)

### Acceptance Criteria

- `copilot_lsp_request_completion(uri, line, character, version)` command:
  - Sends `textDocument/inlineCompletion` request with:

    ```json
    {
      "textDocument": { "uri": "file:///...", "version": N },
      "position": { "line": L, "character": C },
      "context": { "triggerKind": 2 },
      "formattingOptions": { "tabSize": 2, "insertSpaces": true }
    }
    ```
  - Returns `Vec<InlineCompletionItem>` (parsed from response `items[]`)
  - Returns empty vec if LSP returns null or error
- `InlineCompletionItem` struct:

  ```rust
  #[derive(Serialize, Deserialize)]
  pub struct InlineCompletionItem {
      pub insert_text: String,
      pub range: Option<CompletionRange>,
      pub command: Option<CompletionCommand>,
  }
  ```
- `copilot_lsp_accept_completion(command_name, args)` command:
  - Sends `workspace/executeCommand` with the acceptance tracking command
  - Sends `textDocument/didShowCompletion` notification (required by LSP spec)
- Handle cancellation: if a new completion request comes in while one is pending, the LSP auto-cancels the previous one

### Implementation Notes

- `triggerKind: 2` means "invoked" (as opposed to 1 = automatic) — use 2 for all requests
- The `formattingOptions` should match the editor's tab settings
- Keep response parsing lenient — some fields may be missing

---

## Task 6: Create GhostText Tiptap extension

**Complexity:** L | **Category:** frontend | **Dependencies:** none (can be developed in parallel with backend)

### Description

Create a Tiptap extension that renders ghost text (inline completion suggestions) as ProseMirror widget decorations.

### Files

- `src/components/editor/extensions/ghost-text.ts` (new)
- `src/components/editor/extensions/index.ts` (register extension)

### Acceptance Criteria

- Tiptap `Extension.create({ name: 'ghostText' })` with ProseMirror plugin
- Plugin state: `{ completion: { text, from, to, command } | null }`
- `setGhostText` transaction metadata to set/clear the completion
- When completion is set:
  - Creates `Decoration.widget()` at the cursor position
  - Widget renders `<span class="ghost-text">{text}</span>`
  - Widget is non-editable, non-selectable (`contenteditable: false`)
- When completion is cleared: removes decoration
- Keyboard shortcuts:
  - `Tab`: If ghost text is visible, accept it (insert text at position, dispatch custom event). Return `true` to consume the key.
  - `Escape`: If ghost text is visible, clear it. Return `true`.
- Auto-dismiss: ghost text clears on any document change transaction (unless it's the acceptance insert)
- Position remapping: if document changes while ghost text is shown (e.g., undo), clear the ghost text
- Does NOT interfere with:
  - Slash command menu (Tab should still work for slash commands when no ghost text)
  - InlineDiff decorations (ghost text is cleared when inline diff is active)
  - Normal Tab behavior (indentation in code blocks, etc.)

### Implementation Notes

- Follow the pattern from `inline-diff.ts` and `ai-suggestion.ts`
- Use `Decoration.widget()` not `Decoration.inline()` — widget doesn't affect text layout
- The widget DOM should be an inline span that appears right after the cursor character
- Priority: ghost text should have lower priority than inline diff decorations
- Export `GhostTextPluginKey` for external access (hook needs to dispatch transactions)
- Export `clearGhostText(editor)` and `setGhostText(editor, completion)` helper functions

---

## Task 7: Create useCopilotCompletion hook

**Complexity:** L | **Category:** frontend | **Dependencies:** #5, #6

### Description

Create the React hook that orchestrates the Copilot LSP lifecycle, document sync, and completion requests.

### Files

- `src/hooks/useCopilotCompletion.ts` (new)

### Acceptance Criteria

- Reads `inline_completion` connection from routing-store
- If no connection assigned, hook is a no-op (returns early)
- **LSP lifecycle:**
  - Spawns LSP on first use when a connection is assigned (`copilot_lsp_start`)
  - Shuts down LSP when connection is removed or app unmounts (`copilot_lsp_stop`)
- **Document sync:**
  - Tracks active tab file path and content
  - Sends `didOpen` when a new tab becomes active
  - Sends `didChange` on editor content updates (debounced 300ms)
  - Sends `didClose` when tab is closed or deactivated
  - Sends `didFocus` when tab becomes active
  - Maintains version counter per file URI
- **Completion requests:**
  - After 150ms of typing inactivity, requests a completion at cursor position
  - Cancels pending request if user types again (new request cancels old)
  - On response: dispatches `setGhostText` transaction to the editor
  - Clears ghost text when no items returned
  - Does not request when:
    - Selection is not collapsed (user is selecting text)
    - Editor is not focused
    - InlineDiff is active
    - Slash command menu is open
- **Event listeners:**
  - Listens for `copilot-status-changed` events
  - Listens for `copilot-auth-device-code` events (for auth flow)
- **Cleanup:**
  - Properly unlistens all events on unmount
  - Clears timeouts and cancels pending requests

### Implementation Notes

- Use `editor.on('selectionUpdate', ...)` for cursor position tracking
- Use `editor.on('update', ...)` for content changes
- Convert file paths to `file:///` URIs for the LSP
- Debounce using `setTimeout` / `clearTimeout` pattern (no external debounce library)
- The hook takes `editor: Editor | null` as a parameter (from `useEditor`)
- Position mapping: convert ProseMirror position to LSP line/character using `editor.state.doc`

---

## Task 8: Add Copilot LSP auth flow to ConnectionsSettings

**Complexity:** M | **Category:** frontend | **Dependencies:** #3

### Description

Extend the `ConnectAgent` flow in ConnectionsSettings to handle Copilot LSP authentication (separate from ACP agent auth).

### Files

- `src/components/settings/ConnectionsSettings.tsx`
- `src/lib/ai/connections.ts` (update GitHub/Copilot provider option)

### Acceptance Criteria

- When connecting a GitHub Copilot connection:
  - Check binary availability via `copilot_lsp_check_availability`
  - If not found: show install instructions (same `not_installed` phase pattern)
  - If found: start LSP and initiate sign-in
- **Device code phase** (new `AgentPhase` value: `device_code`):
  - Display user code prominently (large, monospace, centered)
  - "Open GitHub" button to open `https://github.com/login/device` in browser
  - "Copy code" button to copy device code to clipboard
  - Instruction text: "Enter this code on GitHub to sign in"
  - Wait for `copilot-status-changed` event with authenticated state
- On auth success: auto-transition to `connected` phase
- On auth failure/timeout: show error with retry option
- Update `PROVIDER_OPTIONS` for GitHub Copilot:
  - `binaryName`: `"copilot-language-server"`
  - Ensure capabilities include `inline_completion`
- Connection card shows "Copilot LSP" status indicator

### Implementation Notes

- The device code flow is different from ACP auth (which opens a browser popup directly)
- The `signIn` response includes both the code and a command — we show the code and let the command handle browser opening
- Reuse existing `ConnectAgent` component structure, just add the `device_code` phase
- Listen for `copilot-auth-device-code` event for the user code display

---

## Task 9: Wire GhostText into Editor.tsx

**Complexity:** S | **Category:** frontend | **Dependencies:** #6, #7

### Description

Integrate the ghost text extension and completion hook into the editor.

### Files

- `src/components/editor/Editor.tsx`
- `src/components/editor/extensions/index.ts` (add GhostText to extension list)

### Acceptance Criteria

- GhostText extension added to the Tiptap editor extensions list
- `useCopilotCompletion(editor)` called in `Editor.tsx` (or the appropriate parent component)
- Ghost text properly shows/hides based on completion responses
- Tab-to-accept inserts text and updates editor content (triggers save flow)
- Ghost text clears when:
  - User switches tabs
  - External change review activates
  - Editor loses focus
  - Settings dialog opens

### Implementation Notes

- The extension should be conditionally included only when `inline_completion` routing is configured (avoid loading extension overhead when not needed)
- Or always include it but have it be a no-op when no completions are active (simpler, negligible overhead)
- Prefer the simpler approach: always include, no-op when unused

---

## Task 10: Add ghost text styles and polish

**Complexity:** S | **Category:** frontend | **Dependencies:** #9

### Description

Add CSS styles for ghost text and polish the visual presentation.

### Files

- `src/styles/editor.css` (ghost text styles)

### Acceptance Criteria

- `.ghost-text` class with:
  - `color: var(--muted-foreground)` — uses theme variable
  - `opacity: 0.4` — clearly dimmed
  - `font-style: italic` — distinguishes from real content
  - `pointer-events: none` — not clickable
  - `user-select: none` — not selectable
  - `transition: opacity 100ms ease-in` — smooth fade-in
- Ghost text renders correctly in both light and dark mode
- Ghost text does not cause layout shifts (no width/height changes to surrounding content)
- Multi-line completions display properly
- Ghost text works with all editor content types (headings, lists, code blocks, paragraphs)
- No ghost text flickering during rapid typing (debounce handles this)

### Implementation Notes

- Test with long completions (100+ characters) — should not overflow
- Test with completions at end of line vs middle of line
- Test in both themes
- The widget decoration approach means ghost text is a separate DOM element — it won't affect the ProseMirror content model

---

## Task 11: Status bar indicator and per-document toggle

**Complexity:** S | **Category:** frontend | **Dependencies:** #9

### Description

Add a clickable Copilot status indicator in the editor status bar with a popover to toggle completions on/off per document. Also rename "GitHub Copilot LS" → "GitHub Copilot LSP" throughout the UI, remove debug console.logs from ghost-text, and correct the Copilot CLI provider capabilities (remove `inline_completion` — only the LSP supports it, not the ACP CLI).

### Files

- `src/lib/ai/connections.ts` (rename label, fix Copilot CLI capabilities)
- `src/components/editor/extensions/ghost-text.ts` (remove debug logs)
- `src/stores/editor-store.ts` (add `copilotDisabled` tab field + toggle method)
- `src/hooks/useCopilotCompletion.ts` (guard on disabled flag, clear ghost text)
- `src/components/editor/StatusBar.tsx` (add Copilot indicator with popover)
- `src/components/editor/Editor.tsx` (wire new StatusBar props)

### Acceptance Criteria

- "GitHub Copilot LS" renamed to "GitHub Copilot LSP" in provider options
- Copilot CLI provider (`copilot --acp`) no longer claims `inline_completion` capability
- Debug `console.log` statements removed from ghost-text extension (keep `console.warn` for errors)
- Per-tab `copilotDisabled` boolean flag (session-only, not persisted, resets on tab close)
- Completion requests and ghost text suppressed when `copilotDisabled` is true
- Existing ghost text cleared immediately when toggle is switched off
- Status bar shows GitHub icon when `inline_completion` connection is configured
- Icon dims (40% opacity) when disabled for the current document
- Popover shows connection name, green/grey status dot, toggle switch, and helper text
- No icon shown when no inline completion connection is configured

### Implementation Notes

- `copilotDisabled` is on the `Tab` interface but NOT in `PersistedTab` or `partialize` — purely session-scoped
- The toggle still sends `didChange` to keep the LSP in sync — only completion requests are suppressed
- Uses shadcn/ui `Popover` and `Switch` components per design system rules