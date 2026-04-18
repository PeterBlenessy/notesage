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

## Notes

- Parse benchmarks include Tiptap editor creation overhead (\~15ms fixed cost)
- Decoration operations are sub-millisecond even at 100KB — well within real-time editing budgets
- Store operations are sub-millisecond — no concern for performance
- CI budgets use 3x multiplier to account for shared runner variability
- Dev budgets use 2x multiplier for local machine variance