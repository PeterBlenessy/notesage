# PRD: App Stability, Persistence & Observability

**Date:** 2026-03-08 **Phase:** Cross-cutting (applies to all existing phases) **Status:** ✅ Complete **Priority:** High — addresses production crash (black page after macOS sleep)

---

## Problem

Notesage becomes completely unresponsive (black page, no DevTools, no context menu) after a macOS laptop lid is closed overnight and reopened. The WebView content process is killed by macOS during extended sleep, and the app has no recovery mechanism. Additionally, the codebase has systemic issues that compound over long sessions:

1. **No sleep/wake recovery** — macOS can terminate the WKWebView content process via App Nap or jetsam; the app has zero handling for this.
2. **Unbounded store growth** — chat messages, agent tasks, activities, and streaming output accumulate indefinitely in Zustand stores persisted to localStorage.
3. **localStorage as persistence layer** — every Zustand `set()` call triggers synchronous `JSON.stringify()` → `localStorage.setItem()` on the main thread with no throttling. During streaming, this means 100+ serializations/sec of multi-MB stores.
4. **Child process death after sleep** — Copilot LSP, MCP servers, and ACP agents can die during sleep; reader loops block forever on dead process stdout with no timeouts.
5. **Minimal observability** — `debugLog()` exists but has &lt;30 call sites; Rust backend uses `eprintln!` with no persistence; no way to diagnose production issues post-mortem.
6. **Resource leaks** — inline diff widget DOM listeners rely on MutationObserver cleanup (race condition), setInterval in streaming has incomplete error-path cleanup.

## Goals

1. **Sleep/wake resilience** — app recovers gracefully from macOS sleep, including WebView process termination, child process death, and filesystem watcher staleness.
2. **Bounded persistence** — all stores have size limits, streaming output is not persisted synchronously, and persistence uses Tauri-side file storage instead of localStorage.
3. **Production-grade logging** — structured, leveled logging on both frontend and backend, persisted to rotating log files, always-on in dev, toggleable in prod, accessible from Settings.
4. **Resource leak prevention** — fix identified leaks in inline-diff widgets, streaming intervals, and debounce maps.
5. **Diagnostic capability** — users can share log files for support; developers can diagnose overnight crashes from log output alone.

## Non-Goals

- Real-time log streaming UI (log viewer within the app)
- Crash reporting / telemetry to external services
- Full WebView process management (Tauri upstream responsibility)
- Changing the Zustand state management library itself

---

## User Stories

- As a user, I want the app to recover automatically when I open my laptop after sleep, so that I don't have to force-quit and restart.
- As a user, I want my chat history and agent task logs to persist reliably without slowing down the app, so that long sessions remain responsive.
- As a user, I want to find and share log files easily from Settings, so that I can report issues with diagnostic context.
- As a developer, I want structured logs with timestamps and categories in a persistent file, so that I can diagnose issues that happened hours ago.
- As a user, I want the app to stay responsive even after hours of chat and agent delegation, so that I can leave it running as a daily driver.

---

## Technical Approach

### A. Sleep/Wake Recovery

#### A1. WebView Health Check on Wake

Add a `visibilitychange` + `focus` listener in `App.tsx` that calls a lightweight Tauri command (`ping`) on wake. If the command fails or times out (500ms), force-reload the WebView.

```typescript
// App.tsx — new effect
useEffect(() => {
  const onVisibilityChange = async () => {
    if (document.visibilityState === 'visible') {
      try {
        await Promise.race([
          invoke('ping'),
          new Promise((_, reject) => setTimeout(() => reject('timeout'), 500)),
        ]);
        // Backend alive — check child processes
        await invoke('health_check');
      } catch {
        // WebView or backend unresponsive — reload
        window.location.reload();
      }
    }
  };
  document.addEventListener('visibilitychange', onVisibilityChange);
  return () => document.removeEventListener('visibilitychange', onVisibilityChange);
}, []);
```

New Tauri commands:

- `ping() -> Result<(), String>` — no-op, returns immediately (tests IPC channel)
- `health_check() -> Result<HealthStatus, String>` — checks child process liveness, watcher state; returns status object

#### A2. Child Process Liveness Detection

Add `try_wait()` checks to all spawned child processes (ACP, LSP, MCP) before attempting communication. If a process is dead, clean up and emit a status event so the frontend can show a reconnection toast.

Add timeouts to all reader loops in Rust:

- `copilot_lsp.rs` reader loop: `tokio::time::timeout(Duration::from_secs(30), reader.read_line(...))`
- `mcp.rs` reader loop: same pattern
- On timeout: assume process dead, exit loop, emit error event

#### A3. Filesystem Watcher Recovery

In `health_check`, verify the watcher is still functional by checking `WatcherState`. If the watcher is dead (common after macOS sleep), recreate it and re-watch all previously watched paths.

Add event batching in the watcher callback: instead of emitting one `file-changed` event per file, collect events during the debounce window and emit a single `file-changed-batch` event with an array of `{ path, kind }`. Frontend processes the batch in a single React update cycle.

#### A4. Disable App Nap (macOS)

Add `NSSupportsAutomaticTermination = false` and `NSAppSleepDisabled = true` to the macOS entitlements or Info.plist to prevent macOS from aggressively suspending the app.

---

### B. Persistence Migration: localStorage → Tauri File Storage

#### B1. Custom Zustand Storage Adapter

Replace the default `localStorage` Zustand persist storage with a custom adapter that:

1. **Writes to Tauri-side files** via `invoke('store_write', { key, value })` and `invoke('store_read', { key })`
2. **Throttles writes** — maximum one write per 2 seconds per store (configurable), queuing the latest state
3. **Writes asynchronously** — `setItem` returns immediately, actual disk write happens in background
4. **Handles large data** — no 5MB localStorage limit; files stored in `~/.notesage/state/`

New Tauri commands:

- `store_read(key: String) -> Result<Option<String>, String>` — reads `~/.notesage/state/{key}.json`
- `store_write(key: String, value: String) -> Result<(), String>` — writes atomically (write to `.tmp`, rename)
- `store_delete(key: String) -> Result<(), String>` — removes state file

#### B2. Migration from localStorage

On first launch after update:

1. For each persisted store, check if `~/.notesage/state/{store-name}.json` exists
2. If not, read from `localStorage`, write to file, then remove from `localStorage`
3. Migration is one-time, idempotent, and logged

#### B3. Streaming Output Isolation

Streaming fields (`partialOutput`, `thinkingOutput` in activity-store; in-progress message content in chat-store) should NOT be persisted during streaming. Instead:

- Use a separate non-persisted Zustand slice for transient streaming state
- Only persist `finalOutput` when streaming completes
- This eliminates the 100+ writes/sec during token streaming

---

### C. Store Bounds & Cleanup

#### C1. Chat Store Limits

| Limit | Value | Behavior |
| --- | --- | --- |
| Max conversations | 50 | Oldest auto-deleted when exceeded |
| Max messages per conversation | 500 | Oldest messages pruned |
| Max message content size | 100KB | Truncated with "\[truncated\]" marker |

Add `pruneConversations()` called on every `addMessage()`.

#### C2. Activity Store Limits

| Limit | Value | Behavior |
| --- | --- | --- |
| Max completed tasks | 100 | Oldest completed tasks pruned on `addTask()` |
| Max activities per task | 200 | Oldest activities pruned |
| Auto-prune age | 7 days | Completed tasks older than 7 days removed on startup |

#### C3. Comment Activity Cleanup

- `activitiesByComment` entries auto-removed when comment is deleted or resolved
- `partialReplies` module-level map: add explicit `clearPartialReply(commentId)` called on delegation complete/error

#### C4. External Change Store

- Auto-expire deferred changes older than 1 hour (check on each `addChange()`)
- Cap at 20 concurrent pending changes — reject new ones with toast warning

#### C5. Editor Store

- Cap `scrollPositions` map at 200 entries (LRU eviction)
- Already partializes correctly — no additional changes needed

---

### D. Structured Logging

#### D1. Rust Backend: `log` Crate + `tauri-plugin-log`

Replace the current `debug_log!` macro and `eprintln!` with the standard Rust `log` crate integrated via `tauri-plugin-log`:

- **Dev mode:** `Debug` level, outputs to stdout + rotating log file
- **Prod mode:** `Info` level by default; `Debug` when user enables debug logging toggle
- **Log file location:** `~/Library/Logs/com.notesage.app/` (macOS standard) via `tauri-plugin-log` defaults
- **Rotation:** 5MB per file, keep 5 rotated files (25MB total max)
- **Format:** `[2026-03-08T14:30:00.123Z] [INFO] [watcher] Event batch: 12 events for /Users/...`

Categories (Rust targets):

- `notesage::watcher` — filesystem events, debounce, self-write
- `notesage::acp` — agent spawn, session, permission, cleanup
- `notesage::copilot` — LSP lifecycle, completions, auth
- `notesage::mcp` — server lifecycle, tool calls, errors
- `notesage::ai` — streaming, provider selection, errors
- `notesage::store` — persistence reads/writes, migration
- `notesage::export` — PDF generation
- `notesage::health` — wake detection, health checks, recovery actions

#### D2. Frontend: Structured Logger with Backend Forwarding

Replace `debugLog()` and bare `console.log()` with a structured logger that forwards to the Rust backend:

```typescript
// src/lib/logger.ts
export const log = {
  debug(category: string, message: string, data?: unknown): void;
  info(category: string, message: string, data?: unknown): void;
  warn(category: string, message: string, data?: unknown): void;
  error(category: string, message: string, data?: unknown): void;
};
```

Behavior:

- **Dev mode:** Always logs to `console` + forwards to backend via `invoke('log_frontend', { level, category, message, data })`
- **Prod mode:** `warn`/`error` always forwarded; `info`/`debug` only when debug logging is enabled
- **Batching:** Frontend log forwarding is batched (flush every 500ms or 20 messages, whichever comes first) to avoid IPC spam
- **Categories:** `editor`, `chat`, `ai`, `watcher`, `store`, `settings`, `copilot`, `mcp`, `skills`, `lifecycle`

New Tauri command:

- `log_frontend(entries: Vec<LogEntry>) -> Result<(), String>` — writes frontend log entries to the same log file with `[frontend]` prefix

#### D3. Log File Access from Settings

Add a "Log Files" row in Settings &gt; Advanced:

- Shows current log file location (e.g., `~/Library/Logs/com.notesage.app/`)
- "Reveal in Finder" button that calls existing `reveal_in_finder` command
- Shows total log size (sum of all rotated files)
- "Clear Logs" button to delete all log files

#### D4. Critical Log Points (Minimum Coverage)

These events MUST be logged at `info` or higher in the initial implementation:

**Lifecycle:**

- App startup complete (with version, platform, feature flags)
- Wake from sleep detected
- Health check results (pass/fail, which subsystems)
- WebView reload triggered

**AI/Agent:**

- Chat message sent (provider, model, message length — not content)
- Streaming started/completed/errored (duration, token count)
- ACP agent spawned/stopped/errored
- Permission request/response

**Persistence:**

- Store write (store name, size in bytes, duration)
- Store migration (from localStorage, success/failure)
- Store pruning (store name, items removed)

**Filesystem:**

- Watcher started/stopped/recovered
- Event batch processed (count, types)
- File watcher error

**Child Processes:**

- LSP/MCP/ACP process spawned (binary, args)
- Process death detected (PID, exit code)
- Process recovery attempted

---

### E. Resource Leak Fixes

#### E1. Inline Diff Widget Cleanup

Replace the MutationObserver-based cleanup pattern in `inline-diff.ts` with a deterministic approach:

- Track active widgets in a module-level `Set<HTMLElement>`
- ProseMirror decoration `destroy` callback removes the widget's listener
- On decoration update (new set of decorations), diff against previous set and clean up removed widgets

#### E2. Streaming Interval Guard

In `useAIOperations.ts`, wrap the streaming interval in a try/finally that guarantees `clearInterval`:

```typescript
const flushInterval = setInterval(flush, 50);
try {
  await streamingPromise;
} finally {
  clearInterval(flushInterval);
  flush(); // Final flush
}
```

#### E3. Debounce Map Bounds

In `useFileWatcher.ts`, cap `modifyDebounce` and `icloudDiscoveryDebounce` maps at 500 entries. If exceeded, clear all pending timeouts and process a single batch refresh instead of per-file debouncing.

---

## Data Model

### New Tauri Commands

```rust
#[tauri::command]
fn ping() -> Result<(), String>

#[tauri::command]
async fn health_check(
    watcher: State<WatcherState>,
    acp: State<AcpState>,
    copilot: State<CopilotLspState>,
    mcp: State<McpState>,
) -> Result<HealthStatus, String>

#[derive(Serialize)]
struct HealthStatus {
    watcher_alive: bool,
    watched_paths: Vec<String>,
    acp_agents: Vec<ProcessStatus>,
    copilot_lsp: Option<ProcessStatus>,
    mcp_servers: Vec<ProcessStatus>,
}

#[derive(Serialize)]
struct ProcessStatus {
    name: String,
    alive: bool,
    pid: Option<u32>,
}

#[tauri::command]
async fn store_read(key: String) -> Result<Option<String>, String>

#[tauri::command]
async fn store_write(key: String, value: String) -> Result<(), String>

#[tauri::command]
async fn store_delete(key: String) -> Result<(), String>

#[tauri::command]
fn log_frontend(entries: Vec<LogEntry>) -> Result<(), String>

#[derive(Deserialize)]
struct LogEntry {
    level: String,     // "debug" | "info" | "warn" | "error"
    category: String,  // "editor" | "chat" | "ai" | ...
    message: String,
    data: Option<serde_json::Value>,
    timestamp: f64,    // JS Date.now()
}

#[tauri::command]
fn get_log_path() -> Result<String, String>

#[tauri::command]
async fn clear_logs() -> Result<(), String>

#[tauri::command]
async fn get_log_size() -> Result<u64, String>
```

### New Frontend Modules

```typescript
// src/lib/logger.ts — structured frontend logger
// src/lib/tauri-storage.ts — custom Zustand persist storage adapter
```

### Store Changes

```typescript
// activity-store.ts — add constants
const MAX_COMPLETED_TASKS = 100;
const MAX_ACTIVITIES_PER_TASK = 200;
const TASK_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

// chat-store.ts — add constants
const MAX_CONVERSATIONS = 50;
const MAX_MESSAGES_PER_CONVERSATION = 500;

// external-change-store.ts — add constants
const MAX_PENDING_CHANGES = 20;
const CHANGE_TTL_MS = 60 * 60 * 1000; // 1 hour

// editor-store.ts — add constant
const MAX_SCROLL_POSITIONS = 200;
```

---

## Dependencies

| Dependency | Purpose | Notes |
| --- | --- | --- |
| `tauri-plugin-log` | Rust log rotation + file output | Tauri official plugin, well-maintained |
| `log` (Rust crate) | Standard logging facade | Already a transitive dep via Tauri |

No new frontend npm dependencies required.

---

## UI/UX

### Settings &gt; Advanced Section

Add below the existing "Debug Logging" toggle:

```
[Toggle] Debug Logging          [enabled/disabled]
         Log Files               ~/Library/Logs/com.notesage.app/
         Total size: 2.3 MB      [Reveal in Finder]  [Clear Logs]
```

- "Reveal in Finder" calls `reveal_in_finder` with the log directory path
- "Clear Logs" shows confirmation dialog, then deletes all log files
- Log path and size update when Settings opens

### Wake Recovery Toast

When the app detects a wake and recovers:

- If WebView reloaded: toast "App recovered from sleep — your work is saved"
- If child processes reconnected: toast "Reconnected to AI services" (info level, auto-dismiss)
- If watcher recovered: no user-visible toast (silent recovery)

---

## Implementation Order

| Step | Scope | Description |
| --- | --- | --- |
| 1 | Logging (Rust) | Add `tauri-plugin-log`, replace `eprintln!`/`debug_log!` with `log::*` macros |
| 2 | Logging (Frontend) | Create `logger.ts`, add `log_frontend` command, replace `debugLog`/`console.log` |
| 3 | Logging (Settings UI) | Log file path, reveal, clear, size display |
| 4 | Persistence migration | `store_read`/`store_write` commands, custom Zustand storage adapter, localStorage migration |
| 5 | Store bounds | Add limits to chat-store, activity-store, external-change-store, editor-store |
| 6 | Streaming isolation | Split transient streaming state from persisted state in activity-store and chat-store |
| 7 | Sleep/wake recovery | `ping`, `health_check`, `visibilitychange` handler, WebView reload |
| 8 | Child process timeouts | Reader loop timeouts in copilot_lsp.rs, mcp.rs; liveness detection |
| 9 | Watcher recovery | Watcher health check, event batching, auto-reconnect |
| 10 | Resource leak fixes | Inline-diff cleanup, interval guard, debounce map bounds |
| 11 | App Nap prevention | macOS Info.plist / entitlement changes |

---

## Quality Gates

### Functional

- [x] App recovers from simulated WebView death (verify via DevTools → kill renderer)

- [x] App recovers from simulated child process death (kill copilot-language-server PID)

- [x] Chat with 1000+ messages remains responsive (&lt; 100ms per store write)

- [x] Persistence writes throttled to ≤ 1/2s during streaming (verify via log output)

- [x] Chat and activity stores use file storage (`~/.notesage/state/`); config stores use localStorage for instant startup

- [x] Log files written to expected location with correct rotation

- [x] Frontend logs appear in backend log file with `[frontend]` prefix

- [x] "Reveal in Finder" opens the log directory

- [x] "Clear Logs" removes all log files after confirmation

- [x] Store bounds enforced: conversations capped at 50, tasks at 100, changes at 20

- [x] Completed tasks older than 7 days pruned on startup

- [x] Streaming `partialOutput`/`thinkingOutput` not written to disk during streaming

### Design

- [x] Settings log section follows design system (neutral palette, consistent spacing)

- [x] Recovery toasts are non-intrusive (auto-dismiss, info level)

- [x] No user-visible jank during persistence writes

### Stability

- [x] App runs 24+ hours with lid open/close cycles without degradation

- [x] Memory usage stays stable (&lt; 500MB) over 8-hour session with moderate chat use

- [x] No orphaned child processes after repeated sleep/wake cycles (startup cleanup via pkill)

---

## Out of Scope

- In-app log viewer / log search UI
- Crash reporting to external services (Sentry, etc.)
- Switching from Zustand to a different state manager
- Database storage (SQLite/IndexedDB) — file-based JSON is sufficient for current data volumes and avoids new dependencies
- Cross-device log sync
- Log-level configuration per category (all categories share the global debug toggle)
- WebView process pinning (requires upstream Tauri/WKWebView changes)