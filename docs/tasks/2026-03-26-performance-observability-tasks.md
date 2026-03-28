# Performance Observability Tasks

|  |  |
| --- | --- |
| **Date** | 2026-03-26 |
| **Status** | In progress |
| **PRD** | [performance-observability](../prds/2026-03-26-performance-observability.md) |
| **Total** | 16 tasks: 6S, 6M, 4L |
| **Suggested order** | Instrumentation (#1-#9) → Benchmark infra (#10-#11) → Benchmark tests (#12-#14) → Baseline (#15) → CI (#16) |

**Risks:**

- Decoration plugin instrumentation (#5) adds `performance.now()` calls to every keystroke — must verify overhead is &lt;1ms even on large documents
- ProseMirror benchmark tests (#12, #13) require creating a real editor instance in jsdom — may need the same Tiptap extension setup as `markdown-roundtrip.test.ts`
- Budget numbers (#15) are machine-dependent — CI machines may be faster/slower than dev machines, budgets need generous headroom (3x baseline recommended for CI)

---

## Phase 1: Instrumentation

### #1 — Instrument app startup ✅

**Description:** Add `perf:startup` logs to `useAppLifecycle.ts`. Capture `performance.now()` at the start of `reloadTrees()`, then log after each major step: tree validation complete (`{ projects, folders, totalFiles, ms }`), index init per project (`{ project, fileCount, ms }`), tabs restored (`{ tabCount, activeTab, ms }`), and `startupReady=true` (`{ totalMs }`). Also log the tab restoration step in `restorePersistedTabs()`.

**Complexity:** M | **Category:** frontend | **Dependencies:** None

**Files:** `src/hooks/useAppLifecycle.ts`

---

### #2 — Instrument file save ✅

**Description:** Add `perf:save` logs to `useFileOperations.ts`. In `saveFile()`, measure: markdown serialization time (time to call `serializeFrontmatter` + content prep), Tauri write time (time for `tauriApi.writeFile`), and total. Log `{ file, sizeKB, serializeMs, writeMs, totalMs }`.

**Complexity:** S | **Category:** frontend | **Dependencies:** None

**Files:** `src/hooks/useFileOperations.ts`

---

### #3 — Instrument file tree loading ✅

**Description:** Add `perf:tree` logs to `workspace-store.ts` and `useFileOperations.ts`. In `refreshFileTree()` and the store's tree-update actions, measure time for each `tauriApi.listDirectory()` call. Log `{ path, fileCount, ms }` where `path` is the last path segment (not full path). Also log the total tree refresh: `{ sections, totalFiles, ms }`.

**Complexity:** S | **Category:** frontend | **Dependencies:** None

**Files:** `src/hooks/useFileOperations.ts`, `src/stores/workspace-store.ts`

---

### #4 — Instrument find in document ✅

**Description:** Add `perf:find` logs to `search-highlight.ts`. In the `findMatches()` function, measure time to walk the document and build the match list. Log `{ query, matchCount, docNodes, ms }` where `docNodes` is `doc.nodeSize`. Only log when query is non-empty (skip empty-query clears).

**Complexity:** S | **Category:** frontend | **Dependencies:** None

**Files:** `src/components/editor/extensions/search-highlight.ts`

---

### #5 — Instrument editor typing (decoration plugins) ✅

**Description:** Add `perf:typing` logs to the `apply()` method of the 3 heaviest decoration plugins: `TagHighlight`, `SearchHighlight`, and `CommentMark`. Only log when `tr.docChanged` is true (skip selection-only transactions). Log `{ plugin, docNodes, decorationCount, ms }`. Use a sampling strategy: only log every 10th keystroke to avoid console spam (use a module-level counter). Verify overhead is &lt;1ms on a 50KB document.

**Complexity:** M | **Category:** frontend | **Dependencies:** None

**Files:** `src/components/editor/extensions/tag-highlight.ts`, `src/components/editor/extensions/search-highlight.ts`, `src/components/editor/extensions/comment-mark.ts`

---

### #6 — Instrument command palette ✅

**Description:** Add `perf:palette` logs to `CommandPalette.tsx`. Measure time from mode change or query change to results rendered. Log `{ mode, query, resultCount, ms }` where `mode` is "files", "tags", "mentions", "commands", or "research". For index-backed modes (tags, mentions, research), measure the Tauri IPC call time separately.

**Complexity:** M | **Category:** frontend | **Dependencies:** None

**Files:** `src/components/CommandPalette.tsx`

---

### #7 — Instrument AI chat streaming ✅

**Description:** Add `perf:ai-chat` logs to `useDirectApiChat.ts`. Capture `performance.now()` when `sendChatMessage` is called. Log "First token" when the first `ai-stream-chunk` event arrives (`{ provider, ms }`). Log "Stream complete" when `ai-stream-done` fires (`{ provider, totalTokens, ms }`). For ACP path, add equivalent logs around `acp_session_prompt`.

**Complexity:** M | **Category:** frontend | **Dependencies:** None

**Files:** `src/hooks/useDirectApiChat.ts`

---

### #8 — Instrument skill/agent discovery ✅

**Description:** Add `perf:skills` logs to `useSkillOperations.ts`. Measure the full discovery pipeline: bundled extraction, skill scanning, agent scanning, instruction scanning. Log individual steps (`{ step, ms }`) and the total (`{ skillCount, agentCount, totalMs }`).

**Complexity:** S | **Category:** frontend | **Dependencies:** None

**Files:** `src/hooks/useSkillOperations.ts`

---

### #9 — Instrument document index (Rust backend) ✅

**Description:** Add timing logs to `src-tauri/src/index/mod.rs` for index build and query operations. Use `std::time::Instant` to measure `build_index()` per project and each query function. Log via Rust's `log::debug!` macro (already configured). Log `[perf:index] build: project={} files={} ms={}` and `[perf:index] query: type={} results={} ms={}`.

**Complexity:** M | **Category:** backend | **Dependencies:** None

**Files:** `src-tauri/src/index/mod.rs`

---

## Phase 2: Benchmark Infrastructure

### #10 — Create benchmark harness and synthetic document generator

**Description:** Create `src/perf/harness.ts` with: (a) `benchmark(name, fn, budgetMs)` — runs function, asserts `elapsed < budget`, logs result as structured output. (b) `generateMarkdown(sizeKB)` — generates synthetic markdown with realistic content (headings, paragraphs, bold/italic, lists, code blocks, tables, `#tags`, `@mentions`) at approximately the target size. (c) `DOC_SIZES` constant: `{ small: 1, medium: 10, large: 50, extraLarge: 100 }`. (d) `createTestEditor(content)` — creates a Tiptap editor with the same extensions as the real app (reuse the pattern from `markdown-roundtrip.test.ts`). Add `"test:perf": "vitest run src/perf/"` to `package.json`.

**Complexity:** L | **Category:** frontend | **Dependencies:** None

**Files:** new: `src/perf/harness.ts`; modified: `package.json`

---

### #11 — Create synthetic document fixtures

**Description:** Using the `generateMarkdown()` function from #10, create 4 fixture files in `tests/fixtures/perf/`: `perf-1kb.md`, `perf-10kb.md`, `perf-50kb.md`, `perf-100kb.md`. These serve as reproducible inputs for benchmarks. Verify actual sizes are within 10% of target. Include a mix of all supported syntax: headings (H1-H4), paragraphs, bold, italic, inline code, bullet lists, ordered lists, task lists, blockquotes, code blocks with language, tables, horizontal rules, links, `#tags`, `@mentions`.

**Complexity:** S | **Category:** frontend | **Dependencies:** #10

**Files:** new: `tests/fixtures/perf/perf-1kb.md`, `perf-10kb.md`, `perf-50kb.md`, `perf-100kb.md`

---

## Phase 3: Benchmark Tests

### #12 — Benchmark: markdown parse and serialize

**Description:** Create `src/perf/markdown.perf.ts`. For each fixture size: (a) parse markdown → ProseMirror doc, assert under budget. (b) serialize ProseMirror doc → markdown, assert under budget. Use `createTestEditor(content)` from harness. Initial budgets (generous, tighten from baseline): parse 1KB/10ms, 10KB/50ms, 50KB/200ms, 100KB/500ms. Serialize: same budgets. Run each 3 times, use median.

**Complexity:** L | **Category:** frontend | **Dependencies:** #10, #11

**Files:** new: `src/perf/markdown.perf.ts`

---

### #13 — Benchmark: search and decoration rebuild

**Description:** Create `src/perf/decorations.perf.ts`. For each fixture size: (a) search decoration rebuild: call `findMatches(doc, "the")` and `buildDecorations()`, assert under budget. (b) tag decoration rebuild: dispatch a doc-change transaction on a doc with `#tag` patterns, measure `TagHighlight` plugin rebuild time. Initial budgets: search 1KB/5ms, 10KB/20ms, 50KB/80ms, 100KB/200ms. Tag: same or slightly less.

**Complexity:** L | **Category:** frontend | **Dependencies:** #10, #11

**Files:** new: `src/perf/decorations.perf.ts`

---

### #14 — Benchmark: store operations and command palette filtering

**Description:** Create `src/perf/stores.perf.ts`. Tests: (a) Zustand `editor-store.updateTabContent()` with varying tab counts (10, 50, 100 tabs), assert &lt;5ms. (b) Workspace store `listDirectory` result processing with varying file counts (100, 500, 1000 entries), assert &lt;10ms. (c) Command palette filtering: generate 500 file entries, filter with a 3-char query, assert &lt;20ms. No Tauri IPC needed — test pure JS logic.

**Complexity:** M | **Category:** frontend | **Dependencies:** #10

**Files:** new: `src/perf/stores.perf.ts`

---

## Phase 4: Baseline and CI

### #15 — Record performance baseline

**Description:** Run `pnpm test:perf` 10 times on the development machine. Record median values for all benchmarks. Create `docs/performance-baseline.md` with: machine specs (chip, RAM, macOS version, Node version), date, table of results per operation per size, and derived budgets (2x median for dev, 3x median for CI). Update the benchmark budgets in the test files to match the 2x-median values.

**Complexity:** M | **Category:** frontend | **Dependencies:** #12, #13, #14

**Files:** new: `docs/performance-baseline.md`; modified: `src/perf/*.perf.ts` (budget adjustments)

---

### #16 — Add performance tests to CI

**Description:** Add `pnpm test:perf` step to the CI workflow (`.github/workflows/test.yml` if it exists from test-infrastructure tasks, otherwise create it). Run after unit tests pass. Use CI budgets (3x baseline). On failure, output a clear table showing which operation exceeded its budget and by how much. Upload benchmark results as a CI artifact for trend tracking.

**Complexity:** M | **Category:** both | **Dependencies:** #15

**Files:** `.github/workflows/test.yml` (create or modify)