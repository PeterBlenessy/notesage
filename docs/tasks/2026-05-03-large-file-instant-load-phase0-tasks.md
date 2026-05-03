# Tasks: Large File Instant Load — Phase 0 (Profiling Instrumentation)

|  |  |
| --- | --- |
| **Date** | 2026-05-03 |
| **Status** | Not started |
| **PRD** | [large-file-instant-load](../prds/2026-05-03-large-file-instant-load.md) |
| **Phase** | 0 of 4 — blocking all subsequent phases |
| **Total** | 18 tasks: 8S, 7M, 3L |
| **Suggested order** | Sub-batch A (build flag + instrumentation: #1–#3) → Sub-batch B (fixtures: #4–#5) → Sub-batch C (benchmark suite: #6–#8) → Sub-batch D (auto-capture: #9–#12) → Sub-batch E (CI + AW + docs: #13–#17) → Phase 0b incremental: #18 |

## Risks / open questions

- **`__PERF__` flag mechanics in Vite + Tauri.** Vite supports `define` for build-time replacements but Tauri's dev server may need extra wiring. Spike during Task #1 to confirm — if the flag can't compile out cleanly, fall back to a runtime `process.env.NODE_ENV === 'test'` check (slightly worse, still acceptable since the perf brackets are tiny).
- **JSONL log location on dev vs production builds.** `~/.notesage/perf/load-log.jsonl` is fine in both, but the rotation logic must be Tauri-bundled (no JS-only fs access). Confirm during Task #10.
- **Synthetic fixture realism.** The mix preset must be representative of the real cost distribution. Initial mix is a guess; after Phase 0a baseline lands, compare its per-stage breakdown against the developer-only run on the real 506 KB book and adjust the mix if the shapes diverge significantly.
- **CI runtime budget.** The benchmark adds runtime to every PR. Target <60s wall-clock for the perf-load job to keep CI quick; if 1MB fixture pushes that, gate it behind a label or run only on PRs that touch the load path.
- **AW skill update conflicts.** `aw-tdd` and `aw-review` SKILL.md edits in Tasks #14, #15 might conflict with parallel AW work. Coordinate by landing them in their own small PR before any other AW-driven feature work begins.

---

## Sub-batch A — Build flag + instrumentation

### #1 — Add `__PERF__` build flag to Vite + TypeScript

| Field | Value |
| --- | --- |
| **Description** | Define a global `__PERF__` boolean flag in `vite.config.ts` (and `vitest.config.ts` / `vitest.perf.config.ts`) using Vite's `define` replacement. Production builds → `false`, perf-test runs → `true`. Add `declare const __PERF__: boolean;` to a global `.d.ts` so TypeScript recognizes it. Test that `if (__PERF__) { … }` is dead-code-eliminated in production (`pnpm tauri build` then grep the bundle for the dead branch). |
| **Complexity** | S |
| **Category** | both |
| **Dependencies** | none |
| **Files** | `vite.config.ts`, `vitest.config.ts`, `vitest.perf.config.ts`, `src/types/perf-flag.d.ts` (new) |

### #2 — Instrument markdown.ts preprocessing + parse path

| Field | Value |
| --- | --- |
| **Description** | Add a small timing helper (e.g., `markStage(name, fn)`) that's a no-op when `__PERF__` is false. Wrap each of the 13 preprocessing functions (`stripGhostTaskItems`, `normalizeEmptyTaskItems`, `convertMermaidToHtml`, `convertCalloutsToHtml`, `convertPageBreaksToHtml`, `convertTocToHtml`, `convertLinkPreviewsToHtml`, `convertDrawingsToHtml`, `convertChartsToHtml`, `convertInlineDrawingsToHtml`, `convertInlineChartsToHtml`, `encodeImagePathSpaces`, `convertDataUriImagesToHtml`) plus `stripAnnotationsFromMarkdown`, `stripNodeIdComments`, `extractTableColumnMetadata`, and the markdown-it parse + `setContent` calls inside `loadRawMarkdownIntoEditor`. Records go into a per-load in-process collector, flushed once per load completion. Confirm production build shows zero overhead via Task #17. |
| **Complexity** | M |
| **Category** | frontend |
| **Dependencies** | Depends on #1 |
| **Files** | `src/lib/markdown.ts`, new `src/lib/perf-stage.ts` (helper) |

### #3 — Instrument editor mount + plugin appendTransaction init

| Field | Value |
| --- | --- |
| **Description** | Wrap the editor mount path in `Editor.tsx` (tab activation → first interactive paint) with stage markers. For each ProseMirror plugin in `src/components/editor/extensions/` (tag-highlight, mention-highlight, date-highlight, search-highlight, comment-mark, table-aggregation, table-sort, table-filter, table-sparkline, table-header-menu, page-breaks, ai-suggestion), wrap the first-init `appendTransaction` with a per-plugin timing record. Use the same collector from #2. Final stage `perf:load:total` records wall-clock from tab-activation event to `editor.isEditable === true`. |
| **Complexity** | M |
| **Category** | frontend |
| **Dependencies** | Depends on #1, #2 |
| **Files** | `src/components/editor/Editor.tsx`, every file in `src/components/editor/extensions/` that defines an `appendTransaction` |

---

## Sub-batch B — Fixtures

### #4 — Synthetic fixture generator script

| Field | Value |
| --- | --- |
| **Description** | New `scripts/gen-perf-fixture.mjs` (Node, no Tauri deps) that produces deterministic markdown documents. CLI flags: `--size <kb>` (target file size), `--mix <basic|book|tables|mixed>` (construct mix preset), `--seed <n>` (RNG seed, default 42), `--out <path>`. Emits content using a vocabulary of: paragraphs (Lorem-ish), H1–H6 headings, bullet/ordered/task lists, blockquotes, fenced code blocks (multiple languages), links (internal `[text](./file.md)` + external), images, GFM tables (with `<!-- type:currency,summary:sum -->` column metadata), callouts (`> [!note]`, etc.), tags (`#tag`), mentions (`@person`), date badges (`//YYYY-MM-DD`). The `mixed` preset uses proportions roughly representative of the real 506 KB book (high heading + table density). Output is byte-stable for a given (size, mix, seed) tuple. |
| **Complexity** | L |
| **Category** | both (script lives at repo root, used by frontend tests) |
| **Dependencies** | none |
| **Files** | `scripts/gen-perf-fixture.mjs` (new), `scripts/perf-fixture-vocab.mjs` (new — split out the construct emitters for testability) |

### #5 — Generate canonical fixture set + commit

| Field | Value |
| --- | --- |
| **Description** | Run the generator from #4 to produce `tests/fixtures/perf/synthetic/{1kb,10kb,100kb,500kb,1mb}.md` using the `mixed` preset and seed 42. Commit the output files. Add a `tests/fixtures/perf/README.md` documenting the source script, the seed, the mix preset, and how to regenerate (`node scripts/gen-perf-fixture.mjs --size 500 --mix mixed --seed 42 --out tests/fixtures/perf/synthetic/500kb.md`). Add a top-level `tests/fixtures/perf/community/.gitkeep` placeholder for Phase 0b. |
| **Complexity** | S |
| **Category** | both |
| **Dependencies** | Depends on #4 |
| **Files** | `tests/fixtures/perf/synthetic/{1kb,10kb,100kb,500kb,1mb}.md`, `tests/fixtures/perf/README.md` (new), `tests/fixtures/perf/community/.gitkeep` (new) |

---

## Sub-batch C — Benchmark suite

### #6 — Vitest perf suite for load pipeline

| Field | Value |
| --- | --- |
| **Description** | New `src/perf/load.perf.test.ts`, modeled on the existing `src/perf/markdown.perf.test.ts` and `src/perf/decorations.perf.test.ts`. For each fixture in `tests/fixtures/perf/synthetic/`, run the actual production load pipeline (the same code paths `Editor.tsx` invokes — `loadRawMarkdownIntoEditor` plus a Tiptap editor created via the existing `createTestEditor` harness with the production extension set). Capture per-stage timings via the collector from #2/#3. Write structured JSON to `perf/load-baseline.json`. Compare current run against the checked-in baseline; fail (`expect(deltaPct).toBeLessThan(threshold)`) on any per-stage regression beyond per-stage threshold (default 20%, tunable via `perf/load-baseline.json`'s metadata block). Supports `NOTESAGE_PERF_FIXTURE_PATH` env var: when set, additionally loads that file, prints results with banner `personal fixture: no regression check possible`, and skips the regression assertion for that fixture only. |
| **Complexity** | L |
| **Category** | frontend |
| **Dependencies** | Depends on #2, #3, #5 |
| **Files** | `src/perf/load.perf.test.ts` (new), `perf/load-baseline.json` (new — committed seed file with placeholder thresholds; first real run replaces with actual numbers via Task #15) |

### #7 — Package.json scripts: `test:perf:load` and `test:perf:load:update`

| Field | Value |
| --- | --- |
| **Description** | Add to `package.json` scripts block: `test:perf:load` (runs `vitest run -c vitest.perf.config.ts src/perf/load.perf.test.ts`) and `test:perf:load:update` (same with `UPDATE_BASELINE=1` env var that the suite reads to write the new numbers to `perf/load-baseline.json` instead of comparing). Mirror the convention of existing `coverage:check` / `coverage:update-baseline` scripts. |
| **Complexity** | S |
| **Category** | frontend |
| **Dependencies** | Depends on #6 |
| **Files** | `package.json` |

### #8 — `--help` text documents `NOTESAGE_PERF_FIXTURE_PATH`

| Field | Value |
| --- | --- |
| **Description** | The benchmark suite prints a startup banner when invoked. Include in the banner: usage of `NOTESAGE_PERF_FIXTURE_PATH=/path/to/file.md pnpm test:perf:load` to point at a personal fixture, plus the `personal fixture: no regression check possible` warning. Also add a brief `# Performance Testing` section to `README.md` documenting how to run the suite, regenerate fixtures, and use the personal-fixture escape hatch. |
| **Complexity** | S |
| **Category** | frontend |
| **Dependencies** | Depends on #7 |
| **Files** | `src/perf/load.perf.test.ts`, `README.md` |

---

## Sub-batch D — Auto-capture (Channel 2)

### #9 — Settings store field + Settings > Advanced toggle

| Field | Value |
| --- | --- |
| **Description** | Add `perfLoggingEnabled: boolean` to `settings-store`. Default: `true` in dev builds (detected via `import.meta.env.DEV`), `false` in production. Add a toggle to Settings > Advanced labeled "Performance logging (auto-capture file load timings)" with subtitle "Writes structured JSON to ~/.notesage/perf/load-log.jsonl. Used by `pnpm perf:report`. No identifying file content is captured." |
| **Complexity** | S |
| **Category** | frontend |
| **Dependencies** | none |
| **Files** | `src/stores/settings-store.ts`, `src/components/settings/v2/AdvancedSettings.tsx` (or wherever the v2 advanced panel lives) |

### #10 — Tauri command: append JSONL line with rotation

| Field | Value |
| --- | --- |
| **Description** | New Tauri command `perf_log_append(line: String) -> Result<(), String>` in a new `src-tauri/src/commands/perf_log.rs` module. Appends `line\n` to `~/.notesage/perf/load-log.jsonl`, creating directories as needed. Rotation: if the file exceeds 10 MB, rename to `load-log.jsonl.1` (overwriting any existing `.1`) and start fresh. Uses the same path-resolution helpers as other home-directory file ops (mirror the pattern in `src-tauri/src/commands/store.rs` or `transcription.rs`). Wire into `lib.rs` `generate_handler!` macro. Add unit tests for the rotation logic. |
| **Complexity** | M |
| **Category** | backend |
| **Dependencies** | none |
| **Files** | `src-tauri/src/commands/perf_log.rs` (new), `src-tauri/src/commands/mod.rs`, `src-tauri/src/lib.rs` |

### #11 — Frontend: emit JSONL record on each load when enabled

| Field | Value |
| --- | --- |
| **Description** | At the end of `loadRawMarkdownIntoEditor` (or wherever `perf:load:total` is emitted in #3), if `useSettingsStore.getState().perfLoggingEnabled === true`, serialize the collected per-stage timings as one JSON object and call `tauriApi.perfLogAppend(JSON.stringify(record))`. The record schema: `{ timestamp, fileSize, fileType, stages: { read, frontmatter, preprocess: {...per-pass}, parseMd, setContent, pluginInit: {...per-plugin}, decorations: {...per-plugin}, total } }`. Fire-and-forget; don't block the load on the IPC. |
| **Complexity** | S |
| **Category** | frontend |
| **Dependencies** | Depends on #3, #9, #10 |
| **Files** | `src/lib/markdown.ts`, `src/lib/tauri.ts` |

### #12 — `pnpm perf:report` script (summary + `--watch`)

| Field | Value |
| --- | --- |
| **Description** | New Node script `scripts/perf-report.mjs` that reads `~/.notesage/perf/load-log.jsonl`, groups records by file size bucket (`<10KB`, `10-100KB`, `100-500KB`, `>500KB`), computes per-stage p50/p95 per bucket, prints a summary table to stdout. Flag `--watch` tails the file (re-reads on append, prints new records as they arrive — use `fs.watch` or a polling loop). Add `perf:report` script to `package.json` invoking this. |
| **Complexity** | M |
| **Category** | frontend |
| **Dependencies** | Depends on #11 |
| **Files** | `scripts/perf-report.mjs` (new), `package.json` |

---

## Sub-batch E — CI + AW + docs

### #13 — Add `perf-load` job to `.github/workflows/test.yml`

| Field | Value |
| --- | --- |
| **Description** | Add a fourth job `perf-load` to the test workflow, alongside `frontend-tests`, `playwright-e2e`, `rust-backend`. Job runs `pnpm test:perf:load` (with `PERF_BUDGET_MULTIPLIER=2.0` for CI runner variance, mirroring how the existing perf job uses `1.5`). On regression beyond threshold, the job fails. Add the job to branch protection's required checks via repo admin (call this out in the PR description so the user can flip the setting after merge). Use a posting action (or GitHub Script step) to comment a delta table on the PR — keep this simple in v1: just a markdown table showing per-stage current ms, baseline ms, delta %, status icon. |
| **Complexity** | M |
| **Category** | both |
| **Dependencies** | Depends on #6, #7 |
| **Files** | `.github/workflows/test.yml` |

### #14 — Update `aw-tdd` SKILL.md hard-gate list

| Field | Value |
| --- | --- |
| **Description** | Add `pnpm test:perf:load` to the list of hard gates in `.claude/skills/aw-tdd/SKILL.md` (next to the existing `pnpm test`, `pnpm typecheck`, `pnpm lint`, red-not-red, no-unrelated-files-modified gates). Phrase it consistently with the existing format. Note that this gate only applies once the perf suite is committed (i.e., after Tasks #6–#8 land); add an interim note that the gate is conditional on the suite's existence to handle the gap between this PR landing and the suite landing if they're separate. |
| **Complexity** | S |
| **Category** | both |
| **Dependencies** | Depends on #6 |
| **Files** | `.claude/skills/aw-tdd/SKILL.md` |

### #15 — Update `aw-review` SKILL.md checklist

| Field | Value |
| --- | --- |
| **Description** | Add a per-criterion check item to `.claude/skills/aw-review/SKILL.md`: "If the PR diff touches `src/lib/markdown.ts`, `src/components/editor/Editor.tsx`, or any file in `src/components/editor/extensions/`, confirm that the `perf-load` CI job passed and that the delta-table comment shows no per-stage regression beyond the threshold." Phrase it as a definite item in the standard reviewer checklist, not an optional one. |
| **Complexity** | S |
| **Category** | both |
| **Dependencies** | Depends on #13 |
| **Files** | `.claude/skills/aw-review/SKILL.md` |

### #16 — Add "Large File Load" section to `docs/performance-baseline.md`

| Field | Value |
| --- | --- |
| **Description** | After running `pnpm test:perf:load:update` to capture the first real baseline, append a new "Large File Load" section to `docs/performance-baseline.md` with the captured numbers per fixture (1KB, 10KB, 100KB, 500KB, 1MB) showing per-stage breakdowns (read, frontmatter, preprocess subtotal, parse-md, setContent, plugin-init subtotal, decorations subtotal, total). Include a developer-only annotation row at the bottom for the personal 506 KB book result (run locally via `NOTESAGE_PERF_FIXTURE_PATH`), explicitly labeled "developer-only, not a regression gate". This is the row that gets a `2026-05-03 baseline:` prefix and is updated on each phase completion. |
| **Complexity** | S |
| **Category** | both |
| **Dependencies** | Depends on #6, #7 |
| **Files** | `docs/performance-baseline.md` |

### #17 — Production-overhead verification

| Field | Value |
| --- | --- |
| **Description** | Verify that the perf brackets compile out cleanly in production. Run the full benchmark suite twice: once with `__PERF__=true` (normal perf mode), once with `__PERF__=false` (simulating production). Confirm the `__PERF__=false` numbers match the pre-instrumentation baseline (the existing markdown perf benchmark numbers in `docs/performance-baseline.md`) within noise (~5%). If any per-stage regression appears in the false-flag run, investigate — likely the bracket helper isn't dead-code-eliminated and needs to be restructured. Document the verification result in the PR description as proof. |
| **Complexity** | M |
| **Category** | frontend |
| **Dependencies** | Depends on #2, #3, #6 |
| **Files** | `docs/performance-baseline.md` (annotation), PR description |

---

## Phase 0b — Incremental (after Phase 0a regression gate ships)

### #18 — Harvest 3–5 vetted community fixture samples

| Field | Value |
| --- | --- |
| **Description** | Identify 3–5 markdown documents from open-licensed sources (CommonMark spec test cases, prosemirror-markdown's test fixtures, Tiptap's test cases) that exercise edge cases the synthetic generator misses (deeply nested lists, complex tables, unusual frontmatter, escape sequences, etc.). For each: copy into `tests/fixtures/perf/community/<name>.md`, add per-file `<name>.md.LICENSE` sidecar with the source license text, attribution, and a link to origin. Update `tests/fixtures/perf/community/README.md` (renamed from `.gitkeep` of #5) listing all sources. Add the community fixtures to the benchmark suite's iteration list (Task #6's array). **GPL/AGPL sources are excluded** to keep the test corpus license-clean. |
| **Complexity** | M |
| **Category** | both |
| **Dependencies** | Depends on #5, #6 |
| **Files** | `tests/fixtures/perf/community/*.md`, `tests/fixtures/perf/community/*.LICENSE`, `tests/fixtures/perf/community/README.md`, `src/perf/load.perf.test.ts` |
