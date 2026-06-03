---
name: audit-async-flows
description: Audit for race conditions, stale closures, missing cancellation, and error handling gaps
user-invocable: true
---

# Audit: Async Flows & Race Conditions

Search the codebase for async patterns that can produce incorrect behavior. This is a research-only audit — do not modify any code.

## What to Search For

### Event-Bus Correlation (architectural)

The per-listener checks below pass each call site individually while the *bus* is unsound. Audit
the bus, not just the cleanup:

- **Correlate emit ↔ consume:** For every Tauri event emitted by the backend, check the payload
  carries a correlation id (streamId / sessionId / requestId / conversationId). If two
  consumers (or two invocations of one consumer) can be live at once on the same global event
  name, an uncorrelated payload will be delivered to the wrong one. Search both sides:
  `grep -rn "\.emit(" src-tauri/src/commands` and the matching `listen<…>('<same-name>'` sites.
- **Filter on the narrowest id, not the coarsest:** A listener that filters on `instanceId`
  while a single instance is reused across conversations/sessions (e.g. an ACP agent whose
  `chatSessionId` is swapped, not the instance) will accept a stale stream's chunk into the
  current message. Verify the gate uses the per-conversation/per-session id the payload carries
  (e.g. `useAcpSessionListeners.ts` checking only `instanceId` though the payload also has a
  `sessionId`). The correct shape is `isOurEvent(conversationId)` — `useCopilotChat.ts`.
- **`generateStructured`/utility callers on shared stream names:** any helper that registers its
  own `listen('ai-stream-chunk', …)` (e.g. `structured.ts`) and can run concurrently with chat
  is a cross-contamination source even though it looks self-contained.

### Race Conditions

- **Module-level singletons:** Find module-level mutable variables (outside React components/hooks) that are read and written by async functions. Multiple concurrent callers can race.
- **Concurrent async calls without dedup:** Find async functions called from effects or callbacks that don't guard against concurrent execution (e.g., no in-progress flag or pending Promise).
- **Async useEffect without abort:** Find `useEffect` hooks that call async functions without checking if the effect is still current when the result arrives.

**Pattern to flag:**
```typescript
// BAD — module-level singleton, concurrent callers can both spawn
let agent: AgentHandle | null = null;
async function ensureAgent() {
  if (!agent) {
    agent = await spawnAgent();  // two callers can both reach here
  }
  return agent;
}
```

#### Abort-aware in-flight dedup

When an in-flight flag/ref dedups duplicate work keyed by an identity (tab id, doc id), verify the
flag is cleared when the controlling operation is **aborted**, not only when it **completes
(`.finally`)**. A dedup keyed by `tabId` that survives an abort will refuse to restart the same
key on fast A→B→A re-entry — the first A run was aborted, the second A run early-returns on the
stale flag, and A is left stuck on a loading/preview state. (e.g. `useEditorTabSwitch.ts` clears
`previewInFlightRef` only in `.finally`, but aborts the prior pipeline without clearing the ref.)
Clear the flag at the abort site too.

### Stale Closures

Find debounce/timeout callbacks that capture values from the enclosing scope. If the captured value can change before the timer fires, the callback uses stale data.

**Pattern to flag:**
```typescript
// BAD — commentKey captured from closure, stale if tab switches during 2s window
positionSaveTimeoutRef.current = setTimeout(() => {
  saveComments(commentKey, storageRoot);
}, 2000);
```

#### Non-reactive store reads in dependency arrays

Flag any `useStore.getState().someField` appearing inside a `useCallback`/`useEffect`/`useMemo`
**dependency array**. `getState()` is evaluated once at render time and does NOT subscribe — when
that field changes without an unrelated re-render, the hook keeps the stale dep and never re-runs.
The body may re-read `getState()` and behave correctly by accident, but the effect won't re-arm on
the setting flip (e.g. toggling "disable completions" doesn't re-register the update listener until
the next unrelated render). Correct form: subscribe with a selector
(`const x = useStore((s) => s.someField);`) and use `x` in both body and deps.
(e.g. `useLocalCompletion.ts`, `useCopilotCompletion.ts`.)

### Missing Cancellation

Find async operations that complete and apply their results even when they're no longer relevant:
- Completion requests where a newer request has superseded the old one
- API calls without AbortController that continue after component unmount
- Requests that check staleness only after the response arrives (wasted compute)
- **Frontend-only "cancel" of a backend-driven stream:** a Stop button that unlistens frontend
  listeners / sets `loading=false` but leaves a fire-and-forget `invoke('…_stream')` Rust task
  reading the provider socket to completion. There must be a matching `…_cancel(streamId)` Tauri
  command that aborts the upstream request (mirror `download_cancels` in `transcription.rs`).
- **AbortController that controls nothing:** an `AbortController` created and `.abort()`'d but
  never passed into the operation it claims to cancel (Tauri `invoke` accepts no `AbortSignal`).
  This is fine ONLY as a post-hoc staleness guard — but if the work itself keeps running, say so;
  do not let the AbortController imply cancellation that does not happen.
- **Cancel during the listener-registration window:** if `cancelFn` is wired only *after*
  `await Promise.all([listen(...)])` resolves, a cancel issued during setup is a no-op and the
  message fills in anyway. Set the cancel flag/ref BEFORE the await.

#### Unmount-abort of chunked / yielding async pipelines

Find long async pipelines that yield to the event loop mid-flight (`await requestAnimationFrame`,
`await new Promise(setTimeout)`, streaming/chunked loops). For each:

- Does the controlling `AbortController` get aborted on **effect cleanup / unmount**, or only on
  the *next* run of the effect? An effect that creates `abortController` and aborts it at the top
  of the *next* activation but has **no `return () => abortController.abort()`** never cancels on
  unmount — the in-flight pipeline keeps running against a torn-down target.
  (e.g. `useEditorTabSwitch.ts` aborts the previous run but the main effect has no cleanup return;
  the worker-parse → `streamingHydrate` chain keeps going after the Editor unmounts.)
- Inside the yielding loop, is the *target* checked for destruction between chunks, not just the
  `signal`? A loop that checks `signal.aborted` but then calls
  `editor.chain()…insertContent(chunk).run()` with no `editor.isDestroyed` guard — an unmount
  during the `await requestAnimationFrame` makes the next chunk write to a destroyed ProseMirror
  view. Flag any post-yield write to an editor/view/DOM node without a freshness check.
  (e.g. `markdown.ts`.)

#### Request-supersede guard (out-of-order async results)

For any debounced request that paints a result at the cursor / latest position (inline
completions, search-as-you-type, suggestions):

- Is there a monotonic `requestId` (`const thisRequest = ++requestId.current`) compared after the
  await (`if (thisRequest !== requestId.current) return;`)? Without it, a slow request N that
  resolves after N+1 paints its stale result at wherever the cursor now is. (e.g.
  `useCopilotCompletion.requestCompletion` checks only `editor.isFocused/isDestroyed` and re-reads
  `editor.state.selection` — no supersede guard; `useLocalCompletion.ts` does it correctly.)
  Cross-check sibling hooks: if one has the guard and a parallel one doesn't, flag the gap.
- Capture the *requested* position and compare it to the current one before applying, so a
  result is discarded when the cursor has moved off the request anchor.

### Error Handling Gaps

- **Empty catch blocks:** `catch {}` or `catch { /* ignore */ }` — swallowed errors
- **Missing try/catch on async IIFEs:** `(async () => { ... })()` without outer error handling
- **`Promise.all` instead of `Promise.allSettled`:** One failure loses all results
- **Generic error messages:** Catch blocks that log "something went wrong" without the actual error

### State Consistency

Find places where multiple Zustand stores are updated in sequence. If the first update triggers a re-render before the second completes, components may see inconsistent state.

### Post-Unmount State Updates

Find async callbacks (in setTimeout, Promise.then, event handlers) that call React state setters or store actions without checking if the component is still mounted.

**React 19 / concurrent-rendering note:** React 19 may mount, unmount, and re-mount effects (Strict
Mode double-invoke; concurrent interruption). An async pipeline started in an effect can therefore
outlive its mount. Two consequences to check beyond "is the component mounted":
- The cleanup return must cancel in-flight async work (abort the controller), not merely null a
  ref — a chunked pipeline that yields with `await requestAnimationFrame` will resume after the
  unmount that React already processed.
- A post-yield write to a long-lived external object (Tiptap view, DOM node, ProseMirror state)
  needs a freshness check (`editor.isDestroyed`) because the object the effect closed over may have
  been destroyed during the yield, even though the React `mounted` flag was the thing you checked.

**AbortController vs ignore-flag — two distinct mechanisms, don't conflate:**
- **Ignore-flag (`let ignore = false; … return () => { ignore = true }`)** — correctly discards a
  late result so it isn't applied. It does NOT stop the underlying work.
- **True cancellation (AbortController wired into `fetch`, or a backend `…_cancel(id)` command)** —
  actually stops the work and frees the socket/tokens.
A `fetch`/HTTP stream or paid provider call needs *true* cancellation; a Tauri `invoke()` cannot be
aborted by an `AbortSignal` and needs a paired backend cancel command. Flag any code that uses an
AbortController as if it were cancelling an `invoke()`.

## Output Format

For each finding:

```markdown
### <SEVERITY>: <Short title>

**File:** `<path>:<line>`

<Description — what can go wrong and under what conditions.>

**Fix:** <Suggested fix.>
```

End with a `### Confirmed Good Patterns` section.

## Example Finding

### CRITICAL: Global Tauri events with no correlation id (concurrent streams cross-contaminate)

**File:** `src/hooks/useDirectApiChat.ts` + `src/lib/ai/structured.ts`

`ai-stream-chunk` / `ai-stream-done` / `ai-tool-call` are emitted from Rust as plain global
events with no stream/request id in the payload (`ai_streaming.rs`). Both
`useDirectApiChat.sendChatMessage` and `generateStructured()` listen on the *same* global names.
Any two direct-API generations that overlap (e.g. a `generateStructured` intent-classification
call fired mid chat-stream, or a background `useAgentTaskOperations` task) share one bus with no
way to tell whose chunk is whose — the structured parser accumulates the chat's prose and
`JSON.parse` throws, and the chat message gets the structured model's JSON appended.

A per-hook `cancelled`/`mounted` flag does NOT fix this: it only guards a stream's own teardown,
not a *different* stream's events landing in this listener.

**Fix:** Thread a `streamId` (UUID) from the frontend into `ai_chat_stream`, include it in every
emitted payload, and early-return in each listener when `payload.streamId !== thisStreamId` — the
`isOurEvent(conversationId)` pattern `useCopilotChat.ts` and `useAgentTaskOperations.ts` already
use for Copilot events. (Note: the module-level *spawn* singleton race is already solved in
`acp-agent-state.ts` via an in-flight `acpSpawnPromise` + post-await re-verification — verify
before reporting it.)
