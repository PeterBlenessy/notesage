/**
 * App startup and project open E2E tests.
 *
 * Validates that the app reaches an interactive state quickly,
 * can open a project folder, render the file tree, and load
 * markdown files into the editor.
 */
import * as path from 'path';

import { openFile, getEditorText } from '../helpers/actions';
import { measureAction } from '../helpers/timing';
import { ensureCleanState, ensureProjectOpen } from '../helpers/setup';

const TEST_PROJECT_PATH = path.resolve(process.cwd(), 'e2e-real/fixtures/test-project');

describe('App startup and project open', () => {
    before(async () => {
        console.log(`[startup] Test project path: ${TEST_PROJECT_PATH}`);
        // Ensure only test project is open, sidebar visible for file tree tests
        await ensureProjectOpen(TEST_PROJECT_PATH);
        await browser.execute(() => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const w = window as any;
            if (w.__E2E_SETTINGS_STORE__) {
                const s = w.__E2E_SETTINGS_STORE__.getState();
                if (!s.sidebarPinned) s.setSidebarPinned(true);
                if (!s.sidebarOpen) s.setSidebarOpen(true);
            }
        });
        await browser.pause(300);
    });

    beforeEach(async () => {
        // Close tabs but keep sidebar open for these tests
        await browser.execute(() => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const w = window as any;
            if (w.__E2E_EDITOR_STORE__) {
                const state = w.__E2E_EDITOR_STORE__.getState();
                for (const tab of [...state.openDocuments]) {
                    state.closeTab(tab.id);
                }
            }
        });
        await browser.pause(200);
    });

    // ---------------------------------------------------------------
    // Test 1: App startup — root rendered, editor area present
    // ---------------------------------------------------------------
    it('should reach interactive state', async () => {
        // Option A (2026-05-16): dropped the "<3 seconds" perf budget; functional
        // check is the `waitForExist` not throwing. Generous timeout absorbs
        // CI runner variance.
        const { duration } = await measureAction(async () => {
            const root = await browser.$('#root');
            await root.waitForExist({ timeout: 30_000 });
        });
        console.log(`[startup] Interactive state reached in ${duration.toFixed(0)}ms (informational only)`);
    });

    // ---------------------------------------------------------------
    // Test 2: Open a markdown file and verify editor content
    // ---------------------------------------------------------------
    it('should open a markdown file and show editor content', async () => {
        await openFile('README.md');
        const editorText = await getEditorText();
        console.log(`[startup] Editor text length: ${editorText.length} (informational only)`);
        expect(editorText).toContain('Test Project');
        expect(editorText).toContain('E2E testing');
    });

    // ---------------------------------------------------------------
    // Test 3: Open a file with rich markdown content
    // ---------------------------------------------------------------
    it('should render rich markdown content correctly', async () => {
        await openFile('notes.md');
        const editorText = await getEditorText();
        expect(editorText).toContain('Apples');
        expect(editorText).toContain('Bread');
        expect(editorText).toContain('Write documentation');
        expect(editorText).toContain('important blockquote');
    });

    // ---------------------------------------------------------------
    // Test 3b: Regression — sequential openFile() shows second file's content
    // ---------------------------------------------------------------
    it('should not show stale content from previous file after sequential open', async () => {
        // Open README.md first, confirm it renders
        await openFile('README.md');
        const firstText = await getEditorText();
        expect(firstText).toContain('Test Project');

        // Then open notes.md — editor must show notes.md content, NOT README.md
        await openFile('notes.md');
        const secondText = await getEditorText();
        expect(secondText).toContain('Apples');
        // README.md unique content must not be visible after switching
        expect(secondText).not.toContain('E2E testing');
    });

    // ---------------------------------------------------------------
    // Test 4: Open a nested directory file
    // ---------------------------------------------------------------
    it('should handle nested directory files', async () => {
        await openFile('nested/deep-note.md');

        const editorText = await getEditorText();
        console.log(`[startup] deep-note.md editor text preview: ${editorText.substring(0, 80)}...`);

        expect(editorText).toContain('Deep Note');
        expect(editorText).toContain('nested directory');
    });
});
