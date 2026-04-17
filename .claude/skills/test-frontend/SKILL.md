---
name: test-frontend
description: Run frontend type checking and Vitest unit tests (fast pass)
user-invocable: true
---

# Frontend Tests

Fast feedback loop for frontend changes: TypeScript type checking and Vitest unit tests.

## Commands

```bash
pnpm typecheck              # TypeScript (tsc --noEmit)
pnpm test                   # Vitest unit tests (no coverage)
pnpm typecheck && pnpm test # Both in sequence
```

Single file: `pnpm test path/to/file.test.ts`
Verbose: `pnpm test -- --reporter=verbose`

## What's Covered

- Type errors across `src/`
- Component, hook, store, and utility tests
- Markdown round-trip tests (`src/lib/__tests__/markdown-roundtrip.test.ts`)
- Frontmatter and persistence round-trip tests

## When Tests Fail

### TypeScript errors
Fix the type; don't use `@ts-ignore`. Use `unknown` with narrowing instead of `any`.

### Unit test failures
If behavior is intentional, update the test. Otherwise fix the code. Never disable a test to get green.

### Round-trip failures
Use `/test-markdown-roundtrip` for parse/serialize debugging guidance.

## Related

- `/test-coverage` — per-file coverage regression
- `/test-e2e` — Playwright mocked E2E
- `/test-markdown-roundtrip` — markdown conversion debugging
- `/test` — umbrella
