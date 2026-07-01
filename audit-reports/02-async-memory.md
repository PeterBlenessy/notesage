# Audit 02 — Async Flows, Concurrency & Memory/Lifecycle

**Scope:** `src/` (hooks, stores, components) of the Notesage Tauri v2 + React 19 app.
**Method:** Manual read of every Tauri `listen()` call site, all streaming/agent/completion hooks, the tab-switch pipeline, and module-level singletons. Lens: race conditions, stale closures, missing cancellation, post-unmount writes, listener/interval leaks, leaked subprocesses/streams. Read-only.

**Severity counts:** Critical 2 · High 4 · Medium 5 · Low 3

The codebase is *substantially* more careful than the dated skill checklists assume — the two "broken `listen()`" example patterns the skills flag (StatusBar/useSandboxViolations) have mostly been fixed with `mounted`-flag guards, and the comment position-save stale-closure example is fixed. The real, current bugs are architectural: **global, un-correlated streaming events** and a **cosmetic-only cancel** that the old per-hook checklist would not surface.

---

## CRITICAL

### C1 — `ai-stream-*` events are global and un-correlated; concurrent streams cross-contaminate

**Location:**
- Emit: `src-tauri/src/commands/ai_streaming.rs:292,384,536` (`emit("ai-stream-chunk", text)`, `emit("ai-stream-done", ())` — no request/stream ID in payload)
- Consume A: `src/hooks/useDirectApiChat.ts:458-538`
- Consume B: `src/lib/ai/structured.ts:71-89`

**Evidence:** The Rust backend emits `ai-stream-chunk` / `ai-stream-thinking-chunk` / `ai-stream-image` / `ai-tool-call` / `ai-stream-done` as **plain global events with no correlation id**:
```rust
// ai_streaming.rs:292
.emit("ai-stream-chunk", text)
```
Both `useDirectApiChat.sendChatMessage` and `generateStructured()` register listeners on the *same* global event names. `generateStructured` even has its own:
```ts
// structured.ts:71
const unlistenChunk = await listen<string>('ai-stream-chunk', (event) => { collected += event.payload; });
```

**Impact:** Any two direct-API generations that overlap in time share one event bus with no way to tell whose chunk is whose. Real triggers:
- A skill/intent-classification `generateStructured()` call fires while a chat stream is mid-flight → the structured parser accumulates the chat's prose into `collected`, then `JSON.parse` throws "invalid JSON"; simultaneously the chat message gets the structured model's JSON appended.
- A background agent task (`useAgentTaskOperations`, `ai-stream-chunk` at line 726) running concurrently with foreground chat → tokens interleave into both messages.
The `cancelled` flag in `useDirectApiChat` only protects against a stream's *own* teardown, not against a *different* stream's events landing in its listeners.

**Fix:** Thread a `streamId` (UUID) from the frontend into `ai_chat_stream`, include it in every emitted payload, and have each listener early-return when `payload.streamId !== thisStreamId` — exactly the `isOurEvent(conversationId)` pattern Copilot already uses (`useCopilotChat.ts:425`). Until then, at minimum serialize direct-API calls behind a single in-flight mutex so two can never overlap.

---

### C2 — `cancelDirectChat` is cosmetic: the backend HTTP stream is never cancelled

**Location:** `src/hooks/useDirectApiChat.ts:603-609` (cancel) + `:541-563` (cleanup); no backend counterpart exists (`grep` for `ai_chat_stream_cancel` / abort in `ai_streaming.rs` returns nothing).

**Evidence:**
```ts
const cancelDirectChat = useCallback(() => {
  if (cleanupRef.current) cleanupRef.current();   // only unlistens FRONTEND listeners
  setLoading(false);
  setActiveTool(null);
}, [setLoading, setActiveTool]);
```
`cleanup()` calls the `unlistenX()` handles and clears the flush interval — but `invoke('ai_chat_stream', …)` (line 576) is a fire-and-forget Rust task that keeps reading the provider SSE stream to completion. There is no `invoke('…cancel…')` and no AbortController plumbed into the Rust HTTP client.

**Impact:** "Stop" on a direct-API (Anthropic/OpenAI/Ollama/local) chat stops the *UI* but the request keeps streaming server-side — burns paid tokens, holds the socket, and (because of C1) those still-arriving global chunks can land in the *next* message the user starts. Also: cancelling during the `await Promise.all([listen(...)])` window (lines 448-539, before line 565 sets `cleanupRef.current`) is a complete no-op — listeners register afterward and the "cancelled" message fills in anyway.

**Fix:** Add an `ai_chat_stream_cancel(streamId)` Tauri command that aborts the Rust reqwest stream task (store a `CancellationToken`/`AbortHandle` per `streamId` in managed state, mirror of `download_cancels` in `transcription.rs`). Have `cancelDirectChat` invoke it. Set `cleanupRef.current` (or a `cancelRequested` boolean) *before* the `await Promise.all` so cancel during setup is honoured.

---

## HIGH

### H1 — `useEditorTabSwitch` main effect never aborts on unmount; `streamingHydrate` writes to a destroyed editor

**Location:** `src/hooks/useEditorTabSwitch.ts:159-720` (no cleanup return on the main effect) + `src/lib/markdown.ts:1354-1384` (chunk loop guards `signal.aborted` but not `editor.isDestroyed`).

**Evidence:** The big tab-switch effect creates `abortController` (line 166) but only aborts it on the *next* activation (line 165). There is **no `return () => abortController.abort()`**. Meanwhile the hydration loop yields across `requestAnimationFrame` between chunks:
```ts
// markdown.ts:1355
for (let i = 0; i < docContent.length; i += HYDRATE_CHUNK_SIZE) {
  if (signal.aborted) return {...};            // checks abort
  editor.chain().setMeta("addToHistory", false).insertContent(chunk).run();  // NOT guarded by editor.isDestroyed
  await new Promise(r => requestAnimationFrame(r));  // unmount can happen here
}
```

**Impact:** When the Editor component unmounts mid-hydration (close document while a large file streams in, navigate away during cold-start), the in-flight worker-parse → `streamingHydrate` chain keeps running because nothing aborted the controller. The next chunk calls `editor.chain()...run()` on a destroyed ProseMirror view → throws / caught by the editor ErrorBoundary, and `runPostLoad`/`setPreviewState` write store state for a gone tab. Same hazard in all four parse branches (lines 350, 443, 534, 654) and the `loadRawMarkdownIntoEditor` fallbacks.

**Fix:** Add `return () => abortController.abort();` to the main effect so unmount cancels the pipeline. Defensively add `if (editor.isDestroyed) return {aborted:true,…}` inside the `streamingHydrate` chunk loop (next to the existing `signal.aborted` check).

### H2 — ACP `acp-session-update` listener filters only by `instanceId`, not `sessionId` — stale stream can write the wrong conversation

**Location:** `src/hooks/useAcpSessionListeners.ts:93-94`, `:137-138`; agent is a reused module-level singleton (`src/lib/ai/acp-agent-state.ts:198`).

**Evidence:**
```ts
const unlisten = await listen<AcpSessionUpdatePayload>('acp-session-update', (event) => {
  if (event.payload.instanceId !== deps.instanceId) return;   // ONLY instanceId
  ...
  streamedContent += chunkContent.text;
  deps.updateMessage(deps.assistantMessageId, streamedContent);  // closes over a fixed assistantMessageId
```
A single ACP agent instance is reused across conversations (`acpAgent.chatSessionId` is swapped, not the instance). The listener captures `deps.assistantMessageId` and filters only on `instanceId` — which is identical for every conversation on that agent.

**Impact:** If a late `agent_message_chunk` from conversation A's prompt arrives after the user switched to conversation B and started a new prompt on the same agent, and A's cleanup hasn't run yet, the chunk is filtered *in* (instanceId matches) and appended to A's `assistantMessageId` — but the relevant tab/segment may already be torn down or the user has moved on. The teardown-on-new-prompt (`cleanupRef.current()` at send start) mitigates the common case but there is a window during rapid switch+send. The payload carries a `sessionId` that is *not* checked.

**Fix:** Add `if (event.payload.update?.sessionId && event.payload.sessionId !== deps.sessionId) return;` — gate on the session id the way `useCopilotChat`/`useAgentTaskOperations` gate on `conversationId` (`isOurEvent`).

### H3 — `StatusBar` `IndexProgressIndicator` leaks two listeners and writes state post-unmount

**Location:** `src/components/editor/StatusBar.tsx:129-144`

**Evidence:**
```ts
useEffect(() => {
  let unlisten1, unlisten2;
  import("@tauri-apps/api/event").then(({ listen }) => {
    listen("index-progress", (e) => setProgress(e.payload)).then((fn) => { unlisten1 = fn; });
    listen("index-ready", () => setProgress(null)).then((fn) => { unlisten2 = fn; });
  });
  return () => { unlisten1?.(); unlisten2?.(); };   // both still undefined if unmount races the import/listen
}, []);
```
There is **no `mounted` guard** (contrast with the now-correct `useSandboxViolations.ts:48-54`). The cleanup runs `unlisten1?.()`/`unlisten2?.()` which are `undefined` whenever the component unmounts before the dynamic `import()` *and* the two `listen()` promises all resolve. The `.then(fn => unlisten1 = fn)` then fires after unmount and the listeners are never removed.

**Impact:** StatusBar mounts/unmounts on every document open/close and view-mode toggle. Each unmount that races the async chain leaks two `index-progress`/`index-ready` listeners and a dangling `setProgress` that fires on a torn-down component (React 19 warns; over a long session the listener count climbs). Indexing fires frequently (watcher-driven), so the orphaned listeners keep invoking `setProgress` forever.

**Fix:** Add `let mounted = true;`, guard each `.then` (`if (mounted) unlisten1 = fn; else fn();`), guard `setProgress` calls with `if (!mounted) return;`, and set `mounted = false` in cleanup — same shape as `useSandboxViolations`.

### H4 — `useTrayEvents` sequential `await listen()` setup leaks listeners on unmount/dep-change mid-setup

**Location:** `src/hooks/useTrayEvents.ts:31-69`

**Evidence:**
```ts
const unlisteners: (() => void)[] = [];
const setup = async () => {
  unlisteners.push(await listen("tray-new-note", …));      // 4 sequential await points
  unlisteners.push(await listen("tray-quick-note", …));
  unlisteners.push(await listen("tray-open-actions", …));
  unlisteners.push(await listen<string>("tray-open-file", …));
};
setup().catch(…);
return () => { unlisteners.forEach((fn) => fn()); };
```
If the effect re-runs (any of the 4 callback deps changes identity) or the component unmounts while `setup()` is between two `await`s, cleanup iterates a *partially populated* `unlisteners` array. Listeners awaited *after* cleanup ran are pushed into the array but never invoked — the array reference cleanup closed over is the old one, and even if it weren't, cleanup already ran.

**Impact:** App-root mount, so a full unmount is rare — but the callbacks are passed from `App.tsx` and any future un-memoized prop would re-fire this effect and duplicate the four tray listeners (every tray click then double-fires: two new notes, two open-actions, etc.). Latent foot-gun.

**Fix:** Track a `mounted` flag; in `setup`, after each `await listen()`, `if (!mounted) { fn(); return; }` before pushing; set `mounted = false` first in cleanup. Or register all four with `Promise.all` and unwind atomically.

---

## MEDIUM

### M1 — `App.tsx` `open-files` listener: same undefined-`unlisten` race as H3

**Location:** `src/App.tsx:216-249`

**Evidence:** `import().then(() => listen("open-files", …).then((fn) => { unlisten = fn; }))` with `return () => { unlisten?.(); }` and **no `mounted` guard**. Identical broken double-async pattern to H3. App-root so practical leak is rare, but the handler also runs `openFile`/`addExplorerFolder` async work with no abort.

**Fix:** Add the `mounted` guard + immediate-unlisten-if-unmounted, as in `useActionScanner.ts:59-66`.

### M2 — `useCopilotCompletion.requestCompletion` has no request-supersede guard; slow completion overwrites a newer one at a stale position

**Location:** `src/hooks/useCopilotCompletion.ts:240-290` (compare with `useLocalCompletion.ts:148,172` which *does* use `requestId`)

**Evidence:** After `await requestCopilotCompletion(...)` it checks only `editor.isFocused`/`isDestroyed` (line 270), then reads `currentPos = editor.state.selection.$from.pos` (line 273) and places ghost text there — regardless of whether the cursor still corresponds to the requested `pos`. There is no `++requestId` / `thisRequest !== requestId.current` discard that `useLocalCompletion` has, and no AbortController.

**Impact:** Rapid typing fires multiple debounced completion requests; if request N resolves after request N+1, N's (now-stale) suggestion is painted at wherever the cursor currently is — flickering / wrong ghost text. Wasted compute too (response applied even though superseded).

**Fix:** Mirror `useLocalCompletion`: `const thisRequest = ++requestId.current; … if (thisRequest !== requestId.current) return;` after the await, and capture+compare the requested position.

### M3 — `useEditorTabSwitch` `previewInFlightRef` dedup is keyed by tab id, not abort-aware

**Location:** `src/hooks/useEditorTabSwitch.ts:319-320,593-597,709-712`

**Evidence:** `previewInFlightRef.current === tabIdOnEntry` guards duplicate `renderMarkdownPreview` fires, cleared in `.finally`. But if the user switches A→B→A quickly, the first A render is still "in flight" (ref === A), so the second A activation early-returns (line 593-595) *without* loading content — yet its `abortController` already aborted the first A pipeline at line 165. Result: A's first pipeline is aborted, A's second pipeline refuses to start (dedup), so A can be left on the stale preview/loading state until another trigger.

**Impact:** Edge-case "document stuck on preview / blank" on fast back-and-forth switching of the same large file. Hard to hit but real.

**Fix:** Clear `previewInFlightRef.current` when the controlling `abortController` aborts (i.e. at line 165 before creating the new controller), so a re-entry for the same tab is allowed to restart.

### M4 — `useLocalCompletion` / `useCopilotCompletion`: `useSettingsStore.getState()` in dependency arrays is non-reactive

**Location:** `src/hooks/useLocalCompletion.ts:217,255,265`; `src/hooks/useCopilotCompletion.ts:289`

**Evidence:**
```ts
}, [editor, isActive, useSettingsStore.getState().inlineCompletionsDisabled, …]);  // line 217
```
A `getState()` call evaluated at render time is placed in a dep array. It reads the value at the moment the component renders, but it does **not** subscribe — so when `inlineCompletionsDisabled` changes without an unrelated re-render, the `useCallback`/`useEffect` keeps a stale value and won't re-run. The guards re-read `getState()` inside the body (lines 103/231) so behaviour is mostly saved, but the dep is misleading and can cause the effect to *not* re-register when only that setting flips.

**Impact:** Toggling "disable completions" may not immediately tear down / re-arm the update listener until the next render from another source. Minor correctness/clarity bug; also a typecheck/lint smell.

**Fix:** Subscribe properly: `const inlineDisabled = useSettingsStore((s) => s.inlineCompletionsDisabled);` and use `inlineDisabled` in body and deps.

### M5 — ACP eager-session effect: listener registered in async IIFE can leak if cleanup runs before the `await listen()` resolves

**Location:** `src/hooks/useAcpLifecycle.ts:315-451` (IIFE registers `eagerUnlisten` at line 385; cleanup at 444-450 reads `eagerUnlistenRef.current`)

**Evidence:** The effect body is `eagerSessionPromise = (async () => { … const eagerUnlisten = await listen(...); eagerUnlistenRef.current = eagerUnlisten; … })()`. The cleanup (line 444) does `eagerUnlistenRef.current?.(); eagerUnlistenRef.current = null;`. If the effect cleanup fires (conversation switch / connection change / unmount) *before* the IIFE reaches line 408, `eagerUnlistenRef.current` is still null at cleanup → the listener registered a moment later is never torn down. The `eagerSessionPromise` module lock prevents *concurrent* firings but does not bridge the cleanup-before-await-resolves gap. (The send-chat path at 730 and recovery at 1002 also null this ref, partially masking it, but a switch with no subsequent send leaks one `acp-session-update` listener.)

**Impact:** Each chat/connection switch that lands in this window leaks one eager `acp-session-update` listener; over a session of provider/conversation hopping the count grows and every agent stream notification fans out to dead listeners.

**Fix:** Capture a local `let active = true;` in the effect; in cleanup set `active = false; eagerUnlistenRef.current?.()`; after the `await listen()` resolves, `if (!active) { eagerUnlisten(); return; }` before storing it.

---

## LOW

### L1 — `useFileWatcher` / `DrawingPreview` / `ChatMessageList` use `listen().then(fn => fn())` in cleanup — correct but fragile

**Location:** `useFileWatcher.ts:260`, `DrawingPreview.tsx:179`, `ChatMessageList.tsx:169`

**Evidence:** `return () => { unlisten.then((fn) => fn()); }`. This *works* (the Promise resolves exactly once; the cleanup `.then` always fires the unlisten), so it is **not** a leak. It is fragile only in that there is a brief window after unmount where the listener is still live and its handler runs (the handlers do guard via store lookups). Flagging for consistency — prefer the `mounted`-flag form used elsewhere.

**Fix (optional):** Standardize on the `mounted`+immediate-unlisten form for uniformity and to silence the handler during the post-unmount-pre-resolve window.

### L2 — `useLocalCompletion` aborts an `invoke()` it cannot actually cancel

**Location:** `src/hooks/useLocalCompletion.ts:141-145,155-161,172`

**Evidence:** An `AbortController` is created and `.abort()`'d on the next request, but it is never passed *into* `tauriApi.*FimCompletion` (Tauri `invoke` accepts no `AbortSignal`). Cancellation is purely post-hoc: `if (abortController.signal.aborted || thisRequest !== requestId.current) return;` after the await. The FIM HTTP request to the local server still completes.

**Impact:** Wasted local-server compute for superseded completions (cheap, local). The staleness *guard* is correct, so no wrong ghost text — only the wasted work. Documenting because the AbortController gives a false impression of true cancellation.

**Fix:** Either add a backend `cancel_fim(requestId)` that aborts the upstream request, or drop the AbortController and keep only the `requestId` supersede guard to avoid implying cancellation that doesn't happen.

### L3 — `ChatMessageList` domain-request listener re-subscribes on every `effectiveConnection.id` change, can drop an in-flight 30s-timeout request

**Location:** `src/components/chat/ChatMessageList.tsx:137-170`

**Evidence:** The `network-domain-request` listener's effect dep is `[effectiveConnection?.id]`. Switching the chat-footer provider mid-agent-run tears down and re-creates the listener; a `network-domain-request` emitted during the swap (the backend auto-denies after 30s) could arrive with no listener attached and be lost, leaving the agent blocked on that domain until timeout.

**Impact:** Rare — requires a domain prompt to fire exactly during a provider switch. The agent stalls 30s then auto-denies. Low.

**Fix:** Keep one app-lifetime listener (mounted higher up) keyed by nothing, and resolve `effectiveConnection` inside the handler via `getState()` rather than re-subscribing per connection.

---

## Confirmed Good Patterns

| File | Pattern checked | Status |
| --- | --- | --- |
| `src/lib/ai/acp-agent-state.ts:200-390` | ACP spawn singleton — `acpSpawnPromise` in-flight dedup + post-await re-verification + recursion cap | Correct (the skill's example bug is already fixed here) |
| `src/hooks/useSandboxViolations.ts:20-61` | `listen()` with `mounted` flag + immediate-unlisten-if-unmounted | Correct |
| `src/hooks/useActionScanner.ts:27-72` | `mounted` flag, immediate unlisten, debounce timer cleared | Correct |
| `src/hooks/useRecording.ts:33-75` | interval cleared on stop/unmount; level listener `mounted`-guarded | Correct |
| `src/hooks/useLocalAI.ts:191-275` | status listener `mounted`-guarded; 30s health-check interval cleared; `startServer` unlistens in `finally` | Correct |
| `src/hooks/useFadeOnType.ts` | capture-phase DOM listeners + matchMedia listener all removed; timer cleared; class reset on unmount | Correct |
| `src/hooks/useWindowFocus.ts:71-76` | `focus`/`blur` listeners removed with same fn refs | Correct |
| `src/hooks/useScrollPersistence.ts:90-102` | passive scroll listener + debounce timer cleaned up | Correct |
| `src/hooks/useCommentOperations.ts:142-159` | position-save debounce captures `currentKey`/`currentRoot` to avoid stale closure; flush-on-cleanup | Correct (the skill's exact example is fixed) |
| `src/hooks/useAcpLifecycle.ts:1091-1118` | cancel-escalation listener handles listen-resolves-after-timeout via `cancelMounted` | Correct |
| `src/hooks/useCopilotChat.ts:425` / `useAgentTaskOperations.ts:556-563` | `isOurEvent(conversationId)` gates global Copilot events per-conversation | Correct (this is the pattern C1/H2 need) |
| `src/hooks/useAppLifecycle.ts:307-343` | startup parallel load — inner mapped promises catch individually, `Promise.all` can't reject; per-step `withTimeout` | Correct |
| `src/hooks/useDirectApiChat.ts:541-563` | streaming cleanup is idempotent (`cancelled` flag), clears flush interval, unlistens all 8, finalizes | Correct *within* a single stream (cross-stream is C1) |

---

## Notes the dated skills would miss

1. **The skills hunt per-hook `listen()` leaks** — but the live bugs (C1/C2/H2) are **architectural**: global, un-correlated Tauri events plus a frontend-only "cancel." A per-listener checklist passes each call site individually while the *bus* is unsound. The fix is a `streamId`/`sessionId` correlation id, not tighter cleanup.
2. **The skills' two flagship "broken `listen()`" examples (StatusBar, useSandboxViolations) and the comment-save stale-closure example are already fixed** in this codebase. Re-flagging them verbatim would be noise; the *remaining* instances of that exact anti-pattern are `StatusBar.tsx:129` (H3) and `App.tsx:216` (M1), which the skill's own example would catch — but only those two.
3. **React 19 concurrency nuance:** H1 (`streamingHydrate` across `requestAnimationFrame` yields with no unmount-abort and no `isDestroyed` guard) is a modern-rendering hazard — the chunked-hydration-with-yield design is new since the skills were written, and the abort plumbing exists for *tab switch* but was never wired to *unmount*.
