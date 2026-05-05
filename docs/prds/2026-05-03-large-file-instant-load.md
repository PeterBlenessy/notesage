# PRD: Large Markdown File Instant Load

|  |  |
| --- | --- |
| **Date** | 2026-05-03 |
| **Status** | Draft |
| **Priority** | High — current behavior on book-length markdown is a UX failure (&gt;30s frozen UI on a real user file) |
| **Impact** | Opening any markdown file feels instant. First open of a previously-unseen large file paints content in &lt;300ms via Rust HTML preview, hydrates to a fully editable Tiptap editor invisibly in the background. Every subsequent open of the same file (the common case for long-form writing) loads in &lt;100ms via a parsed-state disk cache. The "is the app frozen?" failure mode becomes structurally impossible. |
| **Trigger** | A 506 KB / 6634-line / 396-heading / 952-table-row markdown book (`Svenska-Investmentbolag-v0.10.0.md`) takes &gt;30s to open with no visible progress, no spinner, no way to cancel. The main thread is fully blocked the entire time. |
| **Related research** | [llm-wiki-data-transformation](../research/llm-wiki-data-transformation.md) — discovered the SQLite-index/parser pattern that this PRD reuses for the cache hash key |
| **Related PRD** | [2026-04-14-markdown-preprocessing-hardening](2026-04-14-markdown-preprocessing-hardening.md) — replaces the 13 regex preprocessing passes with a single markdown-it plugin pass; complements this PRD by making the worker hydration faster |
| **Tasks** | Phase task files are written before each phase ships. Phase 1: [2026-05-03-large-file-instant-load-phase1-tasks](../tasks/2026-05-03-large-file-instant-load-phase1-tasks.md). |

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

1. **Instant first paint:** opening any markdown file shows readable, scrollable, selectable content in **&lt;300ms** regardless of file size.
2. **Identical render:** the preview that paints in &lt;300ms is **visually indistinguishable** from the final editor view. The swap from preview to editor is invisible — no flicker, no layout shift, no visible mode change.
3. **Background hydration:** the editable Tiptap editor finishes hydrating within \~5–10s of first paint for files up to 1 MB, all on a Web Worker — main thread stays at 60 fps the entire time.
4. **Fast subsequent opens:** every open of a previously-loaded file completes in **&lt;100ms** via a parsed-state disk cache. Cache invalidates on file content hash change.
5. **Empirical decisions:** every threshold (when to use the worker vs direct parse, when to cache, etc.) is determined from real measurements captured via browser DevTools Timeline profiling on representative files, not from guessed numbers.

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

- [ ] **Layer 2:** Worker hydration of the 500 KB synthetic fixture completes within **10s** while the main thread maintains 60 fps (measured via DevTools Timeline frame chart during hydration). Local-only spot check against the real 506 KB book confirms parity.

- [ ] **Layer 2 swap:** No visible flicker, no scroll-position shift, no layout shift during preview→editor swap. Verified by frame-by-frame video capture of the swap moment.

- [ ] **Layer 3:** Repeat open of any cached file completes in **&lt;100ms p95**, verified across all fixture sizes; local-only spot check against the real 506 KB book confirms parity.

- [ ] **Layer 3 invalidation:** Editing the file (in Notesage or externally) invalidates the cache; next open uses Layer 1+2 path.

- [ ] **Layer 3 schema invalidation:** Bumping a Tiptap extension's version invalidates all caches at once; verified by integration test.

- [ ] All existing markdown round-trip tests still pass (no regression in parse fidelity).

- [ ] All existing performance benchmarks still pass within budget (no regression for small files).

- [ ] No regression in unit, Playwright E2E, or real E2E test suites.

### Performance Targets

Captured before each phase via DevTools Timeline against the 506 KB book, recorded in `docs/performance-baseline.md`.

| File size | First open (p95) | Subsequent open (p95) |
| --- | --- | --- |
| 10 KB | ≤ pre-Phase-1 baseline (no regression) | ≤ pre-Phase-1 baseline |
| 100 KB | &lt;500 ms first paint, &lt;2 s editable | &lt;100 ms |
| 500 KB | &lt;300 ms first paint, &lt;10 s editable | &lt;100 ms |
| 1 MB | &lt;500 ms first paint, &lt;20 s editable | &lt;200 ms |

### Design

- [ ] Preview wrapper visually identical to editor — same fonts, same padding, same line-height, same max-width, same callout/table/code styling.

- [ ] Preview→editor swap is invisible to the user — no flicker, no layout shift, no scroll jump.

- [ ] Loading overlay (only shown when user tries to edit before hydration completes) follows the existing design system: `Tooltip`/`Popover` styling, accent border, no chromatic colors except destructive on error.

- [ ] Settings &gt; Advanced "Clear parse cache" button styled consistently with other destructive actions (uses `Button variant="destructive"`).

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

### Phase 2 — Web Worker hydration (Layer 2)

- Refactor `src/lib/markdown.ts` preprocessing helpers to be worker-safe (no DOM deps).
- New worker `src/workers/markdown-parse.worker.ts`.
- Main-thread coordination: kick off worker after preview, swap on result.
- Edit-A path: brief overlay if user clicks before hydration.
- **Measurement gate:** baseline doc updated with "after Phase 2: editable in X ms (was Y ms), main-thread frames-per-second during hydration = Z" — verified by DevTools Timeline frame chart on the 506 KB book.

### Phase 3 — Parsed-state disk cache (Layer 3)

- Cache directory infrastructure (per-project + global).
- `read_parsed_cache` / `write_parsed_cache` / `clear_parsed_cache` Tauri commands.
- Tiptap schema hash computation (one helper that hashes the extension list).
- Cache lookup integrated into the load path before Layer 1.
- iCloud xattr exclusion + gitignore entry.
- Settings &gt; Advanced "Clear parse cache" button.
- **Measurement gate:** baseline doc updated with "after Phase 3: subsequent open = X ms (was Y ms)" — verified by DevTools Timeline recording on the 506 KB book.

### Phase 4 — Empirical threshold tuning (the deferred Decision)

- Using the 3 phases of baseline data, decide:
  - **File size cutoff for the worker path** — below this size, do direct main-thread parse (avoids worker round-trip overhead).
  - **File size cutoff for the preview path** — below this, skip preview (parse is faster than the preview render+swap).
  - **Cache write threshold** — below this size, don't write to cache (parsing is fast enough that the I/O isn't worth it).
- Document the chosen thresholds in `docs/performance-baseline.md` with the data that justified them.
- Land the conditionals as small gating PRs.

## Out of Scope

- **Plugin lazy-init** — `tag-highlight`, `comment-mark`, etc. could lazy-build decorations on first interaction instead of on init. Real win on table-heavy files but adds complexity to plugin contracts. Defer until we have data showing plugin init is the dominant remaining cost after Phase 3.
- **Table virtualization** — `table-aggregation` walking 952 rows is real, but addressing it requires a custom node view for tables. Out of scope for this PRD; if the data shows it's the bottleneck after Phase 3, file a follow-up PRD.
- **Section-based loading** — opening only the visible H1/H2 section of a book. A different paradigm; would be its own PRD ("book mode") if pursued.
- **Source-mode default for huge files** — pragmatic escape hatch but represents giving up on the rich-edit experience. Not pursued unless Layer 1+2+3 fail to hit targets.
- **Streaming editor construction** — incrementally inserting nodes as parsing progresses (Notion-style). Architecturally interesting but multi-month engineering for an experienced editor team. Cache + preview pattern delivers most of the benefit at a fraction of the cost.
- **Embeddings or semantic chunking** — orthogonal to load performance.
- **Cache sync across devices** — caches are device-local by design (mirrors the SQLite index pattern). Each device rebuilds from the markdown source.