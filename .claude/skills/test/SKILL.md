---
name: test
description: Run all project tests including markdown round-trip tests
user-invocable: true
---

# Test Suite

Runs the complete test suite for Notesage including type checking, unit tests, and markdown round-trip tests.

## What It Runs

### 1. TypeScript Type Checking

```bash
pnpm typecheck
```

Verifies:
- No TypeScript errors
- All types resolve correctly
- No `any` types (if strict mode enabled)
- Import paths valid

### 2. Unit Tests (if configured)

```bash
pnpm test
```

Runs:
- Component tests (Vitest + React Testing Library)
- Hook tests
- Utility function tests
- Store tests

### 3. Markdown Round-Trip Tests

```bash
pnpm test:roundtrip
```

**Critical for Phase 1 quality gates.**

Tests markdown parsing and serialization:

```
.md file → Parse → ProseMirror → Serialize → .md file
```

Input and output must be equivalent (whitespace-normalized).

**Test fixtures** in `tests/fixtures/`:
- `headings.md` — H1-H6
- `lists.md` — Bullet, ordered, task lists
- `formatting.md` — Bold, italic, strikethrough
- `links-images.md` — Links and images
- `code-blocks.md` — Code blocks with syntax
- `tables.md` — Table formatting
- `blockquotes.md` — Quote blocks
- `complex.md` — All features combined

## When Tests Fail

### TypeScript Errors
1. Fix the type errors immediately
2. Don't use `@ts-ignore` to bypass
3. Add proper types or use `unknown`

### Unit Test Failures
1. Check if component logic changed
2. Update tests if behavior is intentional
3. Fix code if behavior is wrong

### Round-Trip Failures
**This is critical** — markdown must round-trip correctly.

1. Identify which fixture fails
2. Debug the conversion (parse → inspect → serialize → compare)
3. Check markdown library config (tiptap-markdown or prosemirror-markdown)
4. Fix and re-test — ensure all other fixtures still pass

## Quality Gates

Phase 1 cannot be considered complete unless:

- All TypeScript type checks pass
- All unit tests pass
- **All markdown round-trip tests pass** (critical!)
- No console errors during tests

## Reference

- @docs/phase-1-spec.md — Complete quality gate requirements
- @docs/architecture.md — Testing strategy and patterns
- Use the `markdown-roundtrip` skill for detailed markdown testing guidance
