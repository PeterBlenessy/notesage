---
name: audit-async-flows
description: Audit for race conditions, stale closures, missing cancellation, and error handling gaps
user-invocable: true
---

# Audit: Async Flows & Race Conditions

Search the codebase for async patterns that can produce incorrect behavior. This is a research-only audit — do not modify any code.

## What to Search For

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

### Stale Closures

Find debounce/timeout callbacks that capture values from the enclosing scope. If the captured value can change before the timer fires, the callback uses stale data.

**Pattern to flag:**
```typescript
// BAD — commentKey captured from closure, stale if tab switches during 2s window
positionSaveTimeoutRef.current = setTimeout(() => {
  saveComments(commentKey, storageRoot);
}, 2000);
```

### Missing Cancellation

Find async operations that complete and apply their results even when they're no longer relevant:
- Completion requests where a newer request has superseded the old one
- API calls without AbortController that continue after component unmount
- Requests that check staleness only after the response arrives (wasted compute)

### Error Handling Gaps

- **Empty catch blocks:** `catch {}` or `catch { /* ignore */ }` — swallowed errors
- **Missing try/catch on async IIFEs:** `(async () => { ... })()` without outer error handling
- **`Promise.all` instead of `Promise.allSettled`:** One failure loses all results
- **Generic error messages:** Catch blocks that log "something went wrong" without the actual error

### State Consistency

Find places where multiple Zustand stores are updated in sequence. If the first update triggers a re-render before the second completes, components may see inconsistent state.

### Post-Unmount State Updates

Find async callbacks (in setTimeout, Promise.then, event handlers) that call React state setters or store actions without checking if the component is still mounted.

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

### HIGH: ACP agent singleton race condition

**File:** `src/hooks/useAcpLifecycle.ts:136-177`

Module-level `acpAgent` is a mutable singleton. Multiple concurrent calls to `ensureAcpAgent` can both see `acpAgent === null` and both spawn a new agent — one is leaked.

**Fix:** Add a spawn-in-progress Promise that concurrent callers await:
```typescript
let spawnPromise: Promise<AgentHandle> | null = null;
async function ensureAgent() {
  if (agent) return agent;
  if (!spawnPromise) {
    spawnPromise = spawnAgent().then(a => { agent = a; spawnPromise = null; return a; });
  }
  return spawnPromise;
}
```
