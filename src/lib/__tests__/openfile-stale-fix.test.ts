/**
 * Meta-test: locks the openFile() stale-content fix patterns as a fast CI gate.
 *
 * These tests verify the source code contains the required fix patterns for
 * issue #285 (openFile() leaves stale editor content in CI). Real E2E tests
 * require a running Tauri app and cannot run in unit CI; this meta-test
 * provides a proxy gate that catches regressions during ordinary `pnpm test`.
 *
 * Criteria locked:
 *  1. openFile() in actions.ts uses sentinel-based polling (not just DOM-exist check)
 *  2. The three it.skip wrappers from #285 have been removed
 *  3. A regression test for sequential openFile() calls exists in startup.test.ts
 */
import { describe, it, expect, beforeAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.resolve(__dirname, '../../..');

function readFile(rel: string): string {
    return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

describe('openFile() stale-content fix (issue #285)', () => {
    let actionsSource: string;
    let editorTestSource: string;
    let startupTestSource: string;

    beforeAll(() => {
        actionsSource = readFile('e2e-real/helpers/actions.ts');
        editorTestSource = readFile('e2e-real/tests/editor.test.ts');
        startupTestSource = readFile('e2e-real/tests/startup.test.ts');
    });

    // -----------------------------------------------------------------
    // Criterion 1: sentinel extraction helper exists in actions.ts
    // -----------------------------------------------------------------
    it('actions.ts defines extractFirstSignificantText helper', () => {
        expect(actionsSource).toContain('extractFirstSignificantText');
    });

    it('actions.ts polls editor content against a sentinel (not just DOM existence)', () => {
        // The fix must wait until the editor text includes the sentinel,
        // not just wait for .ProseMirror to exist.
        expect(actionsSource).toContain('contentKey');
        expect(actionsSource).toContain('getText()');
    });

    // -----------------------------------------------------------------
    // Criterion 2: it.skip wrappers removed from the 3 acceptance tests
    // -----------------------------------------------------------------
    it('editor.test.ts does not skip "should save file to disk with Cmd+S"', () => {
        // The test must exist (not removed) but must NOT be wrapped in it.skip
        expect(editorTestSource).toContain('should save file to disk with Cmd+S');
        expect(editorTestSource).not.toMatch(/it\.skip\(['"`]should save file to disk with Cmd\+S/);
    });

    it('startup.test.ts does not skip "should open a markdown file and show editor content"', () => {
        expect(startupTestSource).toContain('should open a markdown file and show editor content');
        expect(startupTestSource).not.toMatch(/it\.skip\(['"`]should open a markdown file and show editor content/);
    });

    it('startup.test.ts does not skip "should render rich markdown content correctly"', () => {
        expect(startupTestSource).toContain('should render rich markdown content correctly');
        expect(startupTestSource).not.toMatch(/it\.skip\(['"`]should render rich markdown content correctly/);
    });

    // -----------------------------------------------------------------
    // Criterion 3: regression test for sequential openFile() calls
    // -----------------------------------------------------------------
    it('startup.test.ts contains regression test for sequential openFile() A → B', () => {
        // The regression test must open two files in sequence and assert the
        // second file's content is visible (not the first file's).
        // "should not show stale content" is the canonical test name.
        expect(startupTestSource).toContain('should not show stale content from previous file');
    });
});
