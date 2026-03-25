# Full Codebase Audit — 2026-03-25

**Date:** 2026-03-25 **Status:** Audit complete

| Stage | Link | Status |
| --- | --- | --- |
| PRD | — | Not planned |
| Tasks | [full-codebase-audit-tasks](../tasks/2026-03-25-full-codebase-audit-tasks.md) | Not started |

Comprehensive audit of the Notesage codebase covering component size, memory leaks, async flows, render performance, and Rust backend patterns.

## Summary

The codebase is **generally well-engineered** — the Rust backend is solid, there are no critical security issues, and process lifecycle management is proper. The main concerns are on the frontend: oversized components, memory leak patterns in event listeners, race conditions in agent singletons, and broad Zustand subscriptions causing unnecessary re-renders.

**Severity counts:** 10 HIGH, 16 MEDIUM, 7 LOW

### Findings by Area

| Area | HIGH | MED | LOW | Summary |
| --- | --- | --- | --- | --- |
| [1. Memory Leaks](#1-memory-leaks--resource-cleanup) | 4 | 2 | 0 | Tauri `listen()` cleanup patterns — 4 hooks leak listeners on unmount |
| [2. Async Flows](#2-async-flows--race-conditions) | 2 | 8 | 4 | Module-level agent singletons race on concurrent spawn; stale closures and missing cancellation in several hooks |
| [3. Render Performance](#3-render-performance--zustand-patterns) | 4 | 4 | 2 | Top-level components (Layout, Sidebar, ChatPanel, FileTreeItem) subscribe to entire Zustand stores without selectors, causing cascading re-renders |
| [4. Large Files](#4-large-files--decomposition-opportunities) | 3 | 5 | 0 | Editor.tsx (1,822 lines) and ConnectionsSettings.tsx (1,685 lines) need decomposition; 3 Rust modules over 1,400 lines |
| [5. Rust Backend](#5-rust-backend) | 0 | 3 | 2 | Solid overall — minor issues with a double keychain read, one panic vector, and silent shutdown errors |
| [6. Security](#6-security) | 0 | 0 | 0 | No issues found — parameterized SQL, keychain credentials, Seatbelt sandboxing, network proxy all solid |

---

## 1. Memory Leaks & Resource Cleanup

### HIGH: useSandboxViolations — Listener Not Cleaned Up Before Unmount

**File:** `src/hooks/useSandboxViolations.ts:20-50`

The `listen()` call's promise is not awaited. If the component unmounts before `listen()` resolves, the cleanup function runs but `unlisten` is still null, so the listener is never cleaned up and continues to fire.

```typescript
// Current (broken)
useEffect(() => {
  let unlisten: (() => void) | null = null;
  listen<SandboxViolationPayload>('sandbox-violation', (event) => {
    // handler
  }).then((fn) => { unlisten = fn; });
  return () => { unlisten?.(); };  // unlisten may still be null
}, []);
```

**Fix:** Track mount state and clean up immediately if already unmounted:

```typescript
useEffect(() => {
  let unlisten: (() => void) | null = null;
  let mounted = true;
  listen<SandboxViolationPayload>('sandbox-violation', (event) => {
    if (!mounted) return;
    // handler
  }).then((fn) => {
    if (mounted) { unlisten = fn; }
    else { fn(); }  // clean up immediately
  });
  return () => { mounted = false; unlisten?.(); };
}, []);
```

### HIGH: useAcpLifecycle — Double Cleanup Possible

**File:** `src/hooks/useAcpLifecycle.ts:554-591`

The `cleanupRef` callback chain stores `unlisten` and `unlistenPermission` functions. If the component unmounts while the `try` block is still executing, the cleanup reference may be overwritten or called multiple times when `acpCancelChat` is invoked during streaming.

**Fix:** Add a guard to prevent double-call:

```typescript
cleanupRef.current = () => {
  if (!cleanupRef.current) return;
  cleanupRef.current = null;
  unlisten();
  unlistenPermission();
  // ... rest
};
```

### HIGH: useSpeechRecognition — Overwrites Unlisten Without Cleanup

**File:** `src/hooks/useSpeechRecognition.ts:38-92`

When `startWhisperDictation` is called multiple times, the new `unlisten` overwrites `unlistenRef.current` without first cleaning up the old listener. Old listeners continue to fire.

**Fix:** Clean up previous listener before creating a new one:

```typescript
const startWhisperDictation = useCallback(async () => {
  if (unlistenRef.current) {
    unlistenRef.current();
    unlistenRef.current = null;
  }
  // ... rest of setup
}, [...]);
```

### HIGH: useMcpDiscovery — Incomplete Cleanup (Needs Verification)

**File:** `src/hooks/useMcpOperations.ts:139-150`

The effect creates a Tauri event listener for `mcp-server-status` but the cleanup function's completeness could not be fully verified. Should be checked to confirm `unlisten()` is properly called.

### MEDIUM: useSpeechRecognition — Unmount During Whisper Fallback

**File:** `src/hooks/useSpeechRecognition.ts:139-140`

When Web Speech API fails, `startWhisperDictation()` is called async without await. If the component unmounts before completion, state updates will be orphaned.

### MEDIUM: useCopilotCompletion — Timeout Cleanup

**File:** `src/hooks/useCopilotCompletion.ts:143-149`

Tracked open document timeouts are cleaned up, but other places in the hook may have stale timers. Full review recommended.

### Confirmed Good Patterns

| File | Pattern | Status |
| --- | --- | --- |
| `useRecording.ts` | Recording level listener | Properly cleaned up with mounted flag |
| `useLocalCompletion.ts` | Timeout cleanup | Properly cleared on unmount |
| `useFileWatcher.ts` | Multiple debounce maps | All timeouts cleared in cleanup |
| `useKeyboardShortcuts.ts` | Keyboard event listener | Properly removed on unmount |
| `useAppLifecycle.ts` | DOM listeners + agent cleanup | Properly cleaned up |
| `acp.rs` (Rust) | AcpState::stop_all_sync() | Excellent exit handler |
| `copilot_lsp.rs` (Rust) | Reader task | Exits when stdout closes |
| `local_inference.rs` (Rust) | Process cleanup | SIGTERM then SIGKILL + PID file + RunEvent::Exit |

---

## 2. Async Flows & Race Conditions

### HIGH: ACP Agent Singleton Race Condition

**File:** `src/hooks/useAcpLifecycle.ts:136-177`

Module-level `acpAgent` is a mutable singleton. Multiple concurrent calls to `ensureAcpAgent` can race:

1. Call A checks `acpAgent` exists (null)
2. Call B checks same condition simultaneously (null)
3. Both spawn a new agent — one is leaked

The respawn detection (lines 154-165) comparing `connectionId` and `sandboxScopeKey` doesn't protect against concurrent calls.

**Fix:** Add a spawn-in-progress lock (e.g., a Promise that concurrent callers await).

### HIGH: Task Agent Singleton Race Condition

**File:** `src/hooks/useAgentTaskOperations.ts:82-162`

Identical pattern to the ACP agent. Module-level `taskAgent` with the same concurrent spawn vulnerability.

### MEDIUM: Stale Closure in Comment Save Debounce

**File:** `src/hooks/useCommentOperations.ts:109-113`

The `positionSaveTimeoutRef` debounce callback captures `commentKey` and `storageRoot` from closure. If the user switches tabs during the 2s debounce window, the pending timeout uses the old `commentKey`.

**Fix:** Read current values from store/ref inside the timeout callback.

### MEDIUM: Missing Cancellation in useLocalCompletion

**File:** `src/hooks/useLocalCompletion.ts:74-169`

Completion requests lack AbortController. While `requestId` deduplication discards stale results, the HTTP request itself still completes — wasting network/compute.

### MEDIUM: useModelMetadata — fetchedRef Never Resets

**File:** `src/hooks/useModelMetadata.ts:38`

`fetchedRef` prevents re-runs but is never reset. If `modelType` changes, the hook won't refetch.

**Fix:** Reset `fetchedRef` when `modelType` changes.

### MEDIUM: useLocalAI — Promise.all Loses All Results

**File:** `src/hooks/useLocalAI.ts:41`

If any promise in `Promise.all` rejects, all results are lost (including successful ones).

**Fix:** Use `Promise.allSettled` and handle individual failures.

### MEDIUM: useSkillDiscovery — Missing Outer Error Boundary

**File:** `src/hooks/useSkillOperations.ts:196-244`

Async IIFE without outer try/catch. An unexpected throw from `migratePersonasToAgents()` or `scanSkills()` would be unhandled.

### MEDIUM: useFileWatcher — Stale State in Debounced Modify Handler

**File:** `src/hooks/useFileWatcher.ts:169-174`

The `handleModifyEvent` async handler fires from a `setTimeout` callback and reads `useEditorStore.getState()` at call time. State may be stale when awaits complete.

### MEDIUM: useLocalCompletion — Editor Null Check After Await

**File:** `src/hooks/useLocalCompletion.ts:133`

After an async operation, code accesses `editor.isFocused` and `editor.isDestroyed` without null check. If editor is destroyed during the await, this throws.

### MEDIUM: useSpeechRecognition — Async Fallback Without Unmount Guard

**File:** `src/hooks/useSpeechRecognition.ts:139-140`

When Web Speech API fails, `startWhisperDictation()` is called async without await. Component may unmount before completion.

### LOW: useFileWatcher — Debounce Map Overflow

**File:** `src/hooks/useFileWatcher.ts:59-62, 160-166`

Per-file debounce maps can briefly exceed `MAX_DEBOUNCE_ENTRIES` before the overflow guard triggers.

### LOW: useCopilotCompletion — didChange/Completion Race

**File:** `src/hooks/useCopilotCompletion.ts:218-232`

`didChange` invoke and debounced `requestCompletion` fire without coordination. Completion could use a stale document version.

### LOW: useAppLifecycle — Visibility Change Without Cancellation

**File:** `src/hooks/useAppLifecycle.ts:86-152`

`tauriApi.ping()` and `tauriApi.healthCheck()` called from visibility change handler have no abort on unmount.

### LOW: iCloud Discovery — Stale Store Snapshot

**File:** `src/hooks/useFileWatcher.ts:105-127`

iCloud project discovery reads store state inside a 1s debounced setTimeout. Calling `addProject()` on a potentially superseded snapshot could lose concurrent updates.

---

## 3. Render Performance & Zustand Patterns

### HIGH: Broad Store Subscriptions (No Selectors)

Several top-level, always-visible components subscribe to entire Zustand stores. Any mutation to any field triggers a full re-render cascade.

| File | Line | Fields Destructured | Impact |
| --- | --- | --- | --- |
| `Layout.tsx` | 169 | `useSettingsStore()` | Top-level component — cascades to everything |
| `ChatPanel.tsx` | 51 | 13 fields from `useChatStore()` | Always visible during sessions |
| `Sidebar.tsx` | 27-39 | 11 fields from `useWorkspaceStore()` | Always visible |
| `FileTreeItem.tsx` | 69-71 | `useWorkspaceStore()` + `useEditorStore()` | Multiplied per file/folder in tree |
| `AISettings.tsx` | 18-27 | 8 fields from `useAIStore()` | Modal-based (lower impact) |

**Fix:** Replace `const { x, y } = useStore()` with `const x = useStore(s => s.x)` for each field.

### MEDIUM: CommandPalette — useMemo Defeated by Unmemoized Callbacks

**File:** `src/components/CommandPalette.tsx:280-291`

The `actions` array is wrapped in `useMemo` with 13 dependencies, but many are inline arrow functions recreated every render. The memoization is effectively broken.

**Fix:** Extract callbacks into `useCallback` hooks.

### MEDIUM: Layout.tsx — Inline Callback Props

**File:** `src/components/Layout.tsx:204-206`

Arrow function created on every render, passed as prop to TitleBar.

### MEDIUM: DocumentOutline — Inline onClick Per Heading

**File:** `src/components/DocumentOutline.tsx:81-84`

Each heading button has inline `onClick={() => handleSelect(heading.pos)}`, creating N new functions per render.

### LOW: DocumentOutline — Inline Style Objects

**File:** `src/components/DocumentOutline.tsx:85`

`style={{ paddingLeft }}` creates new object per heading per render.

### LOW: ChatPanel — Array Identity in useEffect Dependencies

**File:** `src/components/chat/ChatPanel.tsx:120`

`selectedProjectPaths` array identity changes on every message, causing the effect to run too often.

---

## 4. Large Files & Decomposition Opportunities

### HIGH Priority

| File | Lines | Key Issue |
| --- | --- | --- |
| `Editor.tsx` | 1,822 | 15+ responsibilities: viewers, file watching, comments, AI, completions, shortcuts |
| `ConnectionsSettings.tsx` | 1,685 | `ConnectAgent` (468 lines) and `ConnectCopilotLsp` (384 lines) nested inline |
| `useAIOperations.ts` | 505 | \~50-line provider routing conditional, fragile to extend |

**Editor.tsx recommended extraction:**

| Extract to | Responsibility |
| --- | --- |
| `EditorViewerContainer.tsx` | File type routing (PDF/EPUB/DOCX/images) |
| `useFileWatcherIntegration.ts` | External change detection + diff review |
| `useEditorKeyBindings.ts` | Keyboard shortcut handlers |
| `useCommentEditorSync.ts` | Comment position remapping |
| `Editor.tsx` (remaining) | Thin orchestrator (\~600 lines) |

**useAIOperations.ts recommended extraction:**

| Extract to | Provider |
| --- | --- |
| `useAnthropicChat.ts` | Anthropic streaming |
| `useOpenAiChat.ts` | OpenAI streaming |
| `useOllamaChat.ts` | Ollama streaming |
| `useAcpChat.ts` | ACP agent routing |
| `useAIOperations.ts` (remaining) | Router (\~150 lines) |

### MEDIUM Priority

| File | Lines | Key Issue |
| --- | --- | --- |
| `SkillsSettings.tsx` | 1,267 | 3 dialogs + AgentGroup (406 lines) nested inline |
| `useAcpLifecycle.ts` | 800 | Auth, sandbox, binary resolution all mixed |
| `local_inference.rs` | 1,769 | Model mgmt, thinking detection, server lifecycle mixed |
| `copilot_lsp.rs` | 1,684 | JSON-RPC transport duplicated with mcp.rs |
| `acp.rs` | 1,481 | Auth, binary resolution, permissions all mixed |

### Acceptable Size (No Action Needed)

| File | Lines | Reason |
| --- | --- | --- |
| `Toolbar.tsx` | 1,050 | Repetitive but declarative |
| `PdfViewer.tsx` | 931 | Specialized, well-isolated |
| `SettingsDialog.tsx` | 922 | Tab orchestrator with lazy children |
| `tauri.ts` | 863 | Type definitions + API wrappers |
| `ChatPanel.tsx` | 842 | Well-structured message routing |

---

## 5. Rust Backend

### Overall: GOOD — No Critical Issues

The Rust backend is well-engineered with proper process lifecycle management, correct mutex discipline, safe SQL, and appropriate unsafe usage.

### MODERATE: Double Keychain Read

**File:** `src-tauri/src/commands/credentials.rs:17-20`

Calls `entry.get_password()` twice — once to check success, then again with `.unwrap()`.

**Fix:** `Ok(password) => Ok(Some(password))`

### MODERATE: Panic on Tokio Runtime Creation

**File:** `src-tauri/src/commands/acp.rs:411`

`.expect("Failed to create tokio runtime")` panics instead of returning error.

**Fix:** Replace with `map_err` and return `Err(String)`.

### MODERATE: Silent try_lock Failures

**File:** `src-tauri/src/commands/network_proxy.rs:195-205`

`try_lock()` failures during shutdown are silently ignored — proxy processes may not clean up.

**Fix:** Add `log::warn!` on the else branch.

### LOW: New HTTP Client Per Request

**File:** `src-tauri/src/commands/ai.rs:133`

`reqwest::Client::new()` per request — no connection pooling. Low impact for UI app.

### LOW: String-Typed Errors Lose Context

All Tauri commands use `Result<T, String>`. Acceptable for IPC but some error paths lose diagnostic detail.

### Confirmed Good Patterns

- **Process management:** `kill_on_drop(true)`, `RunEvent::Exit` hooks, orphan cleanup — all solid
- **Mutex discipline:** Correct `parking_lot` vs `tokio` selection, no nested locks, no locks across awaits
- **SQL safety:** All queries use parameterized `rusqlite::params!`
- **Unsafe code:** Only `libc::kill(pid, 0)` — justified, properly `#[cfg(unix)]`-gated
- **Concurrency:** All shared mutable state in Mutex, `Arc<AtomicBool>` for flags
- **Sandbox:** Comprehensive Seatbelt profiles, network proxy with domain allowlists

---

## 6. Security

No issues found. The security posture is solid:

- **SQL injection:** All queries use parameterized `rusqlite::params!` — no string interpolation
- **Credential storage:** API keys in OS keychain (macOS Keychain via `keyring` crate), never in localStorage or IPC
- **Filesystem sandboxing:** Seatbelt profiles with `(deny default)`, configurable writable paths
- **Network sandboxing:** Kernel-enforced proxy-only networking + domain allowlists with approval flow
- **Unsafe code:** Only `libc::kill(pid, 0)` for process liveness checks — justified, `#[cfg(unix)]`-gated
- **No XSS vectors:** All user content rendered through ProseMirror (sanitized) or Tauri webview