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

## Example Finding

### HIGH: useSandboxViolations — Listener not cleaned up before unmount

**File:** `src/hooks/useSandboxViolations.ts:20-50`

The `listen()` promise may resolve after component unmount. When it does, `unlisten` is still null, so the listener is never cleaned up and continues to fire indefinitely.

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
    else { fn(); }
  });
  return () => { mounted = false; unlisten?.(); };
}, []);
```
