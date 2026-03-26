# PRD: Performance Observability — Instrumentation, Benchmarks, and Regression Detection

|  |  |
| --- | --- |
| **Date** | 2026-03-26 |
| **Status** | Draft |
| **Priority** | High |
| **Impact** | Data-driven performance decisions, automated regression detection, measurable user experience improvements |

## Problem

Notesage has no systematic way to measure or monitor performance. Tab switches take 50-300ms, keystrokes in large documents can lag 50-130ms, and startup with multiple projects can take 1-3s — but we have no data to know if these numbers are getting better or worse over time. Performance logs were added for tab switching (commit 4e854f3) but 10 of 13 performance-critical areas have zero instrumentation. There are no performance benchmarks or regression tests.

Without visibility, we can't:

- Detect regressions introduced by new features
- Prioritize which areas to optimize (is typing lag worse than tab switching?)
- Set and track performance budgets
- Compare before/after when optimizing

### Performance-critical areas and current state

| Area | User action | Perceived latency | Instrumented? |
| --- | --- | --- | --- |
| App startup | Launch → usable editor | 1-3s | None |
| Tab switching | Click tab → content visible | 50-300ms | `perf:tab-switch`, `perf:tab-load`, `perf:tab-preload` |
| Editor typing | Keystroke → character appears | 35-130ms (large docs) | None |
| File tree loading | Open project → sidebar tree | 50-500ms | None |
| File save | Cmd+S → saved | 50-200ms | None |
| Find in document | Type query → highlights appear | 50-300ms | None |
| Command palette | Cmd+K → results shown | 100-200ms | None |
| AI chat streaming | Send → first token visible | 200-500ms (API) | None |
| Agent/skill loading | Startup → agents in picker | 500ms-2s | None |
| Slash/tag/mention popup | Type trigger → popup visible | &lt;100ms | None |
| Document index queries | Tag search → results | 20-150ms (cold: up to 5s) | None |
| Sidebar interactions | Expand/collapse → response | &lt;16ms (60fps) | None |

### Where time is actually spent

**App startup (serial bottleneck):** `listDirectory()` called sequentially per project/folder (\~50-100ms each), then `indexInit()` per project (500ms-5s each). 5 projects = 1-2s just for tree validation.

**Tab switching:** Cache restore is fast (\~65-80ms total). Parse from markdown is slow (\~100-300ms) because `prosemirror-markdown` rebuilds the entire document model. Double-rAF scroll restoration adds 16-32ms.

**Editor typing:** 6-8 decoration plugins (`SearchHighlight`, `TagHighlight`, `CommentMark`, `InlineDiff`, `GhostText`, `AISuggestion`, `MentionHighlight`, `DateHighlight`) each run `apply()` on every transaction. Large documents (&gt;50KB) can see 50-100ms per keystroke in decoration rebuilds alone.

**Find in document:** Full document scan via `doc.descendants()` on every search keystroke. No incremental matching.

## Goals

1. **Full instrumentation** — All 13 performance-critical areas emit structured `perf:*` debug logs with timing, file sizes, and context (gated behind debug log level)
2. **Performance benchmark suite** — Vitest tests that measure key operations against synthetic documents of known sizes (1KB, 10KB, 50KB, 100KB) and assert timing budgets
3. **Regression detection** — `pnpm test:perf` runs benchmarks and fails if any operation exceeds its budget, runnable in CI
4. **Performance baseline document** — Measured baseline numbers for all areas on reference hardware, checked into the repo

## Non-Goals

- Real-time performance monitoring dashboard or APM integration
- Optimizing any specific area (this PRD is about visibility; optimization PRDs follow from the data)
- User-facing performance metrics (no "page loaded in X ms" UI)
- Mobile or cross-platform benchmarking
- Profiling Rust backend performance (cargo bench is a separate effort)

## User Stories

- As a **developer**, I want to see structured timing logs for any user action by setting log level to "debug", so I can diagnose performance issues
- As a **developer**, I want to run `pnpm test:perf` and see if any operation has regressed beyond its budget, so I can catch problems before release
- As a **reviewer**, I want CI to flag performance regressions on PRs that touch critical paths, so we don't ship slowdowns

## Technical Approach

### Phase 1: Instrumentation

Add `log.debug("perf:<category>", "<action>", { ...data })` calls to all uninstrumented areas. All logs use structured objects (not string interpolation) with consistent fields:

**Standard fields:**

- `file` — filename (not full path) when applicable
- `sizeKB` — file/content size in KB
- `ms` — duration in milliseconds
- `count` — item count when applicable

**Categories and log points:**

| Category | Log point | Data |
| --- | --- | --- |
| `perf:startup` | Tree reload complete | `{ projects, folders, totalFiles, ms }` |
| `perf:startup` | Index init complete | `{ project, fileCount, ms }` |
| `perf:startup` | Tabs restored | `{ tabCount, activeTab, ms }` |
| `perf:startup` | App ready (startupReady=true) | `{ totalMs }` |
| `perf:tab-switch` | Editor state restored | `{ file, sizeKB, restore, setupMs }` (exists) |
| `perf:tab-switch` | Tab visible | `{ file, scroll, totalMs }` (exists) |
| `perf:tab-load` | Content loaded from disk | `{ file, type, sizeKB, ms }` (exists) |
| `perf:tab-preload` | Background preload | `{ file, type, sizeKB, ms }` (exists) |
| `perf:typing` | Decoration rebuild | `{ plugin, nodeCount, decorationCount, ms }` |
| `perf:save` | File saved | `{ file, sizeKB, serializeMs, writeMs, totalMs }` |
| `perf:find` | Search executed | `{ query, matchCount, docSizeKB, ms }` |
| `perf:palette` | Results rendered | `{ mode, query, resultCount, ms }` |
| `perf:ai-chat` | First token received | `{ provider, model, promptTokens, ms }` |
| `perf:ai-chat` | Stream complete | `{ provider, model, totalTokens, ms }` |
| `perf:skills` | Discovery complete | `{ skillCount, agentCount, ms }` |
| `perf:tree` | Directory listed | `{ path, fileCount, ms }` |
| `perf:tree` | Tree rendered | `{ section, itemCount, ms }` |
| `perf:index` | Index built | `{ project, fileCount, ms }` |
| `perf:index` | Query executed | `{ type, query, resultCount, ms }` |

**Files to instrument:**

| File | Category |
| --- | --- |
| `src/hooks/useAppLifecycle.ts` | `perf:startup` |
| `src/hooks/useEditorTabSwitch.ts` | `perf:tab-switch` (already done) |
| `src/components/editor/Editor.tsx` | `perf:tab-load`, `perf:tab-preload` (already done) |
| `src/hooks/useEditor.ts` (onUpdate) | `perf:typing` |
| `src/components/editor/extensions/search-highlight.ts` | `perf:find` |
| `src/hooks/useFileOperations.ts` | `perf:save`, `perf:tree` |
| `src/components/CommandPalette.tsx` | `perf:palette` |
| `src/hooks/useDirectApiChat.ts` | `perf:ai-chat` |
| `src/hooks/useSkillOperations.ts` | `perf:skills` |
| `src/stores/workspace-store.ts` | `perf:tree` |
| `src-tauri/src/index/mod.rs` | `perf:index` (Rust-side logging) |

### Phase 2: Performance Benchmark Suite

Create vitest-based performance tests that run key operations on synthetic documents and assert timing budgets.

**Test structure:**

```
src/perf/
  tab-switch.perf.ts       # Tab switch with cache vs parse at various sizes
  markdown-parse.perf.ts   # Markdown → ProseMirror at 1KB, 10KB, 50KB, 100KB
  markdown-serialize.perf.ts # ProseMirror → markdown at various sizes
  search.perf.ts           # Find-in-document at various doc sizes
  decoration-rebuild.perf.ts # Tag/search/comment decoration rebuild
  store-operations.perf.ts # Zustand store read/write at various state sizes
```

**Synthetic test documents:**

Generate markdown fixtures programmatically in test setup:

- `smallDoc` — 1KB (10 paragraphs)
- `mediumDoc` — 10KB (100 paragraphs, mixed formatting)
- `largeDoc` — 50KB (500 paragraphs, tables, code blocks, lists)
- `extraLargeDoc` — 100KB (1000 paragraphs, heavy formatting)

**Timing approach:**

```typescript
function benchmark(name: string, fn: () => void, budget: number) {
  const t0 = performance.now();
  fn();
  const elapsed = performance.now() - t0;
  expect(elapsed).toBeLessThan(budget);
  // Also log for trend analysis
  console.log(`[perf] ${name}: ${elapsed.toFixed(1)}ms (budget: ${budget}ms)`);
}
```

**Budget examples (initial, adjust from baseline measurements):**

| Operation | 1KB | 10KB | 50KB | 100KB |
| --- | --- | --- | --- | --- |
| Markdown → ProseMirror parse | 5ms | 20ms | 80ms | 200ms |
| ProseMirror → markdown serialize | 5ms | 15ms | 60ms | 150ms |
| Search decoration rebuild | 2ms | 10ms | 40ms | 100ms |
| Tag decoration rebuild | 2ms | 8ms | 30ms | 80ms |

**Scripts:**

```json
{
  "test:perf": "vitest run --reporter=verbose src/perf/"
}
```

### Phase 3: Baseline Document

After Phase 1 and 2 are complete, record measured numbers on reference hardware and save as `docs/performance-baseline.md`:

- Machine specs (CPU, RAM, macOS version)
- Date measured
- For each benchmark: median time across 10 runs, at each document size
- For each instrumented area: typical latency range observed during manual testing
- Budgets derived from baseline (e.g., 2x baseline = budget ceiling)

This document is the reference point for regression detection.

### Phase 4: CI Integration

- Add `pnpm test:perf` to CI pipeline
- Performance tests run after unit tests pass
- Budget violations fail the build with clear output showing which operation regressed and by how much
- Optional: store benchmark results as CI artifacts for trend tracking

## Dependencies

| Dependency | Purpose | Status |
| --- | --- | --- |
| `vitest` | Performance test runner | Already installed (v4.0.18) |
| `@testing-library/react` | Hook testing for perf benchmarks | Already installed |
| `jsdom` | DOM environment for ProseMirror benchmarks | Already installed |
| `src/lib/logger.ts` | Structured logging with `perf:*` categories | Already exists |

No new dependencies required.

## Quality Gates

### Phase 1: Instrumentation

- [ ] All 13 areas from the table above have at least one `perf:*` log

- [ ] All logs use structured objects with consistent field names

- [ ] Logs only visible when log level is set to "debug"

- [ ] No measurable performance impact from the logging itself (&lt;1ms overhead per log)

- [ ] `perf:` filter in browser console shows all performance logs

### Phase 2: Benchmarks

- [ ] `pnpm test:perf` runs 20+ benchmark tests

- [ ] Tests cover: markdown parse, serialize, search, decoration rebuild, store operations

- [ ] Each test runs at 4 document sizes (1KB, 10KB, 50KB, 100KB)

- [ ] Timing budgets defined and enforced via `expect(elapsed).toBeLessThan(budget)`

- [ ] Tests complete in &lt;30s total

### Phase 3: Baseline

- [ ] `docs/performance-baseline.md` exists with measured numbers

- [ ] Covers all benchmarked operations at all sizes

- [ ] Includes machine specs and measurement date

- [ ] Budgets derived from baseline (documented rationale)

### Phase 4: CI

- [ ] `pnpm test:perf` runs in CI on every PR

- [ ] Budget violations produce clear error messages

- [ ] CI passes on current main branch

## Out of Scope

- Optimizing any specific bottleneck (separate PRDs per area, informed by this data)
- Rust-side benchmarks (`cargo bench`) — valuable but separate effort
- Real-time monitoring / APM / telemetry
- User-facing performance indicators
- Flame graph profiling integration
- Memory usage benchmarks (focus is on latency)
- Network performance (API latency is external)