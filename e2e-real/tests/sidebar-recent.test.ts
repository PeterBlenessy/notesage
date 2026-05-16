/**
 * Real-E2E spec: QuietSidebar Recent section
 *
 * Covers MRU ordering, deduplication, cap enforcement (sidebarRecentCap),
 * external-delete cleanup, and click-to-activate behaviour.
 *
 * Run manually:
 *   Terminal 1: pnpm tauri:test
 *   Terminal 2: tauri-webdriver
 *   Terminal 3: pnpm test:e2e-real
 */

import * as path from 'path';
import { openFile, tauriInvoke } from '../helpers/actions';
import { ensureCleanState, ensureProjectOpen } from '../helpers/setup';

const FIXTURE_PROJECT = path.resolve(process.cwd(), 'e2e-real/fixtures/test-project');
const TEMP_FILE = `${FIXTURE_PROJECT}/temp-sidebar-recent-e2e.md`;

const RECENT_SECTION = 'section[aria-label="Recent"]';
const RECENT_ROW = `${RECENT_SECTION} [role="button"]`;

/** Returns the file names of every visible row in the Recent section. */
async function getRecentNames(): Promise<string[]> {
    const rows = await browser.$$(RECENT_ROW);
    const names: string[] = [];
    for (const row of rows) {
        const span = await row.$('span.truncate');
        if (await span.isExisting()) {
            names.push(await span.getText());
        }
    }
    return names;
}

/**
 * Directly injects recentFiles into the editor store, bypassing openTab.
 * This is fine for cap/filter tests where we need a precise list without
 * actually reading files from disk.
 */
async function setRecentFiles(
    files: Array<{ path: string; name: string; lastAccessedAt?: number }>,
): Promise<void> {
    await browser.execute((files) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (window as any).__E2E_EDITOR_STORE__.setState({ recentFiles: files });
    }, files);
}

/**
 * Directly sets sidebarRecentCap in the settings store, bypassing the
 * clamped setter (which enforces [3, 15]).  This lets tests exercise cap=0.
 */
async function setRecentCap(cap: number): Promise<void> {
    await browser.execute((cap) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (window as any).__E2E_SETTINGS_STORE__.setState({ sidebarRecentCap: cap });
    }, cap);
}

/**
 * Switches to quiet-composer layout, shows the sidebar, resets the recent
 * cap to 5, and clears the recent list — then waits for the Recent section
 * to appear in the DOM before returning.
 */
async function setupQuietSidebar(): Promise<void> {
    await browser.execute(() => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const w = window as any;
        w.__E2E_SETTINGS_STORE__.setState({
            uiPreview: 'quiet-composer',
            sidebarPinned: true,
            sidebarRecentCap: 5,
        });
        w.__E2E_EDITOR_STORE__.setState({ recentFiles: [] });
    });

    await browser.waitUntil(
        async () => {
            const section = await browser.$(RECENT_SECTION);
            return section.isExisting();
        },
        {
            timeout: 5000,
            timeoutMsg: 'QuietSidebar Recent section did not appear within 5s',
            interval: 100,
        },
    );
}

describe('QuietSidebar — Recent section', () => {
    let originalUiPreview: string | undefined;

    before(async () => {
        const root = await browser.$('#root');
        await root.waitForExist({ timeout: 10000 });

        // Capture mode so we can restore it after the suite
        originalUiPreview = await browser.execute(() => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            return (window as any).__E2E_SETTINGS_STORE__?.getState().uiPreview;
        });

        await ensureProjectOpen(FIXTURE_PROJECT);
        // Ensure the filesystem watcher is running on the fixture project
        await tauriInvoke('watch_directory', { path: FIXTURE_PROJECT });
    });

    after(async () => {
        // Restore original layout mode
        const preview = originalUiPreview;
        await browser.execute((preview) => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (window as any).__E2E_SETTINGS_STORE__.setState({ uiPreview: preview ?? undefined });
        }, preview);
        await browser.pause(300);
    });

    beforeEach(async () => {
        await ensureCleanState();
        await setupQuietSidebar();
    });

    afterEach(async () => {
        // Clean up temp file if a test left it behind
        try {
            await tauriInvoke('delete_path', { path: TEMP_FILE });
        } catch {
            // Ignore — file may not exist
        }
    });

    // ---------------------------------------------------------------
    // Test 1: MRU order
    // ---------------------------------------------------------------
    it('adds the most recently opened file to the top of the Recent section', async () => {
        await openFile('README.md', FIXTURE_PROJECT);
        await openFile('notes.md', FIXTURE_PROJECT);

        await browser.waitUntil(
            async () => (await getRecentNames()).length >= 2,
            {
                timeout: 3000,
                timeoutMsg: 'Recent section did not show at least 2 entries within 3s',
                interval: 100,
            },
        );

        const names = await getRecentNames();
        console.log(`[recent] MRU order: ${names.join(', ')}`);

        expect(names[0]).toBe('notes.md');
        expect(names[1]).toBe('README.md');
    });

    // ---------------------------------------------------------------
    // Test 2: Deduplication
    // ---------------------------------------------------------------
    it('moves a re-opened file to the top with no duplicate entry', async () => {
        await openFile('README.md', FIXTURE_PROJECT);
        await openFile('notes.md', FIXTURE_PROJECT);
        await openFile('README.md', FIXTURE_PROJECT);   // re-open

        await browser.waitUntil(
            async () => {
                const names = await getRecentNames();
                return names.length >= 1 && names[0] === 'README.md';
            },
            {
                timeout: 3000,
                timeoutMsg: 'README.md did not move to top after re-open within 3s',
                interval: 100,
            },
        );

        const names = await getRecentNames();
        console.log(`[recent] After re-open: ${names.join(', ')}`);

        expect(names[0]).toBe('README.md');
        expect(names[1]).toBe('notes.md');

        const readmeCount = names.filter((n) => n === 'README.md').length;
        expect(readmeCount).toBe(1);
    });

    // ---------------------------------------------------------------
    // Test 3: Cap enforcement for values in [1, 15]
    // ---------------------------------------------------------------
    it('respects sidebarRecentCap for values in the 1–15 range', async () => {
        const now = Date.now();
        await setRecentFiles([
            { path: `${FIXTURE_PROJECT}/README.md`, name: 'README.md', lastAccessedAt: now },
            { path: `${FIXTURE_PROJECT}/notes.md`, name: 'notes.md', lastAccessedAt: now - 1000 },
            { path: `${FIXTURE_PROJECT}/code-examples.md`, name: 'code-examples.md', lastAccessedAt: now - 2000 },
            { path: `${FIXTURE_PROJECT}/empty.md`, name: 'empty.md', lastAccessedAt: now - 3000 },
            { path: `${FIXTURE_PROJECT}/large-doc.md`, name: 'large-doc.md', lastAccessedAt: now - 4000 },
        ]);

        // cap=3 → only 3 rows visible
        await setRecentCap(3);
        await browser.waitUntil(
            async () => (await browser.$$(RECENT_ROW)).length === 3,
            {
                timeout: 3000,
                timeoutMsg: 'Expected exactly 3 Recent rows at cap=3',
                interval: 100,
            },
        );
        const rowsAt3 = await browser.$$(RECENT_ROW);
        console.log(`[recent] Cap=3 row count: ${rowsAt3.length}`);
        expect(rowsAt3.length).toBe(3);

        // cap=5 → all 5 rows visible
        await setRecentCap(5);
        await browser.waitUntil(
            async () => (await browser.$$(RECENT_ROW)).length === 5,
            {
                timeout: 3000,
                timeoutMsg: 'Expected exactly 5 Recent rows at cap=5',
                interval: 100,
            },
        );
        const rowsAt5 = await browser.$$(RECENT_ROW);
        console.log(`[recent] Cap=5 row count: ${rowsAt5.length}`);
        expect(rowsAt5.length).toBe(5);
    });

    // ---------------------------------------------------------------
    // Test 4: Cap=0 hides the section entirely
    // ---------------------------------------------------------------
    it('hides the Recent section entirely when sidebarRecentCap is 0', async () => {
        // Seed an entry so the section would render if cap were non-zero
        const now = Date.now();
        await setRecentFiles([
            { path: `${FIXTURE_PROJECT}/README.md`, name: 'README.md', lastAccessedAt: now },
        ]);

        // Bypass the clamped setter (which enforces min=3) to force cap=0
        await setRecentCap(0);

        await browser.waitUntil(
            async () => {
                const section = await browser.$(RECENT_SECTION);
                return !(await section.isExisting());
            },
            {
                timeout: 3000,
                timeoutMsg: 'Recent section should not be in the DOM when sidebarRecentCap=0',
                interval: 100,
            },
        );

        const section = await browser.$(RECENT_SECTION);
        const exists = await section.isExisting();
        console.log(`[recent] Section exists at cap=0: ${exists}`);
        expect(exists).toBe(false);
    });

    // ---------------------------------------------------------------
    // Test 5: External delete cleans the Recent list
    // ---------------------------------------------------------------
    it('removes an externally-deleted file from the Recent list', async () => {
        // Create a temporary file in the fixture project
        await tauriInvoke('write_file', {
            path: TEMP_FILE,
            content: '# Temp\n\nTemporary file used by sidebar-recent.test.ts.\n',
        });

        // Open it via the standard helper (reads from disk, adds to recentFiles)
        await openFile('temp-sidebar-recent-e2e.md', FIXTURE_PROJECT);

        // Confirm the file appears in the Recent section
        await browser.waitUntil(
            async () => (await getRecentNames()).includes('temp-sidebar-recent-e2e.md'),
            {
                timeout: 3000,
                timeoutMsg: 'temp file did not appear in the Recent section',
                interval: 100,
            },
        );

        // Externally delete the file (simulates another process/editor deleting it)
        await tauriInvoke('delete_path', { path: TEMP_FILE });

        // Wait for the filesystem watcher to detect the delete and clean the Recent list
        await browser.waitUntil(
            async () => !(await getRecentNames()).includes('temp-sidebar-recent-e2e.md'),
            {
                timeout: 5000,
                timeoutMsg: 'temp file was not removed from the Recent section after external delete',
                interval: 300,
            },
        );

        const names = await getRecentNames();
        console.log(`[recent] After external delete, Recent names: ${names.join(', ')}`);
        expect(names).not.toContain('temp-sidebar-recent-e2e.md');
    });

    // ---------------------------------------------------------------
    // Test 6: Click to activate
    // ---------------------------------------------------------------
    it('activates the corresponding document when a Recent row is clicked', async () => {
        // Open README.md — this adds it to both openDocuments and recentFiles
        await openFile('README.md', FIXTURE_PROJECT);

        // Close the tab without clearing recentFiles (closeTab does not remove from recentFiles)
        await browser.execute(() => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const state = (window as any).__E2E_EDITOR_STORE__.getState();
            const tab = state.openDocuments.find(
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                (t: any) => typeof t.filePath === 'string' && t.filePath.endsWith('README.md'),
            );
            if (tab) state.closeTab(tab.id);
        });

        // The file should still appear in the Recent section
        await browser.waitUntil(
            async () => (await getRecentNames()).includes('README.md'),
            {
                timeout: 3000,
                timeoutMsg: 'README.md should remain in Recent after tab close',
                interval: 100,
            },
        );

        // Find and click the README.md row
        let targetRow: WebdriverIO.Element | null = null;
        const rows = await browser.$$(RECENT_ROW);
        for (const row of rows) {
            const span = await row.$('span.truncate');
            if ((await span.isExisting()) && (await span.getText()) === 'README.md') {
                targetRow = row;
                break;
            }
        }
        expect(targetRow).not.toBeNull();
        await targetRow!.click();

        // Wait for README.md to be the active document in the editor
        await browser.waitUntil(
            async () => {
                const activeFilePath = await browser.execute(() => {
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    const state = (window as any).__E2E_EDITOR_STORE__.getState();
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    const activeTab = state.openDocuments.find((t: any) => t.id === state.activeTabId);
                    return activeTab?.filePath ?? null;
                });
                return typeof activeFilePath === 'string' && activeFilePath.endsWith('README.md');
            },
            {
                timeout: 5000,
                timeoutMsg: 'README.md was not activated after clicking the Recent row',
                interval: 200,
            },
        );

        const activeFilePath = await browser.execute(() => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const state = (window as any).__E2E_EDITOR_STORE__.getState();
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const activeTab = state.openDocuments.find((t: any) => t.id === state.activeTabId);
            return activeTab?.filePath ?? null;
        });
        console.log(`[recent] Active file after click: ${activeFilePath}`);
        expect(typeof activeFilePath === 'string' && activeFilePath.endsWith('README.md')).toBe(true);
    });
});
