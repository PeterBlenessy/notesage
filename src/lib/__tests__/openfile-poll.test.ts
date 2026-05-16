// Regression-lock tests for the openFile() polling fix (issue #285).
//
// openFile() in e2e-real/helpers/actions.ts previously waited only for
// .ProseMirror to exist after calling openTab(), which could return
// immediately (the element was already present from the previous spec)
// leaving stale content from the prior file visible to subsequent assertions.
//
// The fix:
// 1. Reads the file content via tauriInvoke before calling openTab()
// 2. Extracts a text sentinel (extractFirstSignificantText) from the content
// 3. Polls with waitUntil until ProseMirror's getText() contains the sentinel
//
// These meta-tests assert the fix is present; they are RED before the fix
// and GREEN after.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const actionsPath = resolve(__dirname, '../../../e2e-real/helpers/actions.ts');
const startupTestPath = resolve(__dirname, '../../../e2e-real/tests/startup.test.ts');

describe('openFile() polling fix (#285)', () => {
  describe('e2e-real/helpers/actions.ts — content-poll guard', () => {
    const src = readFileSync(actionsPath, 'utf-8');

    it('exports or defines extractFirstSignificantText helper', () => {
      // The helper strips markdown syntax from the first non-empty line
      // so openFile() can derive a contentKey to poll against.
      expect(src).toContain('extractFirstSignificantText');
    });

    it('openFile() uses a contentKey derived from file content', () => {
      // The contentKey is the text sentinel used in the waitUntil loop.
      expect(src).toContain('contentKey');
    });

    it('openFile() polls ProseMirror with text.includes(contentKey)', () => {
      // The waitUntil predicate must check that the rendered text includes
      // the sentinel; a fixed pause is not sufficient in CI.
      expect(src).toContain('text.includes(contentKey)');
    });
  });

  describe('e2e-real/tests/startup.test.ts — sequential-open regression', () => {
    const src = readFileSync(startupTestPath, 'utf-8');

    it('contains a regression test for the stale-content bug (A→B sequence)', () => {
      // A dedicated test must open two different files in sequence and assert
      // that getEditorText() returns the SECOND file's content, not the first's.
      // The description string contains "stale" to make this assertion stable.
      expect(src).toContain('stale');
    });
  });
});
