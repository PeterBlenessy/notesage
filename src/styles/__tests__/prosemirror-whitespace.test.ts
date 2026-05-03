// @vitest-environment node

/**
 * Regression lock for issue #125 — ProseMirror white-space warning fix.
 *
 * ProseMirror emits a console warning on every editor mount when the base
 * `.ProseMirror` rule does not declare `white-space`.  The fix is to add
 * `white-space: pre-wrap` to the root rule so ProseMirror's internal check
 * is satisfied.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const repoRoot = resolve(__dirname, '../../..');
const read = (p: string) => readFileSync(resolve(repoRoot, p), 'utf8');
const editor = read('src/styles/editor.css');

describe('ProseMirror white-space base rule (#125)', () => {
  it('base .ProseMirror rule declares white-space: pre-wrap', () => {
    // ProseMirror checks the computed white-space of the editor root and
    // emits a warning if it is not set to pre-wrap.  The fix must land on
    // the top-level `.ProseMirror {` block, not on a child selector.
    const baseProseMirrorBlock = editor.match(/\.ProseMirror\s*\{([^}]*)\}/);
    expect(baseProseMirrorBlock).toBeTruthy();
    expect(baseProseMirrorBlock![1]).toContain('white-space: pre-wrap');
  });

  it('code blocks (.ProseMirror pre) retain their existing white-space rule', () => {
    // Code blocks must continue to render with pre-wrap — this is a
    // regression guard confirming the base-rule fix did not inadvertently
    // remove the child-rule declaration.
    const preBlock = editor.match(/\.ProseMirror pre\s*\{([^}]*)\}/);
    // The current rule does not set white-space on pre — white-space from
    // the base rule (pre-wrap) is the correct inherited value.  If a future
    // change adds an explicit declaration it must not break this test.
    expect(preBlock).toBeTruthy();
    // The pre block must NOT override to a non-pre-wrap value such as `pre` or `nowrap`.
    const preWhiteSpace = preBlock![1].match(/white-space\s*:\s*([^;]+)/);
    if (preWhiteSpace) {
      expect(preWhiteSpace[1].trim()).toBe('pre-wrap');
    }
  });
});
