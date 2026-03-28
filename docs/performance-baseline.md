# Performance Baseline

Recorded 2026-03-28 from 10 runs of `pnpm test:perf`.

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
| 10KB | 50 | 100 | 150 |
| 50KB | 138 | 276 | 414 |
| 100KB | 182 | 364 | 546 |

### Markdown Serialize

| Size | Median (ms) | Dev Budget (2x) | CI Budget (3x) |
| --- | --- | --- | --- |
| 1KB | 0.25 | 1 | 2 |
| 10KB | 0.62 | 2 | 3 |
| 50KB | 5.1 | 10 | 15 |
| 100KB | 4.6 | 10 | 15 |

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
| updateTabContent (10 tabs) | <0.01 | 5 | 5 |
| updateTabContent (50 tabs) | <0.01 | 5 | 5 |
| updateTabContent (100 tabs) | <0.01 | 5 | 5 |
| listDirectory (100 entries) | 0.07 | 1 | 2 |
| listDirectory (500 entries) | 0.24 | 1 | 2 |
| listDirectory (1000 entries) | 0.44 | 2 | 3 |
| palette filter (500, 3-char) | 0.03 | 1 | 1 |
| palette filter (500, 8 queries) | 0.11 | 1 | 1 |

## Notes

- Parse benchmarks include Tiptap editor creation overhead (~15ms fixed cost)
- Decoration operations are sub-millisecond even at 100KB — well within real-time editing budgets
- Store operations are sub-millisecond — no concern for performance
- CI budgets use 3x multiplier to account for shared runner variability
- Dev budgets use 2x multiplier for local machine variance
