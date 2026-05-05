# Large File Instant Load — Phase 2 Tasks

|  |  |
| --- | --- |
| **Date** | 2026-05-05 |
| **Status** | Not started |
| **PRD** | [large-file-instant-load](../prds/2026-05-03-large-file-instant-load.md) |
| **Phase** | 2 of 4 — Web Worker hydration (Layer 2) |
| **Total** | 25 tasks across 6 milestones |
| **Complexity mix** | \~10 S, \~12 M, \~3 L |
| **Suggested order** | M2.1 Worker scaffolding (#1 → #2 → #3 → #4) → M2.2 Preprocessing audit + port (#5 → #6 → #7 → #8) → M2.3 Schema in worker (#9 → #10) → M2.4 Main-thread integration (#11 → #12 → #13 → #14 → #15) → M2.5 Edit-A overlay (#16 → #17 → #18) → M2.6 Tests + perf (#19 → #20 → #21 → #22) → M2.7 Measurement gate (#23 → #24 → #25) |

## Scope

Phase 2 of the three-layer architecture. Phase 1 delivered an instant first paint via a comrak HTML preview; Phase 2 attacks the remaining 4.5–5.1 s `animation-frame-fired` parse block that freezes the entire app while the editor hydrates. The whole markdown→ProseMirror JSON pipeline moves to a Web Worker so the main thread stays at 60 fps the entire time.

The user-visible win: Phase 1 made content paint fast; Phase 2 makes the app *responsive* during hydration. Scrolling, sidebar interaction, find/replace, command bar, theme toggle — all keep working while the worker chews through the 506 KB book in the background.

Phase 2 targets **Quiet Composer** (single-document shell). Internal symbols like `useEditorTabSwitch` still carry the legacy "tab" name but only ever handle one active document at a time in this shell.

## Execution notes

- **The hard task is #9** (Tiptap schema in worker). Worth a deep-dive before starting #5 — if the schema can't cleanly construct in a worker (extension imports touch DOM at module load, etc.), the architecture pivots: chunked main-thread parse via `setTimeout(0)` between batches.
- **`postMessage` cloning is the natural cancellation point.** Single-document Quiet Composer means at most ONE in-flight parse at any time. If the user opens a different doc, the worker keeps running but the bridge ignores the orphaned result. Don't terminate the worker — terminate-and-respawn is more expensive than a stale message.
- **Plugin init storm is out of scope.** The ~1.85 s `microtask-dispatched` task that runs after `setContent(json)` is the editor's plugin re-initialisation (table-aggregation walking 952 rows, decoration plugins rebuilding, etc.). Phase 2 doesn't touch it. If post-Phase-2 measurements show this as the dominant remaining blocker, file a follow-up PRD for plugin lazy-init (currently § Out of Scope in the parent PRD).
- **Don't regress small files.** The worker has spawn + message-passing overhead. Below some threshold (TBD in Phase 4), the worker path is net-negative vs direct main-thread parse. Phase 2 must NOT regress 10 KB / 100 KB load times. M2.6 includes a regression-watch perf benchmark.
- **Round-trip parity is the merge gate.** Worker output and main-thread output for the same markdown must produce byte-identical ProseMirror JSON. #19 locks this in.
- **Performance target.** PRD § "Performance Targets" says 500 KB editable in <10 s post-Phase-2. Pre-Phase-2 baseline is ~7 s click-to-editable; Phase 2 doesn't aim to make it faster, it aims to make it *responsive* during those ~7 s. The metric to move is main-thread frame chart, not total time.

## Risks and open questions

- **Tiptap extension worker-safety (#9).** Some Tiptap extensions import React or DOM-touching utilities at module load. ~20 extensions in the editor; need to identify a worker-safe schema-defining subset. The plugin-driven extensions (search-highlight, comment-mark, AI suggestion, tag-highlight, etc.) are decoration plugins that don't define schema nodes — they can stay main-thread-only without affecting the worker's parse.
- **Sidecar resolution timing (#8).** Drawing `.excalidraw.svg` and chart sidecar reads happen via Tauri IPC today (main-thread only). Worker can't read files. Decision: emit placeholder nodes from worker; main thread resolves sidecars after `setContent`. Same UX gap the preview already has, kept consistent.
- **JSON serialization size.** A 506 KB markdown produces ~1 MB ProseMirror JSON. `postMessage` structured cloning is fast but not free. Probably fine at 1 MB; if cloning is >100 ms in measurements, switch to transferable objects or share the doc via SharedArrayBuffer.
- **Worker debug ergonomics in WKWebView.** Source maps in workers can be flaky. If debugging gets painful, fall back to inlining the worker via Vite's `inline=worker` option (slower spawn, easier source maps). Not a blocker.
- **Edit-A overlay UX.** PRD specifies "Loading editor (Xs)…" with a determinate progress bar driven by worker progress events. Worker emits `progress` events for `preprocess` / `parse` / `finalize` stages, each `0..1`. Overlay shows max of all stages. If progress events are too granular or jittery, fall back to elapsed-seconds counter.
- **Cancellation race.** Single-document means at most one in-flight parse, BUT a rapid document-switch (open A → open B before A's worker returns) can produce orphan results. The bridge must check "is this result for the *currently active* document?" before applying. Already specified in #14 — flagging as a place that's easy to subtly get wrong.

---

## M2.1 Worker scaffolding (4 tasks)

### #1 — Worker file + Vite `?worker` import

| Field | Value |
| --- | --- |
| Description | Create `src/workers/markdown-parse.worker.ts` as a plain ES module (no React, no DOM imports). Initial content is a stub that posts a "ready" message on load. Import in `markdown-worker.ts` (M2.1 #3) via `new MarkdownParseWorker()` from a `?worker` URL import — Vite's first-class worker support, no separate build config needed. Smoke-test: console.log on receive, console.log on post-receive. |
| Complexity | S |
| Category | frontend |
| Depends on | none |
| Files | `src/workers/markdown-parse.worker.ts` (new) |

### #2 — Message protocol types

| Field | Value |
| --- | --- |
| Description | Create `src/workers/markdown-parse.types.ts` with the discriminated unions from PRD § "Worker message protocol": `ParseRequest`, `ParseProgress`, `ParseResult`, `ParseError`. Each carries a correlation `id: string` (UUID) so multiple in-flight parses can be tracked at the protocol level even though Quiet Composer has only one active doc. Worker imports types from this file; main-thread bridge imports them too. |
| Complexity | S |
| Category | frontend |
| Depends on | none |
| Files | `src/workers/markdown-parse.types.ts` (new) |

### #3 — Main-thread bridge

| Field | Value |
| --- | --- |
| Description | New `src/lib/markdown-worker.ts` exporting `parseInWorker(markdown, projectRoot, opts?: { onProgress })`. Returns `Promise<ParseResult>`. Internally manages a singleton worker instance, a correlation-id map of pending parses, and an `AbortController`-style cancellation. Cancellation strategy: don't terminate the worker, just remove the id from the map so any future message for that id is dropped. Worker keeps running (orphan parse), main thread doesn't care. |
| Complexity | M |
| Category | frontend |
| Depends on | #1, #2 |
| Files | `src/lib/markdown-worker.ts` (new), worker types from #2 |

### #4 — Worker lifecycle

| Field | Value |
| --- | --- |
| Description | Lazy-spawn the worker on first `parseInWorker()` call. Reuse the same instance for the app's lifetime. Vite's HMR + dev preserves the worker across hot reloads (verify). On app exit, the worker auto-terminates with the page unload — no explicit cleanup needed. Add a `terminateWorker()` escape hatch for tests. |
| Complexity | S |
| Category | frontend |
| Depends on | #3 |
| Files | `src/lib/markdown-worker.ts` |

---

## M2.2 Preprocessing audit + port (4 tasks)

### #5 — Audit each preprocessing function for DOM access

| Field | Value |
| --- | --- |
| Description | Read `src/lib/markdown.ts` end-to-end. For each preprocessing function — callouts, mermaid blocks, charts, drawings, page breaks, link previews, TOC, image paths, data URIs, sparklines, dynamic table metadata, custom syntax, tag/mention/date pre-decorators (the 13 from PRD § Problem) — classify as "worker-safe" (pure string→string) or "main-thread" (touches `document` / `window` / Tauri IPC / browser-only APIs). Document the audit inline as JSDoc tags on each function (`@workerSafe` / `@mainThreadOnly`). Output: a written audit table with classifications + reasoning, committed alongside the code. |
| Complexity | M |
| Category | research/frontend |
| Depends on | none |
| Files | `src/lib/markdown.ts` (annotations only; no behaviour change) |

### #6 — Extract worker-safe preprocessors to shared module

| Field | Value |
| --- | --- |
| Description | Move the pure-string preprocessors identified in #5 into `src/lib/markdown-preprocess-pure.ts`. Both main-thread (current `loadRawMarkdownIntoEditor` chain) and worker import from this module. No behaviour change for the main-thread path — it still calls the same functions, just via the new module. Tests pass unchanged. |
| Complexity | M |
| Category | frontend |
| Depends on | #5 |
| Files | `src/lib/markdown-preprocess-pure.ts` (new), `src/lib/markdown.ts` (re-exports), preprocessor tests |

### #7 — Keep DOM-dependent preprocessors on main thread

| Field | Value |
| --- | --- |
| Description | For each main-thread-only function from #5, run it BEFORE posting markdown to the worker. The worker receives partially-preprocessed markdown. Document the contract clearly in the worker bridge (`markdown-worker.ts`): "input to the worker is markdown that has already had `prepareImagePaths`, `resolveMermaidBlocks`, etc., applied on the main thread." Include the list in the JSDoc. |
| Complexity | S |
| Category | frontend |
| Depends on | #5, #6 |
| Files | `src/lib/markdown-worker.ts`, `src/lib/markdown.ts` |

### #8 — Sidecar resolution decision (placeholders during hydration)

| Field | Value |
| --- | --- |
| Description | Drawing `.excalidraw.svg` and chart sidecar JSON files are read via Tauri IPC. Worker can't run Tauri commands. Decision: worker emits placeholder ProseMirror nodes (drawing/chart node with empty `data` attr); main thread resolves sidecars from disk and patches the doc AFTER `setContent`. Same UX gap the comrak preview already has — drawings/charts pop in once the editor takes over. Document in PRD § "Fidelity gaps to manage" + inline comment in `markdown-parse.worker.ts`. |
| Complexity | M |
| Category | frontend |
| Depends on | #5 |
| Files | `src/workers/markdown-parse.worker.ts`, `src/lib/markdown-worker.ts`, post-hydrate sidecar resolution helper |

---

## M2.3 Schema construction in worker (2 tasks)

### #9 — Tiptap schema in worker (HIGH RISK)

| Field | Value |
| --- | --- |
| Description | The worker needs Tiptap's `Schema` to feed `prosemirror-markdown`'s parser. Tiptap's `getSchema(extensions)` constructs a Schema from an extensions array. Audit the existing extension imports in `useEditor.ts`: which can run at module-load time in a worker (no DOM imports)? Build a worker-only extensions array — `src/workers/worker-extensions.ts` — that includes only the schema-defining extensions (heading, paragraph, list, blockquote, code-block, table, image, drawing, chart, callout, link-preview, mermaid, page-break, etc.). Exclude plugin-driven extensions (search-highlight, comment-mark, AI suggestion, tag-highlight, mention-highlight, date-highlight, table-aggregation, table-sort, table-filter, table-sparkline, send-to-ai, etc.) — they're decoration plugins that don't define schema nodes, so omitting them from the worker doesn't change the parsed JSON. **High-risk task** — if any required schema-defining extension imports React/DOM, vendor a minimal Tiptap-extension-shim. Worst-case fallback: chunked main-thread parse via `setTimeout(0)` between batches. |
| Complexity | L |
| Category | frontend |
| Depends on | #5 |
| Files | `src/workers/worker-extensions.ts` (new), `src/workers/markdown-parse.worker.ts` |

### #10 — Worker parse + JSON output

| Field | Value |
| --- | --- |
| Description | Wire it together. Worker receives `ParseRequest{ markdown, projectRoot? }` → runs pure preprocessors from #6 → constructs a `Schema` via #9's worker-extensions → uses prosemirror-markdown's parser to produce a ProseMirror Node → calls `node.toJSON()` → posts back as `ParseResult{ doc, tableMetadata, nodeIds, annotations, timings }`. Emit `ParseProgress` messages at the preprocess/parse/finalize stage boundaries. Total `timings` field captures all three stages for the perf benchmark. |
| Complexity | M |
| Category | frontend |
| Depends on | #6, #9 |
| Files | `src/workers/markdown-parse.worker.ts` |

---

## M2.4 Main-thread integration (5 tasks)

### #11 — `loadParsedJsonIntoEditor` helper

| Field | Value |
| --- | --- |
| Description | Sibling to existing `loadRawMarkdownIntoEditor` in `src/lib/markdown.ts`. Takes pre-parsed JSON (via `editor.commands.setContent(json, false)`). Same `addToHistory: false` flag — bypasses the Delete extension and skips the markdown serialize debounce, just like `loadRawMarkdownIntoEditor` does. Replaces the parse step entirely on the worker path. |
| Complexity | S |
| Category | frontend |
| Depends on | none |
| Files | `src/lib/markdown.ts` |

### #12 — Replace fresh-parse path in `useEditorTabSwitch`

| Field | Value |
| --- | --- |
| Description | Currently the deferred-preview path inside `useEditorTabSwitch` calls `loadRawMarkdownIntoEditor(editor, content)` after the rAF×2. Replace with: `parseInWorker(content, projectPath, { onProgress: ... })` → on result, `loadParsedJsonIntoEditor(editor, json)` + sidecar resolution from #8. Preview surface stays on screen until JSON arrives + `setContent` runs + `setPreviewState("hydrated")`. Cache hits and external-change reloads still take the synchronous path — only fresh markdown parses go through the worker. |
| Complexity | M |
| Category | frontend |
| Depends on | #3, #10, #11 |
| Files | `src/hooks/useEditorTabSwitch.ts`, `src/lib/markdown.ts` |

### #13 — Scroll position preservation across the swap

| Field | Value |
| --- | --- |
| Description | Capture `scrollAreaRef.current.scrollTop` BEFORE `setContent`. Restore AFTER. Existing `restoreScrollRatio` handles per-file persistence; this is the in-the-moment swap. Foundation for "no scroll-position shift" PRD acceptance criterion. The preview and editor share the same `scrollAreaRef`, so scrollTop survives across the child swap automatically — but capture/restore is belt-and-braces in case `setContent` itself mutates scroll. |
| Complexity | S |
| Category | frontend |
| Depends on | #12 |
| Files | `src/hooks/useEditorTabSwitch.ts` |

### #14 — Cancellation on document switch

| Field | Value |
| --- | --- |
| Description | If the user opens a different document while a worker parse is in flight, abort: ignore the worker's eventual result. Quiet Composer's `openTab` evicts the previous document, so the in-flight parse becomes orphaned — its result will arrive but the document no longer exists in `openDocuments`. The bridge in `markdown-worker.ts` checks "does this document still exist + is it still active?" before applying the result. Don't terminate the worker — orphan-then-discard is cheaper than terminate-and-respawn. New document activation kicks off its own worker parse via the existing useEffect chain. |
| Complexity | M |
| Category | frontend |
| Depends on | #3, #12 |
| Files | `src/lib/markdown-worker.ts`, `src/hooks/useEditorTabSwitch.ts` |

### #15 — Fallback to main-thread parse on worker error

| Field | Value |
| --- | --- |
| Description | If the worker errors (crash, schema construction failure, oversized message, throws inside parse), catch the `ParseError` message and fall through to legacy `loadRawMarkdownIntoEditor`. Log `[perf:tab-switch] worker-fallback {reason}` so the diagnostic trail is preserved. User-facing: a brief "Loaded with fallback parser" toast may be appropriate if errors are persistent — defer until measurements show how often it happens. |
| Complexity | S |
| Category | frontend |
| Depends on | #12 |
| Files | `src/hooks/useEditorTabSwitch.ts`, `src/lib/markdown-worker.ts` |

---

## M2.5 Edit-A overlay (3 tasks)

### #16 — Capture clicks/keystrokes on preview during hydration

| Field | Value |
| --- | --- |
| Description | While `previewState === "ready"` and a worker parse is in flight, intercept `keydown`, `mousedown`, `paste`, `input` events on the `<MarkdownPreview>` surface in capture phase. Don't let them reach the (hidden) editor. On capture, dispatch a "user wants to edit" signal to a new `editorHydrationStore` (or a ref). The overlay reads this signal. |
| Complexity | S |
| Category | frontend |
| Depends on | #12 |
| Files | `src/components/editor/MarkdownPreview.tsx`, possible `src/stores/editor-hydration-store.ts` (new) or ref-based |

### #17 — Loading overlay component

| Field | Value |
| --- | --- |
| Description | New `src/components/editor/EditorHydratingOverlay.tsx` — small frosted-glass card centered over the preview when the user has tried to edit during hydration. "Loading editor (Xs)…" with elapsed-seconds counter. Optional determinate progress bar driven by `ParseProgress` events from the worker (max of preprocess/parse/finalize stages). Follows design-system: `Popover`-style chrome, accent border, no chromatic colors except destructive on error. Respects `prefers-reduced-motion` (no spinner, just static "Loading editor…" text). |
| Complexity | M |
| Category | frontend |
| Depends on | #16 |
| Files | `src/components/editor/EditorHydratingOverlay.tsx` (new), `src/components/editor/Editor.tsx` (mount the overlay in the render branch) |

### #18 — Foreground hydrate on edit attempt

| Field | Value |
| --- | --- |
| Description | When the user's edit-attempt signal fires AND the worker hasn't returned yet, await the worker's in-flight parse with a hard 3 s deadline. If the parse arrives within 3 s → `setContent(json)` → editor takes over → focus the editor → dismiss the overlay. PRD's Edit-A is "block briefly", not "queue intent" — the user can retype. Edit-B (intent replay) is deferred per PRD. If the 3 s deadline expires without a result, surface "Taking longer than expected" + a Cancel button that aborts the parse (#14) and falls back to main-thread sync parse (#15). |
| Complexity | M |
| Category | frontend |
| Depends on | #14, #15, #17 |
| Files | `src/hooks/useEditorTabSwitch.ts`, `src/components/editor/EditorHydratingOverlay.tsx` |

---

## M2.6 Tests + perf (4 tasks)

### #19 — Worker round-trip parity test

| Field | Value |
| --- | --- |
| Description | Vitest unit test in `src/workers/__tests__/markdown-parse.worker.test.ts`. Parse `tests/fixtures/preview-fidelity/mixed-small.md` and `tests/fixtures/full-syntax.md` on the main thread (existing `loadRawMarkdownIntoEditor` path with a mock editor) vs the worker path. JSON output must be deeply equal. Catches Schema drift between main and worker contexts. The merge gate for #9. |
| Complexity | M |
| Category | test |
| Depends on | #10 |
| Files | `src/workers/__tests__/markdown-parse.worker.test.ts` (new), reuses `tests/fixtures/preview-fidelity/mixed-small.md` |

### #20 — E2E worker path

| Field | Value |
| --- | --- |
| Description | Extend `e2e/tests/preview-fidelity.spec.ts` to assert: while preview is on screen AND the worker is parsing, the main thread is responsive. Direct verification: schedule `setTimeout(callback, 50)` repeatedly during the hydration window; assert each callback fires within <100 ms (proxy for "main thread not blocked"). Pre-Phase-2 baseline would fail this test (the 5 s timer-fired event blocks setTimeouts); post-Phase-2 should pass. |
| Complexity | M |
| Category | test |
| Depends on | #12 |
| Files | `e2e/tests/preview-fidelity.spec.ts`, fixture data |

### #21 — Perf benchmark — worker hydration time

| Field | Value |
| --- | --- |
| Description | New `src/perf/markdown-worker.perf.test.ts` runs `parseInWorker(generateMarkdown(500))` 5 times, asserts median <7 s on M3 dev hardware (allows 1.5x for CI per existing `PERF_BUDGET_MULTIPLIER` convention). Same harness as existing `markdown.perf.test.ts`. The benchmark itself runs in a Vitest worker thread — verify the worker path actually exercises a Web Worker (Vitest's native Worker shim, not just Node's `worker_threads`). |
| Complexity | S |
| Category | perf |
| Depends on | #10 |
| Files | `src/perf/markdown-worker.perf.test.ts` (new), `vitest.perf.config.ts` if worker config tweaks needed |

### #22 — Small-file regression watch

| Field | Value |
| --- | --- |
| Description | Add 10 KB and 100 KB recordings to `docs/performance-baseline.md` for both the main-thread (legacy) and worker path. Phase 2 must NOT regress small-file load times. Threshold tuning (when to skip the worker for small files) is Phase 4 — Phase 2 just confirms the worker isn't slower for small files even if it's not faster. |
| Complexity | S |
| Category | perf |
| Depends on | #12 |
| Files | `docs/performance-baseline.md`, perf benchmark recordings (user-local) |

---

## M2.7 Measurement gate + rollout (3 tasks)

### #23 — DevTools Timeline before/after capture

| Field | Value |
| --- | --- |
| Description | Pre-Phase-2 recording (current state of `feat/large-file-instant-load`) and post-Phase-2 recording on the user's 506 KB book. Same methodology as Phase 1 (3 instruments: JavaScript & Events with stack traces, Layout & Rendering, Screenshots; no Memory or Allocations). The metric Phase 2 must move: main-thread frame chart during the hydration window. Pre = blocked ~5 s; post = fps stays at 60. User-run on real hardware. |
| Complexity | S |
| Category | perf |
| Depends on | #12 |
| Files | user-local recordings (NOT committed) |

### #24 — Update `docs/performance-baseline.md`

| Field | Value |
| --- | --- |
| Description | New "2026-MM-DD — Phase 2, Book 506 KB" entry with: worker timing breakdown (preprocess / parse / finalize from `ParseResult.timings`), main-thread responsiveness metric (worst setTimeout deviation during hydration window), click → editable total time. Compare against the Phase 1 baseline. |
| Complexity | S |
| Category | docs |
| Depends on | #23 |
| Files | `docs/performance-baseline.md` |

### #25 — Tick PRD quality gates + status

| Field | Value |
| --- | --- |
| Description | In `docs/prds/2026-05-03-large-file-instant-load.md`: tick Layer 2 + Layer 2 swap quality gates. Add "Phase 2 — landed" note with commit ref. Update this task file's table at the top: status `Not started` → `Landed`. Update `project_large_file_instant_load.md` memory entry — flip "Phase 2 next" to "Phase 2 landed; Phase 3 next." |
| Complexity | S |
| Category | docs |
| Depends on | #24 |
| Files | `docs/prds/2026-05-03-large-file-instant-load.md`, this task file, memory |
