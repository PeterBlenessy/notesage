# Release v0.42.0

**Date:** 2026-05-08
**Previous version:** 0.41.0

Large markdown files now load and switch much faster, and clicking a different document while one is mid-load cleanly cancels the previous load. Two small Settings toggles let you tune the loading behaviour to taste.

## Changes

### Improvements

- **Large markdown files load substantially faster.** A 500 KB book that previously took ~15 seconds to become editable now lands in around 5 seconds on first open and around 3 seconds when you revisit the same doc later in the session. Smaller docs (50–100 KB) finish in under a second on first open and under 800 ms on revisit.
- **Clicking a different document while one is loading now interrupts cleanly.** The previous document's load is cancelled — its content doesn't flash through on the way to the one you actually want. Mouse hover and click hit-tests stay responsive throughout, so you can keep clicking to find the right file without waiting for the wrong one to finish.
- **Recently-viewed documents reopen quickly.** Notesage now keeps the parsed result of recently-opened documents in memory. Switching back to a file you opened earlier in the session skips the parse step entirely and goes straight to displaying the content.

### Settings

- **New: Settings → System → Performance → "Instant-load preview".** When on (default), Notesage shows a quick HTML preview of larger documents while the editor hydrates in the background. Turn it off to mount the editor directly — slightly slower first paint on large docs but no preview/editor visual swap.
- **New: Settings → System → Files → "File hover preview".** When on (default), hovering a file in the sidebar's Recent / Pinned / Tags / Mentions sections pops up a small preview of its first lines. Turn it off if you find the popovers distracting during click-heavy work. The folder hover preview is unaffected.

## Under the hood

PR #135. Pivoted significantly from the originally-planned 5-layer architecture (in-memory state cache + IDB viewport cache + pre-warm + Edit-A overlay) to a simpler **streaming hydrate + parse-result cache + abort propagation** design that hit the same outcome with less infrastructure. Full pivot record in `docs/prds/2026-05-03-large-file-instant-load.md` § "Phase 3b — As shipped" and `docs/tasks/2026-05-03-large-file-instant-load-phase3b-tasks.md` § "Pivot inventory".

What landed:

- **Streaming hydrate** (`src/lib/markdown.ts` `streamingHydrate()`) — replaces single-shot `setContent(json)` with chunked `editor.chain().insertContent(chunk).run()` of ~1000 top-level nodes per chunk, yielding via `requestAnimationFrame` between chunks. The book's previously-uninterruptible 4.4 s synchronous block is now ~90 yieldable chunks. First chunk uses `setContent` (single transaction) so small docs that fit in one chunk match the legacy single-transaction behaviour.
- **Parse-result cache** (`src/lib/parsed-doc-cache.ts`, new) — singleton in-memory LRU of worker `ParseResult` keyed by file path. Stored the moment the worker returns, so an aborted hydration mid-stream does NOT throw the parse work away. Bounded 100 MB. Invalidated on user edit (`transaction.docChanged && !addToHistory`), external file change (watcher fire), and app quit (in-memory only).
- **AbortController per tab activation** (`useEditorTabSwitch.ts`) — fresh controller on every effect run; previous controller aborted. Threads through `parseInWorker(..., { signal })` and every `setContent` / `setPreview` callback in the .then chain.
- **Cursor responsiveness during streaming** — yields between chunks use `requestAnimationFrame` (one paint frame, ~16 ms) rather than `setTimeout(0)` (~1–4 ms). The longer yield costs a small total-time bump but lets the browser do hover/click hit-tests between chunks. Without it, sidebar items don't show the pointer cursor while a doc is loading.
- **`MarkdownPreview key={activeTab.id}`** — forces full DOM unmount + remount on every tab switch instead of React diff-and-reuse.
- **M2.5 Edit-A overlay revert** — the loading-overlay implementation from Phase 2 was found to have regressed book load by ~16 s due to unstable `onEditIntent` callback identity causing per-render document-level capture-listener thrashing. Reverted entirely; the streaming hydrate now makes a loading overlay unnecessary anyway.
- **Perf-category rename** — `[perf:tab-switch]` / `[perf:tab-load]` → `[perf:doc-switch]` / `[perf:doc-load]`. Quiet Composer has no tabs; the old names were misleading. Three new fields in the doc-switch log: `pipelineMs` (full async pipeline time), `chunkCount` + `streamMs` (streaming hydrate progress), `fromCache` (whether the parse cache hit).

What was deferred to follow-up issues:

- **#131** — Pre-warm parse cache at app start during the existing 4–6 s tree-validation window for top-5 Recents + Pinned files. Marginal first-click win.
- **#132** — IndexedDB viewport cache for cross-session cold start. Would address slow first paint on the very first open after restart.
- **#133** — Unit tests for `parsedDocCache` + `streamingHydrate`.
- **#134** — Update `docs/performance-baseline.md` with post-pivot measurements.

### Headline numbers

Apple M3 / 24 GB / `pnpm tauri dev` / 506 KB book (`Svenska-Investmentbolag-v0.10.0.md`):

| State | Click → editable |
| --- | --- |
| v0.40.0 prod (no Phase 1+2) | 15 s |
| Phase 2 baseline (commit `19d1b00f`) | 5 s |
| M2.5 in place (regression) | 22 s |
| v0.42.0, first load | ~5 s |
| v0.42.0, cache hit | ~2.8 s |

## Files Changed

PR #135 squashed into `a6b8925a`. New files: `src/lib/parsed-doc-cache.ts`. Modified: `src/lib/markdown.ts`, `src/hooks/useEditorTabSwitch.ts`, `src/hooks/useFileWatcher.ts`, `src/components/editor/Editor.tsx`, `src/stores/settings-store.ts`, `src/components/settings/v2/SystemSettings.tsx`, `src/components/sidebar/quiet/FilePreview.tsx`, `src/lib/logger.ts`. Plus E2E test calibrations in `e2e/tests/editor.spec.ts`, `e2e/tests/preview-fidelity.spec.ts`, fixture inflation in `tests/fixtures/preview-fidelity/mixed-small.md`. Docs updated: `docs/architecture.md`, `docs/prds/2026-05-03-large-file-instant-load.md`, `docs/tasks/2026-05-03-large-file-instant-load-phase3b-tasks.md`.

## Quality Gates

- `pnpm typecheck` — clean
- `pnpm test --run` — 4599 / 4599 passing
- `pnpm test:perf` (CI's 1.5× multiplier) — 46 / 46 passing
- `pnpm test:e2e` — 32 / 32 passing
- `cargo test` — 684 / 684 passing
