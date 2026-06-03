---
name: test
description: Dispatch to the right test skill based on scope or what changed
user-invocable: true
argument-hint: "[scope: all | frontend | backend | e2e | perf]"
---

# Test Umbrella

Routes to specialized test skills based on an explicit scope or `git diff`. For a single test category, invoke the sub-skill directly.

## Process

1. **Determine scope:**
   - If the user passed an argument, use it
   - Otherwise inspect `git diff --name-only main...HEAD` and pick skills by file type

2. **Dispatch:**

   | Scope / changed files | Invoke |
   |---|---|
   | `all` | every sub-skill below |
   | `frontend` / `.ts`, `.tsx` | `/test-frontend` |
   | `backend` / `src-tauri/**/*.rs` | `/test-rust` |
   | `e2e` / editor, IPC hot paths | `/test-e2e` |
   | `perf` / editor, startup, stores, IPC | `/test-perf` |
   | Any changed TS/TSX | `/test-coverage` |
   | Markdown parse/serialize / Tiptap schema | `/test-markdown-roundtrip` |
   | Pre-release only | `/test-e2e-real` |

3. **Report consolidated results** — one pass/fail summary with per-suite breakdown. Stop at first failing gate if running full suite.

## Specialized Skills

| Skill | Use for |
|---|---|
| `/test-frontend` | typecheck + Vitest unit tests |
| `/test-rust` | `cargo test` in `src-tauri/` |
| `/test-e2e` | Playwright mocked E2E |
| `/test-e2e-real` | Real app E2E (WebDriverIO, pre-release) |
| `/test-perf` | Performance benchmarks + baseline |
| `/test-coverage` | Per-file coverage regression |
| `/test-markdown-roundtrip` | Markdown parse/serialize debugging |

## Quality Gates (Release)

A release cannot ship unless:

- TypeScript checks pass
- Frontend + Rust unit tests pass
- Markdown round-trip tests pass
- Playwright E2E passes
- Perf benchmarks within budget
- Coverage does not regress on changed files

For the full release flow use `/release` — it orchestrates the gates and version bump.

## CI Pipeline

`.github/workflows/test.yml` is the source of truth — read it for exact runners,
multipliers, and steps (they drift). At time of writing: a `Detect changed paths`
gate skips the test jobs for docs-only PRs, then four jobs run **all on macOS**:

- **Frontend Tests & Coverage** — typecheck, contrast audit, `test:coverage`, perf benchmarks, coverage regression check (PR only)
- **Playwright E2E** — installs `chromium` + `webkit`, runs `test:e2e`
- **Rust Backend** — `cargo test` in `src-tauri/`
- **Real Tauri E2E** — `tauri-webdriver` driving the live app (`test:e2e-real-full`)

All non-skipped jobs must pass for merge. Check the workflow file before relying on
any specific runner image or budget multiplier.

## Reference

- @docs/architecture.md — testing strategy, test inventory
- @docs/performance-baseline.md — perf baseline history
