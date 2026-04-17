---
name: test-perf
description: Run performance benchmarks and update the baseline
user-invocable: true
---

# Performance Benchmarks

Measures critical editor operations against budget thresholds: markdown parse/serialize, decorations, stores, Tauri IPC hot paths.

## Commands

```bash
pnpm test:perf                              # Strict budget (dev)
PERF_BUDGET_MULTIPLIER=1.5 pnpm test:perf   # CI tolerance (runner variability)
```

Config: `vitest.perf.config.ts` | Baseline: `docs/performance-baseline.md`

## What's Covered

| Suite | Measures | Budget range |
|---|---|---|
| `markdown.perf.test.ts` | Parse + serialize at 1KB / 10KB / 50KB / 100KB | 34–364ms / 1–15ms |
| `decorations.perf.test.ts` | Search + tag decoration rebuilds | < 2ms |
| `stores.perf.test.ts` | Store ops + command palette filter | 1–20ms |

## After a Run That Touches Hot Paths

Per CLAUDE.md "Performance Tracking":

1. **Verify benchmarks pass** — budgets enforced; CI uses 1.5× multiplier
2. **Capture real-world startup** — open the app in dev mode, grep `[perf:*]` console logs
3. **Append a dated entry** to `docs/performance-baseline.md` with the commit hash. Never overwrite previous entries — the history is the point.

Key startup metrics: `phase1-ready`, `startup ready`, `tree refresh`, `skills total`.

## When Budgets Fail

1. Identify the flagged category (markdown, decorations, stores)
2. Profile the specific operation — don't guess
3. Budgets reflect real UX — don't raise without justification
4. If the cost is intentional and worth it, raise the budget AND update the baseline in the same commit

## Related

- `/test` — umbrella
- `docs/performance-baseline.md` — historical baseline entries
