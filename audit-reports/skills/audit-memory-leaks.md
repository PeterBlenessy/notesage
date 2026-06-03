# Proposal: Improvements to `audit-memory-leaks` SKILL.md

Grounded in audit `audit-reports/02-async-memory.md`. Each change is traceable to a specific finding. Frontmatter and section structure are preserved; these are surgical edits.

Scope split: this file carries listener / interval / subprocess / ref-leak findings. Race / cancellation / stale-closure / correlation-id findings go to `audit-async-flows.md`.

---

## 1. Stale / incorrect guidance to fix

### 1a. The "Example Finding" cites `useSandboxViolations` as the broken case — but it is now the *fixed* reference

> **Current text (lines 101-121):**
> ```
> ### HIGH: useSandboxViolations — Listener not cleaned up before unmount
>
> **File:** `src/hooks/useSandboxViolations.ts:20-50`
>
> The `listen()` promise may resolve after component unmount. When it does, `unlisten` is still null, so the listener is never cleaned up and continues to fire indefinitely.
>
> **Fix:** Track mount state and clean up immediately if already unmounted:
> [snippet]
> ```

**Why it is stale:** the audit's "Confirmed Good Patterns" table lists `useSandboxViolations.ts:20-61` as the *correct* `mounted`-flag + immediate-unlisten reference, and finding H3 explicitly contrasts the broken StatusBar against "the now-correct `useSandboxViolations.ts:48-54`." Citing it as the HIGH broken example now points auditors at the canonical *good* implementation.

**Replacement text** — re-point the example to a still-broken site (H3) and keep the same teaching shape:

```
### HIGH: StatusBar IndexProgressIndicator — two listeners leak + post-unmount setState

**File:** `src/components/editor/StatusBar.tsx:129-144`

A dynamic `import("@tauri-apps/api/event").then(({ listen }) => { listen(...).then(fn => unlisten1 = fn); listen(...).then(fn => unlisten2 = fn); })` with `return () => { unlisten1?.(); unlisten2?.(); }` and **no `mounted` guard**. If the component unmounts before the import *and* both `listen()` promises resolve, the cleanup runs with `unlisten1/2` still `undefined`; the `.then` callbacks then fire after unmount, the listeners are never removed, and `setProgress` runs on a torn-down component (React 19 warns). StatusBar mounts/unmounts on every document open/close and view-mode toggle, and indexing fires frequently (watcher-driven), so the orphaned listeners keep invoking `setProgress` for the life of the session.

**Fix:** Mirror the correct `useSandboxViolations.ts:48-54` shape — `let mounted = true;`, guard each `.then` (`if (mounted) unlisten1 = fn; else fn();`), guard `setProgress` with `if (!mounted) return;`, set `mounted = false` first in cleanup.
```

### 1b. "Tauri Event Listeners" assumes a *single* `listen()` per effect

> **Current "broken pattern" (lines 21-28)** shows one `listen('event', …).then(fn => unlisten = fn)`.

**Why it is incomplete:** findings H3 (two listeners behind one dynamic `import()`), H4 (`useTrayEvents` — four *sequential* `await listen()` pushed into an array), and M5 (a listener registered inside an async IIFE, ref read in cleanup) show three multi-listener / deferred-registration variants the single-listener pattern doesn't catch. The single-`unlisten` example passes each of these individually.

**Replacement / addition** — keep the existing single-listener pattern, then append:

```
**Also flag these multi-listener / deferred-registration variants (the single-listener pattern misses them):**

- **Dynamic `import()` then N listeners, no `mounted` guard** — `import('@tauri-apps/api/event')
  .then(({listen}) => { listen(a).then(fn=>u1=fn); listen(b).then(fn=>u2=fn); })`. Unmount that
  races the import leaves every `uN` undefined at cleanup and registers the listeners afterward.
  (`StatusBar.tsx:129` H3, `App.tsx:216` M1.)
- **Sequential `await listen()` pushed into an array** — `unlisteners.push(await listen(a)); …
  push(await listen(b));` inside `setup()`, with `return () => unlisteners.forEach(fn => fn())`.
  Unmount/dep-change between two awaits makes cleanup iterate a partially-populated array; the
  listeners awaited after cleanup ran are pushed but never invoked. Track `mounted` and
  `if (!mounted) { fn(); return; }` after each await, or register all with `Promise.all` and
  unwind atomically. (`useTrayEvents.ts:31-69` H4.)
- **Listener registered in an async IIFE, ref read in cleanup** — `(async () => { const u =
  await listen(...); ref.current = u; })()` with cleanup `ref.current?.()`. If cleanup fires before
  the `await listen()` resolves, `ref.current` is still null and the just-registered listener
  leaks. Capture `let active = true`, set `active = false` in cleanup, and after the await
  `if (!active) { u(); return; }` before storing. (`useAcpLifecycle.ts:315-451` eager-session M5.)
```

---

## 2. New checks to add (each cited to the finding that proves the skill missed it)

### 2a. Add under **Tauri Event Listeners** — **Re-subscribe churn drops in-flight events**

> Cited to **L3** (`ChatMessageList.tsx:137-170`).

```
### Listener re-subscribe churn (dropped in-flight events)

Flag listeners whose effect dependency array contains a value that changes during normal use
(e.g. `[effectiveConnection?.id]`) when the event they handle can fire *during* that change. Tearing
down and re-creating the listener opens a window where an event emitted mid-swap arrives with no
listener attached and is lost. (`ChatMessageList.tsx:137` re-subscribes the
`network-domain-request` listener on every connection switch; a domain prompt fired during a
provider switch is dropped, stalling the agent until the backend's 30s auto-deny.) Prefer one
app-lifetime listener that resolves the current value via `getState()` inside the handler over a
per-dependency re-subscription.
```

### 2b. Add under **Tauri Event Listeners** — **`listen().then(fn => fn())` in cleanup**

> Cited to **L1** (`useFileWatcher.ts:260`, `DrawingPreview.tsx:179`, `ChatMessageList.tsx:169`).

```
### `return () => unlistenPromise.then(fn => fn())` (correct but fragile)

`return () => { unlisten.then((fn) => fn()); }` is NOT a leak — the Promise resolves once and the
cleanup `.then` always fires the unlisten. The only residual hazard is a brief window after unmount
where the listener is still live and its handler runs (verify the handler self-guards via a store
lookup or `mounted` flag). Report as a LOW/consistency item, not a leak; recommend standardizing on
the `mounted`-flag + immediate-unlisten form for uniformity. (`useFileWatcher.ts:260`,
`DrawingPreview.tsx:179`, `ChatMessageList.tsx:169`.)
```

---

## 3. Modern-judgment additions (the old skill predates these)

### 3a. Tauri `listen()` unlisten teardown — sharpen the existing **Tauri Event Listeners** intro

> The skill already covers the single-`unlisten` case; the audit shows the real survivors are deferred/multi-listener registrations. Add a one-line discriminator at the top of the section:

```
**Key discriminator:** the bug is never "they forgot to call unlisten" — it is that `unlisten` is
captured *after* an `await`/`.then`, so cleanup running first sees `undefined`. Audit every site for
the gap between "cleanup can run" and "unlisten handle exists," and confirm a `mounted`/`active`
flag bridges it. The codebase's correct references are `useSandboxViolations.ts:48-54`,
`useActionScanner.ts:59-66`, and `useLocalAI.ts:191-275` (unlistens in `finally`).
```

### 3b. Event-bus teardown — add under **Tauri Event Listeners** (cross-references async audit)

> Motivated by the audit's "Notes the dated skills would miss" — per-listener leaks are mostly fixed; the architectural issue is global uncorrelated events. The *leak* dimension belongs here.

```
### Reused-singleton listeners (fan-out to dead targets)

When a listener is registered per-conversation/per-tab but the underlying transport is a reused
module-level singleton (e.g. one ACP agent instance reused across conversations,
`acp-agent-state.ts:198`), a leaked listener doesn't just sit idle — every event on the shared
singleton fans out to *all* surviving listeners, including dead ones whose component/conversation is
gone. Count growth here is multiplicative with event frequency. When auditing such a listener,
check both that it is torn down (this skill) AND that it filters on a correlation id so a live
sibling doesn't receive a stale stream's events (see `audit-async-flows` — H2/C1, out of scope
here). M5's leaked eager `acp-session-update` listener is the leak half of this pair.
```

### 3c. AbortController — extend the existing **AbortController** section with the "controls nothing" smell

> Cited to **L2** (`useLocalCompletion.ts:141-145`). The skill currently only asks "is there an AbortController?"; the audit shows an AbortController that exists but is wired to nothing.

```
**Beyond presence — verify the signal is actually consumed.** An `AbortController` that is created
and `.abort()`'d but never passed into the operation (Tauri `invoke` accepts no `AbortSignal`, so
`*FimCompletion` keeps running) is a false-cancellation smell: it implies cleanup that doesn't
happen and wastes backend compute on superseded work. Either pair it with a backend `cancel_*(id)`
command or drop it and keep only a `requestId` supersede guard. (`useLocalCompletion.ts:141-145`,
L2 — the true-cancellation requirement is detailed in `audit-async-flows` C2.)
```

---

## 4. Confirmed-good sites to seed the skill's good-patterns table (avoid re-flagging)

The skill ends with a "Confirmed Good Patterns" table. Seed it with the audit's verified-clean sites so future runs don't re-report them:

| File | Pattern checked | Status |
| --- | --- | --- |
| `src/hooks/useSandboxViolations.ts:20-61` | `listen()` `mounted` flag + immediate-unlisten | Properly cleaned up |
| `src/hooks/useActionScanner.ts:27-72` | `mounted` flag, immediate unlisten, debounce cleared | Properly cleaned up |
| `src/hooks/useRecording.ts:33-75` | interval cleared on stop/unmount; level listener `mounted`-guarded | Properly cleaned up |
| `src/hooks/useLocalAI.ts:191-275` | status listener `mounted`-guarded; 30s health interval cleared; `startServer` unlistens in `finally` | Properly cleaned up |
| `src/hooks/useFadeOnType.ts` | capture-phase DOM + matchMedia listeners removed; timer cleared; class reset | Properly cleaned up |
| `src/hooks/useWindowFocus.ts:71-76` | `focus`/`blur` removed with same fn refs | Properly cleaned up |
| `src/hooks/useScrollPersistence.ts:90-102` | passive scroll listener + debounce timer cleaned up | Properly cleaned up |

(Note: `useSandboxViolations` and the ACP spawn singleton — the skills' former flagship "broken" examples — are now correct; re-flagging them is noise.)
