---
name: audit-memory-leaks
description: Audit for memory leaks — event listeners, intervals, process cleanup, stale refs
user-invocable: true
---

# Audit: Memory Leaks & Resource Cleanup

Search the codebase for resource lifecycle issues that cause leaks over time. This is a research-only audit — do not modify any code.

## What to Search For

### Tauri Event Listeners

Find all `listen(` and `listen<` calls from `@tauri-apps/api/event`. For each one, verify:
- Is it inside a `useEffect`?
- Does the cleanup function call the returned `unlisten`?
- Does it handle the async nature of `listen()` (returns a Promise)?

**Key discriminator:** the bug is never "they forgot to call unlisten" — it is that `unlisten` is
captured *after* an `await`/`.then`, so cleanup running first sees `undefined`. Audit every site for
the gap between "cleanup can run" and "unlisten handle exists," and confirm a `mounted`/`active`
flag bridges it. The codebase's correct references are `useSandboxViolations.ts:48-54`,
`useActionScanner.ts:59-66`, and `useLocalAI.ts:191-275` (unlistens in `finally`).

**Common broken pattern to flag:**
```typescript
// BAD — unlisten is null if component unmounts before promise resolves
useEffect(() => {
  let unlisten: (() => void) | null = null;
  listen('event', handler).then((fn) => { unlisten = fn; });
  return () => { unlisten?.(); };  // may still be null!
}, []);
```

**Correct pattern:**
```typescript
// GOOD — tracks mount state, cleans up even if resolved late
useEffect(() => {
  let unlisten: (() => void) | null = null;
  let mounted = true;
  listen('event', handler).then((fn) => {
    if (mounted) { unlisten = fn; }
    else { fn(); }
  });
  return () => { mounted = false; unlisten?.(); };
}, []);
```

**Also flag these multi-listener / deferred-registration variants (the single-listener pattern misses them):**

- **Dynamic `import()` then N listeners, no `mounted` guard** — `import('@tauri-apps/api/event')
  .then(({listen}) => { listen(a).then(fn=>u1=fn); listen(b).then(fn=>u2=fn); })`. Unmount that
  races the import leaves every `uN` undefined at cleanup and registers the listeners afterward.
  (e.g. `StatusBar.tsx`, `App.tsx`.)
- **Sequential `await listen()` pushed into an array** — `unlisteners.push(await listen(a)); …
  push(await listen(b));` inside `setup()`, with `return () => unlisteners.forEach(fn => fn())`.
  Unmount/dep-change between two awaits makes cleanup iterate a partially-populated array; the
  listeners awaited after cleanup ran are pushed but never invoked. Track `mounted` and
  `if (!mounted) { fn(); return; }` after each await, or register all with `Promise.all` and
  unwind atomically. (e.g. `useTrayEvents.ts`.)
- **Listener registered in an async IIFE, ref read in cleanup** — `(async () => { const u =
  await listen(...); ref.current = u; })()` with cleanup `ref.current?.()`. If cleanup fires before
  the `await listen()` resolves, `ref.current` is still null and the just-registered listener
  leaks. Capture `let active = true`, set `active = false` in cleanup, and after the await
  `if (!active) { u(); return; }` before storing. (e.g. `useAcpLifecycle.ts` eager-session.)

### Listener re-subscribe churn (dropped in-flight events)

Flag listeners whose effect dependency array contains a value that changes during normal use
(e.g. `[effectiveConnection?.id]`) when the event they handle can fire *during* that change. Tearing
down and re-creating the listener opens a window where an event emitted mid-swap arrives with no
listener attached and is lost. (e.g. `ChatMessageList.tsx` re-subscribes the
`network-domain-request` listener on every connection switch; a domain prompt fired during a
provider switch is dropped, stalling the agent until the backend's 30s auto-deny.) Prefer one
app-lifetime listener that resolves the current value via `getState()` inside the handler over a
per-dependency re-subscription.

### `return () => unlistenPromise.then(fn => fn())` (correct but fragile)

`return () => { unlisten.then((fn) => fn()); }` is NOT a leak — the Promise resolves once and the
cleanup `.then` always fires the unlisten. The only residual hazard is a brief window after unmount
where the listener is still live and its handler runs (verify the handler self-guards via a store
lookup or `mounted` flag). Report as a LOW/consistency item, not a leak; recommend standardizing on
the `mounted`-flag + immediate-unlisten form for uniformity. (e.g. `useFileWatcher.ts`,
`DrawingPreview.tsx`, `ChatMessageList.tsx`.)

### Reused-singleton listeners (fan-out to dead targets)

When a listener is registered per-conversation/per-tab but the underlying transport is a reused
module-level singleton (e.g. one ACP agent instance reused across conversations,
`acp-agent-state.ts`), a leaked listener doesn't just sit idle — every event on the shared
singleton fans out to *all* surviving listeners, including dead ones whose component/conversation is
gone. Count growth here is multiplicative with event frequency. When auditing such a listener,
check both that it is torn down (this skill) AND that it filters on a correlation id so a live
sibling doesn't receive a stale stream's events (see `audit-async-flows` — out of scope here).

### Intervals and Timeouts

Find all `setInterval` and `setTimeout` calls. Verify each is cleared in a cleanup function (`clearInterval` / `clearTimeout`). Check for timeouts in `useCallback` that overwrite refs without clearing the previous timer.

### DOM Event Listeners

Find `addEventListener` calls. Verify matching `removeEventListener` in useEffect cleanup. Check that the same function reference is used (not an inline arrow function).

### Zustand Subscriptions

Find `.subscribe()` calls on stores. Verify the returned unsubscribe function is called on cleanup.

### Editor Cleanup

Verify the Tiptap editor instance is properly destroyed on unmount via `editor.destroy()` or Tiptap's built-in cleanup.

### Rust Process Cleanup

Check spawned subprocesses (`Command::new`, `Child`) for:
- `kill_on_drop(true)` — ensures process dies when handle is dropped
- `RunEvent::Exit` hook cleanup — stops processes on app exit
- Orphan cleanup on startup — kills leftover processes from crashes

### AbortController

Find long-running async operations (fetch, invoke) that should be abortable but don't use AbortController. Especially in useEffect hooks that could unmount mid-operation.

**Beyond presence — verify the signal is actually consumed.** An `AbortController` that is created
and `.abort()`'d but never passed into the operation (Tauri `invoke` accepts no `AbortSignal`, so
e.g. `*FimCompletion` keeps running) is a false-cancellation smell: it implies cleanup that doesn't
happen and wastes backend compute on superseded work. Either pair it with a backend `cancel_*(id)`
command or drop it and keep only a `requestId` supersede guard. (e.g. `useLocalCompletion.ts` — the
true-cancellation requirement is detailed in `audit-async-flows`.)

### Refs Holding Stale Closures

Find `useRef` that captures values from render scope. Check if the ref is updated when dependencies change, or if it holds a stale closure.

## Output Format

For each finding:

```markdown
### <SEVERITY>: <Short title>

**File:** `<path>:<line>`

<Description of the issue — what's wrong and why it leaks.>

**Fix:** <Suggested fix with code snippet.>
```

End with:

```markdown
### Confirmed Good Patterns

| File | Pattern | Status |
| --- | --- | --- |
| `<file>` | <what was checked> | Properly cleaned up |
```

Seed the table with these audit-verified clean sites so future runs don't re-report them (note:
`useSandboxViolations` and the ACP spawn singleton — former flagship "broken" examples — are now
correct; re-flagging them is noise):

| File | Pattern checked | Status |
| --- | --- | --- |
| `src/hooks/useSandboxViolations.ts:20-61` | `listen()` `mounted` flag + immediate-unlisten | Properly cleaned up |
| `src/hooks/useActionScanner.ts:27-72` | `mounted` flag, immediate unlisten, debounce cleared | Properly cleaned up |
| `src/hooks/useRecording.ts:33-75` | interval cleared on stop/unmount; level listener `mounted`-guarded | Properly cleaned up |
| `src/hooks/useLocalAI.ts:191-275` | status listener `mounted`-guarded; 30s health interval cleared; `startServer` unlistens in `finally` | Properly cleaned up |
| `src/hooks/useFadeOnType.ts` | capture-phase DOM + matchMedia listeners removed; timer cleared; class reset | Properly cleaned up |
| `src/hooks/useWindowFocus.ts:71-76` | `focus`/`blur` removed with same fn refs | Properly cleaned up |
| `src/hooks/useScrollPersistence.ts:90-102` | passive scroll listener + debounce timer cleaned up | Properly cleaned up |

## Example Finding

### HIGH: StatusBar IndexProgressIndicator — two listeners leak + post-unmount setState

**File:** `src/components/editor/StatusBar.tsx:129-144`

A dynamic `import("@tauri-apps/api/event").then(({ listen }) => { listen(...).then(fn => unlisten1 = fn); listen(...).then(fn => unlisten2 = fn); })` with `return () => { unlisten1?.(); unlisten2?.(); }` and **no `mounted` guard**. If the component unmounts before the import *and* both `listen()` promises resolve, the cleanup runs with `unlisten1/2` still `undefined`; the `.then` callbacks then fire after unmount, the listeners are never removed, and `setProgress` runs on a torn-down component (React 19 warns). StatusBar mounts/unmounts on every document open/close and view-mode toggle, and indexing fires frequently (watcher-driven), so the orphaned listeners keep invoking `setProgress` for the life of the session.

**Fix:** Mirror the correct `useSandboxViolations.ts:48-54` shape — `let mounted = true;`, guard each `.then` (`if (mounted) unlisten1 = fn; else fn();`), guard `setProgress` with `if (!mounted) return;`, set `mounted = false` first in cleanup.
