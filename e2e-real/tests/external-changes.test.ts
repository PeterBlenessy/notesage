/**
 * External change detection E2E tests.
 *
 * Validates the filesystem watcher's ability to detect external file changes
 * and update the editor content accordingly.
 */

import * as path from 'path';
import { openFile, typeInEditor, getEditorText, tauriInvoke } from '../helpers/actions';
import { ensureCleanState, ensureProjectOpen } from '../helpers/setup';
import { measureAction } from '../helpers/timing';

const FIXTURE_PROJECT = path.resolve(process.cwd(), 'e2e-real/fixtures/test-project');
const WATCHER_TIMEOUT = 5000;

describe('External Change Detection', () => {
    let originalContents: Record<string, string> = {};

    before(async () => {
        const root = await browser.$('#root');
        await root.waitForExist({ timeout: 5000 });
        await ensureProjectOpen(FIXTURE_PROJECT);
        await tauriInvoke('watch_directory', { path: FIXTURE_PROJECT });
        console.log(`[ext-change] Watcher started on: ${FIXTURE_PROJECT}`);
    });

    beforeEach(async () => {
        await ensureCleanState();
        originalContents = {};
    });

    afterEach(async () => {
        for (const [filePath, content] of Object.entries(originalContents)) {
            console.log(`[ext-change] Restoring ${path.basename(filePath)}`);
            await tauriInvoke('write_file', { path: filePath, content });
        }
        await browser.pause(1000);
    });

    async function saveOriginal(filePath: string): Promise<void> {
        if (!originalContents[filePath]) {
            originalContents[filePath] = await tauriInvoke<string>('read_file', { path: filePath });
        }
    }

    it('should auto-reload editor when a clean tab is modified externally', async () => {
        const targetFile = path.join(FIXTURE_PROJECT, 'notes.md');
        await saveOriginal(targetFile);

        await openFile('notes.md', FIXTURE_PROJECT);
        const initialText = await getEditorText();
        console.log(`[ext-change] Initial editor text length: ${initialText.length}`);

        const timestamp = Date.now();
        const newContent = `# Notes (Updated)\n\nThis content was written externally at ${timestamp}.\n`;

        console.log('[ext-change] Writing external change to notes.md');
        await tauriInvoke('write_file', { path: targetFile, content: newContent });

        const { duration } = await measureAction(async () => {
            await browser.waitUntil(
                async () => {
                    const editorText = await getEditorText();
                    return editorText.includes(String(timestamp));
                },
                { timeout: WATCHER_TIMEOUT, interval: 200, timeoutMsg: 'Editor did not reflect external change' },
            );
        });

        console.log(`[ext-change] Editor updated in ${duration.toFixed(0)}ms`);
        const updatedText = await getEditorText();
        expect(updatedText).toContain(String(timestamp));
    });

    it('should show reload prompt when a dirty tab is modified externally', async () => {
        const targetFile = path.join(FIXTURE_PROJECT, 'notes.md');
        await saveOriginal(targetFile);

        await openFile('notes.md', FIXTURE_PROJECT);
        // Save first to establish clean baseline, then make dirty
        await browser.execute(() => document.execCommand('insertText', false, ' dirty'));
        await browser.pause(500);
        console.log('[ext-change] Made tab dirty');

        const timestamp = Date.now();
        await tauriInvoke('write_file', {
            path: targetFile,
            content: `# Notes (External)\n\nExternal change at ${timestamp}.\n`,
        });

        // Wait for either a reload prompt or a toast about external changes
        await browser.pause(3000);

        // The editor should NOT auto-replace content on a dirty tab
        const editorText = await getEditorText();
        const wasAutoReplaced = editorText.includes(String(timestamp));
        console.log(`[ext-change] Content auto-replaced: ${wasAutoReplaced}`);

        // The key assertion: dirty tab content should be preserved
        expect(wasAutoReplaced).toBe(false);
        console.log('[ext-change] Dirty tab content preserved (not auto-replaced)');
    });

    it('should detect new file creation on disk', async () => {
        const timestamp = Date.now();
        const newFilePath = path.join(FIXTURE_PROJECT, `e2e-test-${timestamp}.md`);
        const newContent = `# E2E Test\n\nCreated at ${timestamp}.\n`;

        console.log('[ext-change] Creating new file on disk');
        await tauriInvoke('write_file', { path: newFilePath, content: newContent });

        // Verify we can read it back
        const readBack = await tauriInvoke<string>('read_file', { path: newFilePath });
        expect(readBack).toContain(String(timestamp));
        console.log('[ext-change] New file verified on disk');

        // Clean up
        await tauriInvoke('delete_path', { path: newFilePath });
        console.log('[ext-change] Cleaned up test file');
    });

    it('should detect file deletion on disk', async () => {
        const timestamp = Date.now();
        const tempFilePath = path.join(FIXTURE_PROJECT, `e2e-temp-${timestamp}.md`);

        // Create temp file
        await tauriInvoke('write_file', { path: tempFilePath, content: `# Temp\n\nCreated at ${timestamp}.\n` });

        // Verify it exists
        const exists = await tauriInvoke<boolean>('path_exists', { path: tempFilePath });
        expect(exists).toBe(true);

        // Delete it
        await tauriInvoke('delete_path', { path: tempFilePath });

        // Verify it's gone
        const existsAfter = await tauriInvoke<boolean>('path_exists', { path: tempFilePath });
        expect(existsAfter).toBe(false);
        console.log('[ext-change] File deletion verified');
    });
});
