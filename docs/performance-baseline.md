# Performance Baseline

Re-recorded 2026-03-28 from 10 runs of `pnpm test:perf`.

Previous baseline (same date, same code) had optimistic parse 100KB (182ms) and serialize 100KB (4.6ms) values — not reproducible under normal conditions. Re-measured with controlled runs to establish reliable budgets.

## Machine Specs

| Spec | Value |
| --- | --- |
| Chip | Apple M3 |
| RAM | 24 GB |
| macOS | 26.3.1 |
| Node | v25.2.1 |

## Results (median of 10 runs)

### Markdown Parse (includes editor creation)

| Size | Median (ms) | Dev Budget (2x) | CI Budget (3x) |
| --- | --- | --- | --- |
| 1KB | 19 | 38 | 57 |
| 10KB | 51 | 102 | 153 |
| 50KB | 139 | 278 | 417 |
| 100KB | 254 | 508 | 762 |

### Markdown Serialize

| Size | Median (ms) | Dev Budget (2x) | CI Budget (3x) |
| --- | --- | --- | --- |
| 1KB | 0.25 | 1 | 1 |
| 10KB | 0.73 | 2 | 3 |
| 50KB | 5.3 | 11 | 16 |
| 100KB | 10.3 | 21 | 31 |

### Search Decorations (findMatches + buildDecorations)

| Size | Median (ms) | Dev Budget (2x) | CI Budget (3x) |
| --- | --- | --- | --- |
| 1KB | 0.03 | 1 | 1 |
| 10KB | 0.08 | 1 | 1 |
| 50KB | 0.31 | 1 | 2 |
| 100KB | 0.23 | 1 | 2 |

### Tag Decorations (buildTagDecorations)

| Size | Median (ms) | Dev Budget (2x) | CI Budget (3x) |
| --- | --- | --- | --- |
| 1KB | 0.01 | 1 | 1 |
| 10KB | 0.05 | 1 | 1 |
| 50KB | 0.19 | 1 | 1 |
| 100KB | 0.19 | 1 | 1 |

### Store Operations

| Operation | Median (ms) | Dev Budget (2x) | CI Budget (3x) |
| --- | --- | --- | --- |
| updateTabContent (10 tabs) | &lt;0.01 | 5 | 5 |
| updateTabContent (50 tabs) | &lt;0.01 | 5 | 5 |
| updateTabContent (100 tabs) | &lt;0.01 | 5 | 5 |
| listDirectory (100 entries) | 0.07 | 1 | 2 |
| listDirectory (500 entries) | 0.24 | 1 | 2 |
| listDirectory (1000 entries) | 0.44 | 2 | 3 |
| palette filter (500, 3-char) | 0.03 | 1 | 1 |
| palette filter (500, 8 queries) | 0.11 | 1 | 1 |

## Component Benchmarks — Quiet Composer UI Refresh (M1.8)

Added 2026-04-23 alongside Phase 1 ARIA + reduced-motion sweep. All four suites use jsdom + `@testing-library/react` to render real component trees and time user-perceived interactions. Real-Chromium performance is typically 5–10× faster than the jsdom numbers below.

### FloatingCommandBar (`cmdbar.perf.test.ts` — task #88)

| Operation | Median (ms) | Spec Budget |
| --- | --- | --- |
| focus (compact→expanded) | 2.53 | 100 |
| dismiss (Esc → compact) | 1.94 | 80 |
| prefix morph (`/` → mode picker) | 2.41 | 50 |
| attachment-chip add | 2.25 | 30 |
| context row initial render (3 projects) | 3.56 | 20 |

### AgentOrb (`orb.perf.test.ts` — task #89)

| Operation | Median (ms) | Spec Budget |
| --- | --- | --- |
| panel open (N=10 tasks) | 12.75 | 120 |
| panel open (N=50 tasks) | 9.29 | 120 |
| panel open (N=100 tasks) | 9.34 | 120 |
| pulse render cost | 1.06 | 5 |
| reduced-motion render | 0.52 | 5 |

The orb pulse animation is CSS-only (`@keyframes orb-pulse`) — there is no `requestAnimationFrame` JS in the loop. The "pulse render cost" benchmark measures the cost of mounting the orb in pulsing state; a regression that accidentally introduces JS-driven animation would either fail the budget or drop the `orb-pulsing` class assertion.

### StatusTray (`status-tray.perf.test.ts` — task #90)

| Operation | Median (ms) | Spec Budget |
| --- | --- | --- |
| popover open | 34.57 | 150 |
| comments list expand | 23.54 | 80 |
| segmented picker click | 1.37 | 50 |

### Sidebar Type-to-Filter (`sidebar-filter.perf.test.ts` — task #91)

| Operation | Median (ms) | Spec Budget | Notes |
| --- | --- | --- | --- |
| first keystroke (N=100) | 7.62 | 50 | hits spec target |
| first keystroke (N=500) | 32.03 | 500 | inflated jsdom budget |
| first keystroke (N=2000) | 208.01 | 8,000 | smoke test only |
| subsequent keystroke (N=100) | 0.54 | 20 | |
| subsequent keystroke (N=500) | 1.13 | 20 | |
| subsequent keystroke (N=2000) | 4.46 | 20 | |

The N=500 / N=2000 first-keystroke budgets are intentionally loose — they document the current ceiling of the unmemoized `PinnedRow` / `RecentRow` implementation in jsdom. Real production workloads rarely have more than ~50 items in either section. Memoization opportunity tracked as F6 in `2026-04-21-ui-refresh-phase1-followups.md`. Once the rows are wrapped in `React.memo`, the budgets should be tightened toward the 50ms spec target — that's the regression-lock value.

## Startup Performance (real-world, dev mode)

Measured with 6 iCloud projects, 3 explorer folders, 22 open tabs, 679 total files. Times are from `[perf:*]` console logs on page refresh (steady-state, not cold first launch).

### 2026-04-12 — Post audit v4 (0c8bde2)

**Skills pipeline:**

| Step | ms |
| --- | --- |
| skill-scan | 1,483 |
| skill-tool-extract (9 skills) | 3,175 |
| agent-scan | 843 |
| instruction-scan | 780 |
| **phase1-ready (tools visible)** | **6,293** |
| bundled-skills-extract | 2,198 |
| bundled-agents-extract | 781 |
| phase2-extract | 4,787 |
| **total** | **11,081** |

**Startup & trees:**

| Metric | ms |
| --- | --- |
| startup ready | 13,068 |
| tree refresh (1st) | 12,804 |
| tree refresh (2nd) | 12,484 |
| index init total | 1,791 |

**Known issues:** Double startup (reloadTrees runs twice), triple tree refresh, sequential skill-tool-extract is the bottleneck.

### 2026-04-14 — v0.32.1 release (8b77165)

6 iCloud projects, 3 explorer folders, 27 open tabs, 1,237 total files.

**Skills pipeline:**

| Step | ms |
| --- | --- |
| skill-scan | 1,860 |
| skill-tool-extract (11 skills) | 2,455 |
| agent-scan | 509 |
| instruction-scan | 597 |
| **phase1-ready (tools visible)** | **5,426** |
| bundled-skills-extract | 1,930 |
| bundled-agents-extract | 457 |
| phase2-extract | 3,367 |
| **total** | **8,793** |

**Startup & trees:**

| Metric | ms |
| --- | --- |
| trees validated (1st) | 1,996 |
| trees validated (2nd) | 4,211 |
| tree refresh | 10,487 |
| tab-preload (27 tabs) | 12,829 |
| index init (per-project) | 182–1,139 |

**Comparison vs 2026-04-12:** phase1-ready improved 6,293→5,426ms (−14%). Tree refresh improved 12,804→10,487ms (−18%) despite 1,237 vs 679 files (+82%). Tab preload is new metric (27 tabs in 12.8s). No regressions.

### 2026-04-14 — v0.33.0 release (edb47fe)

6 iCloud projects, 3 explorer folders, 8 open tabs, 1,245 total files.

**Skills pipeline:**

| Step | ms |
| --- | --- |
| skill-scan | 872 |
| skill-tool-extract (11 skills) | 392 |
| agent-scan | 129 |
| instruction-scan | 151 |
| **phase1-ready (tools visible)** | **1,548** |
| bundled-skills-extract | 302 |
| bundled-agents-extract | 142 |
| phase2-extract | 634 |
| **total** | **2,183** |

**Startup & trees:**

| Metric | ms |
| --- | --- |
| trees validated (1st) | 1,156 |
| trees validated (2nd) | 1,474 |
| tree refresh | 2,592 |
| tab-preload (7 tabs) | 1,970 |
| index init total | 1,048 / 1,135 |
| startup ready | 3,568 / 3,698 |
| tabs restored | 3,267 / 3,430 |

**Comparison vs v0.32.1:** phase1-ready improved 5,426→1,548ms (−71%). Skills total improved 8,793→2,183ms (−75%). Tree refresh improved 10,487→2,592ms (−75%). Startup ready improved dramatically. Fewer open tabs (8 vs 27) accounts for some improvement. No regressions from new extensions.

### v0.34.0 — 2026-04-15 (`cd2cca7`)

Apple M3, 24GB. macOS.
6 iCloud projects, 3 explorer folders, 8 open tabs, 1,247 total files.

**Skills pipeline:**

| Step | ms |
| --- | --- |
| skill-scan | 2,036 |
| skill-tool-extract (11 skills) | 664 |
| agent-scan | 235 |
| instruction-scan | 311 |
| **phase1-ready (tools visible)** | **3,261** |
| bundled-skills-extract | 616 |
| bundled-agents-extract | 396 |
| phase2-extract | 1,355 |
| **total** | **4,616** |

**Startup & trees:**

| Metric | ms |
| --- | --- |
| trees validated (1st) | 2,433 |
| trees validated (2nd) | 3,083 |
| tree refresh | 5,347 |
| tab-preload (7 tabs) | 4,146 |
| index init total | 832 / 1,614 |
| startup ready | 6,058 / 6,887 |
| tabs restored | 5,599 / 6,347 |

**Comparison vs v0.33.0:** Skills phase1-ready regressed 1,548→3,261ms (+110%). Tree refresh regressed 2,592→5,347ms (+106%). Startup ready regressed 3,568→6,058ms (+70%). These are likely due to system load during measurement rather than code changes — the ACP protocol compliance work touches no startup/tree/skill code paths. The skill rescan (110ms on second run) confirms no persistent overhead. Index init improved 1,048→832ms. File count similar (1,245→1,247).

### v0.35.0 — 2026-04-17 (uncommitted, base `4a0c3aa`)

Apple M3, 24GB. macOS.
6 iCloud projects, 3 explorer folders, 6 open tabs, 1,252 total files.

**Skills pipeline:**

| Step | ms |
| --- | --- |
| skill-scan | 2,874 |
| skill-tool-extract (11 skills) | 475 |
| agent-scan | 133 |
| instruction-scan | 121 |
| **phase1-ready (tools visible)** | **3,603** |
| bundled-skills-extract | 391 |
| bundled-agents-cleanup | (first run only) |
| phase2-extract | 719 |
| **total** | **4,322** |

**Startup & trees:**

| Metric | ms |
| --- | --- |
| trees validated (1st) | 3,159 |
| trees validated (2nd) | 3,587 |
| tree refresh | 4,886 |
| tab-preload (5 tabs) | 3,888 |
| index init total | 1,128 / 1,140 |
| startup ready | 5,965 / 5,982 |
| tabs restored | 5,650 / 5,602 |

**Rescan (second run):** skill-scan 12ms, skill-tool-extract 5ms, agent-scan 12ms, instruction-scan 2ms, phase1-ready 31ms, total 31ms. Fast path works correctly.

**Comparison vs v0.34.0:** phase1-ready similar 3,261→3,603ms (+10%, within noise). Skills total improved 4,616→4,322ms (−6%) — `bundled-agents-extract` eliminated (was 396ms), replaced by one-time cleanup. Tree refresh improved 5,347→4,886ms (−9%). Startup ready improved 6,058→5,965ms (−2%). Agent count dropped from 8 (7 bundled + 1 user) to 1 (user only). No regressions.

### v0.36.0 — 2026-04-18 (uncommitted, base `4a5ea7a`)

Apple M3, 24GB. macOS.
6 iCloud projects, 3 explorer folders, 6 open tabs, 1,259 total files.

**Skills pipeline:**

| Step | ms |
| --- | --- |
| skill-scan | 2,928 |
| skill-tool-extract (11 skills) | 466 |
| agent-scan | 115 |
| instruction-scan | 114 |
| **phase1-ready (tools visible)** | **3,624** |
| bundled-skills-extract | 382 |
| phase2-extract | 614 |
| **total** | **4,238** |

**Startup & trees:**

| Metric | ms |
| --- | --- |
| trees validated (1st) | 3,123 |
| trees validated (2nd) | 3,504 |
| tree refresh | 4,664 |
| tab-preload (5 tabs) | 3,926 |
| index init total | 637 / 1,190 |
| startup ready | 5,246 / 5,812 |
| tabs restored | 5,047 / 5,556 |

**Rescan (second run):** skill-scan 25ms, skill-tool-extract 35ms, agent-scan 13ms, instruction-scan 7ms, phase1-ready 81ms, total 81ms.

**Comparison vs v0.35.0:** phase1-ready 3,603→3,624ms (±0%, noise). Skills total 4,322→4,238ms (−2%). Tree refresh 4,886→4,664ms (−5%). **Startup ready 5,965→5,246ms (−12%)** and **tabs restored 5,650→5,047ms (−11%)** — both meaningful improvements. Index init total 1,128→637ms on first run, 1,140→1,190ms on second (first-run improvement; second run noise). No regressions. Batch B + C added rendering work in chat but didn't touch the startup hot path, consistent with flat/better numbers.

### v0.37.0 — 2026-04-18 (uncommitted, base `34bb7cf`)

Apple M3, 24GB. macOS.
6 iCloud projects, 3 explorer folders, 6 open tabs, 1,265 total files.

**Skills pipeline:**

| Step | ms |
| --- | --- |
| skill-scan | 3,186 |
| skill-tool-extract (11 skills) | 408 |
| agent-scan | 111 |
| instruction-scan | 110 |
| **phase1-ready (tools visible)** | **3,817** |
| bundled-skills-extract | 375 |
| phase2-extract | 617 |
| **total** | **4,434** |

**Startup & trees:**

| Metric | ms |
| --- | --- |
| trees validated (1st) | 3,428 |
| trees validated (2nd) | 3,765 |
| tree refresh | 4,914 |
| tab-preload (5 tabs) | 4,118 |
| index init total | 1,155 / 1,164 |
| startup ready | 5,999 / 6,052 |
| tabs restored | 5,706 / 5,802 |

**Rescan (second run):** skill-scan 13ms, skill-tool-extract 4ms, agent-scan 8ms, instruction-scan 2ms, phase1-ready 27ms, total 27ms.

**Comparison vs v0.36.0:** phase1-ready 3,624→3,817ms (+5%, noise). Skills total 4,238→4,434ms (+5%, noise). Tree refresh 4,664→4,914ms (+5%, noise). Startup ready 5,246→5,999ms (+14%) and tabs restored 5,047→5,706ms (+13%) — both first-run only; second-run values are flat (5,812→6,052ms +4%, 5,556→5,802ms +4%). **Index init total 637→1,155ms on first run (+81%)** — the prior v0.36.0 first-run 637ms was an outlier good result (previous v0.35.0 was 1,128ms); v0.37.0's 1,155ms matches the v0.35.0 baseline and the second-run v0.36.0 number (1,190ms). Likely iCloud sync latency noise, not a code regression (Phase 3 auth consolidation and dep pruning don't touch the index or startup hot path). Rescan numbers are cleaner than before (27ms vs 81ms). No real regressions attributable to v0.37.0.

### v0.38.0 — 2026-04-20 (uncommitted, base `a0abcb5`)

Apple M3, 24GB. macOS.
6 iCloud projects, 3 explorer folders, 7 open tabs, 1,291 total files.

**Skills pipeline:**

| Step | ms |
| --- | --- |
| skill-scan | 2,775 |
| skill-tool-extract (11 skills) | 145 |
| agent-scan | 174 |
| instruction-scan | 105 |
| **phase1-ready (tools visible)** | **3,199** |
| bundled-skills-extract | 4 |
| phase2-extract | 18 |
| **total** | **3,217** |

**Startup & trees:**

| Metric | ms |
| --- | --- |
| trees validated (1st) | 1,819 |
| trees validated (2nd) | 2,212 |
| tree refresh (10 sections, 1,291 files) | 3,330 |
| tab-preload (6 tabs) | 2,495 |
| index init total | 1,184 / 1,278 |
| startup ready | 4,387 / 4,494 |
| tabs restored | 4,100 / 4,131 |

**Rescan (second run):** skill-scan 62ms, skill-tool-extract 2ms, agent-scan 7ms, instruction-scan 6ms, phase1-ready 77ms, total 77ms.

**Comparison vs v0.37.0:** phase1-ready 3,817→3,199ms (−16%). Skills total 4,434→3,217ms (−27%). Tree refresh 4,914→3,330ms (−32%). Startup ready 5,999/6,052→4,387/4,494ms (−27% / −26%). Tabs restored 5,706/5,802→4,100/4,131ms (−28% / −29%). Index init total 1,155/1,164→1,184/1,278ms (flat). v0.38.0 does not touch the startup hot path — the entire release is AI-scope / isolation work — so these consistent double-digit improvements are almost certainly iCloud sync noise (cold/warm-cache differences between runs). No regressions.

## Load File Performance (real-world, dev mode)

Per-phase before/after for the [large-file instant-load PRD](prds/2026-05-03-large-file-instant-load.md). Measured via DevTools Timeline (Safari Web Inspector) recordings on representative files. Covers all file sizes — small-file rows are regression-watch (must not get slower as we optimize the large-file path).

Each entry records: commit SHA, file path/size, observed timings (click → first paint → editable), identified hot paths, and an actionable note. Raw `.json` recordings are NOT committed (size + personal paths) — they live under `~/Downloads` or `~/.notesage/perf/`.

### Reference files

| Label | Path | Size |
| --- | --- | --- |
| Book (large) | `~/Library/Mobile Documents/com~apple~CloudDocs/Notesage/Svenska Investmentbolag/Svenska-Investmentbolag-v0.10.0.md` | 506 KB |
| _10 KB sample_ | _TBD_ | _\~10 KB_ |
| _100 KB sample_ | _TBD_ | _\~100 KB_ |

### 2026-05-05 — Pre-Phase-1 baseline, Book 506 KB (a2214ecd)

Recording: `~/Downloads/Screenshots/load-large-file-recording.json` (134 MB, Safari Web Inspector, 21.8s window). Apple M3 / 24 GB / macOS 26.3.1 / `pnpm tauri dev`.

| Phase | Time after click | Dominant cost |
| --- | --- | --- |
| Click | 0.0 s | sidebar item activated |
| **Frozen window** | 0.0 → 6.0 s | Single 5,487 ms microtask + overlapping 5,498 ms layout. No paints emitted in this window. |
| First content paint | **\~6.0 s** | First post-click paint at +5.97 s — the editor DOM appears |
| Tiptap Delete-extension storm | 6.0 → ~14 s | 4 timer-fired tasks back-to-back: 3,370 + 1,198 + 1,136 + 1,056 = **6,760 ms** of `simplifyChangedRanges` / `nodesBetween` work from Tiptap's built-in `Delete` extension reacting to the bulk `setContent` transaction (verified via JavaScript & Events stack samples). |
| Settled | **\~21 s** | Last large layout pass (+21.22 s, 207 ms); subsequent activity is mouse / scroll noise |

**Aggregate layout work:** 2,183 layout records totalling **7,926 ms**. Of those: 9 `forced-layout` (208 + 197 ms top two), 27 regular `layout` (208 + 207 ms top two), 1,674 `paint`, 95 `invalidate-styles`, 97 `recalculate-styles`. Median layout is sub-millisecond — the cost is concentrated in a handful of giant passes.

**Top single-task contributors:**

| Rank | Type | Start (s after click) | Duration (ms) | Source (verified) |
| --- | --- | --- | --- | --- |
| 1 | microtask | +0.04 | 5,487 | `loadRawMarkdownIntoEditor` — preprocessing + markdown-it parse + setContent |
| 2 | timer-fired (timeout 0) | +6.08 | 3,370 | Tiptap `Delete` extension async callback — `simplifyChangedRanges.filter().filter().some()` (O(n²)) + `nodesBetween` walk (148/166 stack samples leaf at `Array.prototype.filter` inside the change-range simplifier) |
| 3 | timer-fired (timeout 150) | +9.45 | 1,198 | Debounced `getMarkdownFromEditor` (`useEditor.ts:271`) — re-serializes 506 KB doc to markdown after Delete extension's transaction landed |
| 4 | timer-fired (timeout 150) | +15.44 | 1,136 | Same as above — second post-load transaction triggers another debounced serialize |
| 5 | timer-fired (timeout 150) | +16.85 | 1,056 | Same as above — third post-load transaction |

**Identified hot paths (in priority order):**

1. **Synchronous parse + initial layout (5.5 s)** — Layers 1+2 directly attack this: Rust comrak preview unblocks first paint (target &lt;300 ms), worker hydration moves the parse off the main thread.
2. **Tiptap `Delete` extension on bulk setContent (3.4 s)** — `@tiptap/core`'s built-in Delete extension fires `editor.emit("delete", ...)` after every transaction, but Notesage subscribes to none of them. On a bulk `setContent` the change-range simplifier and `nodesBetween` walk dominate. **Fix landed in this PR**: pass `coreExtensionOptions.delete.filterTransaction = (tr) => tr.getMeta("addToHistory") === false` so transactions tagged `addToHistory: false` (which is what `loadRawMarkdownIntoEditor` and `setContentWithoutHistory` already use) skip the extension's processing.
3. **Repeated 506 KB markdown re-serialization (3 × ~1.1 s)** — `useEditor.ts:271` 150 ms-debounced `getMarkdownFromEditor` re-runs whenever any transaction fires `onUpdate`. Decoration-plugin `appendTransaction` calls (comment-mark, tag-highlight, table-aggregation, etc.) each trigger one. Fix path: suppress the serialize for transactions where nothing actually changed, or skip when the transaction is from setContent. Open follow-up.
4. **Late layouts at +21 s (~210 ms)** — likely `table-aggregation` walking 952 rows on first `appendTransaction`. Open follow-up.

**Regression-watch reference files (TBD — capture before Phase 1):** 10 KB and 100 KB synthetic samples, same recording method, to confirm Phase 1 doesn't regress small-file performance.

### 2026-05-05 — Post-Delete-fix, Book 506 KB

Re-recorded with `coreExtensionOptions.delete.filterTransaction = (tr) => tr.getMeta("addToHistory") === false` applied in `src/hooks/useEditor.ts`. Same methodology as baseline (a doc already open, click the book in the sidebar). Recording: `~/Downloads/Screenshots/load-large-file-recording-delete-fix.json`.

| Metric | Pre-fix | Post-fix | Delta |
| --- | --- | --- | --- |
| Recording duration | 21.8 s | 20.1 s | −1.7 s |
| **Click → settled** | **\~18.0 s** | **\~15.7 s** | **−2.3 s** |
| Parse microtask | 5,487 ms | 5,357 ms | flat (variance — confirms parse path untouched) |
| **Tiptap Delete extension (timer 0)** | **3,370 ms** | **gone** | **−3,370 ms** ✓ |
| timer-150 #1 | 1,198 ms | 1,156 ms | −42 ms |
| timer-150 #2 | 1,136 ms | 1,059 ms | −77 ms |
| timer-150 #3 | 1,056 ms | 943 ms | −113 ms |
| timer-150 #4 | — | 917 ms | new (see note) |
| Sum of timer-150 tasks | 3,390 ms | 4,075 ms | +685 ms |
| Layout records (count) | 2,183 | 3,182 | +999 |
| Layout aggregate (ms) | 7,926 | 8,312 | +386 |

**Headline:** the 3,370 ms `timer-fired (timeout 0)` Delete-extension task is fully eliminated. Net wall-clock improvement is **~2.3 s click-to-settled** on the 506 KB book. Click → first paint is unchanged (~6 s) because the synchronous parse is what gates that, and parse is untouched until Phase 1 (Rust comrak preview).

**Why a fourth timer-150 appeared:** removing the Delete extension's transaction changed the order in which downstream decoration plugins (`comment-mark`, `tag-highlight`, `table-aggregation`, etc.) finish their `appendTransaction` work. One additional cascade now triggers the debounced `getMarkdownFromEditor` re-serialization. Per-task durations all dropped slightly, but total re-serialization time went up by ~685 ms because of the extra pass. This makes the open follow-up "skip serialize on programmatic-load transactions" more attractive — the next narrow fix worth landing before Phase 1 if we want to chase another ~2-4 s out of the post-paint freeze.

**Verified by post-fix recording:**

- No `timer-fired (timeout 0)` task &gt; 100 ms anywhere in the 20 s recording.
- 5 forced-layouts at +6.3 → +7.7 s, each ~190 ms (these are paint-driven, not the JS-triggered O(n²) walk from before).
- Last large activity ends at +17.0 s (the fourth timer-150). Total click → settled = ~15.7 s.

### 2026-05-05 — Phase 1 (Rust comrak HTML preview), Book 506 KB (84ea0561)

Three live-tested recordings (~/Downloads/Screenshots/load-large-file-recording-phase-1{,-test2,-test3}.json) on Apple M3 / 24 GB / macOS 26.3.1 / `pnpm tauri dev`. Same methodology as previous baselines: a doc already open, click the book in the sidebar.

| Test | Cache state | `read_file` | `render_markdown_preview` | Parse (rAF block) | Click → preview painted | Click → editable |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Cold (refresh + open) | 23 ms | **1,155 ms** | 5,141 ms | \~1.2 s | \~7.5 s |
| 2 | Cold (refresh + open) | 25 ms | **1,136 ms** | 4,840 ms | \~1.2 s | \~7.0 s |
| 3 | Warm (small file opened first) | 20 ms | **118 ms** | 4,483 ms | \~0.2 s | \~5.0 s |

**Headline:** click → readable drops from \~6 s blank window (post-Delete-fix baseline) to **0.2–1.2 s** depending on iCloud cache state. The user can scroll, select, and read the document while the editor finishes hydrating in the background. Click → editable is roughly flat (still gated by the synchronous parse) — Phase 1's goal was instant first paint, not faster total hydration.

**Composition (cold):** Click → `read_file` (\~25 ms) → `render_markdown_preview` (\~1.15 s, dominated by iCloud sync inside `fs::read_to_string`; comrak itself is ~150 ms once the file is OS-cached) → React commit + paint (\~50 ms) → preview visible. Then `deferPastPaint` (rAF×2) yields one paint cycle, then `loadRawMarkdownIntoEditor` runs as an `animation-frame-fired` task of 4.5–5.1 s (the remaining synchronous parse). Plugin init storm appears as a follow-on \~1.85 s `microtask-dispatched` task. Total click → editable = \~7 s.

**Composition (warm — test 3 with small file opened first):** Same pipeline, but iCloud sync is skipped because the OS already has the file cached, so `render_markdown_preview` is 10× faster (118 ms instead of 1.15 s). Parse cost is unchanged. Total click → editable = \~5 s.

**Phase 2 will attack:**

1. **The 4.5–5.1 s `animation-frame-fired` parse block** — moves to a Web Worker. Main thread stays at 60 fps the entire time the editor hydrates. This is what makes the entire app freeze during large-file load today.
2. The 1.85 s plugin init storm microtask — currently in scope of "Out of Scope: Plugin lazy-init" in the PRD; might revisit after Phase 2 if it remains the dominant blocker.

**Phase 3 will attack:**

3. The 1.15 s cold `render_markdown_preview` and 4.5+ s parse on every open — disk cache makes subsequent opens of the same file load in <100 ms.

**Out of scope for Phase 1:** the 4.5–5.1 s parse blocking the main thread (Phase 2), iCloud sync variance (filesystem-side), and the plugin init storm.

**Visual fidelity caveat (live-test feedback):** the preview's blockquote line-height and a few other typography details diverge subtly from the editor's render — comrak emits semantically-equivalent but structurally-different HTML than Tiptap's serialized output, so a few `editor.css` selectors fire differently between the two. Phase 1 ships with this gap acknowledged; tightening targeted selectors is a polish follow-up.

## Notes

- Parse benchmarks include Tiptap editor creation overhead (\~15ms fixed cost)
- Decoration operations are sub-millisecond even at 100KB — well within real-time editing budgets
- Store operations are sub-millisecond — no concern for performance
- CI budgets use 3x multiplier to account for shared runner variability
- Dev budgets use 2x multiplier for local machine variance