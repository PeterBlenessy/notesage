# PRD: Large Markdown File Instant Load

|  |  |
| --- | --- |
| **Date** | 2026-05-03 |
| **Status** | Phase 1 + Phase 2 + Phase 3b landed (2026-05-07). Phase 3 explored and reverted; Phase 3b PIVOTED from the original 5-layer plan to **streaming hydrate + parse cache + abort propagation**, which delivered the core wins without needing the IDB viewport cache (Layer 3b) or the in-memory state cache (Layer 2b). See § "Phase 3b — As shipped". |
| **Priority** | High — current behavior on book-length markdown is a UX failure (&gt;30s frozen UI on a real user file) |
| **Impact** | Opening any markdown file feels instant. First open paints content in &lt;300ms via Rust HTML preview (Layer 1), hydrates via off-thread worker parse + chunked streaming insertion (Layer 2 + streaming hydrate). The streaming loop yields to a paint frame between chunks, so clicks during a load cleanly interrupt and the new doc's pipeline runs instead. **In-session repeat opens** skip the worker via the parse-result cache (~2.8 s click → editable on the 506 KB book vs. ~5 s first load and ~22 s pre-pivot). The "is the app frozen?" failure mode becomes structurally impossible because every chunk yields. |
| **Trigger** | A 506 KB / 6634-line / 396-heading / 952-table-row markdown book (`Svenska-Investmentbolag-v0.10.0.md`) takes &gt;30s to open with no visible progress, no spinner, no way to cancel. The main thread is fully blocked the entire time. |
| **Related research** | [llm-wiki-data-transformation](../research/llm-wiki-data-transformation.md) — discovered the SQLite-index/parser pattern. The parsed-state disk cache idea originated here; Phase 3 found this approach insufficient on its own (see post-mortem) and pivoted to the viewport-render cache architecture. |
| **Related PRD** | [2026-04-14-markdown-preprocessing-hardening](2026-04-14-markdown-preprocessing-hardening.md) — replaces the 13 regex preprocessing passes with a single markdown-it plugin pass; complements this PRD by making the worker hydration faster |
| **Tasks** | Phase task files are written before each phase ships. Phase 1: [2026-05-03-large-file-instant-load-phase1-tasks](../tasks/2026-05-03-large-file-instant-load-phase1-tasks.md). Phase 2: [2026-05-03-large-file-instant-load-phase2-tasks](../tasks/2026-05-03-large-file-instant-load-phase2-tasks.md). Phase 3 (reverted): [2026-05-03-large-file-instant-load-phase3-tasks](../tasks/2026-05-03-large-file-instant-load-phase3-tasks.md). Phase 3b: [2026-05-03-large-file-instant-load-phase3b-tasks](../tasks/2026-05-03-large-file-instant-load-phase3b-tasks.md). |

## Problem

Markdown files &gt;100 KB load slowly enough to break the user's mental model of an "interactive" editor. The dominant failure case is a 506 KB book that takes &gt;30s with the UI completely frozen — no spinner, no progress, no escape hatch. This is not a hypothetical: the user's primary long-form note is exactly this file.

Tracing the load path (`Editor.tsx:129` → `loadRawMarkdownIntoEditor` in `src/lib/markdown.ts:1073`), the time goes into three serial stages on the main thread, with no yields between them:

1. **13 regex preprocessing passes** — each scans the entire markdown string for callouts, mermaid blocks, charts, drawings, page breaks, link previews, TOC, image paths, data URIs. \~6.5 MB of regex work for a 506 KB file. Several patterns have non-trivial backtracking risk.
2. **markdown-it parse + Tiptap** `setContent` — extrapolating from the M3 baseline (100KB → 254ms), this is roughly 1.5s for 506 KB. Not the bottleneck on its own.
3. **Plugin init storm** — once `setContent` lands, every ProseMirror plugin (`tag-highlight`, `mention-highlight`, `date-highlight`, `search-highlight`, `comment-mark`, `table-aggregation`, `table-sort`, `table-filter`, `table-sparkline`, `table-header-menu`, `page-breaks`, `ai-suggestion`) runs an `appendTransaction` walking the full doc on init. `table-aggregation` alone walks 952 table rows and computes per-column footers. This is the single largest cost on table-heavy files.

Plus React's first render of a ProseMirror DOM tree with thousands of nodes. **No loading indicator. No interruption points.**

The performance baselines in `docs/performance-baseline.md` were measured against synthetic content up to 100 KB; real user files are 5x larger and the load curve is super-linear.

The frozen UI is the symptom; the structural cause is that the entire load pipeline — read, preprocess, parse, plugin init, render — is **synchronous, monolithic, and re-runs from scratch on every open**.

## Goals / Non-Goals

### Goals

1. **Instant first paint:** opening any markdown file shows readable, scrollable, selectable content in **&lt;300ms** regardless of file size. Phase 1 ✅ for first-ever opens via comrak; Phase 3b extends this to **&lt;50ms** for previously-saved files via the IndexedDB viewport cache.
2. **Identical render:** the preview that paints first is **visually indistinguishable** from the final editor view. Phase 1 (comrak) achieves \~80% parity (decorations and custom node-views diverge); Phase 3b achieves \~100% parity for previously-edited files because the cached HTML IS the editor's own render output.
3. **Background hydration:** the editable Tiptap editor finishes hydrating within \~5–10s of first paint for files up to 1 MB, all on a Web Worker — main thread stays at 60 fps the entire time. Phase 2 ✅ moved parse + plugin storm off-thread; the residual 4.4s `setContent(json)` DOM materialize on the 506 KB book is acknowledged as the unaddressable floor and is **explicitly out of scope** for this PRD (would require streaming setContent or virtual scrolling).
4. **Fast in-session repeat opens:** switching back to any previously-active document completes in **&lt;100ms** via an LRU in-memory `EditorState` cache (Layer 2b). Restores full undo/redo, selection, scroll, decorations.
5. **Fast cold app start:** previously-edited documents mount cached viewport HTML in **&lt;50ms** via IndexedDB (Layer 3b). Frequently-opened files are eagerly pre-warmed (Layer 4b) into the in-memory cache during the existing tree-validation window so they're hot by the time the user clicks.
6. **Empirical decisions:** every threshold (when to use the worker vs direct parse, when to cache, etc.) is determined from real measurements captured via browser DevTools Timeline profiling on representative files, not from guessed numbers.

### Non-Goals

- Performance work for non-markdown formats (PDF, EPUB, DOCX, PPTX have their own viewers; CodeMirror handles code files efficiently already).
- Replacing Tiptap or moving to a different editor engine.
- Supporting multi-megabyte files as a first-class case (target ceiling is \~1 MB; beyond that, source mode is the right answer).
- Web Worker support for plugin runtime (only the parse pipeline moves; plugins still run on the main thread, but lazy-init where they can).
- A new "Reading mode" surface — the preview MUST look like the editor, not like a separate read-only view.
- Preserving exact Tiptap parse output in the Rust HTML preview — close-enough fidelity is fine because the swap is invisible and brief.

## User Stories

- **As a long-form writer**, I want my 500-page book to open instantly when I click it in the sidebar, so that I can find a passage and start editing without waiting through a frozen UI.
- **As a returning user**, I want the second time I open any file to be effectively instant, so that switching between recent documents feels weightless.
- **As a developer of Notesage**, I want per-stage timing data for every file open, so that I can verify each optimization actually improved the metric I targeted and didn't regress others.
- **As a user editing a large file**, I want the UI to remain responsive (scroll, find, type) while the heavy parsing finishes in the background, so that the app never feels broken.

## Technical Approach

The architecture is three independently-shippable layers, deliberately ordered so each one provides standalone value and they compose into the full instant experience.

### Diagnosis approach

Per-phase before/after measurement is captured via browser DevTools Timeline (Safari Web Inspector or Chrome DevTools) recordings on representative files, including the user's real 506 KB book. No in-app instrumentation, no benchmark suite — DevTools profiling already shows the dominant costs (synchronous parse, layout thrashing from plugin `update` callbacks reading `offsetHeight`, etc.) at the precision needed to choose the right optimization target. Phase gates record the recording URL and the observed before/after numbers in `docs/performance-baseline.md`.

### Layer 1 — Rust comrak HTML preview (instant first paint)

**Mechanism.** A new Tauri command `render_markdown_preview(path)` calls the existing comrak-based `render_html` infrastructure (`src-tauri/src/commands/export.rs` + `src-tauri/src/export/markdown_to_html.rs`) with `include_styles: false` to return a body fragment. Comrak is roughly 10–100x faster than markdown-it in JS for the same input.

**Frontend integration.** `Editor.tsx` adds a new "preview" content-loaded state alongside `contentLoaded: true | false`. When a markdown tab is activated:

1. Fire `render_markdown_preview` immediately. Expected: &lt;100ms for 500 KB on M3.
2. Render the returned HTML into the document area inside a styled wrapper that uses the **same fonts, padding, line-height, max-width, and editor.css class hierarchy** as the real editor. From the user's eye, this MUST be indistinguishable from the eventual editor render.
3. The preview is read-only but selectable — Cmd+F (DOM-based search), Cmd+C (copy), scroll, click links, all work.

**Visual identity is mandatory** (Decision A confirmed). The preview wrapper opts into the same `data-quiet-layout-root`-anchored CSS as the editor; the same `--ns-paragraph-*` and `--ns-heading-*` CSS variables apply; the same content-width and margin settings apply. The acceptance criterion is "swap the preview for the editor on the same scroll position; a screenshot diff shows zero pixel difference outside the cursor caret."

**Fidelity gaps to manage.** Comrak's render and Tiptap's render are not byte-identical for some edge cases:

- Callouts, charts, drawings, link previews, sparklines: already handled by the export pipeline's HTML renderer (`src-tauri/src/export/markdown_to_html.rs`) — same output as Tiptap.
- Tables with column metadata: the HTML renderer already parses `<!-- type:currency -->` comments and emits aggregation footers. Same output.
- Tag badges (`#tag`), mention badges (`@mention`), date badges (`//YYYY-MM-DD`): NOT rendered as badges in the comrak HTML today; they appear as plain text. **Need to either teach the HTML renderer to wrap these in styled spans OR accept the brief plain-text rendering during the &lt;5s hydration window.** Given the 5s window and that the swap is invisible, accepting the gap is fine — but should be measured for visual impact.
- Inline tag/mention autocomplete decorations, comment highlights, inline diff decorations: not present in the preview; appear after hydration. Acceptable.

### Layer 2 — Web Worker hydration (background parse, invisible swap)

**Mechanism.** A new Web Worker (`src/workers/markdown-parse.worker.ts`) takes raw markdown and returns a parsed ProseMirror JSON document.

**Worker scope:**

1. Receives `{ markdown: string, projectRoot?: string }`.
2. Runs the preprocessing chain (the 13 functions, or — once the markdown-preprocessing-hardening PRD lands — the single markdown-it plugin pass).
3. Runs markdown-it parse → Tiptap schema conversion → ProseMirror JSON.
4. Returns the JSON to the main thread.

**Worker-safety constraints.** The worker has no DOM, no `window`, no Tauri IPC. The preprocessing functions in `src/lib/markdown.ts` must be refactored so they work in a worker:

- Functions that touch `document` or `window` get isolated and stay on the main thread.
- Pure string→string transforms move into the worker.
- Tiptap's schema can be instantiated inside a worker (it doesn't require a DOM); the `setContent` call CANNOT happen there because it needs the editor instance, which has DOM. Instead, the worker returns the parsed JSON, the main thread calls `editor.commands.setContent(json)`.

**Main-thread coordination.** While the worker runs:

1. The preview is on screen, user can scroll/read.
2. When the worker posts back the parsed JSON, the main thread:
   - Captures current scroll position from the preview wrapper
   - Calls `editor.commands.setContent(json, false)` (no addToHistory)
   - Restores scroll position
   - Removes the preview wrapper
3. **Visual continuity test:** because preview and editor share the same CSS, the same scroll position, the same content width — there is no flicker, no layout shift. The swap is invisible.

**Edge case — user starts editing before hydration completes.** Two options, both acceptable; pick one in implementation:

- **Option Edit-A (block briefly):** any keystroke or click in the preview triggers a visible "Loading editor (Xs)…" overlay; finish hydration in foreground. \~1–3 second wait depending on how late the user clicks.
- **Option Edit-B (queue intent):** capture the click/keystroke, complete hydration in background, replay the intent into the editor when ready. More elegant but harder to get right (cursor position, IME state, etc.).

Initial implementation: Edit-A. Edit-B is a future enhancement.

### Layer 3 — Parsed-state disk cache (fast subsequent opens)

**Mechanism.** After a successful first hydration, serialize the ProseMirror doc state and cache it on disk. On subsequent opens, deserialize the cache instead of re-parsing.

**Cache key.** SHA-256 of the markdown file's content (post-frontmatter-strip, pre-preprocessing). This is the same hashing pattern the SQLite document index already uses for incremental reindexing — so we can reuse the hash from the index when available.

**Cache location.** Per-project: `<project>/.notesage/cache/parsed/<sha>.json`. Global notes (under `~/Notesage`) use `~/Notesage/.notesage/cache/parsed/<sha>.json`. Mirrors the existing pattern for `index.db` and comment sidecars. Excluded from iCloud via xattr (same mechanism as `index.db`). Gitignored by default.

**Cache content.** A JSON envelope:

```json
{
  "schemaVersion": 1,
  "tiptapSchemaHash": "sha256-of-extension-list-versions",
  "markdownHash": "sha256-of-source-markdown",
  "createdAt": "2026-05-03T17:42:00Z",
  "doc": { /* ProseMirror JSON via editor.getJSON() */ },
  "tableMetadata": { /* TableColumnMetadataMap serialized */ },
  "nodeIds": { /* nodeIds map serialized */ },
  "annotations": { /* annotation positions */ }
}
```

`tiptapSchemaHash` invalidates the cache when the Tiptap extension set changes (e.g., adding a new node type would make old cache entries incompatible).

**Cache lookup flow.** On tab activation:

1. Read file → compute `markdownHash`
2. Look up `<sha>.json` in cache directory
3. If hit AND `tiptapSchemaHash` matches: skip Layer 1 + Layer 2 entirely. Call `editor.commands.setContent(cached.doc)` directly. Apply `tableMetadata`, `nodeIds`, `annotations` follow-ups. **Total time: &lt;100ms even for the 506 KB file.**
4. If miss or schema mismatch: Layer 1 + Layer 2 path. Write to cache after hydration completes.

**Cache size budget.** \~1.5x the markdown size in JSON (slightly larger due to ProseMirror's tagged structure). 506 KB markdown → \~750 KB cache. For 1000 cached files at average 50 KB each: \~75 MB. Acceptable. Optional: ring-buffer eviction at 500 MB total cache size.

**Cache invalidation triggers.**

- Markdown content hash changes (file edited externally or via Notesage save) → next open recomputes.
- Tiptap schema hash changes (Notesage upgraded with new extensions) → all caches invalidate at once on the upgrade.
- User explicitly clears the cache via Settings &gt; Advanced &gt; "Clear parse cache".

**Plugin init still runs on cached opens.** The cache stores the parsed doc; it does NOT short-circuit the plugins. So `table-aggregation`, `tag-highlight`, etc. still run on `setContent`. **This is intentional** — plugin state is derived from the doc and the user's current session (active comments, search query, etc.), not cacheable. The win comes from skipping the preprocessing + markdown parse, which together dominate the load time.

### Layer interaction matrix

| Scenario | Layers used | Expected time (506 KB book) |
| --- | --- | --- |
| First open ever, cold cache | L1 + L2 | First paint &lt;300ms, fully editable in 5–10s background |
| Repeat open, hot cache | L3 | First paint and editable in &lt;100ms, no preview shown |
| Repeat open, file edited externally (cache miss) | L1 + L2 | Same as first open ever |
| Schema upgrade invalidates cache | L1 + L2 | Same as first open ever (one-time per upgrade) |
| Small file (&lt;10 KB) | direct parse (no preview, no worker) | &lt;50ms — preview/worker overhead would be net-negative |

The "small file" row is the empirical-threshold question deferred until we have profiling data.

## UI/UX

This feature is, by design, **invisible to the user when working correctly**. There is no new component, no new control, no new mode.

The only user-visible behavior change: large files open without freezing. Specifically:

- No loading spinner appears for files that complete in &lt;300ms (i.e., almost every file on a hot cache, and small files on cold).
- For files where hydration takes &gt;2s and the user attempts to edit before hydration completes (Layer 2 Edit-A path): a brief overlay says "Loading editor…" with a determinate progress bar. The progress bar is driven by the worker emitting periodic progress updates (% of preprocessing complete + % of parse complete). Removed automatically when hydration finishes.
- Settings &gt; Advanced gains one new control: **"Clear parse cache"** button. One-shot, deletes all `<project>/.notesage/cache/parsed/*.json`. Confirmation dialog: "This will require re-parsing the next time each file is opened."

There is no setting to disable the cache or the preview pipeline — the user can always opt out by deleting the cache directory, but day-to-day there's no toggle. The pipeline is correct or it isn't; we don't ship a broken-pipeline opt-out.

**Visual polish requirement (per Decision A).** During the preview→editor swap:

- Scroll position MUST be preserved exactly (caret-line accuracy).
- No layout shift: preview and editor share the same content width, the same per-block heights (within rounding), the same fonts.
- No flash of unstyled content (FOUC): the preview wrapper opts into all editor.css selectors before insertion.
- A pre-merge screenshot test compares the preview render and the editor render of every fixture file at 1x and 2x DPR and asserts &lt;2% pixel diff outside the cursor.

## Data Model

### Tauri commands (new)

```rust
#[tauri::command]
pub async fn render_markdown_preview(
    path: String,
    project_root: Option<String>,
) -> Result<String, String> {
    // Reuse render_html infrastructure with include_styles=false.
    // Returns HTML body fragment.
}

#[tauri::command]
pub async fn read_parsed_cache(
    cache_path: String,
    expected_markdown_hash: String,
    expected_schema_hash: String,
) -> Result<Option<ParsedCacheEntry>, String> {
    // Returns Some(entry) if the cache file exists AND both hashes match;
    // None on miss or mismatch (caller falls back to fresh parse path).
}

#[tauri::command]
pub async fn write_parsed_cache(
    cache_path: String,
    entry: ParsedCacheEntry,
) -> Result<(), String>;

#[tauri::command]
pub async fn clear_parsed_cache(scope: String) -> Result<u64, String> {
    // scope: "all" | "<project_path>" — returns count of files deleted
}
```

### TypeScript types (new)

```typescript
interface ParsedCacheEntry {
  schemaVersion: number;            // currently 1
  tiptapSchemaHash: string;         // sha256 of extension list versions
  markdownHash: string;             // sha256 of post-frontmatter markdown
  createdAt: string;                // ISO8601
  doc: JSONContent;                 // Tiptap JSON
  tableMetadata: SerializedTableColumnMetadataMap;
  nodeIds: SerializedNodeIdMap;
  annotations: SerializedAnnotationMap;
}
```

### Worker message protocol

```typescript
// Main → Worker
type ParseRequest = {
  type: 'parse';
  id: string;                       // correlation id
  markdown: string;
  projectRoot?: string;
};

// Worker → Main
type ParseProgress = {
  type: 'progress';
  id: string;
  stage: 'preprocess' | 'parse' | 'finalize';
  pct: number;                      // 0..1
};

type ParseResult = {
  type: 'result';
  id: string;
  doc: JSONContent;
  tableMetadata: SerializedTableColumnMetadataMap;
  nodeIds: SerializedNodeIdMap;
  annotations: SerializedAnnotationMap;
  timings: { preprocess: number; parse: number; total: number };
};

type ParseError = {
  type: 'error';
  id: string;
  message: string;
  stack?: string;
};
```

### Settings store (new field)

```typescript
interface SettingsState {
  // ...existing
  parsedCacheEnabled: boolean;     // default true
}
```

(No UI for this; it's a kill-switch for diagnostic purposes only. Settings dialog has the "Clear cache" button but not the enable toggle.)

## Dependencies

- **Existing:** `render_html` Tauri command + comrak crate (already in `src-tauri/Cargo.toml`).
- **Existing:** Tiptap's `editor.getJSON()` and `editor.commands.setContent(json)` for cache serialization.
- **Existing:** SHA-256 hashing — already present in the SQLite document index.
- **Existing:** Web Worker support in Vite — Vite has first-class worker support via `?worker` import suffix; no new tooling needed.
- **No new npm dependencies** are required for the core architecture.
- **Optional future:** the markdown-preprocessing-hardening PRD's markdown-it plugin refactor would let us drop several preprocessing functions from the worker, reducing parse time. Not a blocker — this PRD ships independently — but the two should be coordinated so we don't double-implement preprocessing.

## Quality Gates

### Functional

- [~] **Layer 1:** Opening any markdown file shows readable HTML preview within **300ms p95** on M3 dev hardware. Verified locally against the user's real 506 KB book via DevTools Timeline recording. _Phase 1 landed 2026-05-05 (commit 84ea0561). Warm cache: 0.12 s — meets target. Cold cache (book on iCloud Drive, not OS-cached): 1.15 s — gated by iCloud sync inside `fs::read_to_string`, not by comrak. Comrak itself runs in 100-150 ms at 506 KB. The PRD target was set assuming local filesystem; iCloud variance is filesystem-side and not addressable in Phase 1._

- [~] **Layer 1 fidelity:** Screenshot diff between preview render and editor render of every test fixture shows &lt;2% pixel difference outside the cursor (run at both 1x and 2x DPR, light and dark mode). _Infrastructure landed (`e2e/tests/preview-fidelity.spec.ts` with 3 behavioural tests + ±10 % scroll-height parity). Pixel-level goldens deferred — need human approval on first run. Live-test feedback (2026-05-05) flagged subtle blockquote line-height + syntax-highlighting drift between comrak and Tiptap output; targeted CSS tightening tracked as a Phase 1 polish follow-up._

- [~] **Layer 2:** Worker hydration of the 500 KB synthetic fixture completes within **10s** while the main thread maintains 60 fps (measured via DevTools Timeline frame chart during hydration). Local-only spot check against the real 506 KB book confirms parity. _Phase 2 landed 2026-05-06 (commit 19d1b00f, after `markdown-parse.core.ts` + linkedom fix). The 10 s wall-clock is met (~5 s click → editable). The 60 fps gate is **NOT** met for files of this size — a single 4.44 s `animation-frame-fired` task remains, which is `setContent(json)` materializing 6634 lines into DOM elements. Worker did successfully move the parse + plugin storm off-thread (saved ~2.2 s), but the DOM layer can't be moved off-thread without virtual scrolling or streaming setContent (out of scope for this PRD). 60 fps gate is met for small files where the DOM render is trivial._

- [~] **Layer 2 swap:** No visible flicker, no scroll-position shift, no layout shift during preview→editor swap. Verified by frame-by-frame video capture of the swap moment. _Same `deferPastPaint` rAF×2 mechanism as Phase 1 — preview stays on screen until `setContent` lands, scroll position preserved via shared `scrollAreaRef`. Frame-by-frame video diff not formally captured; subjective live-test 2026-05-06 reports no flicker._

- [x] ~~**Layer 3:** Repeat open of any cached file completes in **&lt;100ms p95**~~ — **superseded by Layer 2b + Layer 3b in Phase 3b.** Phase 3 explored disk-cache approach, found it can't beat the 4.4s DOM materialize floor on the book. Reverted 2026-05-06.

- [ ] **Layer 1b (skip-preview <50 KB):** Files under 50 KB go straight to the worker — no preview surface mounted, no flicker. Verified by E2E test plus DevTools recording on a small fixture.

- [ ] **Layer 2b (in-memory state cache):** In-session switch back to any previously-active document completes in **&lt;100ms p95**, restoring full undo/redo + selection + scroll + decorations. Verified by unit test (state restored byte-equal to capture) plus DevTools recording on the 506 KB book within a session.

- [ ] **Layer 3b (IDB viewport cache, cold start):** Cold app start of a previously-edited file paints content in **&lt;50ms p95** via static HTML mount; full editor hydrates in background. Verified by E2E test (clear app state, open file, measure first-paint) plus DevTools recording on the 506 KB book.

- [ ] **Layer 3b invalidation:** mtime mismatch drops the cache entry; `CACHE_SCHEMA_VERSION` bump invalidates every entry at once. Verified by unit test.

- [ ] **Layer 4b (pre-warm):** Top-5 Recents + all Pinned files are populated into Layer 2b during the existing tree-validation window. By the time `startupReady` flips, the in-memory cache is hot for the user's frequently-opened docs. Verified by perf log inspection — cache hit ratio on first interaction post-startup.

- [ ] **Layer 5b (Edit-A overlay):** When the user clicks/types on a viewport-cached document before hydration, an unobtrusive "Editor loading…" badge appears; disappears when hydration completes; cursor lands where the user clicked. For hydration &lt;500ms the overlay must not appear. Verified by E2E test.

- [ ] All existing markdown round-trip tests still pass (no regression in parse fidelity).

- [ ] All existing performance benchmarks still pass within budget (no regression for small files).

- [ ] No regression in unit, Playwright E2E, or real E2E test suites.

### Performance Targets

Captured before each phase via DevTools Timeline against the 506 KB book, recorded in `docs/performance-baseline.md`. Targets revised after Phase 3 post-mortem to acknowledge the DOM materialize floor on large files and reframe what "fast" means per scenario.

| File size | First-ever open (no cache) | Cold start (viewport cache hit) | In-session repeat | Notes |
| --- | --- | --- | --- | --- |
| 10 KB | &lt;200 ms editable (Layer 1b skip-preview) | &lt;200 ms editable | &lt;100 ms restore (Layer 2b) | Worker faster than preview at this size |
| 100 KB | &lt;500 ms first paint, &lt;1 s editable | &lt;50 ms first paint, &lt;1 s editable | &lt;100 ms restore | |
| 500 KB book | &lt;300 ms first paint (comrak), ~5 s editable | **&lt;50 ms first paint** (cached HTML), ~5 s editable in background | &lt;100 ms restore | DOM materialize floor accepted; viewport cache makes the wait invisible |
| 1 MB | &lt;500 ms first paint, ~10 s editable | &lt;50 ms first paint, ~10 s editable in background | &lt;100 ms restore | |

### Design

- [ ] Preview wrapper visually identical to editor — same fonts, same padding, same line-height, same max-width, same callout/table/code styling.

- [ ] Preview→editor swap is invisible to the user — no flicker, no layout shift, no scroll jump.

- [ ] Loading overlay (only shown when user tries to edit before hydration completes) follows the existing design system: `Tooltip`/`Popover` styling, accent border, no chromatic colors except destructive on error.

- [ ] Settings &gt; Advanced "Clear viewport cache" button (Phase 3b — destructive variant, AlertDialog confirmation, deletes IndexedDB entries). Diagnostic-only; no kill-switch toggles in user-facing UI.

- [ ] Edit-A overlay (Phase 3b Layer 5b) is unobtrusive: small badge near editor top, `--color-accent-primary` border, no chromatic colors, slides in only after &gt;500 ms hydration latency. Disappears immediately on hydration complete.

## Implementation Phases

This PRD ships in **strictly ordered phases**. No phase begins until the previous one's quality gates are met AND its before/after DevTools Timeline numbers are captured in `docs/performance-baseline.md`.

Each phase begins with a fresh DevTools Timeline recording on the 506 KB book to establish the pre-phase baseline, and ends with a second recording to confirm the win.

### Phase 1 — Rust HTML preview (Layer 1) ✅ landed 2026-05-05 (84ea0561)

- New `render_markdown_preview` Tauri command (thin wrapper over existing `render_html`).
- New preview wrapper component in `src/components/editor/`.
- Preview shown immediately on tab activation; editor mount deferred via double `requestAnimationFrame` (rIC and `setTimeout(0)` both raced WebKit's paint cycle and made the preview undeterministic).
- Screenshot fidelity test infrastructure (behavioural assertions + ±10 % scroll parity; pixel goldens deferred).
- **Measurement gate landed:** see `docs/performance-baseline.md` § "2026-05-05 — Phase 1, Book 506 KB". Click → readable: 6 s blank window → 0.12 s warm / 1.15 s cold (iCloud-bound). Click → editable: 15.7 s → 7 s.

**Open follow-up (Phase 1 polish, before Phase 2):** comrak↔Tiptap CSS divergence (blockquote line-height, syntect inline styles vs hljs class highlights). Tighten preview-only selectors based on concrete examples from live-test.

### Phase 2 — Web Worker hydration (Layer 2) ✅ landed 2026-05-06 (19d1b00f)

- Refactor `src/lib/markdown.ts` preprocessing helpers to be worker-safe (no DOM deps).
- New worker `src/workers/markdown-parse.worker.ts` + bridge `src/lib/markdown-worker.ts` + `worker-extensions.ts` shim list + `markdown-parse.core.ts` testable parse pipeline.
- Main-thread coordination: kick off worker after preview, swap on result via the existing `deferPastPaint` rAF×2.
- Edit-A path: deferred (M2.5 #16-18). The brief preview window + remaining 4.4 s DOM materialization make this a polish item — revisit if user feedback shows the gap matters.
- **Used `linkedom` for HTML→DOM parsing** (WKWebView's worker scope doesn't expose `DOMParser` despite MDN compat data — confirmed empirically 2026-05-06).
- **Measurement gate landed:** see `docs/performance-baseline.md` § "2026-05-06 — Phase 2, Book 506 KB". Plugin storm 1.88 s → 100 ms. Total click → editable ~7 s → ~5 s.

**Honest outcome:** worker pipeline works correctly (parity tests pass, no fallback in production). Plugin storm fully eliminated. But the dominant remaining cost is `setContent(json)` materializing 6634 lines into DOM (4.44 s) — a main-thread DOM-layer cost the worker can't help with. The "60 fps during hydration" PRD goal is met for small files but NOT for the 506 KB book; solving that would need virtual scrolling or streaming setContent (significant Tiptap-side changes, out of this PRD's scope). Phase 3's disk cache is the more impactful next step — it skips both the worker parse AND the DOM materialization on repeat opens.

### Phase 3 — Parsed-state disk cache (Layer 3) ❌ explored and reverted 2026-05-06

**What was built.** Full disk-cache implementation: `cache.rs` Tauri commands (read/write/clear), atomic writes, iCloud xattr exclusion, schema-version invalidation, frontend hashing helpers, kill-switch, Settings UI button, 8 unit tests + 11 cargo tests + E2E test. All code milestones M3.1–M3.5 landed in working tree, never committed.

**What we measured.** First live-test against the 506 KB book showed cache HIT path took ~5.1s click-to-editable — the same wall clock as Phase 2's cache MISS path. Plus a UX regression: the cache-hit code path skipped the comrak preview entirely, replacing the Phase 1 "preview at 130ms" with a blank screen for the duration.

**Why it didn't pay off.** The 4.4s `setContent(json)` DOM materialize identified in Phase 2 as unaddressable is also the floor for cache hits. Disk-cache only saves the worker parse (~200ms) and plugin storm (already 100ms post-Phase-2). For the user's actual file (the book), the cache saved ~600ms of work but lost ~1s of preview UX — net negative.

**The thesis was wrong.** The PRD framed Phase 3 as "instant repeat opens via parsed-state cache." This implicitly assumed the parse was the bottleneck. Phase 2's data already showed the bottleneck had moved to DOM materialize, but the Phase 3 plan didn't update on that signal. Lesson: **caching at the parsed-state granularity can never beat the DOM materialize floor for any cache format that ends in `setContent(json)` or `setContent(html)`.**

**What we kept from the work.**

- `CACHE_SCHEMA_VERSION` constant + regression-watch test in `worker-extensions.ts`. Cheap infrastructure, useful for Phase 3b's viewport cache.
- Confirmed empirically that disk-cache approaches are dead for the book's use case. Phase 3b moves to a different cache granularity.

**Files reverted.** `src-tauri/src/commands/cache.rs`, `src/lib/cache-hash.ts`, `useEditorTabSwitch.ts` cache integration, settings store kill-switch, Settings UI button, all related tests. Working tree clean as of revert.

### Phase 3b — Render-output cache + in-memory state cache (the actual fix)

**Reframing.** Phase 3 cached at the wrong granularity (parsed state of the whole document) and through the wrong mechanism (`setContent`, which always rebuilds DOM). Phase 3b caches at viewport granularity (only the visible window's HTML) and mounts as static content (sidesteps `setContent` for first paint). The full editor still hydrates in the background via the existing Phase 1+2 path, but the user has been reading content from t&lt;50ms onward.

**Five layers, each with a specific job.**

#### Layer 1b — Skip-preview rule (file <50 KB)

Files under 50 KB go straight to the worker parse path; no preview surface mounted. At this size the worker is fast enough (50–250ms) that preview adds visible flicker without buying useful time. Eliminates the comrak↔editor CSS divergence concern for small notes (the case where it was most jarring). Threshold may be empirically tuned in Phase 4.

#### Layer 2b — Path-keyed in-memory state cache

Extends today's `cachedEditorStatesRef` so it survives `closeTab`. Key by file path + mtime, LRU-bounded at ~200 MB total (~5–15 docs typical). On switch back: `editor.view.updateState(cachedState)` — full restore including undo/redo, selection, scroll, decorations. Sub-100ms. Lost on app quit. Solves the "feel weight when switching among Recent / Pinned" problem the user flagged after Phase 3.

#### Layer 3b — IndexedDB viewport cache

**Mechanism.** When the user saves a document OR has been idle for 5s with the editor focused, capture `editor.getHTML()` for the visible viewport ± 1 viewport above and below (~100 nodes typical, ~30 KB JSON). Store in IndexedDB keyed by `${filePath}|${mtime}|${cacheSchemaHash}`. On opening a document with a cache hit, **mount the cached HTML as static content inside a `<div>`** — NOT through `editor.commands.setContent`. ProseMirror is never asked to parse 6634 nodes for first paint, so the 4.4s DOM materialize floor is sidestepped for the initial view.

**CSS parity is byte-identical** because the cached HTML literally was the editor's own render at save time. No comrak divergence, no chasing decoration styles in CSS — those decorations are baked into the captured HTML.

**The full ProseMirror editor hydrates in the background** via the existing Phase 1+2 path (skipping comrak preview since the viewport HTML has already taken its place). When ready, a `deferPastPaint` swap replaces the static HTML with the live editor at the same scroll position.

**Storage.** IndexedDB lives in WKWebView's data directory and persists across app restarts. ~30 KB × ~100 docs = ~3 MB. Hard cap at 50 MB with LRU eviction. No Tauri IPC overhead, no atomic-write file shuffling, no iCloud xattr (IDB is outside user notes), no schema versioning theatre — mtime + schema-hash key handles invalidation automatically.

**Cache invalidation.** `mtime` mismatch → drop entry, fall through to Phase 1+2 path. `CACHE_SCHEMA_VERSION` bump → all entries auto-invalidate (existing keys won't match new fingerprint). External-change watcher already drops entries; piggyback on its hooks.

#### Layer 4b — Background pre-warm at app start

App start currently sits idle for ~4–6s during tree validation (per `project_startup_perf.md` — sequential `listDirectory` calls block `startupReady`). The renderer is doing nothing useful in that window. Phase 3b adds a background worker pool that, in parallel with tree validation, parses the **top-5 Recents + all Pinned files** and populates the in-memory state cache (Layer 2b). By the time the user looks at the editor, their frequently-opened docs are hot.

**For the book specifically:** if it's a recent or pinned file (which it is for this user), it gets pre-parsed during the same 4–6s window the app is already waiting on iCloud. By the time the user clicks, in-memory cache hit → instant.

**Investigation note (separate from Phase 3b implementation):** the 4–6s tree-validation window is itself slower than necessary. Spike whether tree validation can be moved to a Web Worker and parallelized to bring it under 1s. If feasible, the pre-warm window shrinks proportionally — but pre-warm still wins because it overlaps with whatever startup work remains.

#### Layer 5b — Edit-A overlay (the loading UX)

The deferred Phase 2 idea (M2.5 #16-#18) finally has a real use case. When viewport-cache HTML is mounted but the real ProseMirror editor hasn't hydrated yet, and the user clicks/types in the document, show a small badge: "Editor loading… (Xs)". When hydration completes, the overlay disappears, focus moves to the editor with the cursor positioned where the user tried to click. For files where hydration completes in &lt;500ms, the overlay never appears (no flicker).

**Per-layer responsibility matrix.**

| Scenario | Path taken | Comrak involved? | Time to first paint |
| --- | --- | --- | --- |
| Cold start, last-active 506 KB book | Layer 3b viewport cache hit | No | &lt;50 ms |
| Cold start, top-5 recent / any pinned | Layer 3b OR Layer 4b pre-warm hot | No | &lt;50 ms |
| In-session switch back to any previously-active doc | Layer 2b in-memory state cache | No | &lt;100 ms (full state restore) |
| Open small file (&lt;50 KB) ever | Layer 1b skip-preview, worker direct | No | ~200 ms (editor mount) |
| Open file edited externally (mtime mismatch) | Layer 3b invalidated → Phase 1+2 fall through | Yes (50 KB+) | Phase 1 numbers |
| First-ever open of a 50 KB+ file | No cache exists → Phase 1+2 fall through | Yes | Phase 1 numbers |

**Comrak's narrowed role.** Comrak (`render_markdown_preview`) is kept as a fallback for the bottom two rows: external-change reload and first-ever opens of files we've never seen. Daily workflow (book + recents + pinned) never invokes it. Maintenance cost stays low because we're not adding to it, just keeping the existing path.

**Storage and memory footprint.**

| Layer | Storage | Typical | Cap |
| --- | --- | --- | --- |
| Layer 2b (state cache) | RAM | 50–150 MB across 5–15 docs | 200 MB |
| Layer 3b (viewport cache) | IndexedDB | 30 KB × ~100 docs = 3 MB | 50 MB hard limit |
| Layer 4b (pre-warm) | RAM (feeds Layer 2b) | Bounded by Layer 2b | — |
| Layer 5b (overlay) | DOM | One element while shown | — |

Total RAM increase: ~150 MB peak. Total disk increase: ~3 MB IDB. Acceptable on M3 / 24 GB target hardware.

**Settings surface.** One diagnostic-only addition: a "Clear viewport cache" button under Settings &gt; Advanced. No user-facing toggles for skip-preview threshold, cache enable/disable, pre-warm scope, or overlay behaviour — every threshold is internal, picked once based on data, and changeable in code if wrong.

**What Phase 3b explicitly does NOT include.**

- No persistence of full ProseMirror state (Phase 3 — already reverted; lesson learned).
- No streaming `setContent` (separate PRD if pursued; Phase 3b makes it less necessary by sidestepping the first-paint problem).
- No virtual scrolling (multi-month investment, not on the table).
- No source-mode default for huge files (user pushed back; not coming back).
- No new user-facing settings beyond the diagnostic clear-cache button.

### Phase 3b — As shipped (pivoted from original plan, 2026-05-07)

The original Phase 3b plan (above) was a 5-layer architecture targeting the 4.4 s `setContent` DOM-materialize floor via cached viewport HTML. **In implementation we pivoted to a different approach** that hit the same outcome with less moving infrastructure:

**What actually shipped (commits `350d817a`, `2602a21f`, `3b277b3c`, `7ec5140a`):**

1. **M3b.1 — Skip-preview rule for files <50 KB.** Shipped as planned. Skips the comrak preview surface entirely for small notes. (commit `350d817a`)

2. **Streaming hydrate (replaces `loadParsedJsonIntoEditor`'s single-shot `setContent`).** New `streamingHydrate(editor, doc, side, signal)` in `src/lib/markdown.ts` inserts the parsed JSON in 1000-top-level-node chunks via `editor.chain().insertContent(chunk).run()`, yielding via `requestAnimationFrame` between chunks. Each chunk's start checks the abort signal — a click on a different tab during streaming cleanly cancels the loop. The book's previously-uninterruptible 4.4 s synchronous block is now ~90 yieldable chunks; cursor / hover / hit-tests stay responsive throughout.

3. **Parse-result cache (`src/lib/parsed-doc-cache.ts`).** Singleton in-memory cache keyed by file path. The worker output is stored the moment it returns — so an aborted hydration mid-stream does NOT throw the parse work away. On the next click of the same file the worker is bypassed entirely; pipeline goes straight to streaming hydrate. Bounded by 100 MB LRU. Invalidated on user edit (`transaction.docChanged && !addToHistory`), external file change, or app quit.

4. **AbortController per tab activation.** `useEditorTabSwitch` creates a fresh controller on every activation and aborts the previous one. Signal threads through the worker bridge (`parseInWorker(..., { signal })`) and through every `setContent` / `setPreview` callback. Clicks during the worker phase or pre-setContent paint window kill the previous tab's work.

5. **Two user-facing settings** (`feat(settings)` commit `3b277b3c`):
   - **System → Performance → "Instant-load preview"** — toggle the comrak preview entirely. When OFF, every doc takes the skip-preview path: editor mounts directly via streaming hydrate, no preview/editor visual swap.
   - **System → Files → "File hover preview"** — toggle the sidebar file-content hover popover (`FilePreview`). FolderPeek (folder hover) is unaffected.

**Headline numbers** (Apple M3 / 24 GB / `pnpm tauri dev` / 506 KB book):

| State | Click → editable |
| --- | --- |
| Phase 2 baseline (pristine, single click) | ~5 s |
| M2.5 in place (regression — reverted in `fae852de`) | ~22 s |
| **Phase 3b shipped, first load** | **~5 s** |
| **Phase 3b shipped, cache hit (revisit)** | **~2.8 s** |

Smaller docs landed proportionally: 92 KB doc 660–840 ms cache hit (~1.5 s steady-state pre-pivot), 0.5 KB doc 130–200 ms.

**Inventory — what of the original 5-layer plan was dropped, deferred, or covered:**

| Original plan | Status | Notes |
| --- | --- | --- |
| Layer 1b — Skip-preview rule | ✅ Shipped | Commit `350d817a` |
| Layer 2b — Path-keyed in-memory state cache (`view.updateState`) | ❌ Dropped | Parse cache + streaming hydrate covers in-session revisits at ~2.8 s for the book. State cache (`view.updateState`) would be theoretically faster but requires keeping multiple `EditorState` refs in memory and the marginal win doesn't justify the complexity. Reverted experiment captured in `editor-state-cache.ts` history. |
| Layer 3b — IndexedDB viewport cache | 🟡 Deferred | Would address cold-start (cross-session) — first paint &lt;50 ms on app restart by mounting cached HTML statically. Parse cache is in-memory only (lost on quit). Worth pursuing if cold-start latency on the book becomes a complaint, but the current ~5 s first-load is acceptable. |
| Layer 4b — Background pre-warm | 🟡 Deferred | Could populate the parse cache during the existing 4–6 s tree-validation startup window for top-5 Recents + Pinned. Would save ~300 ms on the first click of those files. Marginal. Defer until measurement shows it matters. |
| Layer 5b — Edit-A overlay | ❌ Dropped | The streaming hydrate makes the wait short enough (and progressively interactive) that a "loading" overlay is overkill. M2.5's original implementation regressed perf by 16 s and was reverted in `fae852de`. |
| M3b.7 #19 — "Clear viewport cache" Settings button | ❌ N/A | No viewport cache was built. The new parse cache is in-memory only and clears on quit; no diagnostic button needed. |
| M3b.7 #20-#22 — Tests + measurement gate | 🟡 Partially done | Live measurements captured in this PRD's "Phase 3b — As shipped" headline numbers. Unit tests for `parsedDocCache` and `streamingHydrate` are an open follow-up. |

**What stayed unchanged** from earlier phases:
- Phase 1 comrak HTML preview — still fires for 50 KB+ files when `instantLoadPreview` is enabled
- Phase 2 worker pipeline — still parses markdown off-thread; the parse cache stores the worker's output
- Phase 3 (reverted) — `CACHE_SCHEMA_VERSION` constant kept as cheap regression-watch insurance

**Open follow-ups:**
- Unit tests for `parsedDocCache` and `streamingHydrate` (in the spirit of the original M3b.7 #20)
- Performance baseline doc entry for the post-pivot numbers (M3b.7 #22)
- Possible follow-up PRD if cold-start (cross-session) latency on the book becomes a complaint — viewport cache (Layer 3b) is the answer there

### Phase 4 — Empirical threshold tuning (the deferred Decision)

- Using the data from Phases 1, 2, and 3b, decide:
  - **File size cutoff for the worker path** — below this size, do direct main-thread parse (avoids worker round-trip overhead).
  - **File size cutoff for the preview path (`50 KB` initial pick)** — below this, skip preview (parse is faster than the preview render+swap). May tune up or down based on Phase 3b live data.
  - **Pre-warm scope** — initial pick is top-5 Recents + all Pinned. Tune based on observed memory pressure and user behaviour.
  - **Viewport cache size** — initial pick is viewport ± 1 viewport. Tune based on observed scroll-out-of-cached-window frequency.
- Document the chosen thresholds in `docs/performance-baseline.md` with the data that justified them.
- Land the conditionals as small gating PRs.

## Out of Scope

- **Persisted full ProseMirror state** — Phase 3 explored this approach (parsed-state disk cache, JSON serialization, atomic writes); reverted 2026-05-06 after live data showed it can't beat the 4.4s DOM materialize floor on large files. Phase 3b moves to viewport-render caching which sidesteps the floor instead.
- **Streaming `setContent`** — incrementally chunk the DOM materialize across `setTimeout(0)` boundaries to keep the main thread at 60fps during hydration. Multi-week Tiptap-side engineering. Phase 3b's viewport cache makes the loading window invisible without needing this; deferred to its own PRD if first-paint isn't enough.
- **Plugin lazy-init** — `tag-highlight`, `comment-mark`, etc. could lazy-build decorations on first interaction instead of on init. Phase 2 already eliminated most of this cost (1.88 s → 100 ms). Defer until data shows plugin init is the dominant remaining cost.
- **Table virtualization** — `table-aggregation` walking 952 rows is real, but addressing it requires a custom node view for tables. Out of scope; if data shows it's the bottleneck, file a follow-up PRD.
- **Section-based loading** — opening only the visible H1/H2 section of a book. A different paradigm; would be its own PRD ("book mode") if pursued.
- **Source-mode default for huge files** — pragmatic escape hatch but represents giving up on the rich-edit experience. User explicitly pushed back on this option.
- **Embeddings or semantic chunking** — orthogonal to load performance.
- **Cache sync across devices** — Layer 3b's IndexedDB cache is device-local by design (mirrors the SQLite index pattern). Each device rebuilds from the markdown source.

## Adjacent Investigation (NOT part of this PRD)

- **Tree validation in a Worker.** App startup currently spends 4–6 s on sequential `listDirectory` calls during tree validation (per `project_startup_perf.md`). Phase 3b's pre-warm strategy depends on this window being available, but if tree validation can be moved to a Web Worker and parallelized to bring it under 1 s, the user-perceived startup time drops independently. Spike worth doing alongside Phase 3b but architecturally separate; track as a follow-up PRD if findings warrant it.