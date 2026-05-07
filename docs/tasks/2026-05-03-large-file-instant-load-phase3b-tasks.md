# Large File Instant Load — Phase 3b Tasks

|  |  |
| --- | --- |
| **Date** | 2026-05-06 |
| **Status** | Not started |
| **PRD** | [large-file-instant-load](../prds/2026-05-03-large-file-instant-load.md) |
| **Phase** | 3b of 4 — Render-output cache + in-memory state cache (replaces reverted Phase 3) |
| **Total** | 22 tasks across 6 milestones |
| **Complexity mix** | \~10 S, \~10 M, \~2 L |
| **Suggested order** | M3b.1 Skip-preview rule (#1) → M3b.2 In-memory state cache + LRU (#2 → #3 → #4 → #5) → M3b.3 Pre-warm (#6 → #7 → #8) → M3b.4 IDB viewport cache foundation (#9 → #10 → #11 → #12) → M3b.5 Viewport cache integration + swap (#13 → #14 → #15 → #16) → M3b.6 Edit-A overlay (#17 → #18) → M3b.7 Settings + tests + measurement (#19 → #20 → #21 → #22) |

## Scope

Phase 3b replaces the reverted Phase 3 disk-cache approach with a five-layer architecture that addresses the actual user-felt perf gaps:

- **In-session repeat opens** (Recent / Pinned switching): instant via in-memory `EditorState` cache (Layer 2b)
- **Cold app start of frequently-opened docs**: instant via IndexedDB viewport cache (Layer 3b) + background pre-warm (Layer 4b)
- **Small files**: no preview flicker (Layer 1b skip-preview rule, threshold = 50 KB)
- **Loading UX during background hydration**: unobtrusive Edit-A overlay (Layer 5b)

The 506 KB book's 4.4 s `setContent(json)` DOM materialize floor is **accepted as unaddressable** within this PRD's scope. Phase 3b makes the wait invisible (cached HTML on screen from t&lt;50ms) rather than trying to remove it.

Targets **Quiet Composer**. The single-document shell makes integration points clear: extend `useEditorTabSwitch.ts`, hook into `cachedEditorStatesRef`, add background workers in `App.tsx` lifecycle.

## Honest expectation note (read first)

Phase 3b is a **layered win**:

- **Small / medium files (10-300 KB):** repeat opens AND cold-start opens go to <100 ms. The PRD's "instant" promise lands here.
- **506 KB book:** **First paint goes to <50 ms** (cached viewport HTML mounts statically). Full editor hydration still pays the 4.4 s background cost. Click → readable: <50 ms. Click → editable: ~5 s but invisible because the user has been reading. Subjective UX should feel "instant" because the user perceives readability as the goal, not edit-readiness.

The 4.4 s background hydration is the same DOM materialize floor we hit in Phase 2 / Phase 3. **Solving it requires streaming setContent or virtual scrolling — both out of scope.** Phase 3b lives with it gracefully via the cached viewport.

## Execution notes

- **Comrak preview survives**, but only for two narrow scenarios: external-change reloads of 50 KB+ files and first-ever opens of 50 KB+ files. Daily workflow for the user (book + recents + pinned) never invokes it.
- **No user-facing settings.** One diagnostic-only "Clear viewport cache" button under Settings > Advanced. All thresholds (50 KB skip-preview, 200 MB state cache cap, top-5 pre-warm scope, viewport ± 1 viewport capture) are internal.
- **Schema fingerprint discipline** (already in worker-extensions.ts post-revert): bump `CACHE_SCHEMA_VERSION` whenever extension shapes change. Regression-watch test forces awareness.
- **Edit-A overlay only fires for hydration > 500 ms** so small-file users never see it.
- **Pre-warm uses the existing 4-6 s tree-validation window** that's currently idle. No new perceived latency at startup.

## Risks and open questions

- **EditorState memory cost.** A 506 KB book's `EditorState` is ~10–15 MB in memory (ProseMirror nodes + history + decorations). 5–15 docs cached = 50–225 MB peak. Bounded by 200 MB LRU cap; on cap exceedance, evict least-recent. Acceptable on the user's M3 / 24 GB machine; should be communicated as the cache's hard limit.
- **Viewport HTML capture cost.** Walking ~100 DOM nodes and serializing to HTML on save / 5 s idle is sub-50 ms. Negligible.
- **IndexedDB quota.** WKWebView's IDB is generous (50% of disk). 50 MB hard cap on the cache, well under any realistic quota.
- **Scroll-precision on swap.** Mounting cached HTML at exact scroll position is straightforward (set `scrollTop`). Swapping to live editor at the SAME visual position is the risk: ProseMirror's UniqueID assignments differ between cached HTML and re-parsed JSON, so node-ID-based scroll restore won't work. Solution: swap by scroll-position, not node ID. May see 1–2 px jump on swap; acceptable.
- **Decoration pop-in.** Cached HTML lacks tag pills, mention pills, comment highlights (those are runtime decorations, not in the captured HTML). They appear when the editor hydrates — visible "settling" effect. Acceptable trade-off; users see text first, decorations join in.
- **mtime fidelity on iCloud.** iCloud sync can update mtime without content changes. Could cause spurious cache misses → harmless re-parse. If it becomes annoying, add content-hash fallback.
- **Cache poisoning.** A bad cached HTML entry could render incorrectly on every cold start. Mitigation: schema-fingerprint key change forces invalidation; also the "Clear viewport cache" button.

---

## M3b.1 Skip-preview rule for small files (1 task)

### #1 — 50 KB skip-preview gate in `useEditorTabSwitch`

| Field | Value |
| --- | --- |
| Description | In `useEditorTabSwitch.ts`, before kicking off `tauriApi.renderMarkdownPreview`, check `byteLength(activeTab.content) < 50 * 1024`. If true, skip the preview surface entirely and go straight to the worker (`parseInWorker`). Worker output flows into `loadParsedJsonIntoEditor` as today. No `setPreview()` call, no preview HTML, no swap — just direct editor mount. Add a perf log line `[perf:tab-switch] "Skip-preview (small file)" { sizeKB }` so the choice is visible in measurement. |
| Complexity | S |
| Category | frontend |
| Depends on | none |
| Files | `src/hooks/useEditorTabSwitch.ts` |

---

## M3b.2 In-memory state cache + LRU eviction (4 tasks)

### #2 — Path-keyed state cache module

| Field | Value |
| --- | --- |
| Description | New `src/lib/editor-state-cache.ts` exports a small singleton class with `get(filePath)`, `set(filePath, state, byteSize)`, `delete(filePath)`, `has(filePath)`, `clear()`, and `peek()` (non-mutating LRU view). Internal LRU using a `Map` (insertion-order iteration is LRU-compatible since JS Maps preserve order). Tracks total bytes; on `set`, evicts oldest until total &lt; 200 MB cap. State byte-size is a heuristic (`ProseMirror node count × 1024`); good enough for budgeting. |
| Complexity | M |
| Category | frontend |
| Depends on | none |
| Files | `src/lib/editor-state-cache.ts` (new), `src/lib/__tests__/editor-state-cache.test.ts` (new) |

### #3 — Wire path-keyed cache into `useEditorTabSwitch`

| Field | Value |
| --- | --- |
| Description | Extend the existing `cachedEditorStatesRef` (tab-id-keyed) flow. ON `closeTab` (or just before tab is dropped from openDocuments), copy the state into the new path-keyed cache. ON tab activation, before any other path, check the path-keyed cache: if hit AND mtime matches (cheap stat via `tauriApi.path_exists` extended OR a new lightweight `get_mtime` command), call `editor.view.updateState(cachedState)` — same flow as today's tab-id cache hit. Log `[perf:tab-switch] "restore: state-cache (path)"`. |
| Complexity | M |
| Category | frontend |
| Depends on | #2 |
| Files | `src/hooks/useEditorTabSwitch.ts`, possibly `src-tauri/src/commands/file.rs` (if new mtime command needed) |

### #4 — mtime-aware invalidation

| Field | Value |
| --- | --- |
| Description | Add a `get_file_mtime(path)` Tauri command that returns the filesystem mtime as ISO string OR Unix timestamp. Frontend stores mtime alongside cached state. On lookup: if file mtime differs from cached mtime, drop the entry and fall through. Piggyback on the existing `external-change-watcher`: when watcher fires for a path, also drop that path's state cache entry. |
| Complexity | M |
| Category | backend + frontend |
| Depends on | #2, #3 |
| Files | `src-tauri/src/commands/file.rs`, `src/lib/editor-state-cache.ts`, `src/hooks/useFileWatcher.ts` |

### #5 — Unit tests for the state cache

| Field | Value |
| --- | --- |
| Description | Cover: `get` / `set` / `delete` round-trip, LRU eviction at byte cap (insert 250 MB worth, verify oldest evicted), mtime invalidation (set entry with mtime A, lookup with mtime B → miss), `clear` empties everything, `peek` doesn't promote LRU position. |
| Complexity | S |
| Category | test |
| Depends on | #2 |
| Files | `src/lib/__tests__/editor-state-cache.test.ts` |

---

## M3b.3 Background pre-warm at app start (3 tasks)

### #6 — Background worker pool for parsing

| Field | Value |
| --- | --- |
| Description | New `src/lib/markdown-prewarm.ts` exposes `prewarmFiles(paths: string[]): Promise<void>`. Reads each file, runs through `parseInWorker` (existing Phase 2 worker bridge), and writes the resulting `EditorState` into the path-keyed cache (#2). Uses `Promise.allSettled` so one failure doesn't kill the batch. Bounded concurrency: max 2 workers in flight at once (avoid CPU contention with tree validation). Each completion fires a `[perf:prewarm]` log line. |
| Complexity | M |
| Category | frontend |
| Depends on | #2, #3 |
| Files | `src/lib/markdown-prewarm.ts` (new), `src/lib/__tests__/markdown-prewarm.test.ts` (new) |

### #7 — Identify pre-warm candidates (top-5 Recents + all Pinned)

| Field | Value |
| --- | --- |
| Description | Helper function `getPrewarmCandidates(): string[]` that reads from the existing recent-files store (`tray-recents.ts` or wherever MRU lives) and the pinned-files store (`quiet-sidebar` pinned section). Returns up to 5 most-recent + all pinned, deduplicated, only paths that exist on disk. Cap at maybe 10 total to bound memory. |
| Complexity | S |
| Category | frontend |
| Depends on | #6 |
| Files | `src/lib/markdown-prewarm.ts` |

### #8 — Hook pre-warm into app lifecycle

| Field | Value |
| --- | --- |
| Description | In `useAppLifecycle.ts` (the lifecycle hook mounted from `App.tsx`), after the existing tree-validation kick-off, immediately call `prewarmFiles(getPrewarmCandidates())` without awaiting. Pre-warm runs in parallel with tree validation, finishes when it finishes. Log `[perf:prewarm] "started"` and `[perf:prewarm] "complete" { count, elapsedMs }`. NO BLOCKING — `startupReady` flag must not depend on pre-warm completion. |
| Complexity | S |
| Category | frontend |
| Depends on | #6, #7 |
| Files | `src/hooks/useAppLifecycle.ts` |

---

## M3b.4 IndexedDB viewport cache foundation (4 tasks)

### #9 — IDB schema + access layer

| Field | Value |
| --- | --- |
| Description | New `src/lib/viewport-cache.ts`. Uses native `indexedDB` API (no `idb-keyval` dep — keep dependency footprint small). One object store `viewport-cache` with key shape `${filePath}|${mtime}|${schemaHash}` and value `{ html: string, scrollY: number, capturedAt: number, byteSize: number }`. Module exports `getCachedViewport(key)`, `setCachedViewport(key, entry)`, `deleteCachedViewport(key)`, `clearAllCached()`, `getCacheStats()` (for the diagnostic Settings button). All ops async. |
| Complexity | M |
| Category | frontend |
| Depends on | none |
| Files | `src/lib/viewport-cache.ts` (new), `src/lib/__tests__/viewport-cache.test.ts` (new) |

### #10 — IDB hard-limit + LRU eviction

| Field | Value |
| --- | --- |
| Description | Track total `byteSize` across all cached entries. On `setCachedViewport`, if total + new entry would exceed 50 MB cap, delete oldest entries (by `capturedAt`) until under the limit. Atomic via IDB transaction. `getCacheStats()` returns `{ totalBytes, entryCount }` for the Settings button. |
| Complexity | M |
| Category | frontend |
| Depends on | #9 |
| Files | `src/lib/viewport-cache.ts` |

### #11 — Capture viewport HTML helper

| Field | Value |
| --- | --- |
| Description | New helper in `src/lib/viewport-cache.ts`: `captureViewportHTML(editor: Editor, scrollAreaEl: HTMLDivElement): { html: string, scrollY: number, byteSize: number }`. Uses `editor.view.dom` to get the rendered DOM, computes which nodes are in the viewport (visible scroll range ± 1 viewport height above and below), serializes those nodes' `outerHTML`. Returns the HTML string + current scrollTop + byte size. Sub-50 ms target for ~100 nodes. |
| Complexity | M |
| Category | frontend |
| Depends on | #9 |
| Files | `src/lib/viewport-cache.ts` |

### #12 — Capture trigger: save + idle

| Field | Value |
| --- | --- |
| Description | In `useEditorTabSwitch.ts` (or a new sibling `useViewportCacheCapture.ts`): subscribe to `editor.on('update', ...)` debounced to 5 s of idle for capture. Also capture on document save (hook into `useFileOperations.saveFile`). Both call `captureViewportHTML(editor, scrollAreaRef.current)` then `setCachedViewport(key, entry)` async (fire-and-forget). Skip capture when `editor` is null / state empty / file size below skip-preview threshold (no point caching what we don't preview). |
| Complexity | M |
| Category | frontend |
| Depends on | #9, #10, #11 |
| Files | `src/hooks/useEditorTabSwitch.ts` OR `src/hooks/useViewportCacheCapture.ts` (new) |

---

## M3b.5 Viewport cache integration + swap (4 tasks)

### #13 — Cache lookup before preview path

| Field | Value |
| --- | --- |
| Description | In `useEditorTabSwitch.ts`'s big useEffect, AFTER the in-memory state cache check (#3) and BEFORE the comrak preview path: compute `key = ${filePath}|${mtime}|${schemaHash}`, call `getCachedViewport(key)`. On hit: mount the cached HTML inside a new wrapper component (#14), set scrollTop, fire perf log `[perf:tab-switch] "Viewport cache hit"`, kick off background hydration (#15). On miss: existing comrak preview path. |
| Complexity | M |
| Category | frontend |
| Depends on | #9, #11 |
| Files | `src/hooks/useEditorTabSwitch.ts` |

### #14 — `<ViewportCacheMount>` wrapper component

| Field | Value |
| --- | --- |
| Description | New `src/components/editor/ViewportCacheMount.tsx`. Receives `{ html: string, scrollY: number, isHydrating: boolean }`. Renders the HTML inside a `<div class="ProseMirror viewport-cache-mount">` so all `editor.css` selectors apply for byte-identical CSS. Sets scrollTop after mount. Renders nothing (transparent) once `isHydrating` flips false (i.e., real editor takes over). Forward ref so parent can scroll-restore the live editor to the same position. |
| Complexity | M |
| Category | frontend |
| Depends on | #13 |
| Files | `src/components/editor/ViewportCacheMount.tsx` (new) |

### #15 — Background hydration on cache hit

| Field | Value |
| --- | --- |
| Description | When viewport cache hits (#13), kick off the worker parse (`parseInWorker`) in parallel — same as cache miss but WITHOUT the comrak preview render. When worker resolves, `loadParsedJsonIntoEditor(editor, ...)` runs — this triggers the 4.4 s DOM materialize on the book, but the user is already reading the cached viewport so it's invisible. After hydration, fire a perf log line `[perf:tab-switch] "Hydration complete after viewport cache"` with elapsed. |
| Complexity | M |
| Category | frontend |
| Depends on | #13, #14 |
| Files | `src/hooks/useEditorTabSwitch.ts` |

### #16 — Swap from cached HTML to live editor

| Field | Value |
| --- | --- |
| Description | When the worker resolves and the editor is hydrated, swap the `<ViewportCacheMount>` for the real editor. Use the existing `deferPastPaint` (rAF×2) mechanism to ensure the cached HTML stays visible until the editor is fully painted. After swap, restore scroll-position by `scrollTop` value (NOT by node ID — UniqueIDs differ between captures). Tolerate 1–2 px jump as documented in the PRD. Verify in E2E test (#21). |
| Complexity | L |
| Category | frontend |
| Depends on | #14, #15 |
| Files | `src/hooks/useEditorTabSwitch.ts`, `src/components/editor/ViewportCacheMount.tsx` |

---

## M3b.6 Edit-A overlay (2 tasks)

### #17 — Overlay component

| Field | Value |
| --- | --- |
| Description | New `src/components/editor/EditAOverlay.tsx`. Small badge near the top of the editor area, accent-colored border, slides in with 200 ms ease. Shows `"Editor loading… (Xs)"` with a count-up timer. Sits at z-index above the cached HTML mount but below modals. Reduces motion when `prefers-reduced-motion: reduce`. Reused design pattern from local-AI startup indicator. |
| Complexity | S |
| Category | frontend |
| Depends on | none |
| Files | `src/components/editor/EditAOverlay.tsx` (new) |

### #18 — Wire overlay into hydration flow

| Field | Value |
| --- | --- |
| Description | When viewport cache is mounted AND the user clicks/types in the editor area before hydration completes: show `<EditAOverlay>`. Threshold: if hydration is expected to complete in &lt;500 ms (heuristic based on file size: &lt;50 KB never shows overlay), suppress the overlay entirely. On hydration complete: hide overlay, focus the live editor, position cursor at the click location (or end-of-doc if no specific click). Buffered keystrokes during loading: NOT supported in v1 (user types again after editor is ready). |
| Complexity | M |
| Category | frontend |
| Depends on | #14, #16, #17 |
| Files | `src/hooks/useEditorTabSwitch.ts`, `src/components/editor/EditAOverlay.tsx` |

---

## M3b.7 Settings + tests + measurement gate (4 tasks)

### #19 — "Clear viewport cache" Settings button

| Field | Value |
| --- | --- |
| Description | In `src/components/settings/v2/SystemSettings.tsx`, add a "Performance" SettingsGroup before "Diagnostics" with a single destructive `Button` + AlertDialog confirmation. On confirm, calls `clearAllCached()` from #9, shows toast `Cleared {N} cached viewport entries ({size} MB)`. Description text honest about what it does: "Notesage caches a small render of recently-edited documents to make repeat opens instant. Clearing forces re-rendering on the next open of each file." Diagnostic-only — most users never need this. |
| Complexity | S |
| Category | frontend |
| Depends on | #9, #10 |
| Files | `src/components/settings/v2/SystemSettings.tsx` |

### #20 — Unit tests for cache + capture flow

| Field | Value |
| --- | --- |
| Description | Vitest tests covering: `viewport-cache.ts` (round-trip, key derivation, LRU eviction at byte cap, mtime mismatch returns null), `editor-state-cache.ts` (already covered in #5), `markdown-prewarm.ts` (concurrency cap, fail-tolerant batch), `captureViewportHTML` (returns valid HTML string for a known editor state). Mock `indexedDB` via `fake-indexeddb` package (small dev dep, well-maintained). |
| Complexity | M |
| Category | test |
| Depends on | #2, #6, #9, #11 |
| Files | `src/lib/__tests__/viewport-cache.test.ts`, `src/lib/__tests__/markdown-prewarm.test.ts` |

### #21 — E2E test: cold start hits viewport cache

| Field | Value |
| --- | --- |
| Description | Extend `e2e/tests/preview-fidelity.spec.ts` with a new "Phase 3b — viewport cache" describe block. Test: open a fixture file, wait for hydration, save (triggers capture), close tab. Restart the app context (clear in-memory state but preserve IDB). Open the same file. Assert: (a) viewport cache hit fires (perf log line), (b) `render_markdown_preview` IPC is NOT called, (c) first-paint time &lt;200 ms even on the larger fixture. |
| Complexity | M |
| Category | test |
| Depends on | #13, #14, #15, #16 |
| Files | `e2e/tests/preview-fidelity.spec.ts`, `e2e/fixtures/tauri-mock.ts` (extend with IDB mock if needed) |

### #22 — Measurement gate + PRD update

| Field | Value |
| --- | --- |
| Description | DevTools Timeline recordings on the user's 506 KB book: (a) cold start with empty cache, (b) cold start with viewport cache populated (after one prior open + save), (c) in-session repeat switch via state cache. Update `docs/performance-baseline.md` with new entry "2026-MM-DD — Phase 3b (Viewport cache + state cache)". Update PRD's quality-gate section: tick Layer 1b, 2b, 3b, 4b, 5b boxes with measured numbers. **USER ACTION** for the recordings. |
| Complexity | S |
| Category | perf (USER) + docs |
| Depends on | all |
| Files | `docs/performance-baseline.md`, `docs/prds/2026-05-03-large-file-instant-load.md`, this task file |
