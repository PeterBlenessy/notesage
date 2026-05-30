/**
 * QuietSidebar Recent section E2E tests (issue #278).
 *
 * Covers MRU ordering, deduplication, display-cap enforcement, and
 * click-to-activate against the real Tauri app. Recent is backed by
 * `editor-store.recentFiles` (capped at MAX_RECENT_FILES = 5, most-recent
 * first) and rendered as `[aria-label="Recent"] [role="button"]` rows.
 *
 * One criterion from the original issue is intentionally NOT tested here:
 *
 *   - "Setting sidebarRecentCap to 0 hides the Recent section" — not
 *     achievable: `setSidebarRecentCap` clamps to [3, 15] (min 3). Only the
 *     Tags/Mentions caps go to 0. The criterion conflated Recent with those.
 *
 * External-delete pruning (a file deleted outside the app drops out of Recent
 * on the next watcher tick) is covered in `sidebar-external-delete.test.ts`
 * (issue #391) — it was a real gap, now fixed in `useFileWatcher`.
 *
 * Run manually:
 *   Terminal 1: pnpm tauri:test
 *   Terminal 2: tauri-webdriver
 *   Terminal 3: pnpm test:e2e-real
 */
import * as path from 'path';

import { openFile } from '../helpers/actions';
import { ensureCleanState, ensureProjectOpen } from '../helpers/setup';

const TEST_PROJECT_PATH = path.resolve(process.cwd(), 'e2e-real/fixtures/test-project');
const A = { name: 'notes.md', path: path.join(TEST_PROJECT_PATH, 'notes.md') };
const B = { name: 'code-examples.md', path: path.join(TEST_PROJECT_PATH, 'code-examples.md') };
const C = { name: 'large-doc.md', path: path.join(TEST_PROJECT_PATH, 'large-doc.md') };
const D = { name: 'empty.md', path: path.join(TEST_PROJECT_PATH, 'empty.md') };

async function showSidebar(): Promise<void> {
    await browser.execute(() => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const s = (window as any).__E2E_SETTINGS_STORE__?.getState();
        if (!s) return;
        if (!s.sidebarPinned) s.setSidebarPinned(true);
        if (!s.sidebarOpen) s.setSidebarOpen(true);
    });
}

async function resetRecent(): Promise<void> {
    await browser.execute(() => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const w = window as any;
        w.__E2E_EDITOR_STORE__?.setState({ recentFiles: [] });
        const s = w.__E2E_SETTINGS_STORE__?.getState();
        if (s?.setSidebarRecentCap) s.setSidebarRecentCap(5); // default
    });
}

async function recentRowTexts(): Promise<string[]> {
    const rows = await browser.$$('[aria-label="Recent"] [role="button"]');
    const texts: string[] = [];
    for (const r of rows) texts.push((await r.getText()).trim());
    return texts;
}

async function recentPaths(): Promise<string[]> {
    return browser.execute(() => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const s = (window as any).__E2E_EDITOR_STORE__?.getState();
        return (s?.recentFiles ?? []).map((r: { path: string }) => r.path);
    });
}

async function clickRecentRow(name: string): Promise<void> {
    await browser.waitUntil(
        async () => (await browser.$$('[aria-label="Recent"] [role="button"]')).length > 0,
        { timeout: 10_000, interval: 100, timeoutMsg: 'No Recent rows rendered' },
    );
    const rows = await browser.$$('[aria-label="Recent"] [role="button"]');
    for (const r of rows) {
        if ((await r.getText()).includes(name)) {
            await r.click();
            return;
        }
    }
    throw new Error(`No Recent row found for "${name}"`);
}

async function activeFilePath(): Promise<string | null> {
    return browser.execute(() => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const s = (window as any).__E2E_EDITOR_STORE__?.getState();
        if (!s) return null;
        const t = s.openDocuments.find((d: { id: string }) => d.id === s.activeTabId);
        return t ? t.filePath : null;
    });
}

describe('QuietSidebar — Recent section', () => {
    before(async () => {
        await ensureProjectOpen(TEST_PROJECT_PATH);
        await browser.setWindowSize(1200, 800);
    });

    beforeEach(async () => {
        await ensureCleanState();
        await resetRecent();
        await showSidebar();
    });

    afterEach(async () => {
        await resetRecent();
    });

    it('adds an opened file to the top of Recent (MRU order)', async () => {
        await openFile(A.name, TEST_PROJECT_PATH);
        await openFile(B.name, TEST_PROJECT_PATH);

        // Store: most-recent first.
        await browser.waitUntil(
            async () => {
                const p = await recentPaths();
                return p[0] === B.path && p.includes(A.path);
            },
            { timeout: 10_000, interval: 100, timeoutMsg: 'recentFiles not in MRU order' },
        );

        // DOM: rows render most-recent first.
        const texts = await recentRowTexts();
        const idxB = texts.findIndex((t) => t.includes(B.name));
        const idxA = texts.findIndex((t) => t.includes(A.name));
        expect(idxB).toBe(0);
        expect(idxA).toBeGreaterThan(idxB);
    });

    it('re-opening a recent file moves it to the top without duplicating', async () => {
        await openFile(A.name, TEST_PROJECT_PATH);
        await openFile(B.name, TEST_PROJECT_PATH);
        await openFile(A.name, TEST_PROJECT_PATH); // re-open A

        await browser.waitUntil(
            async () => {
                const p = await recentPaths();
                return p[0] === A.path && p.filter((x) => x === A.path).length === 1;
            },
            { timeout: 10_000, interval: 100, timeoutMsg: 'Re-open did not move A to top without duplication' },
        );
        const p = await recentPaths();
        expect(p.length).toBe(2); // A and B, no dup
    });

    it('respects sidebarRecentCap for the displayed rows', async () => {
        await browser.execute(() => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const s = (window as any).__E2E_SETTINGS_STORE__?.getState();
            s?.setSidebarRecentCap?.(3); // min clamp is 3
        });

        // Open 4 distinct files — recentFiles will hold 4, display caps to 3.
        await openFile(A.name, TEST_PROJECT_PATH);
        await openFile(B.name, TEST_PROJECT_PATH);
        await openFile(C.name, TEST_PROJECT_PATH);
        await openFile(D.name, TEST_PROJECT_PATH);

        await browser.waitUntil(
            async () => (await recentPaths()).length >= 4,
            { timeout: 10_000, interval: 100, timeoutMsg: 'recentFiles did not accumulate 4 entries' },
        );

        const texts = await recentRowTexts();
        expect(texts.length).toBe(3);
    });

    it('clicking a recent item activates the corresponding document', async () => {
        await openFile(A.name, TEST_PROJECT_PATH);
        await openFile(B.name, TEST_PROJECT_PATH);

        await clickRecentRow(A.name);
        await browser.waitUntil(
            async () => (await activeFilePath()) === A.path,
            { timeout: 15_000, interval: 100, timeoutMsg: 'Recent click did not activate the document' },
        );
    });
});
