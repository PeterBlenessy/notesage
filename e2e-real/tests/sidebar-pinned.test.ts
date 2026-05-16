/**
 * QuietSidebar Pinned section E2E tests.
 *
 * Tests pin/unpin, persistence, ordering, navigation, and active-highlight
 * behaviours. Every test runs with settings.uiPreview = "quiet-composer" so
 * the QuietSidebar is mounted.
 *
 * Run manually:
 *   Terminal 1: pnpm tauri:test
 *   Terminal 2: tauri-webdriver
 *   Terminal 3: pnpm test:e2e-real
 */

import * as path from 'path';
import { ensureCleanState, ensureProjectOpen } from '../helpers/setup';
import { openFile } from '../helpers/actions';

const PROJECT_PATH = path.resolve(process.cwd(), 'e2e-real/fixtures/test-project');

// Absolute paths to files in the test fixture
const FILE_README = path.join(PROJECT_PATH, 'README.md');
const FILE_NOTES = path.join(PROJECT_PATH, 'notes.md');
const FILE_CODE = path.join(PROJECT_PATH, 'code-examples.md');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Switches to quiet-composer UI preview and ensures the sidebar is visible.
 * Waits for the QuietSidebar nav element to appear in the DOM.
 */
async function ensureQuietComposerMode(): Promise<void> {
    await browser.execute(() => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const w = window as any;
        if (w.__E2E_SETTINGS_STORE__) {
            const s = w.__E2E_SETTINGS_STORE__.getState();
            s.setUiPreview('quiet-composer');
            if (!s.sidebarPinned) s.setSidebarPinned(true);
        }
    });
    // Wait for the QuietSidebar to mount (the nav element it renders)
    await browser.waitUntil(
        async () => {
            const sidebar = await browser.$('nav[aria-label="Workspace sidebar"]');
            return sidebar.isExisting();
        },
        {
            timeout: 5000,
            timeoutMsg: 'QuietSidebar nav did not mount within 5s after switching to quiet-composer',
        },
    );
    await browser.pause(200);
}

/**
 * Removes all pinned files from the workspace store and waits for the DOM
 * to reflect the empty Pinned section.
 */
async function clearPinnedFiles(): Promise<void> {
    await browser.execute(() => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const w = window as any;
        if (w.__E2E_WORKSPACE_STORE__) {
            const s = w.__E2E_WORKSPACE_STORE__.getState();
            for (const f of [...s.pinnedFiles]) {
                s.unpinFile(f);
            }
        }
    });
    // Wait for the Pinned section list to be empty
    await browser.waitUntil(
        async () => {
            const names = await getPinnedItemNames();
            return names.length === 0;
        },
        {
            timeout: 3000,
            timeoutMsg: 'Pinned section did not clear within 3s',
        },
    );
}

/**
 * Returns the text content of every visible row in the Pinned section.
 * Reads the span.truncate inside each div[role="button"] descendant.
 */
async function getPinnedItemNames(): Promise<string[]> {
    return browser.execute(() => {
        const section = document.querySelector('section[aria-label="Pinned"]');
        if (!section) return [];
        const spans = section.querySelectorAll('div[role="button"] span.truncate');
        return Array.from(spans).map((el) => (el as HTMLElement).textContent ?? '');
    });
}

/**
 * Finds and returns the div[role="button"] row in the Pinned section that
 * matches the given file basename, or null when not found.
 */
async function findPinnedRow(basename: string): Promise<WebdriverIO.Element | null> {
    const section = await browser.$('section[aria-label="Pinned"]');
    if (!(await section.isExisting())) return null;
    const rows = await section.$$('div[role="button"]');
    for (const row of rows) {
        const nameEl = await row.$('span.truncate');
        if (await nameEl.isExisting()) {
            const name = await nameEl.getText();
            if (name === basename) return row;
        }
    }
    return null;
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('QuietSidebar — Pinned section', () => {
    before(async () => {
        // Ensure the app is ready and the workspace store is exposed
        const root = await browser.$('#root');
        await root.waitForExist({ timeout: 10000, timeoutMsg: 'App root not found' });
        await ensureProjectOpen(PROJECT_PATH);
        await ensureQuietComposerMode();
    });

    beforeEach(async () => {
        await ensureCleanState();
        // ensureCleanState sets sidebarPinned to false — restore it so the
        // QuietSidebar stays visible during each scenario.
        await browser.execute(() => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const w = window as any;
            if (w.__E2E_SETTINGS_STORE__) {
                const s = w.__E2E_SETTINGS_STORE__.getState();
                if (!s.sidebarPinned) s.setSidebarPinned(true);
            }
        });
        await clearPinnedFiles();
        await browser.pause(200);
    });

    after(async () => {
        // Restore legacy layout so other test files start from the default state
        await browser.execute(() => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const w = window as any;
            if (w.__E2E_SETTINGS_STORE__) {
                w.__E2E_SETTINGS_STORE__.getState().setUiPreview('legacy');
            }
        });
    });

    // -----------------------------------------------------------------------
    // Scenario 1: Pinning a file adds it to the Pinned section
    // -----------------------------------------------------------------------
    it('should add a file to the Pinned section when pinned', async () => {
        await browser.execute((filePath: string) => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (window as any).__E2E_WORKSPACE_STORE__?.getState().pinFile(filePath);
        }, FILE_README);

        await browser.waitUntil(
            async () => {
                const names = await getPinnedItemNames();
                return names.includes('README.md');
            },
            {
                timeout: 3000,
                timeoutMsg: 'README.md did not appear in Pinned section within 3s',
            },
        );

        const names = await getPinnedItemNames();
        console.log(`[pinned] Pinned items after pin: ${names.join(', ')}`);
        expect(names).toContain('README.md');
    });

    // -----------------------------------------------------------------------
    // Scenario 2: Unpinning removes a file from the Pinned section
    // -----------------------------------------------------------------------
    it('should remove a file from the Pinned section when unpinned', async () => {
        // Pin notes.md first
        await browser.execute((filePath: string) => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (window as any).__E2E_WORKSPACE_STORE__?.getState().pinFile(filePath);
        }, FILE_NOTES);

        await browser.waitUntil(
            async () => (await getPinnedItemNames()).includes('notes.md'),
            { timeout: 3000, timeoutMsg: 'notes.md did not appear in Pinned section' },
        );

        // Unpin it
        await browser.execute((filePath: string) => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (window as any).__E2E_WORKSPACE_STORE__?.getState().unpinFile(filePath);
        }, FILE_NOTES);

        await browser.waitUntil(
            async () => !(await getPinnedItemNames()).includes('notes.md'),
            {
                timeout: 3000,
                timeoutMsg: 'notes.md was not removed from Pinned section within 3s',
            },
        );

        const names = await getPinnedItemNames();
        console.log(`[pinned] Pinned items after unpin: ${names.join(', ')}`);
        expect(names).not.toContain('notes.md');
    });

    // -----------------------------------------------------------------------
    // Scenario 3: Pin state persists across app restart (Zustand persist)
    // -----------------------------------------------------------------------
    it('should persist pinned files in localStorage for restoration on restart', async () => {
        // Pin two files
        await browser.execute((files: string[]) => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const s = (window as any).__E2E_WORKSPACE_STORE__?.getState();
            if (s) for (const f of files) s.pinFile(f);
        }, [FILE_README, FILE_NOTES]);

        // Allow the persist middleware to flush to localStorage
        await browser.pause(500);

        const persisted = await browser.execute(() => {
            const raw = localStorage.getItem('notesage-workspace');
            if (!raw) return null;
            try {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                return (JSON.parse(raw) as any).state?.pinnedFiles ?? null;
            } catch {
                return null;
            }
        }) as string[] | null;

        console.log(`[pinned] Persisted pinnedFiles: ${JSON.stringify(persisted)}`);
        expect(persisted).not.toBeNull();
        expect(persisted).toContain(FILE_README);
        expect(persisted).toContain(FILE_NOTES);
    });

    // -----------------------------------------------------------------------
    // Scenario 4: Pinned items maintain insertion order across restart
    // -----------------------------------------------------------------------
    it('should preserve insertion order of pinned files in localStorage', async () => {
        // Pin in a deliberately non-alphabetical order
        const pinOrder = [FILE_CODE, FILE_README, FILE_NOTES];

        await browser.execute((files: string[]) => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const s = (window as any).__E2E_WORKSPACE_STORE__?.getState();
            if (s) for (const f of files) s.pinFile(f);
        }, pinOrder);

        await browser.pause(500);

        const persisted = await browser.execute(() => {
            const raw = localStorage.getItem('notesage-workspace');
            if (!raw) return null;
            try {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                return (JSON.parse(raw) as any).state?.pinnedFiles ?? null;
            } catch {
                return null;
            }
        }) as string[] | null;

        console.log(`[pinned] Persisted order: ${JSON.stringify(persisted)}`);
        expect(persisted).not.toBeNull();

        // Each file should appear in insertion order (code-examples → readme → notes)
        const indices = pinOrder.map((f) => (persisted as string[]).indexOf(f));
        console.log(`[pinned] Index positions: ${indices.join(', ')}`);
        // Insertion order: earlier-pinned files have lower indices
        expect(indices[0]).toBeLessThan(indices[1]);
        expect(indices[1]).toBeLessThan(indices[2]);
    });

    // -----------------------------------------------------------------------
    // Scenario 5: Clicking a pinned item activates the document
    // -----------------------------------------------------------------------
    it('should open a document in the editor when a pinned row is clicked', async () => {
        // Pin README.md
        await browser.execute((filePath: string) => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (window as any).__E2E_WORKSPACE_STORE__?.getState().pinFile(filePath);
        }, FILE_README);

        await browser.waitUntil(
            async () => (await getPinnedItemNames()).includes('README.md'),
            { timeout: 3000, timeoutMsg: 'README.md did not appear in Pinned section' },
        );

        // Click the pinned row for README.md
        const readmeRow = await findPinnedRow('README.md');
        expect(readmeRow).not.toBeNull();
        await readmeRow!.click();

        // Wait for the editor to surface README.md content
        await browser.waitUntil(
            async () => {
                const editor = await browser.$('.ProseMirror');
                if (!(await editor.isExisting())) return false;
                const text = await editor.getText();
                return text.includes('Test Project');
            },
            {
                timeout: 5000,
                timeoutMsg: 'Editor did not display README.md content within 5s after clicking pinned row',
            },
        );

        const editorText = await (await browser.$('.ProseMirror')).getText();
        console.log(`[pinned] Editor text after click: "${editorText.substring(0, 80)}"`);
        expect(editorText).toContain('Test Project');
    });

    // -----------------------------------------------------------------------
    // Scenario 6: Active document pinned row receives active visual highlight
    // -----------------------------------------------------------------------
    it('should mark the active document\'s pinned row with data-active="true"', async () => {
        // Pin README.md
        await browser.execute((filePath: string) => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (window as any).__E2E_WORKSPACE_STORE__?.getState().pinFile(filePath);
        }, FILE_README);

        await browser.waitUntil(
            async () => (await getPinnedItemNames()).includes('README.md'),
            { timeout: 3000, timeoutMsg: 'README.md did not appear in Pinned section' },
        );

        // Open README.md in the editor
        await openFile('README.md', PROJECT_PATH);
        await browser.pause(300);

        // Verify the active tab is README.md
        const activeFilePath = await browser.execute(() => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const w = window as any;
            if (!w.__E2E_EDITOR_STORE__) return '';
            const state = w.__E2E_EDITOR_STORE__.getState();
            const tab = state.openDocuments.find((t: { id: string }) => t.id === state.activeTabId);
            return tab?.filePath ?? '';
        });
        console.log(`[pinned] Active file path: ${activeFilePath}`);
        expect(activeFilePath).toContain('README.md');

        // The pinned row for the active file must carry data-active="true"
        const readmeRow = await findPinnedRow('README.md');
        expect(readmeRow).not.toBeNull();

        const dataActive = await readmeRow!.getAttribute('data-active');
        console.log(`[pinned] data-active on README.md pinned row: ${dataActive}`);
        expect(dataActive).toBe('true');
    });
});
