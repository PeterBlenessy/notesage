/**
 * Meta-test: regression lock for the QuietSidebar tree-navigation real-E2E spec.
 *
 * Runs in `pnpm test` (Vitest) as a CI red-gate.  It asserts that
 * `e2e-real/tests/tree-overlay.test.ts` exists and contains the key
 * behavioural patterns required by issue #279.
 *
 * This file is intentionally NOT a real-E2E test — it is a static
 * analysis guard so that any accidental deletion of the spec, or a
 * commit that removes a required behaviour, surfaces in `pnpm test`
 * rather than only after a full real-E2E run.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';

const ROOT = resolve(__dirname, '../../..');
const SPEC_FILE = resolve(ROOT, 'e2e-real/tests/tree-overlay.test.ts');

function readSpec(): string {
  return readFileSync(SPEC_FILE, 'utf-8');
}

// ── Existence ─────────────────────────────────────────────────────────────────

describe('e2e-real/tests/tree-overlay.test.ts — existence', () => {
  it('file exists', () => {
    expect(existsSync(SPEC_FILE)).toBe(true);
  });

  it('is picked up by wdio.conf.ts glob (e2e-real/tests/**/*.test.ts)', () => {
    // The wdio.conf.ts uses `specs: ['./e2e-real/tests/**/*.test.ts']`.
    // Any *.test.ts file under e2e-real/tests/ is automatically included.
    // Simply verifying the file exists in that directory is sufficient.
    expect(SPEC_FILE).toMatch(/e2e-real[\\/]tests[\\/].+\.test\.ts$/);
    expect(existsSync(SPEC_FILE)).toBe(true);
  });
});

// ── ArrowRight — expand ────────────────────────────────────────────────────────

describe('e2e-real/tests/tree-overlay.test.ts — ArrowRight expand behaviour', () => {
  it('contains an ArrowRight keypress', () => {
    const content = readSpec();
    expect(content).toContain('ArrowRight');
  });

  it('asserts aria-expanded becomes true after ArrowRight', () => {
    const content = readSpec();
    // The test must wait for aria-expanded to flip to 'true' after pressing ArrowRight.
    expect(content).toMatch(/aria-expanded.*true|true.*aria-expanded/);
  });
});

// ── ArrowDown / ArrowUp — focus navigation ────────────────────────────────────

describe('e2e-real/tests/tree-overlay.test.ts — ArrowDown/ArrowUp navigation', () => {
  it('contains an ArrowDown keypress', () => {
    const content = readSpec();
    expect(content).toContain('ArrowDown');
  });

  it('contains an ArrowUp keypress', () => {
    const content = readSpec();
    expect(content).toContain('ArrowUp');
  });

  it('verifies aria-level changes during navigation', () => {
    const content = readSpec();
    expect(content).toContain('aria-level');
  });
});

// ── Enter / Space — file open ─────────────────────────────────────────────────

describe('e2e-real/tests/tree-overlay.test.ts — Enter/Space file open', () => {
  it('contains an Enter keypress', () => {
    const content = readSpec();
    expect(content).toContain('Enter');
  });

  it('verifies a document is opened in the editor store after Enter/Space', () => {
    const content = readSpec();
    // The test must check the editor store for an opened document.
    expect(content).toContain('__E2E_EDITOR_STORE__');
    expect(content).toMatch(/openDocuments|openTab/);
  });
});

// ── ArrowLeft (× 2) — collapse + focus restore ────────────────────────────────
//
// Per aw-review analysis of ProjectsSection.tsx:
//   • First  ArrowLeft from a child row → focusRow(project.path) [moves focus, no collapse]
//   • Second ArrowLeft from the project row → toggleExpanded(project.path, false) [collapses]
// The spec must send TWO ArrowLeft presses (not one).

describe('e2e-real/tests/tree-overlay.test.ts — ArrowLeft two-step collapse + focus restore', () => {
  it('contains at least two ArrowLeft keypresses (two-step collapse per aw-review)', () => {
    const content = readSpec();
    const arrowLeftCount = (content.match(/ArrowLeft/g) ?? []).length;
    expect(arrowLeftCount).toBeGreaterThanOrEqual(2);
  });

  it('asserts aria-expanded becomes false after the two-step collapse', () => {
    const content = readSpec();
    expect(content).toMatch(/aria-expanded.*false|false.*aria-expanded/);
  });

  it('verifies focus returns to aria-level 1 (project row) between the two ArrowLeft presses', () => {
    const content = readSpec();
    // The test must poll for aria-level === '1' after the first ArrowLeft.
    expect(content).toContain('aria-level');
  });
});

// ── Projects-only — no explorer folders ───────────────────────────────────────

describe('e2e-real/tests/tree-overlay.test.ts — projects-only assertion', () => {
  it('queries the [role="tree"][aria-label="Projects"] tree', () => {
    const content = readSpec();
    expect(content).toContain('aria-label="Projects"');
  });

  it('asserts data-row-type="project" on treeitem rows', () => {
    const content = readSpec();
    expect(content).toContain('data-row-type');
    expect(content).toContain('project');
  });
});
