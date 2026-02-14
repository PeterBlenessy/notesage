---
description: Run all project tests including markdown round-trip tests
---

# Test Command

Runs the complete test suite for Notesage including unit tests, integration tests, and markdown round-trip tests.

## Usage

```
/test
```

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

**Expected output:**
```
$ tsc --noEmit
✓ Type checking complete. No errors found.
```

### 2. Unit Tests (if configured)

```bash
pnpm test
```

Runs:
- Component tests (Vitest + React Testing Library)
- Hook tests
- Utility function tests
- Store tests

**Example tests:**
```typescript
// src/hooks/__tests__/useEditor.test.ts
describe('useEditor', () => {
  it('should create editor instance', () => {
    const { result } = renderHook(() => useEditor());
    expect(result.current.editor).toBeDefined();
  });
});
```

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

**Test fixtures:**
```
tests/fixtures/
├── headings.md           # H1-H6
├── lists.md              # Bullet, ordered, task lists
├── formatting.md         # Bold, italic, strikethrough
├── links-images.md       # Links and images
├── code-blocks.md        # Code blocks with syntax
├── tables.md             # Table formatting
├── blockquotes.md        # Quote blocks
└── complex.md            # All features combined
```

**Example test:**
```typescript
describe('Markdown Round-Trip', () => {
  it('should preserve headings', async () => {
    const original = await readFixture('headings.md');
    const doc = parseMarkdown(original);
    const output = serializeMarkdown(doc);
    expect(normalize(output)).toBe(normalize(original));
  });
});
```

## Expected Output

### All Tests Pass

```
✓ TypeScript type checking
✓ Unit tests (23 passed)
✓ Round-trip tests (8 passed)

All tests passed! ✅
```

### Tests Fail

```
✗ TypeScript type checking
  src/components/Header.tsx:15:7 - error TS2322
  Type 'string' is not assignable to type 'number'

Fix type errors before proceeding.
```

```
✗ Round-trip test failed: complex.md
  Expected: **bold** _italic_
  Received: <strong>bold</strong> <em>italic</em>

Markdown serialization is broken. Check src/lib/markdown.ts
```

## Setting Up Tests

### Install Dependencies

```bash
# Testing libraries
pnpm add -D vitest @testing-library/react @testing-library/jest-dom
pnpm add -D @testing-library/user-event happy-dom

# For round-trip tests
pnpm add -D glob
```

### Configure Vitest

```typescript
// vitest.config.ts
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'happy-dom',
    globals: true,
    setupFiles: ['./tests/setup.ts'],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
```

### Package.json Scripts

```json
{
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "test:roundtrip": "vitest run tests/roundtrip",
    "typecheck": "tsc --noEmit"
  }
}
```

### Create Test Setup

```typescript
// tests/setup.ts
import '@testing-library/jest-dom';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

afterEach(() => {
  cleanup();
});
```

## Writing Round-Trip Tests

### Test Structure

```typescript
// tests/roundtrip/markdown.test.ts
import { describe, it, expect } from 'vitest';
import { parseMarkdown, serializeMarkdown } from '@/lib/markdown';
import { readFile } from 'fs/promises';
import path from 'path';
import { glob } from 'glob';

describe('Markdown Round-Trip', () => {
  const fixtureFiles = glob.sync('tests/fixtures/*.md');

  fixtureFiles.forEach((fixturePath) => {
    const name = path.basename(fixturePath, '.md');

    it(`should round-trip ${name}.md`, async () => {
      const original = await readFile(fixturePath, 'utf-8');
      const doc = parseMarkdown(original);
      const output = serializeMarkdown(doc);

      expect(normalize(output)).toBe(normalize(original));
    });
  });
});

function normalize(markdown: string): string {
  return markdown
    .trim()
    .replace(/\r\n/g, '\n')           // Normalize line endings
    .replace(/\n{3,}/g, '\n\n')       // Max 2 consecutive newlines
    .replace(/[ \t]+$/gm, '');        // Remove trailing whitespace
}
```

### Example Fixtures

```markdown
<!-- tests/fixtures/headings.md -->
# Heading 1

## Heading 2

### Heading 3

#### Heading 4

##### Heading 5

###### Heading 6
```

```markdown
<!-- tests/fixtures/formatting.md -->
This is **bold text** and this is *italic text*.

You can also use __bold__ and _italic_.

This is ~~strikethrough~~ text.

Inline `code` looks like this.
```

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

**This is critical** - markdown must round-trip correctly.

1. **Identify which fixture fails**
   - Look at test output for specific file

2. **Debug the conversion**
   ```typescript
   const original = readFixture('headings.md');
   console.log('Original:', original);

   const doc = parseMarkdown(original);
   console.log('Parsed:', doc.toJSON());

   const output = serializeMarkdown(doc);
   console.log('Output:', output);
   ```

3. **Check markdown library**
   - Verify tiptap-markdown or prosemirror-markdown config
   - Check custom node serialization rules
   - Test with minimal example

4. **Fix and re-test**
   - Update serialization rules
   - Re-run `/test` to verify fix
   - Ensure all other fixtures still pass

## Continuous Integration

### GitHub Actions Example

```yaml
# .github/workflows/test.yml
name: Tests

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: pnpm/action-setup@v2
      - uses: actions/setup-node@v3
        with:
          node-version: '20'
          cache: 'pnpm'
      - run: pnpm install
      - run: pnpm typecheck
      - run: pnpm test
      - run: pnpm test:roundtrip
```

## Coverage

To add test coverage:

```bash
pnpm add -D @vitest/coverage-v8
```

```json
// package.json
{
  "scripts": {
    "test:coverage": "vitest run --coverage"
  }
}
```

```typescript
// vitest.config.ts
export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      exclude: [
        'src/components/ui/**',  // shadcn/ui components
        '**/*.test.ts',
        '**/*.test.tsx',
      ],
    },
  },
});
```

## Quality Gates

Phase 1 cannot be considered complete unless:

- ✅ All TypeScript type checks pass
- ✅ All unit tests pass
- ✅ **All markdown round-trip tests pass** (critical!)
- ✅ No console errors during tests

## Reference

Read @docs/phase-1-spec.md for complete quality gate requirements.

Read @docs/architecture.md for testing strategy and patterns.

Use the `markdown-roundtrip` skill for detailed markdown testing guidance.
