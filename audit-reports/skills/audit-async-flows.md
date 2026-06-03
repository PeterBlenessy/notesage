# Proposal: Improvements to `audit-async-flows` SKILL.md

Grounded in audit `audit-reports/02-async-memory.md`. Each change is traceable to a specific finding. Frontmatter and section structure are preserved; these are surgical edits, not a rewrite.

Scope split: this file carries race / cancellation / stale-closure / correlation-id findings. Listener / interval / subprocess / ref-leak findings go to `audit-memory-leaks.md`.

---

## 1. Stale / incorrect guidance to fix

### 1a. The "Example Finding" (ACP singleton race) is fixed in this codebase — re-flagging it is noise

The skill closes with a worked example whose exact bug no longer exists:

> **Current text (lines 83-99):**
> ```
> ### HIGH: ACP agent singleton race condition
>
> **File:** `src/hooks/useAcpLifecycle.ts:136-177`
>
> Module-level `acpAgent` is a mutable singleton. Multiple concurrent calls to `ensureAcpAgent` can both see `acpAgent === null` and both spawn a new agent — one is leaked.
>
> **Fix:** Add a spawn-in-progress Promise that concurrent callers await:
> ```typescript
> let spawnPromise: Promise<AgentHandle> | null = null;
> async function ensureAgent() {
>   if (agent) return agent;
>   if (!spawnPromise) {
>     spawnPromise = spawnAgent().then(a => { agent = a; spawnPromise = null; return a; });
>   }
>   return spawnPromise;
> }
> ```
> ```

**Why it is stale:** the audit confirms `src/lib/ai/acp-agent-state.ts:200-390` already implements exactly this `acpSpawnPromise` in-flight dedup with post-await re-verification and a recursion cap ("Confirmed Good Patterns", and finding C1's note: *"the `isOurEvent` pattern Copilot already uses"*; "the skill's example bug is already fixed here"). An auditor following this example will re-report a fixed bug.

**Replacement text** — keep the singleton-race pattern as a *teaching* example but re-point it to the live class of bug the audit actually found (un-correlated global event bus), and explicitly note the spawn-dedup is already solved:

```
### CRITICAL: Global Tauri events with no correlation id (concurrent streams cross-contaminate)

**File:** `src/hooks/useDirectApiChat.ts:458-538` + `src/lib/ai/structured.ts:71`

`ai-stream-chunk` / `ai-stream-done` / `ai-tool-call` are emitted from Rust as plain global
events with no stream/request id in the payload (`ai_streaming.rs:292`). Both
`useDirectApiChat.sendChatMessage` and `generateStructured()` listen on the *same* global names.
Any two direct-API generations that overlap (e.g. a `generateStructured` intent-classification
call fired mid chat-stream, or a background `useAgentTaskOperations` task) share one bus with no
way to tell whose chunk is whose — the structured parser accumulates the chat's prose and
`JSON.parse` throws, and the chat message gets the structured model's JSON appended.

A per-hook `cancelled`/`mounted` flag does NOT fix this: it only guards a stream's own teardown,
not a *different* stream's events landing in this listener.

**Fix:** Thread a `streamId` (UUID) from the frontend into `ai_chat_stream`, include it in every
emitted payload, and early-return in each listener when `payload.streamId !== thisStreamId` — the
`isOurEvent(conversationId)` pattern `useCopilotChat.ts:425` and `useAgentTaskOperations.ts:556`
already use for Copilot events. (Note: the module-level *spawn* singleton race is already solved
in `acp-agent-state.ts` via an in-flight `acpSpawnPromise` + post-await re-verification — verify
before reporting it.)
```

### 1b. "Missing Cancellation" treats frontend unlisten as sufficient cancellation

> **Current text (lines 46-48):**
> ```
> - Completion requests where a newer request has superseded the old one
> - API calls without AbortController that continue after component unmount
> - Requests that check staleness only after the response arrives (wasted compute)
> ```

**Why it is incomplete:** finding C2 shows `cancelDirectChat` calls `cleanupRef.current()` (unlisten frontend listeners only) while the Rust `ai_chat_stream` task keeps reading the provider SSE to completion — a *cosmetic* cancel that burns paid tokens and (via C1) lets still-arriving chunks land in the next message. Finding L2 shows the inverse anti-pattern: an `AbortController` is created and `.abort()`'d but never plumbed into the `invoke()` it cannot cancel — giving a *false impression* of true cancellation. The current bullets don't name either: a frontend-only teardown of a backend-driven stream, or an AbortController that controls nothing.

**Replacement / addition** (append two bullets):

```
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
```

---

## 2. New checks to add (each cited to the finding that proves the skill missed it)

Add the following subsections to **"What to Search For"**.

### 2a. Add under a new top-level subsection — **Event-Bus Correlation (architectural)**

> Cited to **C1** (`useDirectApiChat.ts:458` / `structured.ts:71` / `ai_streaming.rs:292`) and **H2** (`useAcpSessionListeners.ts:93`).

```
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
  (`useAcpSessionListeners.ts:93` checks only `instanceId` though the payload also has a
  `sessionId`). The correct shape is `isOurEvent(conversationId)` — `useCopilotChat.ts:425`.
- **`generateStructured`/utility callers on shared stream names:** any helper that registers its
  own `listen('ai-stream-chunk', …)` (e.g. `structured.ts:71`) and can run concurrently with chat
  is a cross-contamination source even though it looks self-contained.
```

### 2b. Add under **Missing Cancellation** — **Unmount-abort of chunked/yielding pipelines**

> Cited to **H1** (`useEditorTabSwitch.ts:159-720` + `markdown.ts:1354-1384`).

```
### Unmount-abort of chunked / yielding async pipelines

Find long async pipelines that yield to the event loop mid-flight (`await requestAnimationFrame`,
`await new Promise(setTimeout)`, streaming/chunked loops). For each:

- Does the controlling `AbortController` get aborted on **effect cleanup / unmount**, or only on
  the *next* run of the effect? An effect that creates `abortController` and aborts it at the top
  of the *next* activation but has **no `return () => abortController.abort()`** never cancels on
  unmount — the in-flight pipeline keeps running against a torn-down target.
  (`useEditorTabSwitch.ts` aborts the previous run at line 165 but the main effect has no cleanup
  return; the worker-parse → `streamingHydrate` chain keeps going after the Editor unmounts.)
- Inside the yielding loop, is the *target* checked for destruction between chunks, not just the
  `signal`? `markdown.ts:1355` checks `signal.aborted` but then calls
  `editor.chain()…insertContent(chunk).run()` with no `editor.isDestroyed` guard — an unmount
  during the `await requestAnimationFrame` makes the next chunk write to a destroyed ProseMirror
  view. Flag any post-yield write to an editor/view/DOM node without a freshness check.
```

### 2c. Add under **Missing Cancellation** — **Request-supersede guard for completions**

> Cited to **M2** (`useCopilotCompletion.ts:240-290`) vs the correct `useLocalCompletion.ts:148,172`.

```
### Request-supersede guard (out-of-order async results)

For any debounced request that paints a result at the cursor / latest position (inline
completions, search-as-you-type, suggestions):

- Is there a monotonic `requestId` (`const thisRequest = ++requestId.current`) compared after the
  await (`if (thisRequest !== requestId.current) return;`)? Without it, a slow request N that
  resolves after N+1 paints its stale result at wherever the cursor now is.
  `useCopilotCompletion.requestCompletion` (240-290) checks only `editor.isFocused/isDestroyed`
  and re-reads `editor.state.selection` — no supersede guard; `useLocalCompletion.ts:148,172` does
  it correctly. Cross-check sibling hooks: if one has the guard and a parallel one doesn't, flag
  the gap.
- Capture the *requested* position and compare it to the current one before applying, so a
  result is discarded when the cursor has moved off the request anchor.
```

### 2d. Add under **Race Conditions** — **Abort-aware in-flight dedup**

> Cited to **M3** (`useEditorTabSwitch.ts:319-320,593-597`).

```
### Abort-aware in-flight dedup

When an in-flight flag/ref dedups duplicate work keyed by an identity (tab id, doc id), verify the
flag is cleared when the controlling operation is **aborted**, not only when it **completes
(`.finally`)**. A dedup keyed by `tabId` that survives an abort will refuse to restart the same
key on fast A→B→A re-entry — the first A run was aborted, the second A run early-returns on the
stale flag, and A is left stuck on a loading/preview state. (`useEditorTabSwitch.ts:319` clears
`previewInFlightRef` only in `.finally`, but line 165 aborts the prior pipeline without clearing
the ref.) Clear the flag at the abort site too.
```

### 2e. Add under **Stale Closures** — **`getState()` snapshots in dependency arrays**

> Cited to **M4** (`useLocalCompletion.ts:217,255,265`; `useCopilotCompletion.ts:289`).

```
### Non-reactive store reads in dependency arrays

Flag any `useStore.getState().someField` appearing inside a `useCallback`/`useEffect`/`useMemo`
**dependency array**. `getState()` is evaluated once at render time and does NOT subscribe — when
that field changes without an unrelated re-render, the hook keeps the stale dep and never re-runs.
The body may re-read `getState()` and behave correctly by accident, but the effect won't re-arm on
the setting flip (e.g. toggling "disable completions" doesn't re-register the update listener until
the next unrelated render). Correct form: subscribe with a selector
(`const x = useStore((s) => s.someField);`) and use `x` in both body and deps.
(`useLocalCompletion.ts:217`, `useCopilotCompletion.ts:289`.)
```

---

## 3. Modern-judgment additions (the old skill predates these)

These extend existing sections rather than duplicate them.

### 3a. React 19 effect-cleanup correctness — append to **Post-Unmount State Updates**

> Motivated by H1 (unmount during `requestAnimationFrame` yield) and the audit's "React 19 concurrency nuance" note.

```
**React 19 / concurrent-rendering note:** React 19 may mount, unmount, and re-mount effects (Strict
Mode double-invoke; concurrent interruption). An async pipeline started in an effect can therefore
outlive its mount. Two consequences to check beyond "is the component mounted":
- The cleanup return must cancel in-flight async work (abort the controller), not merely null a
  ref — a chunked pipeline that yields with `await requestAnimationFrame` will resume after the
  unmount that React already processed (H1).
- A post-yield write to a long-lived external object (Tiptap view, DOM node, ProseMirror state)
  needs a freshness check (`editor.isDestroyed`) because the object the effect closed over may have
  been destroyed during the yield, even though the React `mounted` flag was the thing you checked.
```

### 3b. AbortController / ignore-flag patterns — already partially covered; sharpen the distinction

> Motivated by L2 (AbortController that controls nothing) and C2 (frontend-only cancel).

```
**Two distinct mechanisms — don't conflate:**
- **Ignore-flag (`let ignore = false; … return () => { ignore = true }`)** — correctly discards a
  late result so it isn't applied. It does NOT stop the underlying work.
- **True cancellation (AbortController wired into `fetch`, or a backend `…_cancel(id)` command)** —
  actually stops the work and frees the socket/tokens.
A `fetch`/HTTP stream or paid provider call needs *true* cancellation; a Tauri `invoke()` cannot be
aborted by an `AbortSignal` and needs a paired backend cancel command (C2, L2). Flag any code that
uses an AbortController as if it were cancelling an `invoke()`.
```

---

## 4. What NOT to add (already covered or confirmed-good — avoid re-flagging)

- The comment-save stale-closure example (skill lines 36-41) is **fixed** at
  `useCommentOperations.ts:142-159` (captures `currentKey`/`currentRoot`, flush-on-cleanup). Keep
  the *pattern* in the skill as a teaching example but the auditor must verify before reporting.
- `useAppLifecycle.ts:307-343` already does per-item catch + `withTimeout`, so the
  "`Promise.all` vs `allSettled`" check is satisfied there — don't re-flag.
- ACP spawn singleton dedup (`acp-agent-state.ts`) is correct — see 1a.
