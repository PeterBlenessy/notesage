/**
 * Test setup helpers for E2E tests.
 *
 * Provides functions to reset app state between tests, ensuring
 * each test starts from a clean, predictable baseline.
 */

import { openProject } from './actions';

/**
 * Resets the app to a clean state by closing all open tabs and
 * removing all explorer folders / projects from the sidebar.
 *
 * Intended to be called in `beforeEach` or `before` to ensure tests
 * don't leak state into each other.
 */
export async function ensureCleanState(): Promise<void> {
    await browser.execute(() => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const w = window as any;

        // Close all open tabs
        if (w.__E2E_EDITOR_STORE__) {
            const state = w.__E2E_EDITOR_STORE__.getState();
            for (const tab of [...state.tabs]) {
                state.closeTab(tab.id);
            }
        }
    });

    // Wait for tabs to clear
    await browser.waitUntil(
        async () => {
            const tabCount = await browser.execute(() => {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const w = window as any;
                if (w.__E2E_EDITOR_STORE__) {
                    return w.__E2E_EDITOR_STORE__.getState().tabs.length;
                }
                return 0;
            });
            return tabCount === 0;
        },
        {
            timeout: 3000,
            timeoutMsg: 'Tabs did not clear within 3000ms',
            interval: 200,
        },
    );
}

/**
 * Ensures ONLY the specified project is open in the sidebar.
 *
 * Clears any existing explorer folders/projects first, then opens
 * the target project. This guarantees the file tree only shows
 * the test project's files.
 *
 * @param projectPath - Absolute path to the project folder
 */
export async function ensureProjectOpen(projectPath: string): Promise<void> {
    // Check if the project folder is already in the explorer
    const isOpen = await browser.execute((path: string) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const w = window as any;
        if (w.__E2E_WORKSPACE_STORE__) {
            const s = w.__E2E_WORKSPACE_STORE__.getState();
            const folders: Array<{ path: string; fileTree?: unknown[] }> = s.explorerFolders ?? [];
            const folder = folders.find((f) => f.path === path);
            return folder && folder.fileTree && folder.fileTree.length > 0;
        }
        return false;
    }, projectPath);

    if (!isOpen) {
        await openProject(projectPath);
    }
}
