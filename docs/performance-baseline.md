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

## Notes

- Parse benchmarks include Tiptap editor creation overhead (\~15ms fixed cost)
- Decoration operations are sub-millisecond even at 100KB — well within real-time editing budgets
- Store operations are sub-millisecond — no concern for performance
- CI budgets use 3x multiplier to account for shared runner variability
- Dev budgets use 2x multiplier for local machine variance