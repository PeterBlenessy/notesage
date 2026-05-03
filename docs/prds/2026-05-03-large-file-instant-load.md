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
| **Tasks** | [Phase 0 tasks](../tasks/2026-05-03-large-file-instant-load-phase0-tasks.md) (18 tasks: 8S, 7M, 3L). Phases 1–4 task files written after each prior phase ships, per the data-driven gating in this PRD. |

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
5. **Empirical decisions:** every threshold (when to use the worker vs direct parse, when to cache, etc.) is determined from real measurements taken via the profiling instrumentation that is the **first deliverable of this PRD**, not from guessed numbers.

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

### Layer 0 — Profiling instrumentation (FIRST deliverable, blocks all other work)

Before any optimization, we add per-stage timing instrumentation **and** a push-button benchmark that runs the actual load pipeline. Without this, every subsequent claim of "X is faster" is unverifiable. With it, the AW pipeline gains a hard regression gate it can run on every PR.

**Stages to instrument** (each wrapped with a `performance.now()` bracket inside the load path):

| Stage | Marker | Notes |
| --- | --- | --- |
| File read (Tauri IPC) | `perf:load:read` | Already partially covered; needs file-size + bytes-read fields |
| Frontmatter parse | `perf:load:frontmatter` | New |
| Preprocessing chain (each of the 13 passes) | `perf:load:preprocess` | Per-pass timing in a child object |
| markdown-it parse | `perf:load:parse-md` | New |
| Tiptap `setContent` | `perf:load:set-content` | Wrap `editor.commands.setContent` call |
| Per-plugin `appendTransaction` on init | `perf:load:plugin-init` | Per-plugin timing in a child object |
| Per-decoration-plugin first-build cost | `perf:load:decorations` | tag-highlight, search-highlight, table-aggregation, etc. |
| First paint to interactive | `perf:load:total` | Wall-clock from tab-activation to editor.isEditable |

The instrumentation lives inside `src/lib/markdown.ts` and the editor mount path, gated by a `__PERF__` flag set by the test harness. **Production builds carry zero overhead** — the brackets compile out when the flag is unset.

#### Channel 1 — Headless benchmark suite (the primary measurement, push-button)

A new vitest perf suite (`src/perf/load.perf.test.ts`) modeled on the existing `markdown.perf.test.ts` and `decorations.perf.test.ts`:

1. Loads each fixture from the **fixture strategy** described below through the **actual production load pipeline** — same code paths `Editor.tsx` calls.
2. Sets `__PERF__ = true` on the harness, so the bracketed instrumentation emits per-stage timings.
3. Writes results as structured JSON to `perf/load-baseline.json` (next to the existing `coverage-baseline.json`).
4. Compares against the checked-in `perf/load-baseline.json`. **Fails if any metric regresses by more than the configured threshold** (start with 20%, tightened over time as the pipeline stabilizes).
5. Exposed as `pnpm test:perf:load` — runs the suite, prints a delta table, exits non-zero on regression. **No app needed, no dev tools, no copy-paste, no manual collection.**
6. Baseline updates via `pnpm test:perf:load:update` (mirrors the `coverage:update-baseline` pattern).

This is the regression gate — the answer to "did Phase 1 actually make things faster?" is one command.

#### Fixture strategy (license-clean, repo-friendly, extensible)

The benchmark needs representative input. Personal files (the 506 KB book) **never enter the repo or CI** — that content belongs only to its author. Three sources, in priority order:

1. **Synthetic generator (primary).** A new `scripts/gen-perf-fixture.mjs` that produces a markdown document of arbitrary size with a controlled construct mix. Deterministic (seeded RNG) so the same parameters always produce the same file. Parameters:

   - `--size <kb>` — target file size
   - `--mix <basic|book|tables|mixed>` — construct mix preset
   - `--seed <n>` — reproducibility

   Generates a curated set of fixtures committed to `tests/fixtures/perf/synthetic/` at canonical sizes (1, 10, 100, 500, 1000 KB) using the `mixed` preset that exercises every supported construct. The fixtures are committed (so CI doesn't have to regenerate per run); the generator script is ALSO committed (so anyone can regenerate or experiment with different mixes).

   The generator's content vocabulary starts minimal and **grows in parallel with the markdown-it plugin set** (per the markdown-preprocessing-hardening PRD). Initial vocabulary: paragraphs, headings (H1–H6), bullet/ordered/task lists, blockquotes, fenced code blocks, links, images, GFM tables with column metadata, callouts, tags (`#tag`), mentions (`@mention`), date badges. As new plugins land — sparklines, charts, drawings, link previews — the generator gains corresponding emit functions and we regenerate the fixture set.

2. **Vetted community samples (secondary, for real-world edge cases).** License-audited markdown documents from public sources, used to catch parsing edge cases the synthetic generator misses:

   - CommonMark spec test cases (CC-BY-SA 4.0 — attribution required)
   - prosemirror-markdown's own test fixtures (MIT)
   - Tiptap's built-in test cases (MIT)
   - Any other open-licensed source we vet later

   Stored in `tests/fixtures/perf/community/` with a per-file `.LICENSE` sidecar and a top-of-repo `tests/fixtures/perf/community/README.md` listing all sources, licenses, and attribution. **GPL/AGPL sources are excluded** to avoid forcing a license change on anything that touches the test corpus.

3. **Local-only personal fixture (developer escape hatch, never committed).** A developer can point the benchmark at any file via `NOTESAGE_PERF_FIXTURE_PATH=/path/to/file.md pnpm test:perf:load`. The benchmark loads it, times it, prints results — and **explicitly does NOT compare against** `perf/load-baseline.json` (since CI can't reproduce the comparison). The output banner says `personal fixture: no regression check possible — use synthetic+community for CI gating`. This is the path you use to validate your real 506 KB book locally without ever copying it.

**Phase 0 fixture milestones:**

- **Phase 0a (ships with the benchmark suite):** Synthetic generator + 5 canonical sizes covering basic markdown only (paragraphs, headings, lists, code blocks, tables, links, images). Enough content to exercise the load pipeline as it exists today and unlock the regression gate.
- **Phase 0b (incremental):** Harvest 3–5 representative community samples, audit licenses, add to `community/`. Adds edge-case parsing coverage.
- **Phase 0c (ongoing):** As markdown-it plugins from the preprocessing-hardening PRD land, extend the synthetic generator's vocabulary and regenerate the canonical fixtures.

This keeps the test corpus license-clean, regeneratable, and structurally extensible — no personal content, no copyright drama, no manual fixture maintenance as the construct set grows.

#### Channel 2 — Real-world auto-captured log (secondary, for live observation)

For real-world data on files we don't have as fixtures (the user's actual workspace), the in-app instrumentation auto-captures every load:

- Behind a single setting `perfLoggingEnabled` (default ON in dev builds, OFF in production releases — exposed via Settings &gt; Advanced for power users).
- When on, every markdown-file open appends one JSON line to `~/.notesage/perf/load-log.jsonl`. Rotation: 10 MB, ring buffer.
- A new `pnpm perf:report` command reads the JSONL, groups by file size bucket, and prints a summary table to stdout. **One command, no spelunking through devtools.**
- Optional `pnpm perf:report --watch` tails the log live as files are opened.

The user never reads JSONL by hand; one command summarizes it. This complements Channel 1: Channel 1 enforces no regression via canonical fixtures; Channel 2 surfaces real-world performance on the user's actual files.

#### CI integration (so AW benefits)

`pnpm test:perf:load` is added as a fourth job in `.github/workflows/test.yml`, alongside frontend / playwright / rust:

- Runs on every PR (human or bot-authored — WORKFLOW_PAT path applies)
- Posts a delta-table comment on the PR, similar to the existing coverage comment, showing per-stage and per-fixture deltas vs main
- Fails the PR check if regression exceeds the threshold; merge-blocking via branch protection

#### AW pipeline integration (so the agent uses it autonomously)

Once Channel 1 ships, the AW pipeline picks it up at two points:

1. `aw-tdd` **hard gate** — `aw-tdd`'s SKILL.md adds `pnpm test:perf:load` to the existing red-not-red / `pnpm test` / typecheck / lint hard-gate list. Any AW-produced PR that regresses the perf budget aborts before the PR opens, same as a failing test.
2. `aw-review` **checklist** — `aw-review`'s SKILL.md adds a per-criterion check: "If the PR touches the markdown load path (`src/lib/markdown.ts`, `src/components/editor/Editor.tsx`, any plugin in `src/components/editor/extensions/`), confirm the perf-load CI job passed and the delta table shows no regression." Reviewer enforces it as part of the standard checklist.

This means the moment Channel 1 lands, every future AW pipeline run on perf-sensitive code automatically gets the regression gate, with no per-PR human reminder.

**The first PR for this PRD ships ONLY Layer 0** (Channels 1 + 2 + Fixture strategy + CI integration + the SKILL.md updates for AW). It changes nothing about the load behavior; it just measures and gates. Then we take a snapshot of the baseline against the synthetic fixture set (and the developer can locally validate against personal content via `NOTESAGE_PERF_FIXTURE_PATH`), and every subsequent PR in this PRD reports its impact in absolute milliseconds against that baseline.

This is what makes the rest of the work falsifiable instead of just plausible — and what makes future AW-driven optimization safe instead of risky.

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
| First open ever, cold cache | L0 + L1 + L2 | First paint &lt;300ms, fully editable in 5–10s background |
| Repeat open, hot cache | L0 + L3 | First paint and editable in &lt;100ms, no preview shown |
| Repeat open, file edited externally (cache miss) | L0 + L1 + L2 | Same as first open ever |
| Schema upgrade invalidates cache | L0 + L1 + L2 | Same as first open ever (one-time per upgrade) |
| Small file (&lt;10 KB) | L0 + direct parse (no preview, no worker) | &lt;50ms — preview/worker overhead would be net-negative |

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

interface MarkdownLoadStageTimings {
  read?: number;
  frontmatter?: number;
  preprocess?: { total: number; perPass: Record<string, number> };
  parseMd?: number;
  setContent?: number;
  pluginInit?: { total: number; perPlugin: Record<string, number> };
  decorations?: { total: number; perPlugin: Record<string, number> };
  cacheHit?: boolean;
  cacheReadMs?: number;
  total: number;
  fileSizeBytes: number;
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

- [ ] **Layer 0 — Channel 1:** `pnpm test:perf:load` runs the headless suite against the synthetic fixture set (1 KB, 10 KB, 100 KB, 500 KB, 1 MB) plus any vetted community fixtures, and exits non-zero on any per-stage regression &gt;20%. Baseline checked into `perf/load-baseline.json`. `pnpm test:perf:load:update` regenerates the baseline. **No app needed, no manual collection.**

- [ ] **Layer 0 — Fixture strategy:** Synthetic generator (`scripts/gen-perf-fixture.mjs`) committed and reproducible. Canonical synthetic fixtures committed at `tests/fixtures/perf/synthetic/`. Community samples (if any) under `tests/fixtures/perf/community/` with per-file `.LICENSE` sidecars and a top-level attribution README. Personal-fixture escape hatch via `NOTESAGE_PERF_FIXTURE_PATH` env var documented in `pnpm test:perf:load --help`. **No personal content committed to the repo, no GPL/AGPL sources, no copyright drama.**

- [ ] **Layer 0 — Channel 2:** With `perfLoggingEnabled=true`, every markdown-file open auto-appends one JSON line to `~/.notesage/perf/load-log.jsonl` (10 MB ring buffer, no manual wiring). `pnpm perf:report` reads the log and prints a summary table; `pnpm perf:report --watch` tails it live. **Zero copy-paste from devtools.**

- [ ] **Layer 0 — CI integration:** `.github/workflows/test.yml` adds a fourth job running `pnpm test:perf:load`. Every PR (human or AW-bot) sees a delta-table comment. Regression beyond threshold blocks merge via branch protection.

- [ ] **Layer 0 — AW integration:** `aw-tdd`'s SKILL.md adds `pnpm test:perf:load` to its hard-gate list. `aw-review`'s SKILL.md adds a check item: "if PR touches markdown load path, confirm perf-load CI passed and delta table shows no regression". Both updates land in the same PR as the benchmark suite.

- [ ] **Layer 0 — Production overhead:** Production builds (built without `__PERF__`) show no measurable regression vs the pre-Layer-0 baseline. Verified by running the new benchmark with `__PERF__=false` and confirming numbers match the pre-instrumentation baseline within noise.

- [ ] **Layer 1:** Opening any markdown file shows readable HTML preview within **300ms p95** on M3 dev hardware. Verified in CI against the 500 KB synthetic fixture; verified locally against the user's real 506 KB book via `NOTESAGE_PERF_FIXTURE_PATH`.

- [ ] **Layer 1 fidelity:** Screenshot diff between preview render and editor render of every test fixture shows &lt;2% pixel difference outside the cursor (run at both 1x and 2x DPR, light and dark mode).

- [ ] **Layer 2:** Worker hydration of the 500 KB synthetic fixture completes within **10s** while the main thread maintains 60 fps (measured via `requestAnimationFrame` instrumentation during hydration). Local-only spot check against the real 506 KB book confirms parity.

- [ ] **Layer 2 swap:** No visible flicker, no scroll-position shift, no layout shift during preview→editor swap. Verified by frame-by-frame video capture of the swap moment.

- [ ] **Layer 3:** Repeat open of any cached file completes in **&lt;100ms p95**, verified across all synthetic fixture sizes; local-only spot check against the real 506 KB book confirms parity.

- [ ] **Layer 3 invalidation:** Editing the file (in Notesage or externally) invalidates the cache; next open uses Layer 1+2 path.

- [ ] **Layer 3 schema invalidation:** Bumping a Tiptap extension's version invalidates all caches at once; verified by integration test.

- [ ] All existing markdown round-trip tests still pass (no regression in parse fidelity).

- [ ] All existing performance benchmarks still pass within budget (no regression for small files).

- [ ] No regression in unit, Playwright E2E, or real E2E test suites.

### Performance Targets (vs Layer 0 baseline)

| File size | First open (p95) | Subsequent open (p95) |
| --- | --- | --- |
| 10 KB | ≤ baseline (no regression) | ≤ baseline |
| 100 KB | &lt;500 ms first paint, &lt;2 s editable | &lt;100 ms |
| 500 KB | &lt;300 ms first paint, &lt;10 s editable | &lt;100 ms |
| 1 MB | &lt;500 ms first paint, &lt;20 s editable | &lt;200 ms |

### Design

- [ ] Preview wrapper visually identical to editor — same fonts, same padding, same line-height, same max-width, same callout/table/code styling.

- [ ] Preview→editor swap is invisible to the user — no flicker, no layout shift, no scroll jump.

- [ ] Loading overlay (only shown when user tries to edit before hydration completes) follows the existing design system: `Tooltip`/`Popover` styling, accent border, no chromatic colors except destructive on error.

- [ ] Settings &gt; Advanced "Clear parse cache" button styled consistently with other destructive actions (uses `Button variant="destructive"`).

## Implementation Phases

This PRD ships in **strictly ordered phases**. No phase begins until the previous one's quality gates are met AND its baseline numbers are captured.

### Phase 0 — Profiling instrumentation (BLOCKING all other phases)

**Channel 1 — Headless benchmark suite (the regression gate):**

- Add `__PERF__`-gated `performance.now()` brackets around every stage in the load path (`src/lib/markdown.ts`, `src/components/editor/Editor.tsx`, plugin init code paths).
- Production builds compile out the brackets via Vite tree-shaking (`__PERF__` defaults to `false`).
- New vitest perf suite at `src/perf/load.perf.test.ts`, modeled on `markdown.perf.test.ts` and `decorations.perf.test.ts`.
- Fixture set per the **fixture strategy** above: `tests/fixtures/perf/synthetic/{1kb,10kb,100kb,500kb,1mb}.md` generated by `scripts/gen-perf-fixture.mjs` (committed; deterministic). Plus any vetted `tests/fixtures/perf/community/` samples added in Phase 0b. Personal content (the real 506 KB book) accessed only via `NOTESAGE_PERF_FIXTURE_PATH` env var; never committed.
- Suite runs each fixture through the actual production load pipeline with `__PERF__=true`, captures per-stage timings, writes structured JSON to `perf/load-baseline.json`.
- Baseline comparison: fail if any per-stage metric regresses by &gt;20%. Threshold lives in `perf/load-baseline.json` and is tunable per-stage as the pipeline stabilizes.
- Scripts: `pnpm test:perf:load` (run + compare), `pnpm test:perf:load:update` (regenerate baseline).

**Channel 2 — Real-world auto-captured log (for live observation):**

- New `perfLoggingEnabled` setting in `settings-store` (default ON in dev, OFF in production releases). Settings &gt; Advanced exposes a toggle for power users.
- When enabled, `loadRawMarkdownIntoEditor` and the editor mount path emit one structured JSON line per file open to `~/.notesage/perf/load-log.jsonl`. Ring buffer at 10 MB.
- New `pnpm perf:report` script reads the JSONL, groups by file size bucket, prints summary table to stdout.
- New `pnpm perf:report --watch` tails the log live (useful when iterating with `pnpm tauri dev`).

**CI integration:**

- Add a fourth job `perf-load` to `.github/workflows/test.yml` running `pnpm test:perf:load` on every PR.
- Job posts a delta-table comment on the PR (similar to the existing coverage comment) showing per-stage and per-fixture deltas vs main.
- Branch protection requires the job to pass before merge.

**AW pipeline integration:**

- Update `.claude/skills/aw-tdd/SKILL.md`: add `pnpm test:perf:load` to the existing red-not-red / `pnpm test` / typecheck / lint hard-gate list.
- Update `.claude/skills/aw-review/SKILL.md`: add a per-criterion check item: "if PR touches markdown load path (`src/lib/markdown.ts`, `src/components/editor/Editor.tsx`, any extension in `src/components/editor/extensions/`), confirm the perf-load CI job passed and the delta table shows no regression beyond threshold."

**Documentation:**

- Add a "Large File Load" section to `docs/performance-baseline.md` with the captured baseline numbers.
- **Output of this phase:** rows in the baseline doc per fixture, e.g. "2026-05-03 baseline: 500 KB synthetic-mixed = X ms total, breakdown: Y ms preprocess, Z ms parse, W ms plugins" — plus a CI job that locks those numbers in. Local supplemental measurement against the real 506 KB book recorded in the baseline doc as a developer-only annotation, not as a regression gate.

### Phase 1 — Rust HTML preview (Layer 1)

- New `render_markdown_preview` Tauri command (thin wrapper over existing `render_html`).
- New preview wrapper component in `src/components/editor/`.
- Preview shown immediately on tab activation; editor mount deferred.
- Screenshot fidelity test infrastructure.
- **Measurement gate:** baseline doc updated with "after Phase 1: first paint = X ms (was Y ms)".

### Phase 2 — Web Worker hydration (Layer 2)

- Refactor `src/lib/markdown.ts` preprocessing helpers to be worker-safe (no DOM deps).
- New worker `src/workers/markdown-parse.worker.ts`.
- Main-thread coordination: kick off worker after preview, swap on result.
- Edit-A path: brief overlay if user clicks before hydration.
- **Measurement gate:** baseline doc updated with "after Phase 2: editable in X ms (was Y ms), main thread fps during hydration = Z".

### Phase 3 — Parsed-state disk cache (Layer 3)

- Cache directory infrastructure (per-project + global).
- `read_parsed_cache` / `write_parsed_cache` / `clear_parsed_cache` Tauri commands.
- Tiptap schema hash computation (one helper that hashes the extension list).
- Cache lookup integrated into the load path before Layer 1.
- iCloud xattr exclusion + gitignore entry.
- Settings &gt; Advanced "Clear parse cache" button.
- **Measurement gate:** baseline doc updated with "after Phase 3: subsequent open = X ms (was Y ms)".

### Phase 4 — Empirical threshold tuning (the deferred Decision)

- Using the 4 phases of baseline data, decide:
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