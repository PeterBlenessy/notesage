/**
 * Sidebar Pinned section E2E tests.
 *
 * Validates that the Pinned section in the QuietSidebar stays in sync with
 * the filesystem — specifically that externally-deleted files are pruned
 * from pinnedFiles on the next watcher tick (issue #391).
 *
 * Run manually:
 *   Terminal 1: pnpm tauri:test
 *   Terminal 2: tauri-webdriver
 *   Terminal 3: pnpm test:e2e-real
 */

import * as path from 'path';
import * as fs from 'fs';
import { tauriInvoke, waitForElement } from '../helpers/actions';
import { ensureCleanState, ensureProjectOpen } from '../helpers/setup';

const FIXTURE_PROJECT = path.resolve(process.cwd(), 'e2e-real/fixtures/test-project');
const WATCHER_TIMEOUT = 3000;

/** Pin a file by updating the workspace store directly (bypasses UI interaction). */
async function pinFile(filePath: string): Promise<void> {
    await browser.execute((p: string) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const store = (window as any).__E2E_WORKSPACE_STORE__;
        if (store) store.getState().pinFile(p);
    }, filePath);
}

describe('Sidebar Pinned section', () => {
    before(async () => {
        const root = await browser.$('#root');
        await root.waitForExist({ timeout: 10_000 });
        await ensureProjectOpen(FIXTURE_PROJECT);
        await tauriInvoke('watch_directory', { path: FIXTURE_PROJECT });
    });

    beforeEach(async () => {
        await ensureCleanState();
        // Clear any leftover pinned files from previous tests
        await browser.execute(() => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const store = (window as any).__E2E_WORKSPACE_STORE__;
            if (store) {
                const state = store.getState();
                for (const p of [...state.pinnedFiles]) {
                    state.unpinFile(p);
                }
            }
        });
    });

    // -----------------------------------------------------------------------
    // Acceptance criterion (issue #391): deleting a pinned file externally
    // removes it from the Pinned section on the next watcher tick.
    // -----------------------------------------------------------------------

    it('removes an externally-deleted file from the Pinned section', async () => {
        // Create a temporary file and pin it
        const tmpFile = path.join(FIXTURE_PROJECT, `__e2e_pinned_${Date.now()}.md`);
        await tauriInvoke('write_file', { path: tmpFile, content: '# Temp pinned file\n' });
        await pinFile(tmpFile);
        await browser.pause(200);

        // Verify it is pinned
        const wasPinned: boolean = await browser.execute((p: string) => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const store = (window as any).__E2E_WORKSPACE_STORE__;
            if (!store) return false;
            return store.getState().pinnedFiles.includes(p);
        }, tmpFile);
        expect(wasPinned).toBe(true);

        // Delete the file externally
        fs.unlinkSync(tmpFile);

        // Wait for the watcher to prune the pinned entry
        await browser.waitUntil(
            async () => browser.execute((p: string) => {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const store = (window as any).__E2E_WORKSPACE_STORE__;
                if (!store) return false;
                return !store.getState().pinnedFiles.includes(p);
            }, tmpFile),
            {
                timeout: WATCHER_TIMEOUT,
                timeoutMsg: `pinnedFiles still contains ${path.basename(tmpFile)} ${WATCHER_TIMEOUT}ms after external delete`,
                interval: 200,
            },
        );
    });

    // -----------------------------------------------------------------------
    // Regression guard: app-initiated deletion still prunes Pinned.
    // -----------------------------------------------------------------------

    it('removes a file from Pinned when deleted via app (regression guard)', async () => {
        const tmpFile = path.join(FIXTURE_PROJECT, `__e2e_pinned_app_${Date.now()}.md`);
        await tauriInvoke('write_file', { path: tmpFile, content: '# Temp app-delete pinned\n' });
        await pinFile(tmpFile);
        await browser.pause(200);

        // Verify it is pinned before deletion
        const wasPinned: boolean = await browser.execute((p: string) => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const store = (window as any).__E2E_WORKSPACE_STORE__;
            if (!store) return false;
            return store.getState().pinnedFiles.includes(p);
        }, tmpFile);
        expect(wasPinned).toBe(true);

        // Delete via app (app-initiated path calls unpinFile synchronously)
        await tauriInvoke('delete_path', { path: tmpFile });

        // app-initiated delete unpins synchronously in useFileOperations.deletePath
        const isGone: boolean = await browser.execute((p: string) => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const store = (window as any).__E2E_WORKSPACE_STORE__;
            if (!store) return true;
            return !store.getState().pinnedFiles.includes(p);
        }, tmpFile);
        expect(isGone).toBe(true);
    });

    // -----------------------------------------------------------------------
    // Folder delete: all Pinned entries beneath a deleted folder are pruned.
    // -----------------------------------------------------------------------

    it('removes all Pinned entries under an externally-deleted folder', async () => {
        const tmpDir = path.join(FIXTURE_PROJECT, `__e2e_dir_pinned_${Date.now()}`);
        const fileA = path.join(tmpDir, 'pinned-a.md');
        const fileB = path.join(tmpDir, 'pinned-b.md');
        fs.mkdirSync(tmpDir);
        await tauriInvoke('write_file', { path: fileA, content: '# Pinned A\n' });
        await tauriInvoke('write_file', { path: fileB, content: '# Pinned B\n' });
        await pinFile(fileA);
        await pinFile(fileB);
        await browser.pause(200);

        // Delete the whole folder externally
        fs.rmSync(tmpDir, { recursive: true, force: true });

        await browser.waitUntil(
            async () => browser.execute((a: string, b: string) => {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const store = (window as any).__E2E_WORKSPACE_STORE__;
                if (!store) return false;
                const pinned = store.getState().pinnedFiles as string[];
                return !pinned.includes(a) && !pinned.includes(b);
            }, fileA, fileB),
            {
                timeout: WATCHER_TIMEOUT,
                timeoutMsg: `pinnedFiles still contains entries from ${path.basename(tmpDir)} after external folder delete`,
                interval: 200,
            },
        );
    });
});
