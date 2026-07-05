# Deep Review — 2026-07-03

**Date:** 2026-07-03  **Status:** Audit complete  **Version:** 0.48.0-alpha.8

| Stage | Link | Status |
| --- | --- | --- |
| PRD | — | Pending |
| Tasks | — | Pending |

Deep review focused on three questions: (1) what needs refactoring, (2) what looks functional but isn't fully wired end-to-end, (3) what is badly coded/designed. Ten parallel audit passes: a custom half-wired-features hunt plus nine standard categories (async flows, error UX, render performance, memory leaks, Rust backend, type safety, large files, dead code, documentation drift). Security, accessibility, test-coverage, and dependency categories were out of scope this round (security last audited 2026-06-09; run them separately if wanted). First full-breadth audit since 2026-04-11 (v0.30.2) — everything shipped since (Quiet Composer phase 3, telemetry, OKF wiki-navigation, Local Agent preset, meeting recording, large-file instant load, stream-ID events, automations) was prioritized.

## Summary

The codebase is in good structural health — the April HIGHs are mostly fixed (stream-ID event correlation, real backend stream cancel, Editor.tsx subscriptions, the ACP spawn race), the security-sensitive Rust surfaces (SSRF guards, archive extraction, JSON-RPC framing, GGUF parsing, process cleanup) are consistently hardened, and there are zero type-suppressions and no broken `invoke()` calls anywhere. The main concerns cluster in four places:

1. **Half-wired features** — the user-facing one is "Allow Always" for network domains, which silently behaves as session-only because the Rust `network-domain-always` event has no frontend listener and no persistence target. The git-branch diff review subsystem is fully built (store + hook + editor mount) but has zero triggers — `startReview` is never called, so the whole path is dead. Several settings (`typewriterScrolling`, `searchProvider`), a tray listener, two Copilot progress events, and ~11 registered IPC commands are similarly wired on one side only.
2. **The large-file instant-load pipeline** (`useEditorTabSwitch` + `streamingHydrate`) has three related HIGH race conditions: a dedup ref that survives abort (fast A→B→A leaves the tab stuck), no unmount cleanup for the hydration pipeline, and post-yield editor writes with no `isDestroyed` guard.
3. **Resilience gap at the app root** — the sidebar is the only major surface without an ErrorBoundary and nothing wraps `QuietLayout`, so one sidebar render error white-screens the whole app.
4. **Refactoring debt is concentrated, not diffuse** — `FloatingCommandBar.tsx` (2,873 lines, ~1,467-line component, still growing), `acp.rs` (780-line `run_agent_thread`), `useAcpLifecycle.ts` (module-scope mutable globals), `Editor.tsx` (20+ hooks), and `useAgentTaskOperations.ts` (3× duplicated task-start flows + module-scope maps).

**Severity counts:** 18 HIGH, 47 MEDIUM, 38 LOW
(8 of the 18 HIGHs are large-file refactoring priorities rather than runtime bugs; the runtime-bug HIGHs are the 3 instant-load races, 2 chat-list rendering issues, the missing sidebar boundary, the domain-persistence half-wire, the goal-templates orphan, and 2 doc entries that would mislead an engineer into calling a nonexistent command.)

### Findings by Area

| Area | HIGH | MED | LOW | Summary |
| --- | --- | --- | --- | --- |
| [1. Half-Wired Features](#1-half-wired-features) | 1 | 5 | 4 | "Allow Always" domains never persist; diff-review has no trigger; dead settings/listeners/commands |
| [2. Async Flows & Races](#2-async-flows--race-conditions) | 3 | 4 | 2 | Instant-load pipeline: stuck-tab dedup, no unmount abort, destroyed-view writes; Stop-during-tool-call zombie stream |
| [3. Error UX & Resilience](#3-error-ux--resilience) | 1 | 1 | 1 | No boundary over sidebar/app root (white-screen); Relations panel swallows errors |
| [4. Render Performance](#4-render-performance) | 2 | 4 | 4 | `key={index}` on chat list; per-character forced reflow autoscroll; memo-defeating patterns |
| [5. Memory Leaks](#5-memory-leaks--resource-cleanup) | 0 | 3 | 5 | Deferred-listener registration races (index-progress, tray, ACP eager session) |
| [6. Rust Backend](#6-rust-backend) | 0 | 5 | 6 | Proxy single-read parse; terminal escaping; PID reuse; unverified downloads; Content-Length allocs |
| [7. Type Safety](#7-type-safety) | 0 | 6 | 7 | Trust boundaries: foreign MCP configs, LLM structured output, disk configs asserted without validation |
| [8. Large Files & Refactoring](#8-large-files--decomposition) | 8 | 9 | 0 | FloatingCommandBar, acp.rs, useAcpLifecycle, Editor.tsx, useAgentTaskOperations top the list |
| [9. Dead Code](#9-dead-code--dependency-health) | 1 | 4 | 4 | goal-templates orphan; tested-but-never-called image-drop hook; 11 uninvoked IPC commands |
| [10. Documentation Drift](#10-documentation-drift) | 2 | 6 | 5 | `search_research` documented but nonexistent; deleted Layout.tsx still in architecture tree |

### Comparison with Previous Audit (2026-04-11)

| Change | Details |
| --- | --- |
| **Fixed** | Global AI stream events now carry `streamId` correlation (was CRITICAL-class); backend truly cancels provider streams (`AiStreamState` + `tokio::select!`) |
| **Fixed** | Editor.tsx broad Zustand subscriptions → 20+ atomic selectors; shell-wide subscription hygiene now clean |
| **Fixed** | ACP module-level spawn singleton race → in-flight `spawnPromises` map + post-await re-verification |
| **Fixed** | `selectMessages` module-global closure cache → bounded per-conversation Map |
| **Fixed** | ConnectionsSettings decomposition landed (1,685 → 737 lines) and held |
| **Partially fixed** | ChatMessage now `memo`-wrapped, but per-item `useForegroundLoading()` subscription defeats it |
| **Persists** | FloatingCommandBar.tsx grew 2,832 → 2,873 lines; decomposition not started |
| **Persists** | `useCopilotCompletion` missing request-supersede guard (sibling `useLocalCompletion` has it) |
| **Persists** | ACP session listeners filter on `instanceId` only, ignoring payload `sessionId` |
| **New** | Instant-load pipeline races (3 HIGH), network-domain "Allow Always" half-wire, dead diff-review subsystem, missing sidebar ErrorBoundary |

### Top priorities

1. **Fix or remove "Allow Always" for network domains** (`network_proxy.rs:477` ↔ missing listener) — a trust-relevant permission the user believes is permanent but isn't.
2. **Instant-load pipeline races** (`useEditorTabSwitch.ts`, `markdown.ts:1355`) — clear the preview dedup ref at the abort site, add an unmount cleanup, guard post-yield editor writes with `editor.isDestroyed`.
3. **Add ErrorBoundary around `QuietSidebar` and at the App root** — one sidebar render error currently white-screens the app.
4. **ChatMessageList `key={index}` → `key={message.id}`** and rAF-coalesce the autoscroll MutationObserver.
5. **Decide the fate of git-branch diff review** — wire a trigger or delete the store + hook + mount (currently ~1,000 lines of dead-but-tested feature).
6. **Gate `handleToolCalls` on `cancelled`** in `useDirectApiChat` — Stop during a tool call currently spawns an invisible, billing provider stream.
7. **Start the FloatingCommandBar decomposition** — highest churn × largest unit in the repo; every feature added there makes the split more expensive.

---

## 1. Half-Wired Features


Systematic check of nine wiring seams: settings consumers, Tauri event bus integrity, command surface, store field liveness, no-op affordances, impossible conditions, param key match, payload shapes, docs claims.

### HIGH: "Allow Always" for network domains never persists — silently degrades to session-only
**File:** `src-tauri/src/commands/network_proxy.rs:477-493` (emit) vs. nowhere (no listener)

`DomainApprovalCard` (`src/components/chat/DomainApprovalCard.tsx:75`) offers Allow Once / Allow for Session / **Allow Always**. Clicking "Allow Always" invokes `network_domain_respond` with `decision: 'allow_always'`. Rust's `DomainDecision::AllowAlways` pushes the domain to `session_domains` and emits `network-domain-always` with the comment `// Notify frontend to persist`.

**The seam:** No frontend code ever `listen()`s for `network-domain-always` (emit in 1 file, listen in 0), and there is no persisted network-domain allowlist in `permission-store.ts`. "Allow Always" behaves **identically to "Allow for Session"** — the domain re-prompts next agent session / app restart. Security/trust-relevant UX break: the user believes they granted a permanent exception.
**Fix:** Add a listener that writes the domain into a persisted allowlist and consult it on future requests; or remove the "Allow Always" button and the dead emit.

### MEDIUM: Git-branch diff review is fully built but has no trigger — `reviewActive` can never be true
**File:** `src/stores/diff-review-store.ts:48` (`startReview`) + `src/hooks/useDiffReview.ts` + `src/components/editor/Editor.tsx:288`

`useDiffReview(editor)` implements a complete inline accept/reject-hunk flow. `reviewActive` is set true **only** by `startReview()` — which has zero callers (only its definition and a doc-comment). So `reviewActive` is permanently false, the branch-diff decoration path is dead, `Editor.tsx:288` calls the hook without capturing its return, and the `useFileWatcher.ts:343` "auto-accept if branch review active" guard is also dead. (Different store from the live external-change review, which IS wired.) Docs describe a `BranchDiffSelector` dropdown that doesn't exist in the flow.
**Fix:** Wire a branch-picker entry point that calls `startReview(repoPath, base, compare)`, or delete `diff-review-store.ts` + `useDiffReview.ts` + the mount + the watcher guard.

### MEDIUM: `typewriterScrolling` setting defined and persisted but has no UI and no consumer
**File:** `src/stores/settings-store.ts:64`, setter `:627`

Field + setter + default + persistence exist; zero references elsewhere — no Settings control writes it, no editor code reads it. Entirely unimplemented feature that looks real from the store.
**Fix:** Implement scroll behavior + toggle, or remove field/action + migration to drop the persisted key.

### MEDIUM: `tray-quick-note` is a dead listener — the tray never emits it
**File:** `src/hooks/useTrayEvents.ts:43` (listen) vs. `src-tauri/src/tray.rs` (never emitted)

Tray menu defines `new-note`, `open-actions`, `show-window`, `quit`, `recent-*`; emits `tray-new-note`, `tray-open-actions`, `tray-open-file` — never `tray-quick-note`. The handler (App.tsx:236 `onQuickNote`) can never fire.
**Fix:** Remove listener + prop, or re-add the tray menu item.

### MEDIUM: Copilot chat drops intermediate step / tool-update events (emitted, never listened)
**File:** `src-tauri/src/commands/copilot_protocol.rs:535` (`copilot-chat-tool-update`), `:554` (`copilot-chat-step`)

Both emitted during a Copilot chat turn; no frontend listener for either. Progress/step and tool-update UI silently missing from the Copilot chat surface.
**Fix:** Add listeners rendering step/tool-update state, or remove the emits.

### MEDIUM: `copilot_lsp_sign_out` command registered but never invoked
**File:** `src-tauri/src/lib.rs:341`

Sign-in is wired (`ConnectCopilotLsp.tsx`); no UI path to sign out / revoke a Copilot LSP session in-app.
**Fix:** Add a "Sign out" affordance, or confirm disconnection handled elsewhere and drop the command.

### LOW: `searchProvider` setting has no setter and no consumer
**File:** `src/stores/settings-store.ts:101`, default `:512`

`searchProvider: 'duckduckgo'` — no `setSearchProvider`, no product-code reader (tests only). Web-search tool hardcodes its provider elsewhere. Looks like a configurable preference; is neither settable nor read.
**Fix:** Remove, or make real when a second provider ships.

### LOW: Dead legacy `AISettings.tsx` with a "coming soon" no-op toggle + orphaned `suggestionsEnabled`
**File:** `src/components/settings/AISettings.tsx:377-382`

Live dialog is `settings/v2/SettingsDialogV2.tsx` with its own `v2/AISettings`. Legacy `settings/AISettings.tsx` unimported; contains "Inline AI Suggestions … (coming soon)" Switch bound to `aiStore.suggestionsEnabled` which has no consumer. Doubly dead.
**Fix:** Delete legacy component + `suggestionsEnabled`/`toggleSuggestions`, or wire it.

### LOW: Dead event emits (fire into the void)
**Files:** `agent_manager.rs:1283` (`agent-update-available` — redundant with `agent_check_updates` return), `agent_manager.rs:429` (`agent-install-done` — superseded by progress phase field), `copilot_protocol.rs:265` (`copilot-auth-browser-open`)
**Fix:** Remove unused emits.

### LOW: Registered Tauri commands never invoked from the frontend
**File:** `src-tauri/src/lib.rs` `generate_handler!`

`store_read_batch`, `agent_uninstall`, `agent_install_node_runtime`, `mcp_list_tools`, `mcp_get_server_status`, `fetch_hf_metadata`, `parse_gguf_metadata`, `network_proxy_status`, `sandbox_monitor_register_pid`, `sandbox_monitor_unregister_pid`. Note `sandbox_monitor_*` superseded by an internal Rust path (`acp.rs:636`) so the violation feature itself works. Mild feature gaps worth confirming: `agent_uninstall` (no uninstall UI) and `mcp_list_tools`/`mcp_get_server_status`.
**Fix:** Remove genuinely unused, or wire missing UI.

### Confirmed Good Patterns

- **Settings consumers:** of ~42 UI-backed fields checked, all but `typewriterScrolling` and `searchProvider` have real consumers (long verified list incl. `completionsOnOutOfScope`, `linkPreviewRemoteImages`, `crossProjectMode`, `instantLoadPreview`, `requireAllToolConfirmations`, `externalChangeDiffReview`, caps/pins, etc.).
- **Command surface:** all 228 commands registered; every frontend `invoke('...')` resolves to a registered command — **no runtime-throwing invokes**.
- **Impossible conditions:** `uiPreview` fully deleted (migrations v18/v19), no live gate — Quiet Composer unconditional. `get_system_accent_color` degrades gracefully.
- **Param key match:** verified for `get_backlinks`/`get_outlinks`, `resolve_wikilink`, `transcribe_file`, `render_markdown_preview`, `start_recording`, `stop_recording`, `local_agent_write_config`, `alpha_check`. No mismatches.
- **Payload shapes:** `AgentExitedPayload`, `DomainResolvedPayload`/`DomainAlwaysPayload`, `recording-level`, download-progress, `local-server-status`, `ai-stream-*:<id>` family all line up.
- **Store liveness:** recording-store, quiet-sidebar-store, sidebar-status-slot-store, folder-appearance-store, local-ai completion-server fields, action-store all read-and-written. Only diff-review-store is inert.
- **No empty/console.log-only onClick handlers in live components**; "not yet supported" strings are honest labels, not broken affordances.

---

## 2. Async Flows & Race Conditions


Scope: prioritized subsystems landed since 2026-04-11; re-verified every SKILL example.

### HIGH: `previewInFlightRef` dedup survives abort — tab left stuck on A→B→A re-entry
**File:** `src/hooks/useEditorTabSwitch.ts:165` (abort site) + `:383-387`, `:593-597`, `:709-713` (clear sites)

Main tab-switch effect aborts the previous pipeline at the top but does **not** clear `previewInFlightRef` there — it's cleared only in the `.finally` of `renderMarkdownPreview`. Tauri invoke can't be aborted, so an aborted preview's promise settles later, and its `.finally` only clears when `previewInFlightRef.current === tabIdOnEntry`. Fast A→B→A: second A activation hits the guard at :593 (`if (previewInFlightRef.current === tabIdOnEntry) return;`) and early-returns. A stays stuck in loading/preview state until an unrelated third switch. The abort-aware-dedup gap the SKILL calls out — NOT fixed.
**Fix:** Clear the ref at the abort site: after `abortInFlightRef.current?.abort()`, add `previewInFlightRef.current = null;`. Keep the `.finally` clear as backstop.

### HIGH: Instant-load main effect has no cleanup return — hydration pipeline never aborted on unmount
**File:** `src/hooks/useEditorTabSwitch.ts:159-720`

The effect creates `abortController` per activation and aborts the *previous* one at the top of the *next* run, but has **no `return () => abortController.abort()`**. Editor unmount mid-load of a large file → in-flight `parseInWorker → deferPastPaint → streamingHydrate` chain never cancelled; resumes after unmount (yields with `await requestAnimationFrame` between chunks). Combined with the next finding, post-unmount chunks write into a torn-down ProseMirror view. NOT fixed.
**Fix:** `return () => { abortInFlightRef.current?.abort(); previewInFlightRef.current = null; };`

### HIGH: `streamingHydrate` writes chunks to the editor after a yield with no `isDestroyed` guard
**File:** `src/lib/markdown.ts:1355-1384`

Chunk loop checks only `signal.aborted` at top of each iteration (1356), then after `await new Promise(rAF)` (1382) calls `editor.chain()…insertContent(chunk).run()` (1366/1368) with no `editor.isDestroyed` check. Final `editor.view.updateState(...)` (1397) and deferred `requestAnimationFrame(() => applyAnnotationsToEditor(editor, …))` (1408) likewise unguarded. Unmount during the rAF gap → write to destroyed view. NOT fixed.
**Fix:** Guard every post-yield editor write: `if (signal.aborted || editor.isDestroyed) return { aborted: true, … };` — the `isDestroyed` check is load-bearing.

### MEDIUM: `useCopilotCompletion.requestCompletion` has no request-supersede guard (out-of-order ghost text)
**File:** `src/hooks/useCopilotCompletion.ts:240-290` (esp. 267-279)

Awaits `requestCopilotCompletion(...)`, guards only `!editor.isFocused || editor.isDestroyed` (270), re-reads current cursor (273). No monotonic `requestId` compared after await. Slow request N resolving after N+1 paints stale completion at the new cursor. Sibling `useLocalCompletion.ts` does it correctly (`requestId.current` at 148/172). NOT fixed.
**Fix:** Add `requestId` ref; capture `thisRequest = ++requestId.current` before await, compare after. Capture requested position; discard if cursor moved.

### MEDIUM: Non-reactive `getState()` reads in dependency arrays — effects don't re-arm on setting flip
**File:** `src/hooks/useCopilotCompletion.ts:289, :344, :354`; `src/hooks/useLocalCompletion.ts:217, :255, :265`

Both hooks put `useSettingsStore.getState().inlineCompletionsDisabled` directly in dep arrays. `getState()` doesn't subscribe → toggling "disable completions" doesn't re-render, effects keep stale dep, never re-register until an unrelated re-render. NOT fixed.
**Fix:** Subscribe with a selector and use the variable in body + deps.

### MEDIUM: ACP session listener filters only on `instanceId`, ignoring `sessionId` in the payload
**File:** `src/hooks/useAcpSessionListeners.ts:103` and `:327`

`acp-session-update` and `acp-permission-request` gate solely on `payload.instanceId !== deps.instanceId`. Payload also carries `sessionId` (acp-utils.ts:292/:313); a single agent instance is reused across sessions within a conversation — `agent.chatSessionId` swapped, not the instance (useAcpLifecycle.ts:887/891/900/:555). Two overlapping sends within one conversation, or a session swap while a prior send's listener is live, both pass the gate: chunks append to the stale listener's message too. `cleanupRefs` map is overwritten without invoking prior cleanup (useAcpLifecycle.ts:938) so stale listeners genuinely coexist. NOT fixed.
**Fix:** Gate on sessionId too; run existing cleanup before overwriting `cleanupRefs`.

### MEDIUM: `useDirectApiChat` tool-call continuation isn't gated on `cancelled` — Stop during a tool call spawns a zombie backend stream
**File:** `src/hooks/useDirectApiChat.ts:257-471` (esp. 407, 457), `cleanup` at `:575-603`

`handleToolCalls` never checks `cancelled`. Stop while a tool executes (407) or while awaiting a permission decision (317): cleanup sets `cancelled = true` and unlistens, but `handleToolCalls` continues; on tool completion re-invokes `ai_chat_stream` (457) with the same `streamId` — fresh provider stream whose events land on torn-down channels. Message never updates while the provider streams (and bills) to completion. Permission case: cleanup doesn't resolve the pending tool-permission promise → orphaned closure or zombie stream if user later clicks the card.
**Fix:** Check `cancelled` after each await in `handleToolCalls` before re-invoking; in cleanup, resolve/clear pending tool-permission requests for the conversation.

### LOW: `generateStructured` has no error-event listener or timeout (relies on invoke rejection)
**File:** `src/lib/ai/structured.ts:76-115`

Resolves only on `ai-stream-done:<streamId>`; depends on invoke rejection for errors. Currently correct (provider fns return Err → invoke rejects). No timeout: a future backend path returning Ok without emitting done (as cancel already does, ai.rs:287-298) hangs forever. Theoretical today.
**Fix:** Bounded timeout on `done`, or a dedicated error event.

### LOW: `useDirectApiChat` — cancel-handle ordering is safe today but implicit
**File:** `src/hooks/useDirectApiChat.ts:480-629`

`streamsRef.set` (605) and `invoke('ai_chat_stream')` (616) both happen after `await Promise.all([listen…])` (489) — ordering is safe. Fragile to reorder.
**Fix:** Comment pinning the invariant.

### Confirmed Good Patterns

**Prior SKILL examples now FIXED (verified):**
- **Global AI events carry `streamId`** — `ai_streaming.rs` emits via `stream_event(base, stream_id)`; `useDirectApiChat` + `structured.ts` mint per-call ids and listen suffixed. Cross-contamination closed.
- **Backend truly cancels provider stream** — `AiStreamState` Arc<Notify> per stream_id; `tokio::select!` drops the reqwest stream; `ai_chat_stream_cancel` signals; `notify_one()` closes the register→await race.
- **ACP spawn singleton race solved** — in-flight `spawnPromises` map + post-await re-verification (acp-agent-state.ts:399, 594-599).
- **`useLocalCompletion` supersede guard correct** (148/172), abort-on-unmount, tab-switch dedup reset.

**New subsystems sound:**
- `useTranscriptionJob.ts` — job-id correlation, disposed flag, per-job finally unlisten. No cross-job bleed.
- `useRecording.ts` / `useMeetingRecording.ts` — pause-aware interval; mounted guard; stuck-orb prevention; module scope justified (single capture owner).
- `useLocalAgentSetup.ts` / `local-agent-setup.ts` — rollback only undoes run-created connection; idempotent install skip.
- `useDocumentRelations.ts` — requestIdRef + cancelled double guard; debounced reindex listener via relevantPathsRef.
- `telemetry.ts` — fully defensive.
- `useAgentTaskOperations.ts` — isOurEvent(conversationId) for Copilot; streamEvent(streamId) for direct API; per-task cleanup.
- `useCopilotCompletion` LSP lifecycle — StrictMode-safe, crash backoff, guarded listeners, doc-close on unmount.

`Promise.all([listen…])` sites in useDirectApiChat:489, useCopilotChat:140/435, useDocumentRelations:144 are intended all-or-nothing — not allSettled candidates.

---

## 3. Error UX & Resilience


Scope covered: ErrorBoundary inventory, silent-failure grep across all of `src/`, every `listen(` handler in `src/hooks/`, error-message quality, loading/empty states, graceful degradation, and crash-recovery (Zustand persist + `index/db.rs`). Extra depth on the post-2026-04-11 subsystems: telemetry, wiki-link/Relations panel, Local Agent setup, meeting recording/transcription, alpha updater, sidebar `quiet/` sections, and the stream-cancel path.

---

### HIGH: Sidebar surface is not wrapped in an ErrorBoundary, and there is no boundary above `QuietLayout`

**File:** `src/components/QuietLayout.tsx:225` (mount) / `src/App.tsx:667` / `src/main.tsx:80`

`QuietSidebar` is mounted bare at the layout root: `{sidebarPinned ? <QuietSidebar … /> : null}`. Every *other* major surface in `QuietLayout` is individually wrapped — Editor (`:326`), Relations panel (`:356`), Link hover preview (`:370`), Command bar (`:389`), Agent orb (`:401`), Domain approvals (`:412`) — but the sidebar is not. Worse, there is **no ErrorBoundary anywhere above `QuietLayout`**: `App.tsx` renders `ThemeProvider > div > QuietLayout` with no boundary, and `main.tsx` renders `StrictMode > App` with no boundary. So a render error in the sidebar (a malformed file-tree node, a bad `workspace-store` entry, a null project path in `ProjectRow`/`ChildRow`) unwinds React all the way to the root with no boundary — the **entire app blanks to a white screen**, taking the editor and any unsaved document content with it.

**Fix:** Wrap the sidebar in its own boundary: `<ErrorBoundary name="Sidebar"><QuietSidebar … /></ErrorBoundary>`. Additionally add a top-level `<ErrorBoundary name="App">` around `QuietLayout` in `App.tsx` so a throw degrades to the recoverable fallback (which already renders a "Reload" button and the raw error message) instead of a blank screen.

---

### MEDIUM: Relations panel silently vanishes when the link-graph query fails

**File:** `src/components/editor/RelationsPanel.tsx:505`

`useDocumentRelations` correctly captures a query failure into `error` (`src/hooks/useDocumentRelations.ts:151-157`), and the panel's own JSDoc promises "Loading / error states are shown inside the rolled-out panel" (line 36, repeated 500-501). But the render guard is `if (focusModeActive || !path || loading || error || isEmpty || count === 0) return null;` — when `error` is truthy the component returns `null`, so the collapsed handle never appears and there is **no way for the user to open the panel to see the error**. If `get_backlinks`/`get_outlinks` reject (corrupt or locked `links.db`, IPC error, mid-reindex failure), the Relations feature just disappears with zero indication — indistinguishable from "this document genuinely has no links." The error string is stored in state and never rendered anywhere, and no toast fires. Documented behavior and actual behavior contradict.

**Fix:** Drop `error` from the self-hide condition and render the handle + an error state inside the rolled-out panel (friendly line plus `{error}` in `text-xs text-muted-foreground font-mono`, matching the Editor's load-error pattern). Optionally a one-time `toast.error`.

---

### LOW: Local Agent setup dialog's active-stage spinner has no accessible loading announcement

**File:** `src/components/settings/LocalAgentSetupDialog.tsx:286`

The multi-stage setup flow renders a per-stage `<Loader2 … animate-spin />` for the in-progress stage with no `aria-live`, `aria-busy`, or `role="status"` on the stage container. Long-running stages (agent install ~79 MB download, model download, server start, smoke test) update the indicator purely visually.

**Fix:** Add `aria-busy="true"` to the active-stage row while a stage runs, wrap the current-stage label in an `aria-live="polite"` region. The failure line at `:246-248` should carry `role="alert"`.

---

### Confirmed Good Patterns

- **Meeting recording** (`src/hooks/useRecording.ts`): every `startRecording`/`pause`/`resume`/`stop` wraps the `invoke` in `try/catch` with a specific `toast.error`, and proactively `toast.warning`s on detected silence. Exemplary.
- **Transcription jobs** (`src/hooks/useTranscriptionJob.ts:142-144`): failures call `setTranscriptionError(jobId)` **and** `toast.error`; progress-listener setup failure degrades gracefully; listeners torn down in `finally` and on unmount.
- **Alpha updater** (`src/hooks/useAutoUpdate.ts`): both channels route errors into `status: "error"` with the real message; a hard client-side guarantee refuses prerelease manifests on the stable channel.
- **Local Agent setup** (`useLocalAgentSetup.ts` + `LocalAgentSetupDialog.tsx:246-248`): non-fatal steps log-and-continue; fatal steps throw descriptive; proper `rollback` removes only run-created connections; `setup.error` rendered in dialog.
- **Direct-API chat** (`useDirectApiChat.ts`): outer catch + tool-call catch route through `friendlyAIError` into `setMessageError`; stream-cancel path (`:645-661`) best-efforts backend cancel but always runs local cleanup.
- **ACP session listeners** (`useAcpSessionListeners.ts`): unknown session-update types logged at debug, never crash; fire-and-forget deny/approve invokes annotated with rationale.
- **ACP stream-cancel escalation** (`useAcpLifecycle.ts:1290-1349`): 5s escalation timer with correct listener-leak handling.
- **Telemetry** (`src/lib/telemetry.ts`): textbook acceptable fire-and-forget — no-ops when disabled, try/catch that can never throw into the caller, every branch logs.
- **Editor load error** (`Editor.tsx:570-582`): friendly heading plus raw `activeTab.loadError` in mono — exactly the prescribed pattern.
- **ErrorBoundary fallback** (`ErrorBoundary.tsx`): surfaces `error.message`, offers "Reload"; Sentry capture consent-gated.
- **Sidebar context menu** (`SidebarContextMenu.tsx`): move/open/rename all `toast.error` on failure.
- **SQLite crash recovery** (`src-tauri/src/index/db.rs:21-53`): `open_or_create` maps every failure to an error string — no panic on startup path.

Minor/acceptable: `TagsSection.tsx:105` and `MentionsSection.tsx:107` fall back to empty list on index-query rejection (passive sections, acceptable degradation; worth a `log.debug`). `editor-styles-store.ts:165` swallows a one-time typography-migration write (self-healing).

---

## 4. Render Performance


**Critical environment note:** The **React Compiler is NOT adopted** — `vite.config.ts:90` uses a bare `react()` plugin with no `babel-plugin-react-compiler`. React 19.2 with **manual memoization only**. Every "compiler-covered" label below is live in production today.

### Verification of 2026-04-11 HIGH findings

- **Editor.tsx broad subscriptions — FIXED.** `Editor.tsx:89-111` now uses 20+ atomic selectors. Remaining `openDocuments` whole-array subscription + in-render `.find()` (line 119) is bounded (single-document shell) → Low/polish.
- **ChatMessage unmemoized — PARTIALLY FIXED.** `ChatMessage.tsx:645` now `memo()`-wrapped, but a per-item store subscription defeats the memo (below).

---

### HIGH: ChatMessageList — `key={index}` on the message loop is a reconciliation/correctness bug
**File:** `src/components/chat/ChatMessageList.tsx:241`

`messages.map(...)` keys each row with `<div key={index}>`. The list's identity changes: `branchFromMessage` (line 174) swaps the active thread; edit/resend rebuild it. With an index key React reconciles wrong-message-to-wrong-DOM on a branch switch and **remounts subtrees**, losing per-message local state — `copied`, `thinkingManualToggle` (`ChatMessage.tsx:646,653`), `expanded` in `ActivityLog`/`ToolCallLog`/`ToolCallItem`, `userToggled` in `ToolCallGroup`, `resultExpanded`. Stable `message.id` is in hand.
**Label:** must-fix-by-hand (correctness — compiler does NOT fix key bugs).
**Fix:** `key={message.id ?? index}`.

### HIGH: ChatMessageList — MutationObserver autoscroll forces a synchronous reflow on every streamed character
**File:** `src/components/chat/ChatMessageList.tsx:95-105`

Autoscroll observer registered with `{ childList: true, subtree: true, characterData: true }` — fires on every text mutation (every streamed character). Callback reads `el.scrollHeight` and writes `el.scrollTop` synchronously (99-101) → forced layout/reflow per chunk in the always-visible command-bar stream.
**Label:** must-fix-by-hand (outside React's render model).
**Fix:** Coalesce into one layout/scroll per frame with `requestAnimationFrame` (guard double-scheduling); narrow observer toward `childList`.

### MEDIUM: ChatMessage — per-item `useForegroundLoading()` subscription defeats its own `React.memo`
**File:** `src/components/chat/ChatMessage.tsx:649`

`ChatMessage` is `memo`-wrapped but calls `useForegroundLoading()` (`useSessionRunStore` + `useChatStore` subscription). Only the **last** message needs this flag (`isActivelyStreaming = isLoading && isLast`, lines 654, 686). The subscription lives inside the component so memo cannot gate it: when the run status flips, **every** rendered ChatMessage re-renders. The parent already computes the identical `isLoading` (`ChatMessageList.tsx:55`). MEDIUM (flip is per-send-boundary, not per-chunk).
**Label:** must-fix-by-hand (subscription granularity).
**Fix:** Drop `useForegroundLoading()` from ChatMessage; compute `isActivelyStreaming={isLoading && isLast}` in `ChatMessageList.map` and pass as prop.

### MEDIUM: SegmentRenderer — unmemoized `groupSegments()` + non-memo component + freshly-sliced array props defeat child memos
**File:** `src/components/chat/ChatMessage.tsx:539-546`

`SegmentRenderer` is a plain function calling `groupSegments(segments)` (540) in render — O(segments) grouping recomputed on every stream flush AND unrelated re-renders. For each verb group it allocates a **new** `segments.slice(...)` (546) passed to `memo`-wrapped `ToolCallGroup` — fresh array defeats the memo, so `ToolCallGroup` re-runs `getDetail()` (JSON.parse + regexes per tool call, `ToolCallGroup.tsx:145-159`) on every flush.
**Label:** compiler-covered (but live today).
**Fix:** `useMemo(() => groupSegments(segments), [segments])`, memo-wrap SegmentRenderer, build grouped slices inside the same useMemo.

### MEDIUM: ChatMessageList — in-render `parseQuickReplies()` + new-object `displayMessage` prop per assistant message per render
**File:** `src/components/chat/ChatMessageList.tsx:220-223`

Every assistant message runs `parseQuickReplies(message.content)` (regex passes + split + heuristics) on **every** list render (every streaming chunk). When a reply block is present, `displayMessage = { ...message, content: parsed.strippedContent }` allocates a fresh object passed as `message` prop to memo-wrapped ChatMessage, defeating its memo.
**Label:** compiler-covered (live today).
**Fix:** Memoize keyed on messages array, or precompute `strippedContent` + `replies` in chat-store at write time.

### MEDIUM: ChatMessageList — O(n²) in-render tree derivations per message per render
**File:** `src/components/chat/ChatMessageList.tsx:227-238`

Per message: `segments.findIndex(...)` with nested `allMessages[...]` lookup (227-233) and `getChildren(allMessages, message.id)` (237) — each O(messages). Whole list = O(n²) per render, re-executed every streaming chunk.
**Label:** must-fix-by-hand in practice (inputs change every chunk; fix is algorithmic).
**Fix:** Precompute `Map<messageId, childCount>` and message-id→segment index once per messages change (single useMemo), O(1) lookups in map body.

### LOW: MarkdownContent — inline `remarkPlugins` / `components` config allocated in render
**File:** `src/components/MarkdownContent.tsx:39-51`

`remarkPlugins={[remarkGfm]}` (new array) and `components={{ a: (...) => … }}` (new object) per render. Outer `memo(MarkdownContentImpl)` (65) bounds blast radius; genuine Low/polish.
**Fix:** Hoist `REMARK_PLUGINS` and components map to module scope.

### LOW: App.tsx — root component destructures the whole workspace store for two actions
**File:** `src/App.tsx:102`

`const { addProject, addExplorerFolder } = useWorkspaceStore();` subscribes the app root to the entire workspace store. Any workspace-store change re-renders `App`.
**Fix:** Atomic selectors or `getState()` in handlers.

### LOW: ExplorerFolderItem — whole-store destructure inside a list-item row
**File:** `src/components/sidebar/ExplorerFolderItem.tsx:38`

`const { isExpanded, toggleFolder, removeExplorerFolder } = useWorkspaceStore();` per folder row. (Verify still on a render path after Classic Layout removal before investing.)
**Fix:** Atomic selectors.

### LOW: StatusBar — word count recomputes `editor.getText()` + regex split on every editor transaction
**File:** `src/components/editor/StatusBar.tsx:270-281`

`setTick` on every `editor.on("transaction")` forces StatusBar re-render per keystroke; each render runs `editor.getText()` + `split(/\s+/)` — O(document) per keystroke. Leaf component, so Low, but measurable on very large documents.
**Fix:** Debounce the tick (200-300ms) and/or memoize word count.

---

### Confirmed Good Patterns

- **`selectMessages` module-global closure cache defused:** `chat-store.ts:1037-1086` — bounded per-`conv.id` Map (MAX_ENTRIES=32) keyed on `leafId:length:updatedAt`, stable `EMPTY_MESSAGES` sentinel.
- **`MarkdownContent` reads workspace roots via `getState()` at click time** (`MarkdownContent.tsx:19-28`).
- **All 9 segment views are `memo`-wrapped**; `TextSegmentView` memoizes quick-reply strip.
- **Zero whole-store destructures in the priority surfaces** (QuietLayout, QuietSidebar + sections, FloatingCommandBar, CommandBarStream, AgentOrb, StatusBar, StatusTray, ChatMessageList, ChatMessage). The 2026-04-11 broad-subscription class is resolved for the shell.
- **`AgentOrb` derives unwatched scalars from one filter pass in `useMemo`** (`AgentOrb.tsx:87-93`).
- **`WorkspaceHeader` memoizes recursive `countMarkdownFiles`** (`QuietSidebar.tsx:95-104`).
- **Resize handles are React-render-free** (CSS variable writes during drag, persist on release).
- **`useFadeOnType` / `useQuietChrome` / `useWindowFocus`** drive chrome via DOM attribute writes, no re-renders per keystroke.
- **`ChatMessageList` stabilizes child callbacks** with `useCallback`, memoizes `branchPointInfo`.
- **`StatusTray`** clean.

---

## 5. Memory Leaks & Resource Cleanup


Scope: very thorough, prioritizing code added since 2026-04-11. Seeded Confirmed-Good sites not re-flagged.

### MEDIUM: Background-activity indicator leaks two listeners + post-unmount setState (no `mounted` guard)
**File:** `src/components/editor/status/use-background-activity.ts:49-64`

The skill's example StatusBar bug, relocated intact. Dynamic `import("@tauri-apps/api/event").then(({ listen }) => { listen("index-progress",…).then(fn => unlistenProgress = fn); listen("index-ready",…).then(fn => unlistenReady = fn); })` with `return () => { unlistenProgress?.(); unlistenReady?.(); }` and **no mount-state flag**. Unmount before the import + both listens resolve → cleanup sees undefined handles; listeners register after unmount, never torn down; `setIndexing` fires on torn-down component. Consumed by `StatusBar` → `SidebarStatusBar`, which unmounts on every sidebar hide toggle (`⌘⇧L`); `index-progress` bursts at startup.
**Fix:** Mirror `useSandboxViolations.ts:48-54` — `mounted` flag, guard each `.then` (`if (mounted) unlisten = fn; else fn();`), guard `setIndexing`, `mounted = false` first in cleanup.

### MEDIUM: useTrayEvents — sequential `await listen()` pushed into array, no `mounted` guard
**File:** `src/hooks/useTrayEvents.ts:31-69`

Four listeners registered sequentially — `unlisteners.push(await listen(…))` ×4 — with `return () => unlisteners.forEach(fn => fn())`. Cleanup between two awaits iterates a partially-populated array; listeners awaited after cleanup leak. Deps `[onNewNote, onQuickNote, onOpenActions, onOpenFile]` are plain callbacks from App.tsx; if unmemoized, the effect re-runs on parent re-render, hitting the mid-setup teardown window in normal use.
**Fix:** Track mounted; unlisten anything awaited post-cleanup, or register atomically with `Promise.all` and unwind together. Wrap App callbacks in `useCallback`.

### MEDIUM: useAcpLifecycle eager-session — listener stored in ref inside long async IIFE, race with cleanup
**File:** `src/hooks/useAcpLifecycle.ts:475-639` (listener at `:574`, stored `:600`, cleanup `:632-638`)

Async IIFE only reaches `await listen('acp-session-update', …)` after store rehydration + `ensureAcpAgent` (cold spawn) + `restoreOrCreateAcpSession`. Cleanup only does `eagerUnlistenRef.current?.()`. Unmount or dep change (`activeConversationId` changes on every conversation switch) during the multi-second await window → cleanup runs while ref null, IIFE then registers a listener with no owner. Module-level `eagerSessionPromise` lock prevents a second IIFE, not the orphaning of the first. Leaked `acp-session-update` listener fans out stale-session events to a dead handler.
**Fix:** `let active = true` in the effect; after the await `if (!active) { eagerUnlisten(); return; }` before storing; `active = false` in cleanup.

### LOW: useAcpLifecycle `acp-agent-exited` — classic single-listener `.then`, no `mounted` guard
**File:** `src/hooks/useAcpLifecycle.ts:446-467`

Textbook broken shape. Deps `[]` so impact low (unmount/StrictMode only).
**Fix:** Add `mounted` flag guard.

### LOW: wiki-link decoration plugin — deferred `listen("links-reindexed")`, no guard against early `destroy`
**File:** `src/components/editor/extensions/wiki-link.tsx:403-416`

Plugin `view()`: `void listen("links-reindexed", onReindexed).then((fn) => { unlistenReindex = fn; })` with `destroy: () => { … unlistenReindex?.(); }`. Editor destroyed (tab close, view-mode switch) before promise resolves → listener registers afterward with no teardown, keeps dispatching decoration recomputes into a detached view.
**Fix:** `active` flag in the plugin view closure; unlisten immediately if destroyed.

### LOW: App.tsx `open-files` listener — dynamic-import single listener, no `mounted` guard
**File:** `src/App.tsx:246-279`

Same deferred-registration gap; deps `[openFile, addExplorerFolder]` can change identity. App-lifetime mounting keeps practical risk low.
**Fix:** Add `mounted` flag.

### LOW: FolderPeek — hover open/close timers not cleared on unmount
**File:** `src/components/sidebar/quiet/FolderPeek.tsx:168-169, 246-254, 269-272`

`openTimerRef`/`closeTimerRef` cleared on mouse paths but no unmount cleanup. Row unmounts (sidebar filter keystroke, tree refresh) during pending hover window → timer fires `setPosition`/`setIsOpen` on unmounted component (silent no-op in React 19, but not defensively cleared). 60s interval IS cleared correctly.
**Fix:** `useEffect(() => () => { clearOpenTimer(); clearCloseTimer(); }, […])`.

### LOW (consistency): `return () => promise.then(fn => fn())` unlisten shape
**Files:** `useFileWatcher.ts:260-261`, `DrawingPreview.tsx:177`, `useDocumentRelations.ts:122-125`, `useFileRenameSync.ts:225-227`

Not leaks — promise resolves once, cleanup always fires. Residual hazard is only the brief post-unmount window (each self-guards adequately). Standardize on `mounted`-flag form. `DrawingPreview`'s listener also re-subscribes on `[drawingJson, drawingId]` (churn, not a leak).

### Areas verified with no findings

- Zustand `.subscribe()`: FolderPeek context-menu subscriptions correctly unsubscribed.
- Tiptap: `useEditorTabSwitch` and StatusBar pair `editor.on/off('transaction')` + clear timeouts.
- AbortController in useEditorTabSwitch genuinely consumed by parseInWorker/streamingHydrate.
- Rust process cleanup: no new spawn sites in the reviewed frontend work.

### Confirmed Good Patterns

| File | Pattern checked | Status |
| --- | --- | --- |
| `useSandboxViolations.ts:20-61` | mounted flag + immediate unlisten | Clean |
| `useActionScanner.ts:27-72` | mounted flag, debounce cleared | Clean |
| `useRecording.ts:33-75` | interval cleared; level listener guarded | Clean |
| `useLocalAI.ts:191-275` | guarded; interval cleared; unlisten in finally | Clean |
| `useFadeOnType.ts` | DOM + matchMedia removed; timer cleared | Clean |
| `useWindowFocus.ts:71-76` | same-fn-ref removal; attribute reset | Clean (re-verified) |
| `useScrollPersistence.ts:90-102` | passive scroll + debounce cleaned | Clean |
| `useTranscriptionJob.ts:74-170` | disposed flag; unlisten after await + finally; Set drained | Clean |
| `useGlobalShortcuts.ts:71-133` | bubble+capture removed; callbacks via ref | Clean |
| `useEditorTabSwitch.ts:159-879` | per-activation AbortController; on/off paired; timeouts cleared | Clean |
| `useModelFitCapture.ts:59-104` | disposed flag + Promise.all; poll cleared | Clean |
| `useCopilotCompletion.ts:392-440` | mounted flag, guarded .then | Clean |
| `StatusBar.tsx:271-278` | on/off paired; portal has no listener state | Clean |
| `StatusTray.tsx` | no resources | Clean |
| `useLocalAgentSetup.ts` | no listeners/timers | Clean |
| `telemetry.ts` | fire-and-forget only | Clean |
| `RecentSection.tsx:366-383` / `PinnedSection.tsx:447-464` | same-ref rename listener add/remove | Clean |
| `FolderPeek.tsx:199-203` | 60s interval cleared; subscriptions unsubscribed | Clean (see LOW re hover timers) |

---

## 6. Rust Backend


### MEDIUM: Proxy parses the client request from a single 8 KB `read()` — partial reads truncate
**File:** `src-tauri/src/commands/network_proxy.rs:263`
`handle_connection` does `let mut buf = vec![0u8; 8192]; let n = client.read(&mut buf).await?` and parses request line + headers from `buf[..n]`. TCP doesn't guarantee one-segment delivery; >8 KB requests silently truncate. If the `Host:` header lands in a later segment, `host_from_header` returns None and the request-target/Host mismatch check (security-M3 guard) is skipped; a split request line yields a spurious 400. Allowlist stays authoritative on the request-target so not a bypass, but a robustness gap in a security-sensitive parser.
**Fix:** Loop reading into a growable buffer until `\r\n\r\n`, with a max-header-size cap (mirror json_rpc.rs MAX_HEADER_BYTES).

### MEDIUM: `run_in_terminal` layers shell-quote and AppleScript-quote escaping incoherently
**File:** `src-tauri/src/commands/dialog.rs:44`
Command escaped with shell single-quote idiom (`replace('\'', "'\\''")`) but never placed inside single quotes — interpolated into an AppleScript `do script "{}"` double-quoted literal (with separate `replace('"', "\\\"")`). Two escaping models on one string, neither consistently in force — provably wrong for any input containing a quote; latent shell-injection surface. Today all callers (reauth.ts, ConnectAgent.tsx) pass vetted constants, so not live-exploitable.
**Fix:** Pass the command to AppleScript as a bound variable (osascript argv), or assert vetted constants + one correct AppleScript escaper (drop the shell transform).

### MEDIUM: Orphaned llama-server cleanup signals a PID from disk without verifying process identity
**File:** `src-tauri/src/commands/local_inference.rs:552`
`kill_orphaned_servers` (startup, lib.rs:499) reads a PID from `.server.pid`/`.completion.pid` and runs `kill -15 <pid>` with no check it still belongs to a llama-server. Crash + PID recycle → SIGTERM to an unrelated user process.
**Fix:** Validate identity before signalling (`ps -o comm= -p <pid>` on macOS) or persist a start-timestamp alongside the PID.

### MEDIUM: Runtime/agent downloads extracted with no integrity verification
**File:** `src-tauri/src/commands/agent_manager.rs:540` (Node.js), `:970` (GitHub binaries)
`do_gemini_install` and `do_github_binary_install` download + extract + chmod 0o755 + later spawn, with no pinned SHA-256/signature — HTTPS is the only defense. nodejs.org publishes SHASUMS256.txt; GitHub releases can ship a checksum asset.
**Fix:** Verify a pinned SHA-256 over downloaded bytes before extraction.

### MEDIUM: Download buffers pre-sized from attacker-supplied `Content-Length`, accumulate unbounded
**File:** `src-tauri/src/commands/agent_manager.rs:560`, `:1000`, `:910`
`Vec::with_capacity(total as usize)` where `total = resp.content_length().unwrap_or(0)` — hostile server sending near-usize::MAX drives a capacity-overflow abort (not catchable at command boundary). Streaming loop has no running-total cap. Zip branch (`:910`) trusts the archive's declared uncompressed size (decompression-bomb).
**Fix:** Cap `total` before with_capacity (or drop the reservation); enforce running-total byte cap; clamp zip capacity hint.

### LOW: Unbounded response-body / subprocess-output buffering
**File:** `src-tauri/src/commands/mcp.rs:339`, `web_search.rs:35`, `script_exec.rs:160` (and `:172`)
`resp.text()` on remote MCP server responses and DuckDuckGo HTML; `read_to_end` on skill-script stdout/stderr (timeout races wait(), not the reader). Memory-exhaustion vectors under a hostile peer.
**Fix:** Stream with running-total cap (as link_preview.rs MAX_PREVIEW_BODY_BYTES); cap + truncate script output.

### LOW: `render_markdown_preview` runs blocking file I/O + CPU-bound rendering on the async runtime
**File:** `src-tauri/src/commands/preview.rs:97`
Sync `std::fs::read_to_string` then comrak inline in an async command — exists specifically for the large-file path, so multi-MB parse blocks a tokio worker.
**Fix:** `tokio::task::spawn_blocking` (or tokio::fs + spawn_blocking for comrak).

### LOW: Startup ACP orphan cleanup uses system-wide `pkill -f`
**File:** `src-tauri/src/lib.rs:491`
`pkill -f claude-agent-acp` / `codex-acp` matches full command lines of every process on the host — can signal an unrelated process. Inconsistent with the PID-file discipline used for llama-server two lines below.
**Fix:** PID-file + identity validation, kill by PID.

### LOW: `validate_external_url` omits CGNAT and reserved ranges that `link_preview` blocks
**File:** `src-tauri/src/commands/mcp_oauth.rs:219`
IP-literal check misses CGNAT 100.64.0.0/10, broadcast, documentation ranges — which link_preview.rs:169 `is_blocked_ip` covers. Minor SSRF-surface inconsistency.
**Fix:** Share one `is_blocked_ip` helper between the two modules.

### LOW: `kill_server_process` sends only SIGTERM with no SIGKILL escalation
**File:** `src-tauri/src/commands/local_inference.rs:453`
On failed health check, teardown is `kill -15` only; a wedged llama-server ignoring SIGTERM is never escalated — unlike `stop_sync` (`:76-82`) which does SIGTERM→500ms→SIGKILL.
**Fix:** Reuse the escalation from stop_sync.

### LOW (informational): Whisper context lock held across the whole-file inference
**File:** `src-tauri/src/commands/transcription.rs:998`
`parking_lot::Mutex` guard on `whisper_ctx` held across `create_state()` + `full()` — serializes concurrent transcribe_file jobs and pins the cached model. Runs on spawn_blocking, parking_lot deliberate (documented). Acceptable; flagged so a reviewer knows serialization is intentional.
**Fix (if concurrency ever wanted):** scope lock to cache load/reload, per-call state.

### Confirmed Good Patterns

- **GGUF parser hardening**: 10 MB string cap, `MAX_GGUF_ARRAY_DEPTH = 16` recursion bound, array-count (1M) + KV-count (100k) caps. The recursion-depth bound is present.
- **JSON-RPC framing caps** (json_rpc.rs): MAX_MESSAGE_BYTES (64 MiB) enforced BEFORE `vec![0u8; n]`; MAX_HEADER_BYTES (64 KiB).
- **Whisper Mutex**: `parking_lot::Mutex` with documented poison-safety rationale; std Mutex sites poison-tolerant via `unwrap_or_else(|e| e.into_inner())`.
- **Link-preview SSRF**: http(s)-only, comprehensive `is_blocked_ip`, every redirect hop re-validated via manual `Policy::none()` loop, 2 MiB streamed body cap.
- **MCP-OAuth SSRF**: `validate_external_url` applied on server URL + every discovered endpoint, re-validated before POSTing credentials.
- **Proxy host-confusion fix**: request-target host authoritative; disagreeing Host header rejected; wildcard matching has no suffix-bypass.
- **AI stream cancellation** (ai.rs): real backend cancel via Notify + tokio::select! dropping the reqwest stream.
- **Archive extraction**: tar-slip guard rejects ParentDir/RootDir/Prefix after skip(1); perms masked & 0o755; zip uses enclosed_name.
- **Process-exit cleanup**: SIGTERM→SIGKILL at exit across llama-server/ACP/MCP; RunEvent::Exit invokes all four spawners' stops.
- **Telemetry** (telemetry.rs): parking_lot static for Sentry client; single-point `scrub_event` PII strip, well tested.
- **index/links.rs**: production code panic-free (all unwraps in tests).

---

## 7. Type Safety


Scope: all `: any`/`as any`/`<any>`/`any[]` in `src/` (production and test), all 21 `invoke<{…}>`/typed-annotation IPC call sites, all 18 production `JSON.parse(...) as T` sites, every `@ts-ignore`/`@ts-expect-error`/`eslint-disable`, and the Rust IPC/event boundary. Weighted post-April code heavily: telemetry, links/wiki-link, local-agent-setup, transcription, alpha_update metadata, preview/instant-load, stream-events.

**Found 6 production `any` usages** (plus ~40 in tests, acceptable), **509 `as` type assertions in production** (load-bearing subset: 18 `JSON.parse(...) as T` + 21 inline-typed `invoke` boundaries), **0 suppressed errors** in production.

---

### MEDIUM-HIGH: Foreign MCP config asserted to a named type and mapped without validation
**File:** `src/components/settings/McpServersSettings.tsx:934` (and sibling read at `:986`)

`invoke<Array<{ id; name; command; args: string[]; env: Record<string,string>; source; enabled }>>('mcp_import_configs', { source: sourceId })` asserts a concrete shape onto configs Rust read out of **another tool's config file** (Claude Desktop / Cursor / VS Code). Result immediately `.map()`ed. A malformed/renamed field (`args` absent, `env` a string) flows into saved `mcp.json` and later `mcp_start_server`, crashing far from here.
**Fix:** Type as `unknown`, validate with zod/valibot `.safeParse`; drop failing entries + toast.

### MEDIUM-HIGH: MCP discovery configs asserted via variable annotation, then field-accessed
**File:** `src/hooks/useMcpOperations.ts:138` (and `:144`)

`const globalConfigs: McpServerConfig[] = await invoke('mcp_discover_configs', …)` over foreign-sourced MCP configs on disk; entries passed to `configToEntry(c)`, `c.source` compared (`:162`), auto-start (`:170-183`) reads `entry.command`/`args`/`env` from unvalidated data.
**Fix:** `unknown` + type guard in `configToEntry`; centralize MCP command types in `src/lib/tauri.ts`.

### MEDIUM: `JSON.parse(collected) as T` on LLM output in the structured-generation helper
**File:** `src/lib/ai/structured.ts:84`

`const parsed = JSON.parse(collected) as T`. try/catch only catches a parse throw — valid JSON with a gapped shape (grammar can omit fields; non-local providers ignore `response_format` entirely per docstring :52-55) passes silently and crashes at the caller's first property access.
**Fix:** Accept optional `validate?: (v: unknown) => v is T` in options; parse to `unknown`, reject on validation failure.

### MEDIUM: Project metadata read from disk asserted to `ProjectMetadata`
**File:** `src/hooks/useProjectMetadata.ts:73`

`JSON.parse(raw) as ProjectMetadata; setMetadata(...)` stores disk-sourced `.notesage/*` config with no shape check. Hand-edited/drifted metadata that is valid JSON but wrong-shaped is stored as-is; consumers crash away from the parse.
**Fix:** Type guard before `setMetadata`; on failure fall back to `createDefaultMetadata(...)` (same defaulting path used when file absent, `:68`).

### MEDIUM: Rename-transaction manifest asserted, then unguarded field access on the recovery path
**File:** `src/lib/rename-transaction.ts:299`

`manifest = JSON.parse(raw) as RenameTransactionManifest` in try/catch, but `:305-307` reads `manifest.txnId`, `.phase`, `.entries.length` **outside** the try. Runs during crash recovery — exactly when a half-written manifest is most likely — `manifest.entries.length` throws TypeError and aborts cleanup. Similar at `:166`, `:367` (optional-typed, safer).
**Fix:** Type guard (`entries` is array, `txnId`/`phase` present) inside the try; on failure `cleanupTxnDir(txnDir)` and return.

### MEDIUM: Missed migration — raw `(editor.storage as any).markdown` bypasses typed `getEditorStorage`
**File:** `src/lib/external-diff.ts:146`

Repo ships `getEditorStorage<EditorStorageMarkdown>(editor, 'markdown')` (`src/lib/editor-storage.ts`, JSDoc says "use this instead"). This module still uses raw `(editor.storage as any).markdown` + eslint-disable.
**Fix:** Use the typed helper; read `mdStorage?.parser`.

### LOW-MEDIUM: Chart / document-index sidecar data asserted to concrete types
**File:** `src/lib/chart-storage.ts:64`, `src/components/editor/charts/ChartNodeView.tsx:50`, `src/lib/document-index.ts:115`

`JSON.parse(raw) as ChartData | DocumentIndex` on disk/embedded data. Parse throw handled; valid-but-wrong-shaped sidecar passes. (`resolveChartColors` in `useExportOperations.ts:141` guards with optional chaining — mitigating pattern the others lack.)
**Fix:** Lightweight `isChartData` / `isDocumentIndex` guards, return safe default on mismatch.

### LOW-MEDIUM: `AlphaUpdateMetadata` asserted from IPC, handed to updater install pipeline
**File:** `src/hooks/useAutoUpdate.ts:223`

`invoke<AlphaUpdateMetadata | null>("alpha_check", …)` → `new Update(metadata)` → `downloadAndInstall()`. Strong mitigations: named documented type, null-checked, errors caught, signature verification Rust-side. Drift risk only.
**Fix:** Low priority; co-locate type with the Rust serde struct.

### LOW: 21 inline-typed first-party `invoke` call sites (silent Rust-drift risk)
**Files:** `ConnectionCard.tsx:131,139,158,178,221`, `ConnectAgent.tsx:70,81`, `ConnectCopilotLsp.tsx:165,182`, `useAcpLifecycle.ts:1110`, `useLocalAgentSetup.ts:26,97`, `useAIContext.ts:48`, `tool-executor.ts:246,526`, `ConnectionsSettings.tsx:87`, `tauri.ts:898,1557,1561,1569`

Inline object-literal assertions mean a Rust signature change produces **no** frontend type error.
**Fix:** Promote shapes into `src/lib/tauri.ts` as named types.

### LOW: Third-party interop `as any` casts (narrow to interop type instead)
**File:** `DrawingEditor.tsx:284,287` (Excalidraw), `extensions/toc.ts:187` (Tiptap), `extensions/table-markdown.ts:173` (`type SerializerState = any`)

Acceptable interop category, but silences all checking; upstream drift invisible.
**Fix:** `libraryItems as ExcalidrawLibraryItems` (local interface), `TocView as unknown as ComponentType<NodeViewProps>`, minimal `SerializerState` interface.

### LOW: Perf harness `(editor.storage as any).markdown.getMarkdown()` unguarded chain
**File:** `src/perf/harness.ts:140`
**Fix:** `getEditorStorage<EditorStorageMarkdown>(editor, 'markdown')?.getMarkdown?.()`.

### LOW: Comment sidecar object branch asserted without narrowing
**File:** `src/lib/comment-storage.ts:44`

`parseSidecar` narrows the legacy array branch but the object branch returns bare `parsed as SidecarData` with no check `.comments` exists. Sidecars can be agent-written.
**Fix:** Guard object branch; else return `{ comments: [] }`.

### LOW (informational): Rust IPC event names stringly-typed on both sides
**File:** `acp_client.rs:76,108`, `copilot_protocol.rs`, `watcher.rs:165,183`, `automations.rs:769,822`, `index/mod.rs`; frontend `listen(...)` counterparts

Typo or one-sided rename = silent no-op, no compile error. `copilot_models.rs:19 pub provider: String` minor stringly field.
**Fix:** Shared event-name constants (Rust const/enum + generated TS union). Consider `ProviderKind` enum.

---

### Confirmed Good Patterns

- **`src/lib/ai/path-filter.ts`** — exemplar security-gated boundary: `JSON.parse` → `unknown` → typeof guard → per-field checks (`:62-88`, `:196-205`).
- **`acp-utils.ts:388` `parseRawInput`** — the in-repo reference guard. Correct.
- **`src/lib/markdown.ts:122`** — parses annotation attr as `unknown` with full narrowing. Textbook.
- **`drawing-storage.ts:63`** — returns `JSON.parse(raw) as unknown`, forcing callers to narrow.
- **`telemetry.ts`** — closed `TelemetryEventProps` taxonomy; every `track()` compile-checked; no free text/PII.
- **`editor-storage.ts`** — ships typed `getEditorStorage<T>` accessor.
- **`markdown-worker.ts`** — fully typed discriminated worker messages; no `any` at the boundary.
- **`stream-events.ts` / `structured.ts` stream correlation** — per-stream `streamId` prevents cross-stream leakage; only residual gap is the `as T` (flagged).
- **`link-utils.ts`** — pure, typed; no unsafe casts on the links boundary.
- **`local-agent-setup.ts` + `useLocalAgentSetup.ts`** — DI staged driver, typed deps, null-checked IPC.
- **`ToolCallGroup.tsx:32`** — full parse-narrow chain.
- **`drag-utils.ts:12`** — external dataTransfer parsed in try/catch, `_notesage` discriminant checked.
- **Zero `@ts-ignore`/`@ts-expect-error`/`@ts-nocheck` in production.**

---

## 8. Large Files & Decomposition


Research-only pass. Rank key is **largest single unit** (function/component), not file total, per the skill. Test files excluded from ranking. The four "confirmed cohesive" files are respected and not re-flagged. Where a prior audit fix already landed (e.g. `ConnectionsSettings` split out `ConnectAgent.tsx`), it is noted.

### Files Over Threshold

| File | Lines | Largest unit | Threshold | Responsibilities |
| --- | --- | --- | --- | --- |
| `src/components/cmd/FloatingCommandBar.tsx` | 2,873 | `FloatingCommandBar` ~1,467 | 400 | 5+ (chat surface, prefix modes, 3× resize, attachments, a11y) |
| `src-tauri/src/commands/acp.rs` | 2,561 | `run_agent_thread` ~780 | 1,000 | command surface + session lifecycle + agent thread transport |
| `src-tauri/src/commands/mcp.rs` | 1,950 | `mcp_validate_server` ~162 | 1,000 | 12 commands + HTTP client + JSON-RPC/SSE parsing + transport + catalog |
| `src/lib/tauri.ts` | 1,617 | thin wrappers | 500 | 159 IPC wrappers + 52 interfaces + 9 types (all domains) |
| `src-tauri/src/commands/local_inference.rs` | 1,603 | `local_bundled_chat_stream` ~433 | 1,000 | 8 commands + server lifecycle + model catalog + FIM |
| `src-tauri/src/commands/transcription.rs` | 1,553 | — | 1,000 | 9 commands + machinery |
| `src-tauri/src/commands/sandbox.rs` | 1,451 | — | 1,000 | platform sandbox impl (0 commands) |
| `src/lib/markdown.ts` | 1,444 | `streamingHydrate` ~124 | 500 | round-trip contract + 11× `convert*ToHtml` helper bank |
| `src/hooks/useAcpLifecycle.ts` | 1,374 | `useAcpLifecycle` ~1,100 | 500 | lifecycle hook + 6 module-scope `let` globals |
| `src-tauri/src/commands/ai.rs` | 1,416 | — | 1,000 | 8 AI commands + machinery |
| `src-tauri/src/commands/agent_manager.rs` | 1,321 | — | 1,000 | agent process management |
| `src-tauri/src/commands/ai_streaming.rs` | 1,275 | — | 1,000 | streaming pipeline |
| `src-tauri/src/commands/export.rs` | 1,272 | — | 1,000 | export command dispatch |
| `src/stores/chat-store.ts` | 1,238 | store | 500 | 96 actions across chat/session/streaming |
| `src-tauri/src/index/queries.rs` | 1,238 | — | 1,000 | index DB queries |
| `src/stores/settings-store.ts` | 1,229 | store | 500 | 168 setters across ~12 settings domains |
| `src-tauri/src/index/mod.rs` | 1,229 | — | 1,000 | index subsystem root |
| `src/components/settings/McpServersSettings.tsx` | 1,218 | `AddEditServerDialog` 556 | 400 | list + 5 nested dialogs |
| `src-tauri/src/commands/automations.rs` | 1,109 | — | 1,000 | automations |
| `src/components/editor/Editor.tsx` | 1,047 | `Editor` ~960 | 400 | orchestrator: 20+ custom hooks |
| `src/components/cmd/CommandBarContext.tsx` | 1,002 | `CommandBarContext` ~365 | 400 | 7 components |
| `src/components/activity/ActivityTaskCard.tsx` | 904 | `AgentTaskCardInner` ~358 | 400 | 8 components (4 card variants) |
| `src/components/chat/ChatMessage.tsx` | 892 | `ChatMessage` ~247 | 400 | 11 components |
| `src/components/sidebar/quiet/SidebarContextMenu.tsx` | 882 | `SidebarContextMenu` ~740 | 400 | 1 monolithic menu |
| `src/components/editor/Toolbar.tsx` | 882 | `Toolbar` ~746 | 400 | declarative toolbar (113 buttons) |
| `src/hooks/useEditorTabSwitch.ts` | 882 | `useEditorTabSwitch` ~773 | 500 | tab-switch hydration + preview + side maps |
| `src/components/sidebar/FileTreeItem.tsx` | 834 | `FileTreeItem` ~770 | 400 | 1 monolithic tree row |
| `src/components/sidebar/quiet/FoldersSection.tsx` | 832 | `FoldersSection` ~547 | 400 | 3 components |
| `src/App.tsx` | 808 | `App` ~724 | 400 | root orchestrator + lazy dialogs |
| `src/lib/ai/acp-agent-state.ts` | 899 | — | 500 | ACP state derivation |
| `src/hooks/useAgentTaskOperations.ts` | 819 | `startAcpTask` ~262 | 500 | 3 duplicated task-start flows + module-scope maps |
| `src/stores/permission-store.ts` | 773 | store | 500 | permission state |
| `src/hooks/useCopilotChat.ts` | 769 | — | 500 | copilot chat hook |

---

### HIGH: FloatingCommandBar.tsx — 2,873 lines, main component ~1,467 lines, 9 co-located components

**File:** `src/components/cmd/FloatingCommandBar.tsx:177`

The top offender by a wide margin. The main `FloatingCommandBar` function spans lines 177–1644 (~1,467 lines) — a single function larger than most whole files in the repo. It packs 9 top-level components: `FloatingCommandBar` (177), `PinnedResizeHandle` (1644, ~132), `ExpandedResizeHandle` (1776, ~128), `TopResizeHandle` (1904, ~118), `CompactContent` (2022, ~131), `ExpandedContent` (2153, ~524), `PrefixModeBadge` (2677), `ModePickerDispatch` (2741), `VerbDiscoveryMenu` (2834). Responsibilities: chat surface, prefix-mode dispatch (`/ @ # ! ? >`), pinned/expanded/top resize state machine, attachment chips, combobox/listbox a11y. This is the highest-churn surface in the app, so size × churn concentrates merge conflicts and review load here. (This file was flagged in a prior pass at 2,832 lines and has since grown to 2,873 — decomposition has not started.)

**Fix:** Extract per the skill's prior plan — `cmd/resize/{Pinned,Expanded,Top}ResizeHandle.tsx` (~130 each), `cmd/CompactContent.tsx` / `cmd/ExpandedContent.tsx` (~131 / ~524), `cmd/ModePickerDispatch.tsx` / `cmd/VerbDiscoveryMenu.tsx`, and a `useCommandBarGeometry.ts` hook for the `PINNED_*`/`EXPANDED_*` constants + resize state machine. Target: `FloatingCommandBar.tsx` under 500 lines as a thin orchestrator. The 524-line `ExpandedContent` should itself be decomposed further once extracted.

---

### HIGH: acp.rs — 2,561 lines, `run_agent_thread` ~780 lines, command surface mixed with lifecycle

**File:** `src-tauri/src/commands/acp.rs:516`

Matches the skill's named anti-pattern ("`acp.rs` mixing commands with session-lifecycle"). The file holds 19 `#[tauri::command]` handlers (`acp_agent_spawn` line 1298 through `acp_permission_respond` 2237) bolted onto a large non-command machinery layer: `run_agent_thread` (516, ~780 lines — the single largest unit) plus `AcpState` impl (251), `AgentHandle` (331), `AgentCmd` enum (360), `build_acp_mcp_servers` (166), `extract_model_info` (442), and a large inline `#[cfg(test)]` block (2276+). The 780-line `run_agent_thread` is the decomposition priority.

**Fix:** Split into a thin `commands/acp.rs` (the 19 IPC handlers, delegating only) and an implementation module `acp/session.rs` (or `acp/agent_thread.rs`) housing `run_agent_thread`, `AgentHandle`, `AgentCmd`, and `AcpState`. Break `run_agent_thread` internally by message-kind handling (spawn/authenticate/prompt/cancel/mode). Move the inline tests to a sibling test module.

---

### HIGH: useAcpLifecycle.ts — 1,374 lines, ~1,100-line hook, 6 module-scope `let` globals (boundary leak)

**File:** `src/hooks/useAcpLifecycle.ts:158`

Two problems. (1) The hook body `useAcpLifecycle` (274 → EOF) is ~1,100 lines. (2) It carries **module-scope mutable state that is a hidden global** — exactly the boundary-leak pattern the skill calls out: `let _homeDir` (158), `let eagerSessionPromise` (172), `let unresponsiveTimerId` (184), `let onUnresponsiveCallback` (187), `let retryCallback` (190), `let keepWaitingCallback` (196), with exported free mutators/getters (`startUnresponsiveTimer`, `resetUnresponsiveTimer`, `clearUnresponsiveTimer`, `getRetryCallback`, `getKeepWaitingCallback`). This works only because the hook mounts exactly once; it breaks under StrictMode double-invoke and any future multi-window, and it defeats isolated testing of the timer logic.

**Fix:** Move the unresponsive-timer state and the eager-session/`_homeDir` cache into the store that owns the corresponding status UI, and reduce `useAcpLifecycle` to a thin lifecycle orchestrator. Extract the session-cleanup helpers (`runConvCleanup`, `runAllConvCleanups`) into a testable pure module.

---

### HIGH: useAgentTaskOperations.ts — 819 lines, 3 duplicated task-start flows + module-scope maps

**File:** `src/hooks/useAgentTaskOperations.ts:97`

Boundary-leak + duplication in one file. Module-scope mutable maps `const tasksMap = new Map()` (97) and `const cleanupMap = new Map()` (98) are mutated by the hook — hidden global task registry that breaks under double-mount and blocks multi-window. Separately, three near-parallel task-start implementations share the same `setupTask`/`ensureTaskAgent`/`tasksMap`/`cleanupMap` scaffolding: `startAcpTask` (183, ~262), `startCopilotLspTask` (445, ~155), `startDirectApiTask` (600, ~112) — clear structural duplication of the run/track/cleanup lifecycle.

**Fix:** Move `tasksMap`/`cleanupMap` into the activity/task store. Factor the shared run-lifecycle (setup → ensure agent → track → cleanup) into one helper parameterized by a per-backend strategy, collapsing the three `start*Task` bodies to backend-specific adapters.

---

### HIGH: local_inference.rs — 1,603 lines, mixes server lifecycle + catalog + FIM

**File:** `src-tauri/src/commands/local_inference.rs:770`

Matches the skill's named pattern. Contains 8 `#[tauri::command]` handlers plus: server-process lifecycle (`LocalInferenceState` impl at 45, `kill_server_process` 453, `kill_orphaned_servers` 539, `kill_completion_server_process` 746), a large streaming body `local_bundled_chat_stream` (770, ~433 lines — largest unit), FIM (`local_bundled_fim` 1303, `resolve_fim_port` 1414, `build_server_args` 1432), and the embedded model catalog.

**Fix:** Split into `local_inference/mod.rs` (thin command layer), `local_inference/server.rs`, `local_inference/catalog.rs`, and `local_inference/fim.rs`. Decompose the 433-line `local_bundled_chat_stream` by request-build / stream-loop / token-decode stages.

---

### HIGH: mcp.rs — 1,950 lines, command surface fused with transport + duplicated JSON-RPC

**File:** `src-tauri/src/commands/mcp.rs:191`

12 `#[tauri::command]` handlers mixed with substantial transport/protocol machinery: `spawn_mcp_transport` (191), `mcp_reader_loop` (224), a full `HttpMcpClient` (281), SSE/JSON-RPC parsing (`parse_sse_data_events` 363, `parse_jsonrpc_http_response` 391), `McpConn` enum (433), `McpServerHandle` (465), `McpState` (502), plus catalog (`mcp_catalog_list` 1221). The JSON-RPC handling duplicates concerns already living in `src-tauri/src/commands/json_rpc.rs` (718 lines) — two modules implementing the same protocol.

**Fix:** Extract `mcp/transport.rs` (`HttpMcpClient`, `McpConn`, spawn/reader loop) and `mcp/catalog.rs`, leaving `commands/mcp.rs` as the thin command layer. Consolidate SSE/JSON-RPC framing with `commands/json_rpc.rs` into one shared protocol module.

---

### HIGH: McpServersSettings.tsx — 1,218 lines, 556-line nested `AddEditServerDialog`

**File:** `src/components/settings/McpServersSettings.tsx:353`

Settings-panel-with-nested-dialogs pattern. Main `McpServersSettings` is only ~87 lines (1131). The bulk is inline dialogs: `AddEditServerDialog` (353, **556 lines**, 16 `useState`/`useEffect`), `ImportDialog` (909, ~222), plus `McpServerCard` (90, ~193) and `ToolRow` (283).

**Fix:** Extract `mcp/AddEditServerDialog.tsx`, `mcp/ImportDialog.tsx`, `mcp/McpServerCard.tsx`, `mcp/ToolRow.tsx`, leaving a ~150-line list shell. Consider decomposing `AddEditServerDialog` further (transport vs auth vs validation).

---

### HIGH: Editor.tsx — 1,047 lines, ~960-line component orchestrating 20+ custom hooks

**File:** `src/components/editor/Editor.tsx:88`

The `Editor` component (88 → EOF, ~960 lines) is a textbook 10+-hook orchestrator: `useEditorTabSwitch`, `useCopilotCompletion`, `useCopilotCompletionCM`, `useLocalCompletion`, `useCursorScrollGuard`, `useDiffReview`, `useEditorKeyBindings`, `useEditorResize`, `useEditorZoom`, `useExportOperations`, `useFileOperations`, `useFileWatcher`, `useFileWatcherIntegration`, `usePageSettings`, `useScrollPersistence`, `useUnresolvedDocCreate`, `useCommentEditorSync`, and more (20+). High churn.

**Fix:** Group hooks into cohesive sub-controllers: completion controller, file-lifecycle controller, viewport controller. Target `Editor.tsx` under 500 lines composing 3–4 controllers.

---

### MEDIUM: ChatMessage.tsx — 892 lines, 11 co-located components

**File:** `src/components/chat/ChatMessage.tsx:645`

Eleven top-level components: `ActionIconButton` (32), `ActivityIcon` (64), `ActivityLog` (71), `ToolCallItem` (134), `ToolCallLog` (173), `AttachmentFileStrip` (211), `AttachmentThumbnails` (237), `UserContent` (284), `UserActionButtons` (323), `SegmentRenderer` (539, ~106), `ChatMessage` (645, ~247). Co-location defeats isolated re-render reasoning on a high-churn chat surface.

**Fix:** Extract `chat/message/{ActivityLog,ToolCallLog,AttachmentThumbnails,AttachmentFileStrip,SegmentRenderer,UserContent,UserActionButtons}.tsx`, leaving `ChatMessage.tsx` as the composing shell (~250 lines).

---

### MEDIUM: ActivityTaskCard.tsx — 904 lines, 8 components incl. 4 distinct card variants

**File:** `src/components/activity/ActivityTaskCard.tsx:501`

Eight components, four full card variants: `TranscriptionCard` (292, ~126), `RecordingCard` (418, ~83), `AutomationCard` (521), `AgentTaskCardInner` (546, ~358 — largest unit). `ActivityTaskCard` (501) is a thin dispatcher.

**Fix:** Extract `activity/cards/{TranscriptionCard,RecordingCard,AutomationCard,AgentTaskCard}.tsx` plus shared `ApprovalBadge`/`IconActionButton`. Decompose the 358-line `AgentTaskCardInner`.

---

### MEDIUM: markdown.ts — 1,444 lines, round-trip contract buried under an 11× `convert*ToHtml` helper bank

**File:** `src/lib/markdown.ts:275`

The architecturally load-bearing round-trip API — `getMarkdownFromEditor` (1076), `setMarkdownInEditor` (1113), `loadRawMarkdownIntoEditor` (1149), `loadParsedJsonIntoEditor` (1220), `streamingHydrate` (1305), `prepareInitialContent` (1429) — is interleaved with a bank of 11 `convert*ToHtml` helpers plus parallel `restore*`/`strip*`/`inject*`/`apply*` families.

**Fix:** Move the converter bank to `src/lib/markdown-html-converters.ts` with a re-export from `markdown.ts`, leaving the round-trip contract readable in isolation (~500 lines).

---

### MEDIUM: useEditorTabSwitch.ts — 882 lines, ~773-line hook mixing concerns

**File:** `src/hooks/useEditorTabSwitch.ts:109`

Mixes tab-switch hydration, large-file preview skipping (`SKIP_PREVIEW_THRESHOLD_BYTES`), paint deferral (`deferPastPaint`), and side-map deserialization (`deserializeSideMaps`).

**Fix:** Extract pure helpers into a `lib/tab-switch/` module and split hydration vs. preview-skip into separate hooks composed by `useEditorTabSwitch`.

---

### MEDIUM: CommandBarContext.tsx — 1,002 lines, 7 components

**File:** `src/components/cmd/CommandBarContext.tsx:75`

Seven components: `CommandBarContext` (75, ~365), `Divider` (440), `ProviderPill` (462, ~122), `ProjectsPicker` (584, ~191), `ProviderQuickConfig` (775, ~151), `CrossProjectScopePill` (926), `IconButton` (963).

**Fix:** Extract `cmd/context/{ProviderPill,ProjectsPicker,ProviderQuickConfig,CrossProjectScopePill}.tsx` and shared `IconButton`/`Divider`.

---

### MEDIUM: Single-component monoliths — SidebarContextMenu, FileTreeItem, FoldersSection, App

**Files:**
- `src/components/sidebar/quiet/SidebarContextMenu.tsx:143` — one `SidebarContextMenu` (~740 lines).
- `src/components/sidebar/FileTreeItem.tsx:64` — one memoized `FileTreeItem` (~770 lines).
- `src/components/sidebar/quiet/FoldersSection.tsx:129` — `FoldersSection` (~547) + `FolderRow` + `ChildRow`.
- `src/App.tsx:84` — root `App` (~724 lines) wiring many lazy dialogs + global shortcuts.

**Fix:** SidebarContextMenu: split action groups into sub-menu components. FileTreeItem: extract drag/drop, rename, context-action logic into hooks. App: extract `useAppDialogs` / `useAppShortcuts`. FoldersSection: move `FolderRow`/`ChildRow` to own files.

---

### MEDIUM: Zustand stores over threshold — chat-store, settings-store, permission-store

**Files:** `src/stores/chat-store.ts` (1,238, 96 actions), `src/stores/settings-store.ts` (1,229, 168 setters), `src/stores/permission-store.ts` (773).

Stores are cohesive by nature; lower priority. `settings-store.ts` and `chat-store.ts` are candidates for Zustand slice composition.

**Fix:** Refactor into slice files composed by the root store, keeping the public store type stable. Low urgency.

---

### MEDIUM: tauri.ts — 1,617 lines, 159 IPC wrappers + 52 interfaces spanning all domains

**File:** `src/lib/tauri.ts`

Largely declarative binding surface; largest-unit size is tiny. Concern is breadth.

**Fix:** Optional domain split into `lib/tauri/{editor,ai,mcp,acp,export,index}.ts` re-exported from `lib/tauri.ts`. Low priority.

---

### MEDIUM: Rust command modules with breadth — transcription.rs, ai.rs, ai_streaming.rs, export.rs, agent_manager.rs, automations.rs

Each over the 1,000-line Rust threshold, command-module-mixing shape, no single dominating giant function.

**Fix:** Thin-command-layer + implementation-module separation when next touched. Not urgent.

---

### Index subsystem — queries.rs / mod.rs / links.rs / parser.rs

Over threshold but internally cohesive. If `queries.rs` keeps growing, split by query domain. Low priority.

---

### Acceptable Large Files (do not re-flag for size alone)

Confirmed-cohesive from prior passes: `src/lib/pptx-parser.ts` (~2,279), `src-tauri/src/export/markdown_to_docx.rs` (~2,168), `markdown_to_pptx.rs` (~1,776), `copilot_lsp.rs` (~1,409).

Newly confirmed acceptable: `markdown_to_typst.rs` (1,439), `markdown_to_html.rs` (1,150), `export/templates.rs` (776), `table_utils.rs` (539), `html_styles.rs` (477), `PdfViewer.tsx` (1,045), `EpubViewer.tsx` (808), `HtmlViewer.tsx` (747), `DocxViewer.tsx` (469), `Toolbar.tsx` (882, declarative), `pptx-text-parser.ts` (547), `pptx-types.ts` (405), `chart-types.ts` (393), `sandbox.rs` (1,451, cohesive OS-integration).

### Confirmed Good Patterns

- **Prior decomposition landed and held:** `ConnectionsSettings.tsx` now 737 lines; `ConnectAgent.tsx` its own 587-line file.
- **Export subsystem cleanly sliced:** one file per output format with shared support modules.
- **Index subsystem modularized** into `db.rs`/`queries.rs`/`links.rs`/`parser.rs`/`mod.rs`.
- **Viewers isolated per format** under `editor/viewers/`.
- **Rust state objects use dedicated `impl` blocks** with consistent lifecycle methods.

**Highest-leverage next actions (churn × largest-unit):** (1) `FloatingCommandBar.tsx`, (2) `acp.rs` `run_agent_thread`, (3) `useAcpLifecycle.ts` module-scope globals, (4) `Editor.tsx` hook orchestration, (5) `useAgentTaskOperations.ts` module-scope maps + duplication.

---

## 9. Dead Code & Dependency Health


Scope: 937 TS/TSX files in `src/`, Rust backend, package.json, Cargo.toml, capability grants.

### Orphaned Files

### HIGH: `goal-templates.ts` is a 212-line orphan (half-wired "goal templates" feature)
**File:** `src/lib/goal-templates.ts:1`
Zero importers anywhere. Exports `GOAL_TEMPLATES`, `getGoalTemplate`, `GoalTemplate` — none referenced. The plausible consumer, `useGoalsDiscovery.ts`, discovers goal files at runtime via SQLite `index_goals` and never touches this static catalog. Planned-but-never-wired feature (static template picker never shipped).
**Fix:** Delete; open a tracking issue if template seeding is still intended.

### MEDIUM: `SavedLabel.tsx` orphaned — its test was already deleted (confirms docs' "currently unused")
**File:** `src/components/SavedLabel.tsx:1`
56-line component, zero importers. Only textual matches are comments in `StatusBar.test.tsx` pointing at a test file (`SavedLabel.test.tsx`) that no longer exists. Live label is `formatSavedLabel` in `src/lib/saved-ago.ts` / `QuietSavedLabel`.
**Fix:** Delete + drop stale comments in StatusBar.test.tsx.

### MEDIUM: `ChangeListPopover.tsx` is a 171-line orphan
**File:** `src/components/editor/ChangeListPopover.tsx:1`
Zero importers. Only references are prose comments in `useFileWatcherIntegration.ts:248,263` describing behavior no live component renders. No replacement renders a hunk list.
**Fix:** Delete file + update the two stale comments.

### LOW: `AttachmentStrip.tsx` orphan — explicitly superseded by inline chips
**File:** `src/components/chat/AttachmentStrip.tsx:1`
Zero importers. `FloatingCommandBar.tsx:56,356,2319,2323` documents its removal ("chips render inline"). Replaced by `AttachmentChips.tsx`.
**Fix:** Delete.

### Test-Only Files (false coverage signal)

### MEDIUM: `useEditorImageDrop.ts` — a tested hook no component ever calls (half-wired)
**File:** `src/hooks/useEditorImageDrop.ts:1`
150-line hook (Tauri drag-drop → insert images into editor). Referenced only by its test. Never called by `useEditor.ts`, `Editor.tsx`, or any component; no alternative editor image-drop wiring exists. 250+ lines of tests pass forever regardless of whether image drop works.
**Fix:** Wire `useEditorImageDrop(editor, container)` into the editor container, or delete hook + test.

### LOW: `svg-to-png.ts` — test-only, superseded by Rust-side rasterization
**File:** `src/lib/svg-to-png.ts:1`
118 lines; referenced only by its test. Export rasterization is Rust-side (usvg/resvg).
**Fix:** Delete module + test, or wire if a JS-side path is intended.

> `contrast-math.ts` is NOT dead — imported by `scripts/contrast-audit.ts`.

### Half-Wired Backend: registered commands never invoked from the frontend

All 230 `#[tauri::command]` fns are in `generate_handler!`. These 11 have zero frontend invocations:

### MEDIUM: 11 IPC commands registered but never called by the renderer

| Command | Registered at | Notes |
| --- | --- | --- |
| `agent_uninstall` | `lib.rs:310` | never wired to UI |
| `agent_install_node_runtime` | `lib.rs:311` | " |
| `copilot_lsp_sign_out` | `lib.rs:341` | sign-out never surfaced |
| `mcp_list_tools` | `lib.rs:390` | frontend uses `mcp_list_tools_from_server` |
| `mcp_get_server_status` | `lib.rs:392` | no caller |
| `store_read_batch` | `lib.rs:409` | batch-read optimization never adopted |
| `fetch_hf_metadata` | `lib.rs:444` | logic reached via `fetch_hf_metadata_inner`; command wrapper dead |
| `parse_gguf_metadata` | `lib.rs:445` | no caller |
| `network_proxy_status` | `lib.rs:456` | no caller |
| `sandbox_monitor_register_pid` | `lib.rs:459` | PID monitor not driven from frontend |
| `sandbox_monitor_unregister_pid` | `lib.rs:460` | " |

Each registered command widens the IPC attack surface while delivering nothing.
**Fix:** Confirm no imminent wiring, then unregister (keep `_inner` helpers where reused).

### Unused / Redundant Dependencies

### LOW: Cargo — `async-trait` (zero refs), `typst-library` + `typst-utils` (transitively redundant via `typst`)
**File:** `src-tauri/Cargo.toml`
**Fix:** Remove all three; verify with cargo build.

### npm — no unused runtime dependencies found.

### Deprecated Code

### LOW: `setDebugLogging` is deprecated AND dead
**File:** `src/lib/logger.ts:72`
Zero references; migration to `setLogLevel` complete. True debt.
**Fix:** Delete.

All other `@deprecated` items are migration fallbacks (intentional; see Confirmed Good). No Rust `#[deprecated]`.

### Unreachable Code — none found.

### Confirmed Good Patterns

- **Classic Layout removal complete** — no stragglers for Layout.tsx, TabBar, ChatPanel, CommandPalette.
- **`markdown-parse.worker.ts` NOT an orphan** — Vite `?worker` import.
- **`contrast-math.ts` NOT test-only** — used by audit:contrast script.
- **No phantom `@tauri-apps/plugin-global-shortcut`** — Quick Capture removal clean, guard test exists.
- **All Tauri plugin inits have matching capability grants**; no inert `tauri_plugin_fs::init()`.
- **All 230 registered commands wired into generate_handler!** — none defined-but-unregistered.
- **Migration fallbacks intentionally kept (do NOT flag):** `startMessageIndex` (chat-store.ts:31, read at ChatMessageList.tsx:230); `ai-store.ts` AIPersona (persona→agent migration); `acp-utils.ts` snake_case aliases; `drawing-storage.ts`/`chart-storage.ts` legacy sidecar loaders (used for legacy docs + PDF-export SVG cache); settings-store deprecated fields; project-metadata `agentName`.
- **`openTabs → openDocuments` rename complete** — zero stragglers.
- **`ui/resizable.tsx`, `ui/radio-group.tsx`** excluded per shadcn on-demand policy.

---

## 10. Documentation Drift


### Root causes (two incomplete refactors ripple across the doc set)

1. **Quiet Composer migration** deleted the legacy shell (`Layout.tsx`) and several components (`EditorContent.tsx`, `ChatInput.tsx`, `SlashCommand.tsx` → moved to an extension), but `architecture.md`, `features/editor.md`, `features/ai-workflows.md`, and `product-description.md` still reference the removed files/components.
2. **SQLite document-index migration** replaced `search_research` with `index_search_research`, but `tauri-commands.md` still documents the removed command in full.

The TreeOverlay/`⌘⇧E`→Export refactor was propagated cleanly (see Confirmed Good Patterns).

### docs/tauri-commands.md

### HIGH: `search_research` command documented but does not exist
**Doc:** `docs/tauri-commands.md:1112-1174` ("Research Operations")
**Reality:** No `#[tauri::command] search_research` anywhere in `src-tauri/`. Replaced by `index::index_search_research` (registered `src-tauri/src/lib.rs:365`; frontend `src/lib/tauri.ts:1208`). The doc claims it lives in `file.rs` with a `ResearchSearchResult` struct and `tauriApi.searchResearch(...)` binding — none exist. `invoke('search_research', …)` = "command not found".
**Fix:** Replace the section with `index_search_research` or delete and point to the index command block.

### MEDIUM: command modules `automations.rs` and `html_preview.rs` documented in neither index
**Doc:** `docs/tauri-commands.md` + `docs/architecture.md:26-80`
**Reality:** `commands/automations.rs` (7 commands, registered `lib.rs:248-254`) and `commands/html_preview.rs` (`html_preview_register`/`unregister`, `lib.rs:480-481`) exist; neither appears in the architecture module tree nor tauri-commands.md.
**Fix:** Add rows to the architecture.md module tree.

### docs/architecture.md

### HIGH: `Layout.tsx` (legacy shell) documented as present, but deleted
**Doc:** `docs/architecture.md:111` ("renders Layout (or QuietLayout)") and `:113` (`Layout.tsx` tree entry)
**Reality:** `src/components/Layout.tsx` does not exist. `App.tsx:8` imports only `QuietLayout`; `App.tsx:667` renders it unconditionally.
**Fix:** Delete the tree entry; change :111 to "renders `QuietLayout` + dialogs."

### MEDIUM: dead component paths — `EditorContent.tsx`, `SlashCommand.tsx`, `ChatInput`
**Doc:** `docs/architecture.md:117`, `:135`
**Reality:** Only `Editor.tsx`/`Toolbar.tsx` exist. `EditorContent.tsx` folded into `Editor.tsx`; `SlashCommand.tsx` → `extensions/slash-command.tsx`; `chat/ChatInput.tsx` gone (input is FloatingCommandBar).
**Fix:** Update entries.

### MEDIUM: hooks inventory lists two hooks that were merged away
**Doc:** `docs/architecture.md:139` (`useCommandBarShortcuts, useDoubleTapCmd`)
**Reality:** Neither exists; absorbed into `src/hooks/useGlobalShortcuts.ts` (which the list does NOT mention). keyboard-shortcuts.md:156 documents this correctly.
**Fix:** Remove both; add `useGlobalShortcuts`.

### MEDIUM: store table omits 6 active stores
**Doc:** `docs/architecture.md:231-260`
**Reality:** 32 stores exist; table documents 26. Missing: `automation-store` (6 files), `cmd-bar-summon-store` (3), `domain-request-store` (4), `model-fit-measurement-store` (9), `session-run-store` (20), `sidebar-status-slot-store` (3).
**Fix:** Add rows with purpose + persistence.

### LOW: test inventory counts stale
**Doc:** `docs/architecture.md:286` ("304 unit test files, 18 Playwright, 11 real-e2e")
**Reality:** 361 unit test files (+19%), 20 Playwright, 13 real-e2e.
**Fix:** Update or replace with generating command.

### LOW: perf-category table omits `perf:doc-preload`
**Doc:** `docs/architecture.md:325-345`
**Reality:** `src/lib/logger.ts:36` exports `docPreload: 'perf:doc-preload'` (asserted in logger.test.ts:22) but no table row — and the constant has no production call site outside logger/test.
**Fix:** Add row, or remove the unused constant.

### docs/features/editor.md

### MEDIUM: key-files table points at removed/moved components
**Doc:** `editor.md:167` (`EditorContent.tsx`), `:171` (`SlashCommand.tsx`)
**Reality:** `EditorContent.tsx` gone; slash command at `extensions/slash-command.tsx`.
**Fix:** Remove/repoint rows.

### LOW: key-files table lists a deferred component never created
**Doc:** `editor.md:174` (`AnnotationPicker.tsx`, struck through)
**Reality:** No such file. Honestly labeled, just clutter.
**Fix:** Delete row.

### docs/features/ai-workflows.md

### MEDIUM: chat flow + key-files reference removed `ChatInput`
**Doc:** `ai-workflows.md:17` ("User types message in ChatInput"), `:273` (key-files row)
**Reality:** `chat/ChatInput.tsx` does not exist; input is `FloatingCommandBar`.
**Fix:** Replace references; note prefix modes live in `src/components/cmd/modes/`.

### docs/product-description.md

### LOW: Phase-1 sidebar description lists 5 sections (missing Folders) and TreeOverlay as shipped
**Doc:** `product-description.md:95`
**Reality:** `QuietSidebar.tsx:236-248` renders six sections including Folders; TreeOverlay deleted (guard test `no-tree-overlay.test.ts`).
**Fix:** Add Folders, drop TreeOverlay.

### docs/design-system.md

### LOW: `CommitDialog` path stale (moved into `git/`)
**Doc:** `design-system.md:90` (`src/components/CommitDialog.tsx`)
**Reality:** `src/components/git/CommitDialog.tsx`.
**Fix:** Update path.

### CLAUDE.md — no drift found. All 15 `@docs/...` references resolve; version correctly defers to package.json (0.48.0-alpha.8).

### Version references — no stale hardcoded versions. Alpha channel + alpha_check documented and matching lib.rs:237.

### Keyboard shortcuts — `keyboard-shortcuts.md` matches `appCommandManifest.json` exactly (all 30 command IDs). No missing or phantom shortcuts.

### Confirmed Good Patterns

- **TreeOverlay removal propagated cleanly** across keyboard-shortcuts.md, design-system.md, workspace.md + code guard test. A model for removals.
- **Keyboard manifest is single source of truth**, docs track it 1:1.
- **Six-section sidebar** consistent in architecture.md:132, workspace.md, component docstring.
- **Alpha update channel** fully documented in both docs, matches lib.rs.
- **CLAUDE.md version handling** defers to package.json.
- **Security model docs** accurately describe renderer-trust boundary, keychain order, capability surface.
