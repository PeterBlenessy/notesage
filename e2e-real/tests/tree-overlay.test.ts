/**
 * QuietSidebar inline tree-navigation E2E tests (issue #279).
 *
 * Validates keyboard navigation in the Projects section of the Quiet Composer
 * sidebar — the inline-expand pattern that replaced the deleted TreeOverlay:
 *
 *   1. ArrowRight on a project row expands its file-tree inline (one level)
 *   2. ArrowDown / ArrowUp navigate focus through expanded rows
 *   3. Enter (or Space) on a file row opens it in the editor
 *   4. ArrowLeft on a child row collapses the tree and restores focus to the
 *      parent project row  (the implementation uses ArrowLeft, not Esc —
 *      the QuietSidebar Esc handler only clears the type-to-filter)
 *   5. Only project rows (not explorer folders or the notes root) render in
 *      the [role="tree"][aria-label="Projects"] section
 *
 * NOTE: These tests require a running Tauri app plus tauri-webdriver.
 * They are excluded from `pnpm test` (Vitest) — run with `pnpm test:e2e-real`.
 *
 *   Terminal 1: pnpm tauri:test
 *   Terminal 2: tauri-webdriver
 *   Terminal 3: pnpm test:e2e-real
 */

import * as path from 'path';
import { tauriInvoke } from '../helpers/actions';
import type { FileEntry } from '../../src/lib/tauri';

const TEST_PROJECT = path.resolve(__dirname, '../fixtures/test-project');

// ── ARIA selectors ────────────────────────────────────────────────────────────
// Matches the ARIA structure in ProjectsSection.tsx:
//   <ul role="tree" aria-label="Projects">
//     <li role="treeitem" aria-level="1" data-row-type="project" ...>
//       <ul role="group">
//         <li role="treeitem" aria-level="2" data-row-type="child" data-row-kind="file"|"folder" ...>
const PROJECTS_TREE      = '[role="tree"][aria-label="Projects"]';
const PROJECT_ROW        = `${PROJECTS_TREE} [role="treeitem"][aria-level="1"][data-row-type="project"]`;
const CHILD_ROW          = `${PROJECTS_TREE} [role="treeitem"][aria-level="2"][data-row-type="child"]`;
const FILE_ROW           = `${CHILD_ROW}[data-row-kind="file"]`;

// WebDriver Unicode key constants
const KEY_ARROW_RIGHT = '';
const KEY_ARROW_LEFT  = '';
const KEY_ARROW_UP    = '';
const KEY_ARROW_DOWN  = '';
const KEY_ENTER       = '';
const KEY_SPACE       = '';

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Switch the UI to Quiet Composer so the QuietSidebar mounts. */
async function enableQuietComposer(): Promise<void> {
    await browser.execute(() => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const w = window as any;
        if (w.__E2E_SETTINGS_STORE__) {
            w.__E2E_SETTINGS_STORE__.getState().setUiPreview('quiet-composer');
        }
    });
    // Allow React to re-render the new layout
    await browser.pause(400);
}

/**
 * Add the test project to the Projects section of the QuietSidebar by
 * invoking `list_directory` and pushing the result via the workspace store's
 * `addProject(path, fileTree)` action.
 */
async function addTestProject(): Promise<void> {
    const fileTree = await tauriInvoke<FileEntry[]>('list_directory', { path: TEST_PROJECT });

    await browser.execute(
        (projectPath: string, tree: FileEntry[]) => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const w = window as any;
            const store = w.__E2E_WORKSPACE_STORE__?.getState();
            if (store && typeof store.addProject === 'function') {
                store.addProject(projectPath, tree);
            }
        },
        TEST_PROJECT,
        fileTree,
    );

    // Wait for the project treeitem to appear in the DOM
    await browser.waitUntil(
        async () => {
            const row = await browser.$(PROJECT_ROW);
            return row.isExisting();
        },
        {
            timeout: 8000,
            timeoutMsg: `Project row did not appear in Projects section within 8s`,
            interval: 200,
        },
    );
}

/** Restore the app to a neutral state between tests. */
async function resetState(): Promise<void> {
    await browser.execute(() => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const w = window as any;
        if (w.__E2E_SETTINGS_STORE__) {
            w.__E2E_SETTINGS_STORE__.getState().setUiPreview('legacy');
        }
        if (w.__E2E_WORKSPACE_STORE__) {
            const s = w.__E2E_WORKSPACE_STORE__.getState();
            // Remove the test project we added so we start clean
            if (typeof s.removeProject === 'function') {
                s.removeProject(TEST_PROJECT);
            }
        }
    });
    await browser.pause(200);
}

// ── Suite ─────────────────────────────────────────────────────────────────────

describe('QuietSidebar tree navigation (issue #279)', () => {
    before(async () => {
        // Ensure the app has fully rendered before any test runs
        const root = await browser.$('#root');
        await root.waitForExist({
            timeout: 10000,
            timeoutMsg: 'App root not found within 10s',
        });

        // Wait for the workspace store to be exposed on window
        await browser.waitUntil(
            async () => browser.execute(() => {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                return Boolean((window as any).__E2E_WORKSPACE_STORE__);
            }),
            {
                timeout: 10000,
                timeoutMsg: '__E2E_WORKSPACE_STORE__ not available within 10s',
                interval: 200,
            },
        );
    });

    afterEach(async () => {
        await resetState();
    });

    // -----------------------------------------------------------------------
    // Test 1: ArrowRight expands a project row inline
    // -----------------------------------------------------------------------
    it('should expand project file-tree inline with ArrowRight', async () => {
        await enableQuietComposer();
        await addTestProject();

        const projectRow = await browser.$(PROJECT_ROW);
        await projectRow.waitForExist({ timeout: 5000 });

        // Click to ensure the row has browser focus
        await projectRow.click();
        await browser.pause(100);

        // Confirm the row starts collapsed
        const expandedBefore = await projectRow.getAttribute('aria-expanded');
        console.log(`[tree-nav] aria-expanded before ArrowRight: ${expandedBefore}`);
        expect(expandedBefore).toBe('false');

        // Press ArrowRight → should expand the project inline
        await browser.keys([KEY_ARROW_RIGHT]);
        await browser.pause(300);

        const expandedAfter = await projectRow.getAttribute('aria-expanded');
        console.log(`[tree-nav] aria-expanded after ArrowRight: ${expandedAfter}`);
        expect(expandedAfter).toBe('true');

        // Child rows should now be rendered under the project
        const firstChild = await browser.$(CHILD_ROW);
        const childExists = await firstChild.isExisting();
        console.log(`[tree-nav] first child row exists: ${childExists}`);
        expect(childExists).toBe(true);
    });

    // -----------------------------------------------------------------------
    // Test 2: ArrowDown / ArrowUp navigate between rows
    // -----------------------------------------------------------------------
    it('should navigate rows with ArrowDown and ArrowUp', async () => {
        await enableQuietComposer();
        await addTestProject();

        // Focus and expand the project with ArrowRight
        const projectRow = await browser.$(PROJECT_ROW);
        await projectRow.click();
        await browser.keys([KEY_ARROW_RIGHT]);
        await browser.pause(300);

        // ArrowDown should move focus into the expanded child rows
        await browser.keys([KEY_ARROW_DOWN]);
        await browser.pause(150);

        const focusedRoleAfterDown = await browser.execute(
            () => document.activeElement?.getAttribute('role') ?? '',
        );
        console.log(`[tree-nav] focused role after ArrowDown: ${focusedRoleAfterDown}`);
        expect(focusedRoleAfterDown).toBe('treeitem');

        const focusedLevelAfterDown = await browser.execute(
            () => document.activeElement?.getAttribute('aria-level') ?? '',
        );
        console.log(`[tree-nav] focused aria-level after ArrowDown: ${focusedLevelAfterDown}`);
        // After ArrowDown from project row, focus should be on a child (level 2)
        expect(focusedLevelAfterDown).toBe('2');

        // ArrowUp from first child should return focus to the project row (level 1)
        await browser.keys([KEY_ARROW_UP]);
        await browser.pause(150);

        const focusedLevelAfterUp = await browser.execute(
            () => document.activeElement?.getAttribute('aria-level') ?? '',
        );
        console.log(`[tree-nav] focused aria-level after ArrowUp: ${focusedLevelAfterUp}`);
        expect(focusedLevelAfterUp).toBe('1');
    });

    // -----------------------------------------------------------------------
    // Test 3: Enter (or Space) on a file row opens the file in the editor
    // -----------------------------------------------------------------------
    it('should open a file with Enter on a file row', async () => {
        await enableQuietComposer();
        await addTestProject();

        // Expand the project
        const projectRow = await browser.$(PROJECT_ROW);
        await projectRow.click();
        await browser.keys([KEY_ARROW_RIGHT]);
        await browser.pause(300);

        // Wait for file rows to appear
        await browser.waitUntil(
            async () => {
                const row = await browser.$(FILE_ROW);
                return row.isExisting();
            },
            {
                timeout: 5000,
                timeoutMsg: 'No file rows appeared after expanding project with ArrowRight',
                interval: 200,
            },
        );

        // Click a file row then press Enter to open it
        const fileRow = await browser.$(FILE_ROW);
        await fileRow.click();
        await browser.pause(100);
        await browser.keys([KEY_ENTER]);
        await browser.pause(600);

        // The ProseMirror editor should now be visible (file opened)
        const editor = await browser.$('.ProseMirror');
        const editorExists = await editor.isExisting();
        console.log(`[tree-nav] editor exists after Enter on file row: ${editorExists}`);
        expect(editorExists).toBe(true);
    });

    // -----------------------------------------------------------------------
    // Test 3b: Space on a file row also opens the file
    // -----------------------------------------------------------------------
    it('should open a file with Space on a file row', async () => {
        await enableQuietComposer();
        await addTestProject();

        // Expand the project
        const projectRow = await browser.$(PROJECT_ROW);
        await projectRow.click();
        await browser.keys([KEY_ARROW_RIGHT]);
        await browser.pause(300);

        await browser.waitUntil(
            async () => {
                const row = await browser.$(FILE_ROW);
                return row.isExisting();
            },
            { timeout: 5000, timeoutMsg: 'No file rows appeared after ArrowRight expand', interval: 200 },
        );

        // Navigate to the file row via keyboard then press Space
        await browser.keys([KEY_ARROW_DOWN]);
        await browser.pause(100);
        await browser.keys([KEY_SPACE]);
        await browser.pause(600);

        const editor = await browser.$('.ProseMirror');
        const editorExists = await editor.isExisting();
        console.log(`[tree-nav] editor exists after Space on file row: ${editorExists}`);
        expect(editorExists).toBe(true);
    });

    // -----------------------------------------------------------------------
    // Test 4: ArrowLeft collapses the expanded project and restores focus
    //
    // NOTE: The implementation uses ArrowLeft (not Esc) for collapse+focus
    // restore. The QuietSidebar's Esc handler only clears the type-to-filter.
    // -----------------------------------------------------------------------
    it('should collapse expanded project with ArrowLeft and restore parent focus', async () => {
        await enableQuietComposer();
        await addTestProject();

        // Expand the project row
        const projectRow = await browser.$(PROJECT_ROW);
        await projectRow.click();
        await browser.keys([KEY_ARROW_RIGHT]);
        await browser.pause(300);

        // Navigate into the first child row
        await browser.keys([KEY_ARROW_DOWN]);
        await browser.pause(150);

        const levelOnChild = await browser.execute(
            () => document.activeElement?.getAttribute('aria-level') ?? '',
        );
        console.log(`[tree-nav] focus level before ArrowLeft: ${levelOnChild}`);
        expect(levelOnChild).toBe('2');

        // ArrowLeft from child row → collapse the parent and focus it
        await browser.keys([KEY_ARROW_LEFT]);
        await browser.pause(300);

        // Focus should now be on the project row (aria-level="1")
        const levelAfterCollapse = await browser.execute(
            () => document.activeElement?.getAttribute('aria-level') ?? '',
        );
        console.log(`[tree-nav] focus level after ArrowLeft: ${levelAfterCollapse}`);
        expect(levelAfterCollapse).toBe('1');

        // The project row should now be collapsed
        const expandedAfterCollapse = await projectRow.getAttribute('aria-expanded');
        console.log(`[tree-nav] aria-expanded after ArrowLeft: ${expandedAfterCollapse}`);
        expect(expandedAfterCollapse).toBe('false');
    });

    // -----------------------------------------------------------------------
    // Test 5: Only projects render in the Projects section — not explorer
    //         folders, pinned files, or the notes root
    // -----------------------------------------------------------------------
    it('should render only project rows in the Projects section', async () => {
        await enableQuietComposer();
        await addTestProject();

        const projectsTree = await browser.$(PROJECTS_TREE);
        await projectsTree.waitForExist({
            timeout: 5000,
            timeoutMsg: 'Projects section tree ([role="tree"][aria-label="Projects"]) not found',
        });

        // Top-level rows must all carry data-row-type="project"
        const topLevelRows = await browser.$$(PROJECT_ROW);
        console.log(`[tree-nav] top-level project rows: ${topLevelRows.length}`);
        expect(topLevelRows.length).toBeGreaterThan(0);

        for (const row of topLevelRows) {
            const rowType = await row.getAttribute('data-row-type');
            expect(rowType).toBe('project');
        }

        // Explorer folders added via addExplorerFolder should NOT appear here
        // (they render in the Folders section, not the Projects section)
        const explorerRowsInProjectTree = await browser.$$(
            `${PROJECTS_TREE} [data-row-type="explorer"]`,
        );
        expect(explorerRowsInProjectTree.length).toBe(0);
    });
});
