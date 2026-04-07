# Production Bug Fixes — 2026-04-07

|  |  |
| --- | --- |
| **Date** | 2026-04-07 |
| **Status** | Complete |
| **Bugs** | [startup-ready](../bugs/2026-04-07-startup-ready-never-set.md), [reindex-queue](../bugs/2026-04-07-reindex-queue-not-drained-after-save.md), [tag-badge-css](../bugs/2026-04-07-tag-badge-css-sibling-selector.md) |
| **Total** | 8 tasks: 4S, 3M, 1L |
| **Suggested order** | CSS fix already done (#1) → Backend watcher (#2-#3) → Frontend startup (#4-#6) → Verification (#7-#8) |

**Risks:**

- Watcher changes have caused regressions twice before (poisoned lock 2026-03-23, external changes not detected 2026-03-29). Task #2 is minimal and well-guarded but must be tested carefully.
- Startup timeout (#4) changes a critical initialization path. Must verify skill/agent discovery, watchers, and index init all still work on happy path.

---

### #1 — Remove broken CSS sibling merge rules for badges ✅

**Description:** Remove `.tag-badge:has(+ .tag-badge)`, `.tag-badge + .tag-badge` and equivalent rules for `.mention-badge` and `.date-badge`. Add `margin-inline: 0.1em` to all three badge classes for consistent spacing. The CSS `+` combinator ignores text nodes, so these rules were matching ANY two badges in the same parent element, stripping border-radius from most tags in multi-tag paragraphs.

**Complexity:** S **Category:** frontend **Dependencies:** None **Files:**

- `src/styles/editor.css` — remove 6 rule blocks, add `margin-inline` to 3 selectors

**Acceptance criteria:**

- Tags in multi-tag paragraphs all have full 6px border-radius on both sides
- Consistent spacing gap between badge and surrounding text
- Date and mention badges have the same fix
- All existing tests pass

---

### #2 — Move `process_reindex_queue` outside batch emptiness check ✅

**Description:** In `watcher.rs`, move `crate::index::process_reindex_queue(&app_handle)` to run unconditionally after the event processing loop, before the `if !batch.is_empty()` check. This ensures self-write reindex entries are drained even when no external changes are in the batch.

This is Option A from the architecture analysis — minimal change, well-guarded by existing safeguards:

- `process_reindex_queue` returns early if queue is empty (no-op fast path)
- `processing` mutex prevents concurrent execution
- Circuit breaker throttles rapid reindexing (max 5 per file per 30s)

**Complexity:** S **Category:** backend **Dependencies:** None **Files:**

- `src-tauri/src/commands/watcher.rs` — move one function call (\~3 lines changed)

**Acceptance criteria:**

- After saving a file with a new `#tag`, the tag appears in autocomplete suggestions within \~2s (watcher debounce 500ms + reindex time)
- External file changes still trigger reindex (existing behavior preserved)
- No lock contention or panics under rapid save (circuit breaker handles this)

---

### #3 — Add Rust test for reindex queue drain on self-write-only batches ✅

**Description:** Add a unit test in `src-tauri/src/index/` that verifies `process_reindex_queue` drains entries even when they originate from self-write events. This is a regression guard for the watcher→index coupling.

**Complexity:** M **Category:** backend **Dependencies:** Depends on #2 **Files:**

- `src-tauri/src/index/reindex_queue.rs` — add `#[cfg(test)]` module with queue drain test

**Acceptance criteria:**

- Test queues a reindex entry, calls `process_reindex_queue`, verifies queue is empty afterward
- Test verifies the empty-queue fast path returns immediately

---

### #4 — Wrap `reloadTrees()` in try/finally with safety timeout ✅

**Description:** In `useAppLifecycle.ts`, change the startup `useEffect` to:

1. Wrap `reloadTrees()` in a `try/finally` that always calls `setStartupReady(true)`
2. Add a `Promise.race` with a 30-second timeout — if `reloadTrees` hangs, `startupReady` is set anyway
3. Log a warning when the timeout fires so it's visible in production logs

This ensures `useSkillDiscovery()` and other startup-gated hooks always fire, even if cloud storage paths hang during tree validation.

**Complexity:** M **Category:** frontend **Dependencies:** None **Files:**

- `src/hooks/useAppLifecycle.ts` — modify the `useEffect` at line \~180 and the `reloadTrees()` function

**Acceptance criteria:**

- `startupReady` is always set within 30 seconds of app launch
- Skills and agents are discovered even if a cloud storage `listDirectory` hangs
- Normal startup (no hang) is unaffected — `startupReady` is set immediately after `reloadTrees` completes
- No console errors on normal startup

---

### #5 — Add `log.info` instrumentation to `reloadTrees()` steps ✅

**Description:** Add `log.info('startup', ...)` calls at each major step in `reloadTrees()` so hangs are diagnosable in production backend logs:

- Before/after explorer folder tree reload
- Before/after project tree reload
- Before/after iCloud detection and sync
- Before/after `refreshNotesTree()`
- Before/after index init
- On `setStartupReady(true)`
- On timeout

Currently `reloadTrees` uses `console.log('[perf:startup]')` which is NOT forwarded to the backend log. Using `log.info` ensures visibility in the Tauri log file.

**Complexity:** S **Category:** frontend **Dependencies:** Depends on #4 (modify the same function) **Files:**

- `src/hooks/useAppLifecycle.ts` — add \~8-10 `log.info` calls throughout `reloadTrees()`

**Acceptance criteria:**

- Production backend log shows step-by-step progress of startup
- A hang is identifiable by the last logged step before silence
- Normal startup shows all steps completing with timing

---

### #6 — Add per-step timeouts for cloud storage operations in `reloadTrees()` ✅

**Description:** Wrap individual `listDirectory` and `scanICloudForProjects` calls in `reloadTrees()` with per-operation timeouts (e.g., 10 seconds each). If a single cloud storage path hangs, skip it and continue rather than blocking the entire startup chain.

This is defense-in-depth on top of #4's global timeout. The global timeout ensures `startupReady`, while per-step timeouts ensure the rest of startup (index init, watchers) still completes.

**Complexity:** L **Category:** frontend **Dependencies:** Depends on #4, #5 **Files:**

- `src/hooks/useAppLifecycle.ts` — wrap cloud-facing `await` calls in `Promise.race` with per-step timeouts

**Acceptance criteria:**

- A single hanging cloud storage path doesn't block other projects from loading
- Skipped paths logged as warnings
- Projects on local disk load without timeout overhead
- Total startup time unaffected when no paths hang

---

### #7 — Manual verification: tag autocomplete after save ✅

**Description:** Verify the full tag/mention lifecycle works end-to-end after fixes #1 and #2:

1. Open a file, type a new `#newtag`, save → tag appears in autocomplete suggestions (within \~2s)
2. Open a different file, type `#` → the new tag from step 1 appears in the suggestion list
3. Type `@newmention`, save → mention appears in `@` autocomplete
4. Verify tags in multi-tag paragraphs all have correct rounded corners and spacing
5. Verify date badges (`//2026-04-07`) have correct rounding

**Complexity:** S **Category:** both **Dependencies:** Depends on #1, #2 **Files:** None (manual testing)

**Acceptance criteria:**

- All five verification steps pass
- No visual regressions in badge rendering

---

### #8 — Manual verification: startup with cloud storage paths ✅

**Description:** Verify that startup completes and skills/agents load on a machine with cloud storage projects (iCloud, OneDrive). If no cloud storage machine is available, simulate by adding a non-existent path to `workspace-store` explorer folders and verifying the app still starts and discovers skills.

1. Launch app with projects on cloud storage
2. Verify `startupReady` is set (skills and agents appear in settings)
3. Verify bundled skills extracted to `~/.notesage/skills/`
4. Verify agent picker shows bundled agents
5. Verify chat tools count includes skill-derived tools
6. Check backend log for startup step instrumentation from #5

**Complexity:** M **Category:** both **Dependencies:** Depends on #4, #5, #6 **Files:** None (manual testing)

**Acceptance criteria:**

- Skills and agents visible even if a cloud path is slow
- Backend log shows complete startup trace
- No startup regression on machines without cloud storage