/**
 * Sidebar external-delete pruning E2E tests (issue #391).
 *
 * When a file (or folder) is deleted externally — by another editor, the
 * terminal, an agent, or a sync client — its entries must disappear from the
 * QuietSidebar Recent and Pinned sections on the next filesystem-watcher tick,
 * instead of lingering as dead rows that fail when clicked. App-initiated
 * deletion already pruned both (via `useFileOperations.deletePath`); the
 * watcher path did not until the `useFileWatcher` fix this spec guards.
 *
 * "External" deletes are performed with Node's `fs` (the wdio runner runs in
 * Node and shares the real filesystem with the app), so the app's own
 * self-write suppression does not apply and the real watcher fires.
 *
 * Run manually:
 *   Terminal 1: pnpm tauri:test
 *   Terminal 2: tauri-webdriver
 *   Terminal 3: pnpm test:e2e-real
 */
import * as path from 'path';
import * as fs from 'fs';

import { tauriInvoke, openFile } from '../helpers/actions';
import { ensureCleanState, ensureProjectOpen } from '../helpers/setup';

const FIXTURE_PROJECT = path.resolve(process.cwd(), 'e2e-real/fixtures/test-project');
const WATCHER_TIMEOUT = 5000;

async function recentHas(p: string): Promise<boolean> {
    return browser.execute((fp: string) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const s = (window as any).__E2E_EDITOR_STORE__?.getState();
        return Boolean(s) && s.recentFiles.some((r: { path: string }) => r.path === fp);
    }, p);
}

async function pinnedHas(p: string): Promise<boolean> {
    return browser.execute((fp: string) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const s = (window as any).__E2E_WORKSPACE_STORE__?.getState();
        return Boolean(s) && s.pinnedFiles.includes(fp);
    }, p);
}

async function pin(p: string): Promise<void> {
    await browser.execute((fp: string) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (window as any).__E2E_WORKSPACE_STORE__?.getState().pinFile(fp);
    }, p);
}

async function unpinAll(): Promise<void> {
    await browser.execute(() => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const s = (window as any).__E2E_WORKSPACE_STORE__?.getState();
        if (s) for (const p of [...s.pinnedFiles]) s.unpinFile(p);
    });
}

describe('Sidebar external-delete pruning (#391)', () => {
    before(async () => {
        const root = await browser.$('#root');
        await root.waitForExist({ timeout: 10_000 });
        await ensureProjectOpen(FIXTURE_PROJECT);
        await tauriInvoke('watch_directory', { path: FIXTURE_PROJECT });
    });

    beforeEach(async () => {
        await ensureCleanState();
        await unpinAll();
    });

    afterEach(async () => {
        await unpinAll();
    });

    // ── Recent ──────────────────────────────────────────────────────────────

    it('removes an externally-deleted file from Recent on the next watcher tick', async () => {
        const tmpFile = path.join(FIXTURE_PROJECT, `__e2e_recent_${Date.now()}.md`);
        await tauriInvoke('write_file', { path: tmpFile, content: '# Temp recent file\n' });
        await openFile(path.basename(tmpFile), FIXTURE_PROJECT);
        expect(await recentHas(tmpFile)).toBe(true);

        fs.unlinkSync(tmpFile); // external delete

        await browser.waitUntil(async () => !(await recentHas(tmpFile)), {
            timeout: WATCHER_TIMEOUT,
            interval: 200,
            timeoutMsg: `${path.basename(tmpFile)} still in Recent ${WATCHER_TIMEOUT}ms after external delete`,
        });
    });

    it('removes a file from Recent when deleted via the app (regression guard)', async () => {
        const tmpFile = path.join(FIXTURE_PROJECT, `__e2e_recent_app_${Date.now()}.md`);
        await tauriInvoke('write_file', { path: tmpFile, content: '# Temp app-delete file\n' });
        await openFile(path.basename(tmpFile), FIXTURE_PROJECT);
        expect(await recentHas(tmpFile)).toBe(true);

        await tauriInvoke('delete_path', { path: tmpFile }); // app-initiated, synchronous prune

        await browser.waitUntil(async () => !(await recentHas(tmpFile)), {
            timeout: WATCHER_TIMEOUT,
            interval: 200,
            timeoutMsg: `${path.basename(tmpFile)} still in Recent after app delete`,
        });
    });

    // NOTE: folder-delete pruning (a deleted folder drops every Recent/Pinned
    // entry beneath it) is covered deterministically by unit tests in
    // useFileWatcher.test.ts ("removes all Recent/Pinned entries under a deleted
    // folder (prefix-aware)"). It is intentionally NOT asserted in real-E2E:
    // macOS FSEvents reports recursive folder deletes coarsely, so the watcher
    // doesn't reliably emit a folder-path delete event for a freshly-created
    // temp dir within the test window. The prune *logic* is sound and unit-
    // proven; the real-watcher folder-delete *event* is too flaky to gate CI on.

    // ── Pinned ──────────────────────────────────────────────────────────────

    it('removes an externally-deleted file from Pinned on the next watcher tick', async () => {
        const tmpFile = path.join(FIXTURE_PROJECT, `__e2e_pinned_${Date.now()}.md`);
        await tauriInvoke('write_file', { path: tmpFile, content: '# Temp pinned file\n' });
        await pin(tmpFile);
        expect(await pinnedHas(tmpFile)).toBe(true);

        fs.unlinkSync(tmpFile); // external delete

        await browser.waitUntil(async () => !(await pinnedHas(tmpFile)), {
            timeout: WATCHER_TIMEOUT,
            interval: 200,
            timeoutMsg: `${path.basename(tmpFile)} still Pinned ${WATCHER_TIMEOUT}ms after external delete`,
        });
    });

    it('removes a file from Pinned when deleted via the app (regression guard)', async () => {
        const tmpFile = path.join(FIXTURE_PROJECT, `__e2e_pinned_app_${Date.now()}.md`);
        await tauriInvoke('write_file', { path: tmpFile, content: '# Temp app-delete pinned\n' });
        await pin(tmpFile);
        expect(await pinnedHas(tmpFile)).toBe(true);

        await tauriInvoke('delete_path', { path: tmpFile }); // app-initiated, synchronous unpin

        await browser.waitUntil(async () => !(await pinnedHas(tmpFile)), {
            timeout: WATCHER_TIMEOUT,
            interval: 200,
            timeoutMsg: `${path.basename(tmpFile)} still Pinned after app delete`,
        });
    });
});
