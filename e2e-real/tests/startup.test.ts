/**
 * App startup and project open E2E tests.
 *
 * Validates that the app reaches an interactive state quickly,
 * can open a project folder, render the file tree, and load
 * markdown files into the editor.
 *
 * Run manually:
 *   Terminal 1: pnpm tauri:test
 *   Terminal 2: tauri-webdriver
 *   Terminal 3: pnpm test:e2e-real
 */
import * as path from 'path';

import { waitForElement, openProject, openFile, getEditorText } from '../helpers/actions';
import { measureAction } from '../helpers/timing';
import { ensureCleanState, ensureProjectOpen } from '../helpers/setup';

// Resolve the absolute path to the test fixtures project.
// process.cwd() is available in the wdio Node.js test context.
const TEST_PROJECT_PATH = path.resolve(process.cwd(), 'e2e-real/fixtures/test-project');

describe('App startup and project open', () => {
    before(async () => {
        console.log(`[startup] Test project path: ${TEST_PROJECT_PATH}`);
    });

    beforeEach(async () => {
        await ensureCleanState();
    });

    // ---------------------------------------------------------------
    // Test 1: App startup — sidebar visible within 3s, editor area rendered
    // ---------------------------------------------------------------
    it('should reach interactive state within 3 seconds', async () => {
        const { duration } = await measureAction(async () => {
            // The sidebar always renders a Settings button at the bottom.
            await waitForElement('button[title*="Settings"]', 3000);
        });

        console.log(`[startup] Interactive state reached in ${duration.toFixed(0)}ms`);
        expect(duration).toBeLessThan(3000);

        // The root React container must exist
        const root = await browser.$('#root');
        await root.waitForExist({ timeout: 1000 });
        expect(root).toBeExisting();
    });

    // ---------------------------------------------------------------
    // Test 2: Open project folder and verify file tree
    // ---------------------------------------------------------------
    it('should open a test project and show file tree', async () => {
        const { duration } = await measureAction(async () => {
            await openProject(TEST_PROJECT_PATH);
        });

        console.log(`[startup] Project opened and file tree rendered in ${duration.toFixed(0)}ms`);

        // The file tree should contain items — at least the 4 top-level .md files
        // plus the 'nested' directory (5 items minimum).
        const items = await browser.$$('.truncate.flex-1');
        const itemCount = items.length;
        console.log(`[startup] File tree item count: ${itemCount}`);
        expect(itemCount).toBeGreaterThanOrEqual(4);

        // Verify specific files are present by checking text content
        const itemTexts: string[] = [];
        for (const item of items) {
            const text = await item.getText();
            itemTexts.push(text);
        }
        console.log(`[startup] File tree items: ${itemTexts.join(', ')}`);

        expect(itemTexts).toContain('README.md');
        expect(itemTexts).toContain('notes.md');
        expect(itemTexts).toContain('nested');
    });

    // ---------------------------------------------------------------
    // Test 3: Open a markdown file and verify editor content
    // ---------------------------------------------------------------
    it('should open a markdown file and show editor content', async () => {
        await ensureProjectOpen(TEST_PROJECT_PATH);

        const { duration } = await measureAction(async () => {
            await openFile('README.md');
        });

        console.log(`[startup] README.md opened in ${duration.toFixed(0)}ms`);
        expect(duration).toBeLessThan(2000);

        const editorText = await getEditorText();
        console.log(`[startup] Editor text length: ${editorText.length}`);

        // The editor should contain key content from README.md
        expect(editorText).toContain('Test Project');
        expect(editorText).toContain('E2E testing');
    });

    // ---------------------------------------------------------------
    // Test 4: Open a file with rich markdown content
    // ---------------------------------------------------------------
    it('should render rich markdown content correctly', async () => {
        await ensureProjectOpen(TEST_PROJECT_PATH);
        await openFile('notes.md');

        const editorText = await getEditorText();
        console.log(`[startup] notes.md editor text preview: ${editorText.substring(0, 100)}...`);

        // Verify bullet list content
        expect(editorText).toContain('Apples');
        expect(editorText).toContain('Bread');

        // Verify task list content
        expect(editorText).toContain('Write E2E tests');

        // Verify blockquote content
        expect(editorText).toContain('Keep tests small');
    });

    // ---------------------------------------------------------------
    // Test 5: Open a nested directory file
    // ---------------------------------------------------------------
    it('should handle nested directory files', async () => {
        await ensureProjectOpen(TEST_PROJECT_PATH);

        // First, expand the 'nested' folder by clicking on it.
        // Folder items render with the same .truncate.flex-1 selector.
        const folderSpan = await browser.$(
            '//span[contains(@class, "truncate") and contains(@class, "flex-1") and text()="nested"]'
        );
        await folderSpan.waitForExist({
            timeout: 5000,
            timeoutMsg: '"nested" folder not found in sidebar',
        });

        const folderClickTarget = await folderSpan.parentElement();
        await folderClickTarget.click();

        // Wait for the nested file to appear in the tree
        await browser.waitUntil(
            async () => {
                const deepNote = await browser.$(
                    '//span[contains(@class, "truncate") and contains(@class, "flex-1") and text()="deep-note.md"]'
                );
                return deepNote.isExisting();
            },
            {
                timeout: 3000,
                timeoutMsg: '"deep-note.md" did not appear after expanding "nested" folder',
            },
        );

        // Open the nested file
        await openFile('deep-note.md');

        const editorText = await getEditorText();
        console.log(`[startup] deep-note.md editor text preview: ${editorText.substring(0, 80)}...`);

        expect(editorText).toContain('Deep Note');
        expect(editorText).toContain('nested directory');
    });
});
