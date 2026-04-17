---
name: test-coverage
description: Run coverage regression detection and update the coverage baseline
user-invocable: true
---

# Coverage Regression Check

Detects per-file coverage drops on changed files vs. `coverage-baseline.json`.

## Commands

```bash
pnpm coverage:check              # Detect regressions vs baseline (warning-only)
pnpm coverage:update-baseline    # Run tests + regenerate baseline
pnpm test:coverage               # Full coverage run (produces HTML report)
```

## How It Works

1. `scripts/coverage-check.sh` identifies changed `.ts`/`.tsx` files via git diff
2. Compares per-file coverage against `coverage-baseline.json`
3. Reports regressions (currently warning-only — exits 0)

Uses `@vitest/coverage-istanbul`. Requires Node 22 (pinned in `.nvmrc`).

Reports in `./coverage/` (gitignored): text summary, JSON summary, browsable HTML at `coverage/index.html`.

## When to Update the Baseline

- After intentional test refactors that change coverage shape
- After adding/removing significant code
- Only commit a baseline update when the new numbers reflect reality — don't paper over regressions

## When Coverage Drops

1. Open `coverage/index.html` to find uncovered lines
2. Add tests for uncovered paths before merging
3. Focus on business logic — skip boilerplate and generated code

## Related

- `/test-frontend` — the unit tests that feed coverage
- `/audit-test-coverage` — test inventory and gap analysis
- `/test` — umbrella
