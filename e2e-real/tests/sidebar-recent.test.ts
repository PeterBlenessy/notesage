/**
 * Sidebar Recent section E2E tests.
 *
 * Validates that the Recent section in the QuietSidebar stays in sync with
 * the filesystem — specifically that externally-deleted files are pruned
 * from recentFiles on the next watcher tick (issue #391).
 *
 * Run manually:
 *   Terminal 1: pnpm tauri:test
 *   Terminal 2: tauri-webdriver
 *   Terminal 3: pnpm test:e2e-real
 */

import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { tauriInvoke, openFile, waitForElement } from '../helpers/actions';
import { ensureCleanState, ensureProjectOpen } from '../helpers/setup';

const FIXTURE_PROJECT = path.resolve(process.cwd(), 'e2e-real/fixtures/test-project');
const WATCHER_TIMEOUT = 3000;

describe('Sidebar Recent section', () => {
    before(async () => {
        const root = await browser.$('#root');
        await root.waitForExist({ timeout: 10_000 });
        await ensureProjectOpen(FIXTURE_PROJECT);
        await tauriInvoke('watch_directory', { path: FIXTURE_PROJECT });
    });

    beforeEach(async () => {
        await ensureCleanState();
    });

    // -----------------------------------------------------------------------
    // Acceptance criterion (issue #391): deleting a file externally removes
    // it from the Recent section on the next watcher tick.
    // -----------------------------------------------------------------------

    it('removes an externally-deleted file from the Recent section', async () => {
        // Create a temporary file in the fixture project
        const tmpFile = path.join(FIXTURE_PROJECT, `__e2e_recent_${Date.now()}.md`);
        await tauriInvoke('write_file', { path: tmpFile, content: '# Temp recent file\n' });

        // Open the file so it lands in recentFiles
        await openFile(path.basename(tmpFile), FIXTURE_PROJECT);
        await browser.pause(300);

        // Verify it is in the editor store's recentFiles before deletion
        const wasRecent: boolean = await browser.execute((p: string) => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const store = (window as any).__E2E_EDITOR_STORE__;
            if (!store) return false;
            return store.getState().recentFiles.some((r: { path: string }) => r.path === p);
        }, tmpFile);
        expect(wasRecent).toBe(true);

        // Delete the file externally (not through Notesage's delete command)
        fs.unlinkSync(tmpFile);

        // Wait for the watcher debounce to fire and prune the entry
        await browser.waitUntil(
            async () => browser.execute((p: string) => {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const store = (window as any).__E2E_EDITOR_STORE__;
                if (!store) return false;
                return !store.getState().recentFiles.some((r: { path: string }) => r.path === p);
            }, tmpFile),
            {
                timeout: WATCHER_TIMEOUT,
                timeoutMsg: `recentFiles still contains ${path.basename(tmpFile)} ${WATCHER_TIMEOUT}ms after external delete`,
                interval: 200,
            },
        );
    });

    // -----------------------------------------------------------------------
    // Regression guard: app-initiated deletion still prunes Recent.
    // -----------------------------------------------------------------------

    it('removes a file from Recent when deleted via app (regression guard)', async () => {
        // Create a temporary file
        const tmpFile = path.join(FIXTURE_PROJECT, `__e2e_recent_app_${Date.now()}.md`);
        await tauriInvoke('write_file', { path: tmpFile, content: '# Temp app-delete file\n' });
        await openFile(path.basename(tmpFile), FIXTURE_PROJECT);
        await browser.pause(300);

        // Verify it is recent
        const wasRecent: boolean = await browser.execute((p: string) => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const store = (window as any).__E2E_EDITOR_STORE__;
            if (!store) return false;
            return store.getState().recentFiles.some((r: { path: string }) => r.path === p);
        }, tmpFile);
        expect(wasRecent).toBe(true);

        // Delete via Tauri (app-initiated path)
        await tauriInvoke('delete_path', { path: tmpFile });

        // Pruning is synchronous via useFileOperations.deletePath
        const isGone: boolean = await browser.execute((p: string) => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const store = (window as any).__E2E_EDITOR_STORE__;
            if (!store) return true;
            return !store.getState().recentFiles.some((r: { path: string }) => r.path === p);
        }, tmpFile);
        expect(isGone).toBe(true);
    });

    // -----------------------------------------------------------------------
    // Folder delete: all Recent entries beneath a deleted folder are pruned.
    // -----------------------------------------------------------------------

    it('removes all Recent entries under an externally-deleted folder', async () => {
        // Create a temp subfolder with two files
        const tmpDir = path.join(FIXTURE_PROJECT, `__e2e_dir_${Date.now()}`);
        const fileA = path.join(tmpDir, 'a.md');
        const fileB = path.join(tmpDir, 'b.md');
        fs.mkdirSync(tmpDir);
        await tauriInvoke('write_file', { path: fileA, content: '# A\n' });
        await tauriInvoke('write_file', { path: fileB, content: '# B\n' });

        // Open both to seed recentFiles
        await openFile('a.md', tmpDir);
        await browser.pause(200);
        await openFile('b.md', tmpDir);
        await browser.pause(200);

        // Delete the whole folder externally
        fs.rmSync(tmpDir, { recursive: true, force: true });

        // Both entries must be pruned
        await browser.waitUntil(
            async () => browser.execute((a: string, b: string) => {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const store = (window as any).__E2E_EDITOR_STORE__;
                if (!store) return false;
                const recents = store.getState().recentFiles;
                const hasA = recents.some((r: { path: string }) => r.path === a);
                const hasB = recents.some((r: { path: string }) => r.path === b);
                return !hasA && !hasB;
            }, fileA, fileB),
            {
                timeout: WATCHER_TIMEOUT,
                timeoutMsg: `recentFiles still contains entries from ${path.basename(tmpDir)} after external folder delete`,
                interval: 200,
            },
        );
    });
});
