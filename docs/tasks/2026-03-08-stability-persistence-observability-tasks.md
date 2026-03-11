# Task Breakdown: App Stability, Persistence & Observability

**Status:** ✅ Complete

**PRD:** `docs/prds/2026-03-08-stability-persistence-observability.md`**Total:** 22 tasks — 22/22 done — 5S, 10M, 7L **Estimated effort:** \~30 hours

## Suggested Implementation Order

Start with **logging** (tasks 1-5) — it enables diagnosing everything else. Then **persistence migration** (6-9) to eliminate the localStorage bottleneck. Then **store bounds** (10-14) for long-session resilience. Then **sleep/wake recovery** (15-19) for the overnight crash fix. Finally **resource leak fixes** (20-22) to close remaining gaps.

## Risks & Open Questions

- `tauri-plugin-log` compatibility with Tauri v2 — verify before starting task 1
- localStorage → file migration: if a user downgrades, they lose state (acceptable, but worth noting in release notes)
- App Nap disabling may affect battery life — document the trade-off

---

## Phase D: Structured Logging (Tasks 1–5)

### ✅ Task 1 — Add `tauri-plugin-log` and Rust logging infrastructure

**Complexity:** M | **Category:** backend | **Dependencies:** none

**Description**:Add `tauri-plugin-log` to `Cargo.toml` and `log` crate. Configure the plugin in `lib.rs` with:

- Rotating file output (5MB per file, 5 files max)
- Stdout output in dev mode
- `Info` level default, `Debug` when toggled
- Timestamp + level + target format

Wire the existing `set_debug_logging` command to change the log level filter at runtime.

**Acceptance criteria:**

- `log::info!("test")` writes to `~/Library/Logs/com.notesage.app/notesage.log`
- Log rotation works (create a 6MB test entry → second file created)
- Debug toggle changes log level at runtime

**Files:**

- `src-tauri/Cargo.toml` — add `tauri-plugin-log` and `log` dependencies
- `src-tauri/src/lib.rs` — register plugin, replace `debug_log!` macro and `DEBUG_LOGGING` atomic, update `set_debug_logging` to use `log::set_max_level()`

---

### ✅ Task 2 — Replace `eprintln!` / `debug_log!` with `log::*` across Rust backend

**Complexity:** M | **Category:** backend | **Dependencies:** #1

**Description**:Replace all `eprintln!` and `debug_log!` calls in the Rust backend with appropriate `log::*` macros (`log::info!`, `log::warn!`, `log::error!`, `log::debug!`). Use target-qualified logging for category filtering.

Add the critical log points from PRD section D4:

- App startup complete
- Process spawn/stop/error
- Watcher start/stop/error
- Streaming start/complete/error

**Acceptance criteria:**

- Zero `eprintln!` or `debug_log!` calls remaining in `src-tauri/src/`
- All log calls use structured targets (`notesage::watcher`, `notesage::acp`, etc.)
- Log file shows meaningful output during a normal dev session

**Files:**

- `src-tauri/src/commands/watcher.rs`
- `src-tauri/src/commands/acp.rs`
- `src-tauri/src/commands/copilot_lsp.rs`
- `src-tauri/src/commands/mcp.rs`
- `src-tauri/src/commands/ai_streaming.rs`
- `src-tauri/src/commands/ai.rs`
- `src-tauri/src/commands/skills.rs`
- `src-tauri/src/lib.rs` — remove `debug_log!` macro and `DEBUG_LOGGING` static

---

### ✅ Task 3 — Create frontend structured logger with backend forwarding

**Complexity:** M | **Category:** both | **Dependencies:** #1

**Description**:Create `src/lib/logger.ts` with `log.debug()`, `log.info()`, `log.warn()`, `log.error()` methods. Each method:

- Logs to `console` (dev: always; prod: warn/error always, info/debug only when debug toggle on)
- Queues a `LogEntry` for backend forwarding
- Batch-flushes to `log_frontend` Tauri command every 500ms or 20 entries

Add `log_frontend` Tauri command that writes entries to the Rust log via `log::info!` etc. with `[frontend:{category}]` target prefix.

**Acceptance criteria:**

- `log.info('chat', 'Message sent', { length: 42 })` appears in both console and log file
- Batching confirmed: rapid calls don't trigger 100 IPC invocations
- Flush on `beforeunload` so no entries lost on quit

**Files:**

- `src/lib/logger.ts` — new file
- `src-tauri/src/commands/mod.rs` — add `pub mod logging;`
- `src-tauri/src/commands/logging.rs` — new file with `log_frontend`, `get_log_path`, `clear_logs`, `get_log_size` commands
- `src-tauri/src/lib.rs` — register new commands in `generate_handler![]`

---

### ✅ Task 4 — Replace `debugLog` / `console.log` with structured logger in frontend

**Complexity:** M | **Category:** frontend | **Dependencies:** #3

**Description**:Replace all `debugLog()` calls and diagnostic `console.log()` calls with `log.*()` calls using appropriate categories and levels. Delete `src/lib/debug.ts`.

Add the critical frontend log points from PRD section D4:

- Lifecycle: startup complete, wake detected, health check
- AI: message sent, streaming start/complete/error
- Store: write, migration, pruning
- Watcher: event batch processed

**Acceptance criteria:**

- `src/lib/debug.ts` deleted
- No bare `console.log` for diagnostic purposes (keep `console.error` in catch blocks as fallback)
- At least 30 log call sites across hooks, stores, and App.tsx

**Files:**

- `src/lib/debug.ts` — delete
- `src/App.tsx`
- `src/hooks/useAIOperations.ts`
- `src/hooks/useFileWatcher.ts`
- `src/hooks/useCopilotCompletion.ts`
- `src/hooks/useMcpOperations.ts`
- `src/hooks/useAgentTaskOperations.ts`
- `src/hooks/useSkillOperations.ts`
- `src/stores/comment-store.ts`
- `src/components/settings/ConnectionsSettings.tsx`

---

### ✅ Task 5 — Add log file management UI in Settings

**Complexity:** S | **Category:** frontend | **Dependencies:** #3

**Description**:Add a "Log Files" section in Settings &gt; Advanced, below the existing "Debug Logging" toggle:

- Display log file path from `get_log_path` command
- Display total size from `get_log_size` command
- "Reveal in Finder" button (calls existing `reveal_in_finder`)
- "Clear Logs" button with confirmation dialog (calls `clear_logs`)

Follow existing Settings layout patterns and design system.

**Acceptance criteria:**

- Log path and size displayed correctly
- "Reveal in Finder" opens the log directory in Finder
- "Clear Logs" prompts confirmation, then deletes logs and refreshes size display

**Files:**

- `src/components/settings/SettingsDialog.tsx` — add log files section in Advanced tab

---

## Phase B: Persistence Migration (Tasks 6–9)

### ✅ Task 6 — Add Tauri-side state file commands

**Complexity:** M | **Category:** backend | **Dependencies:** #1 (for logging)

**Description**:Add `store_read`, `store_write`, and `store_delete` commands in a new `src-tauri/src/commands/store.rs`. Files stored in `~/.notesage/state/{key}.json`. Writes must be atomic: write to `.tmp` file, then `rename()`.

Log all reads/writes with store name and byte size.

**Acceptance criteria:**

- `store_write("test", "{}")` creates `~/.notesage/state/test.json`
- `store_read("test")` returns the content
- `store_delete("test")` removes the file
- Atomic write: killing the app mid-write doesn't corrupt the file
- Directory auto-created on first write

**Files:**

- `src-tauri/src/commands/store.rs` — new file
- `src-tauri/src/commands/mod.rs` — add `pub mod store; pub use store::*;`
- `src-tauri/src/lib.rs` — register commands in `generate_handler![]`

---

### ✅ Task 7 — Create throttled Zustand storage adapter

**Complexity:** L | **Category:** frontend | **Dependencies:** #6

**Description**:Create `src/lib/tauri-storage.ts` implementing Zustand's `StateStorage` interface:

- `getItem(key)` — calls `store_read` (async, used during rehydration)
- `setItem(key, value)` — enqueues write, throttled to max 1 write per 2s per key
- `removeItem(key)` — calls `store_delete`

The throttle must:

- Accept the latest value immediately if no write is pending
- If a write is pending, replace the queued value (don't accumulate)
- Flush all pending writes on `beforeunload`

**Acceptance criteria:**

- 100 rapid `setItem` calls within 2s result in exactly 1 `store_write` IPC call
- Value from the last `setItem` is what gets written
- `beforeunload` flushes pending writes synchronously (via `navigator.sendBeacon` or sync XHR fallback)
- Storage adapter is a drop-in replacement for `localStorage` in all persist configs

**Files:**

- `src/lib/tauri-storage.ts` — new file

---

### ✅ Task 8 — Migrate chat and activity stores to Tauri storage adapter

**Complexity:** L | **Category:** frontend | **Dependencies:** #7

**Description**:Replace `{ name: 'store-name' }` persist config with `{ name: 'store-name', storage: createTauriStorage() }` in all persisted stores. The adapter's `getItem` must handle the async nature of Tauri IPC (Zustand persist supports async storage).

**Stores to migrate:**

- `chat-store` (`notesage-chat-history`)
- `activity-store` (`notesage-activity`)
- `editor-store` (`notesage-editor`)
- `workspace-store` (`notesage-workspace`)
- `settings-store` (`notesage-settings`)
- `ai-store` (`notesage-ai`)
- `skill-store` (`notesage-skills`)
- `mcp-store` (`notesage-mcp`)
- `connections-store` (`notesage-connections`)
- `routing-store` (`notesage-routing`)
- `permission-store` (`notesage-permissions`)
- `epub-store` (`notesage-epub`)
- `pdf-store` (`notesage-pdf-export`)

**Acceptance criteria:**

- All stores read/write from `~/.notesage/state/` files
- App starts correctly with existing localStorage data (migration in task 9)
- App starts correctly on a fresh install (no state files, no localStorage)

**Files:**

- All files in `src/stores/` that use `persist()`

---

### ✅ Task 9 — Implement one-time localStorage → file migration

**Complexity:** M | **Category:** frontend | **Dependencies:** #8

**Description**:Add migration logic in the storage adapter or a startup hook:

1. On `getItem(key)`: if file doesn't exist, check `localStorage.getItem(key)`
2. If found in localStorage: write to file via `store_write`, remove from localStorage
3. Log the migration (store name, size)

This is a one-time, idempotent migration. After all stores are migrated, localStorage should be empty (except for non-Zustand items).

**Acceptance criteria:**

- Existing user data survives the update without loss
- localStorage entries removed after successful migration
- Second launch doesn't re-migrate (idempotent)
- Logged: "Migrated store 'notesage-chat-history' (12.4 KB) from localStorage to file"

**Files:**

- `src/lib/tauri-storage.ts` — add migration logic in `getItem`

---

## Phase C: Store Bounds & Cleanup (Tasks 10–14)

### ✅ Task 10 — Add bounds to chat-store

**Complexity:** M | **Category:** frontend | **Dependencies:** none

**Description**:Add pruning to `chat-store.ts`:

- Max 50 conversations — on `addMessage()` to a new conversation, prune oldest if count exceeds limit
- Max 500 messages per conversation — on `addMessage()`, prune oldest messages if exceeded
- Log pruning events

**Acceptance criteria:**

- Creating the 51st conversation removes the oldest inactive conversation
- Adding the 501st message to a conversation removes the oldest message
- Active conversation is never pruned

**Files:**

- `src/stores/chat-store.ts`

---

### ✅ Task 11 — Add bounds to activity-store

**Complexity:** M | **Category:** frontend | **Dependencies:** none

**Description**:Add pruning to `activity-store.ts`:

- Max 100 completed tasks — on `addTask()`, prune oldest completed tasks exceeding limit
- Max 200 activities per task — on `appendActivity()`, prune oldest if exceeded
- On rehydration: remove completed tasks older than 7 days

**Acceptance criteria:**

- Old completed tasks auto-pruned on new task creation
- Activity arrays capped
- Startup cleanup removes week-old tasks

**Files:**

- `src/stores/activity-store.ts`

---

### ✅ Task 12 — Add cleanup to comment-store and external-change-store

**Complexity:** S | **Category:** frontend | **Dependencies:** none

**Description:**

- `comment-store`: auto-remove `activitiesByComment[id]` entries when `deleteComment()` or `setCommentStatus('resolved')` is called. Add `clearPartialReply(commentId)` called on delegation complete/error.
- `external-change-store`: auto-expire changes older than 1 hour on each `addChange()`. Cap at 20 pending changes — reject with toast if exceeded.

**Acceptance criteria:**

- Resolving a comment clears its activity entries
- External changes older than 1 hour are pruned
- 21st pending external change shows "Too many pending changes" toast

**Files:**

- `src/stores/comment-store.ts`
- `src/stores/external-change-store.ts`

---

### ✅ Task 13 — Add LRU cap to editor-store scrollPositions

**Complexity:** S | **Category:** frontend | **Dependencies:** none

**Description**:Cap `scrollPositions` map at 200 entries. On `setScrollPosition()`, if the map exceeds 200, remove the entry that was set least recently. Use insertion order (Object keys in modern JS are ordered by insertion) — delete the oldest key.

**Acceptance criteria:**

- 201st unique file scroll position evicts the oldest entry
- Existing positions are preserved on access (move to end)

**Files:**

- `src/stores/editor-store.ts`

---

### ✅ Task 14 — Isolate streaming state from persisted stores

**Complexity:** L | **Category:** frontend | **Dependencies:** #8 (storage adapter)

**Description**:Split transient streaming fields out of persisted state:

- `activity-store`: `partialOutput` and `thinkingOutput` should not trigger persist writes during streaming. Add them to the `partialize` exclusion, or use a separate non-persisted store slice for transient streaming data.
- `chat-store`: in-progress assistant message content updates should not trigger persist writes. Only persist when the message is finalized (stream complete).

Approach: add `partialize` config to `activity-store` that excludes `partialOutput` and `thinkingOutput` from tasks. The `onRehydrateStorage` already clears these on startup, confirming they're transient.

For `chat-store`: wrap message content updates during streaming in a `skipPersist` mechanism, or batch the final state write on stream-done.

**Acceptance criteria:**

- During streaming, store persist writes happen at most once per 2s (throttle from task 7)
- `partialOutput` / `thinkingOutput` never written to state file
- Final output still persisted correctly when stream completes
- No user-visible difference in behavior

**Files:**

- `src/stores/activity-store.ts` — add `partialize` config
- `src/stores/chat-store.ts` — add `partialize` or skip-persist during streaming
- `src/hooks/useAIOperations.ts` — ensure final flush writes complete message

---

## Phase A: Sleep/Wake Recovery (Tasks 15–19)

### ✅ Task 15 — Add `ping` and `health_check` Tauri commands

**Complexity:** M | **Category:** backend | **Dependencies:** #1 (for logging)

**Description**:Add two commands in a new `src-tauri/src/commands/health.rs`:

- `ping()` — returns `Ok(())` immediately (IPC liveness test)
- `health_check()` — checks:
  - Watcher: is the debouncer still alive? List watched paths.
  - ACP: for each agent, `try_wait()` on child process
  - Copilot LSP: `try_wait()` on child process if running
  - MCP: for each server, `try_wait()` on child process

Returns `HealthStatus` struct with per-subsystem status.

**Acceptance criteria:**

- `ping` returns in &lt;1ms
- `health_check` correctly reports dead processes (test by killing a child PID)
- Health check doesn't modify any state (read-only)

**Files:**

- `src-tauri/src/commands/health.rs` — new file
- `src-tauri/src/commands/mod.rs` — add `pub mod health; pub use health::*;`
- `src-tauri/src/lib.rs` — register `ping`, `health_check` in `generate_handler![]`
- `src-tauri/src/commands/acp.rs` — expose method to check process liveness
- `src-tauri/src/commands/copilot_lsp.rs` — expose method to check process liveness
- `src-tauri/src/commands/mcp.rs` — expose method to check process liveness

---

### ✅ Task 16 — Add `visibilitychange` wake handler in App.tsx

**Complexity:** M | **Category:** frontend | **Dependencies:** #15

**Description**:Add a `useEffect` in `App.tsx` that listens for `visibilitychange`. When the page becomes visible:

1. Call `ping` with a 500ms timeout race
2. If ping fails → `window.location.reload()` (WebView content process dead)
3. If ping succeeds → call `health_check`
4. If health check shows dead processes → show recovery toast, trigger reconnection
5. If health check shows dead watcher → call `watch_directory` for all previously watched paths

Debounce: ignore `visibilitychange` events within 5s of each other (prevent spam on rapid lid open/close).

**Acceptance criteria:**

- Simulated backend unresponsiveness triggers page reload
- Dead child process detected → toast "Reconnected to AI services"
- Watcher recovery happens silently
- No false positives during normal alt-tab

**Files:**

- `src/App.tsx` — add wake recovery effect
- `src/lib/tauri.ts` — add typed wrappers for `ping`, `health_check`

---

### ✅ Task 17 — Add reader loop timeouts in Copilot LSP and MCP

**Complexity:** L | **Category:** backend | **Dependencies:** #1

**Description**:Wrap all blocking `read_line()` / `read_exact()` calls in reader loops with `tokio::time::timeout(Duration::from_secs(30), ...)`:

- `copilot_lsp.rs` reader loop: timeout on `read_content_length` and `read_exact`
- `mcp.rs` reader loop: same pattern

On timeout:

1. Log warning: "Reader timeout — process may be dead"
2. Attempt `try_wait()` on child process
3. If dead: log error, clean up state, emit `copilot-lsp-error` / `mcp-server-status` event
4. If alive: retry (process may be slow, not dead)

**Acceptance criteria:**

- Killing a child process while app is running → error event emitted within 30s
- No hung Tokio tasks after process death
- Normal operation unaffected (30s timeout never fires during healthy communication)

**Files:**

- `src-tauri/src/commands/copilot_lsp.rs` — reader loop timeout
- `src-tauri/src/commands/mcp.rs` — reader loop timeout

---

### ✅ Task 18 — Add filesystem watcher recovery and event batching

**Complexity:** L | **Category:** both | **Dependencies:** #15, #2

**Description:**

**Rust side:**

- In `health_check`, verify watcher liveness. Add a `recover_watcher()` method to `WatcherState` that recreates the debouncer and re-watches all paths from `watched_paths`.
- Replace per-event `emit("file-changed")` with batched `emit("file-changed-batch")` — collect all events in the debounce callback and emit once as `Vec<{path, kind}>`.

**Frontend side:**

- Update `useFileWatcher.ts` to handle `file-changed-batch` events
- Process the entire batch in one pass: deduplicate paths, apply debounce per unique path
- Cap `modifyDebounce` map at 500 entries — if exceeded, clear all and do a single `refreshFileTree()`

**Acceptance criteria:**

- Watcher recovery: simulate watcher death → health check restores watching
- Batching: 100 simultaneous file changes emit 1 batch event, not 100 individual events
- Debounce map bounded: 501 unique paths triggers batch refresh

**Files:**

- `src-tauri/src/commands/watcher.rs` — add `recover_watcher()`, switch to batch emit
- `src-tauri/src/commands/health.rs` — call `recover_watcher()` if watcher dead
- `src/hooks/useFileWatcher.ts` — handle batch events, cap debounce maps

---

### ✅ Task 19 — Disable App Nap for Notesage on macOS

**Complexity:** S | **Category:** backend | **Dependencies:** none

**Description**:Add `NSSupportsAutomaticTermination = false` and `NSAppSleepDisabled = true` to the macOS Info.plist. In Tauri v2, this is configured via `src-tauri/Info.plist` or `tauri.conf.json` macOS section.

This prevents macOS from aggressively suspending the app during sleep, reducing the chance of WebView content process termination.

**Acceptance criteria:**

- `Info.plist` contains the App Nap prevention keys
- App still builds and signs correctly
- Document the trade-off (slightly higher battery usage) in release notes

**Files:**

- `src-tauri/Info.plist` — add keys (create if needed)
- `src-tauri/tauri.conf.json` — reference Info.plist if needed

---

## Phase E: Resource Leak Fixes (Tasks 20–22)

### ✅ Task 20 — Fix inline-diff widget listener cleanup

**Complexity:** L | **Category:** frontend | **Dependencies:** none

**Description**:Replace the MutationObserver-based cleanup in `inline-diff.ts` with a deterministic approach:

1. Track active widget DOM elements and their listeners in a module-level `Map<HTMLElement, () => void>`
2. In the ProseMirror decoration widget factory, register the element + dismiss handler
3. When decorations are rebuilt (new set replaces old), iterate the map — any element no longer in the DOM gets its listener removed and its entry deleted
4. Remove the MutationObserver pattern entirely

**Acceptance criteria:**

- No `MutationObserver` on `document.body` from inline-diff widgets
- `document` click listeners cleaned up when decorations are removed
- Rapid decoration add/remove cycles don't leak listeners (test with 100 cycles)

**Files:**

- `src/components/editor/extensions/inline-diff.ts`

---

### ✅ Task 21 — Fix streaming interval cleanup in useAIOperations

**Complexity:** S | **Category:** frontend | **Dependencies:** none

**Description**:Wrap the 50ms flush `setInterval` in `useAIOperations.ts` streaming path with a `try/finally` block that guarantees `clearInterval` runs on all code paths (success, error, cancellation). Add a final `flush()` call after clearing the interval.

Also audit the ACP streaming path in `useAgentTaskOperations.ts` for the same pattern.

**Acceptance criteria:**

- `clearInterval` called on success, error, and cancellation paths
- No orphaned intervals after repeated stream start/stop cycles
- Final state always flushed to store

**Files:**

- `src/hooks/useAIOperations.ts`
- `src/hooks/useAgentTaskOperations.ts` — audit and fix if needed

---

### ✅ Task 22 — Fix debounce map bounds in useFileWatcher

**Complexity:** S | **Category:** frontend | **Dependencies:** none

**Description**:In `useFileWatcher.ts`, add a size check before adding to `modifyDebounce.current` and `icloudDiscoveryDebounce.current`. If either map exceeds 500 entries:

1. Clear all pending timeouts in the map
2. Empty the map
3. Trigger a single `refreshFileTree()` instead of per-file debouncing
4. Log a warning: "Debounce map overflow — triggering batch refresh"

**Acceptance criteria:**

- Maps never exceed 500 entries
- Overflow triggers one refresh instead of hundreds of per-file refreshes
- Normal operation (&lt; 500 unique paths) unaffected

**Files:**

- `src/hooks/useFileWatcher.ts`

---

## Summary

| Phase | Tasks | Sizes | Description |
| --- | --- | --- | --- |
| D: Logging | 1–5 | 1S, 4M | Structured logging, backend + frontend, Settings UI |
| B: Persistence | 6–9 | 2M, 2L | Tauri file storage, throttled adapter, migration |
| C: Store Bounds | 10–14 | 2S, 3M | Chat/activity/comment/editor caps, streaming isolation |
| A: Sleep/Wake | 15–19 | 1S, 2M, 2L | Health check, wake handler, reader timeouts, watcher recovery |
| E: Leak Fixes | 20–22 | 2S, 1L | Inline-diff, interval guard, debounce bounds |

**Dependency graph:**

```
Phase D (Logging):  1 → 2, 1 → 3 → 4, 3 → 5
Phase B (Persist):  1 → 6 → 7 → 8 → 9, 8 → 14
Phase C (Bounds):   10, 11, 12, 13 (all independent)
Phase A (Wake):     1 → 15 → 16, 1 → 17, 15 → 18
Phase E (Leaks):    20, 21, 22 (all independent)
```

Independent tasks that can be parallelized: #10, #11, #12, #13, #19, #20, #21, #22