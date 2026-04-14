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
| 1KB | 17 | 34 | 51 |
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

## Notes

- Parse benchmarks include Tiptap editor creation overhead (\~15ms fixed cost)
- Decoration operations are sub-millisecond even at 100KB — well within real-time editing budgets
- Store operations are sub-millisecond — no concern for performance
- CI budgets use 3x multiplier to account for shared runner variability
- Dev budgets use 2x multiplier for local machine variance