/**
 * QuietSidebar Pinned section E2E tests (issue #277).
 *
 * Covers pin/unpin, persistence, insertion order, click-to-activate, and the
 * active-row highlight against the real Tauri app.
 *
 * Driven through the exposed Zustand stores (workspace-store `pinFile` /
 * `unpinFile`) + DOM clicks — the WKWebView-safe pattern proven in
 * document-switching.test.ts. Pinned rows render as
 * `[aria-label="Pinned"] [role="button"]` with the filename as text and
 * `data-active="true"` / `aria-current="page"` on the active document's row.
 *
 * "Persist across restart" has no app-restart in this harness, so it is
 * asserted via the persisted artifact: the workspace-store writes pins to
 * localStorage under `notesage-workspace` (Zustand persist), which is what a
 * restart would rehydrate from.
 *
 * Run manually:
 *   Terminal 1: pnpm tauri:test
 *   Terminal 2: tauri-webdriver
 *   Terminal 3: pnpm test:e2e-real
 */
import * as path from 'path';

import { ensureCleanState, ensureProjectOpen } from '../helpers/setup';

const TEST_PROJECT_PATH = path.resolve(process.cwd(), 'e2e-real/fixtures/test-project');
const fileA = { name: 'notes.md', path: path.join(TEST_PROJECT_PATH, 'notes.md'), sentinel: 'My Notes' };
const fileB = { name: 'code-examples.md', path: path.join(TEST_PROJECT_PATH, 'code-examples.md') };

async function pin(...paths: string[]): Promise<void> {
    await browser.execute((ps: string[]) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const s = (window as any).__E2E_WORKSPACE_STORE__?.getState();
        if (s) for (const p of ps) s.pinFile(p);
    }, paths);
}

async function unpinAll(): Promise<void> {
    await browser.execute(() => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const s = (window as any).__E2E_WORKSPACE_STORE__?.getState();
        if (s) for (const p of [...(s.pinnedFiles ?? [])]) s.unpinFile(p);
    });
}

async function showSidebar(): Promise<void> {
    await browser.execute(() => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const s = (window as any).__E2E_SETTINGS_STORE__?.getState();
        if (!s) return;
        if (!s.sidebarPinned) s.setSidebarPinned(true);
        if (!s.sidebarOpen) s.setSidebarOpen(true);
    });
}

async function pinnedRowTexts(): Promise<string[]> {
    const rows = await browser.$$('[aria-label="Pinned"] [role="button"]');
    const texts: string[] = [];
    for (const r of rows) texts.push((await r.getText()).trim());
    return texts;
}

async function clickPinnedRow(name: string): Promise<void> {
    await browser.waitUntil(
        async () => (await browser.$$('[aria-label="Pinned"] [role="button"]')).length > 0,
        { timeout: 10_000, interval: 100, timeoutMsg: 'No Pinned rows rendered' },
    );
    const rows = await browser.$$('[aria-label="Pinned"] [role="button"]');
    for (const r of rows) {
        if ((await r.getText()).includes(name)) {
            await r.click();
            return;
        }
    }
    throw new Error(`No Pinned row found for "${name}"`);
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

describe('QuietSidebar — Pinned section', () => {
    before(async () => {
        await ensureProjectOpen(TEST_PROJECT_PATH);
        // Pin a stable window size — performance/navigation specs resize the
        // window and WKWebView's setWindowSize doesn't always restore, which
        // would collapse the sidebar layout for these tests.
        await browser.setWindowSize(1200, 800);
    });

    beforeEach(async () => {
        await ensureCleanState();
        await unpinAll();
        await showSidebar();
    });

    afterEach(async () => {
        await unpinAll();
    });

    it('pinning a file adds it to the Pinned section', async () => {
        await pin(fileA.path);
        await browser.waitUntil(
            async () => (await pinnedRowTexts()).some((t) => t.includes(fileA.name)),
            { timeout: 10_000, interval: 100, timeoutMsg: `${fileA.name} did not appear in Pinned` },
        );
    });

    it('unpinning removes it from the Pinned section', async () => {
        await pin(fileA.path);
        await browser.waitUntil(
            async () => (await pinnedRowTexts()).some((t) => t.includes(fileA.name)),
            { timeout: 10_000, interval: 100, timeoutMsg: `${fileA.name} did not appear in Pinned` },
        );
        await unpinAll();
        await browser.waitUntil(
            async () => !(await pinnedRowTexts()).some((t) => t.includes(fileA.name)),
            { timeout: 10_000, interval: 100, timeoutMsg: `${fileA.name} still in Pinned after unpin` },
        );
    });

    it('persists pins to the workspace-store localStorage artifact', async () => {
        await pin(fileA.path);
        // The persisted artifact is what a restart rehydrates from.
        const persisted = await browser.execute(() => localStorage.getItem('notesage-workspace'));
        expect(persisted).toBeTruthy();
        expect(persisted as string).toContain(fileA.path);
    });

    it('maintains insertion order (A then B)', async () => {
        await pin(fileA.path);
        await pin(fileB.path);
        await browser.waitUntil(
            async () => (await pinnedRowTexts()).length >= 2,
            { timeout: 10_000, interval: 100, timeoutMsg: 'Two pinned rows did not render' },
        );
        const texts = await pinnedRowTexts();
        const idxA = texts.findIndex((t) => t.includes(fileA.name));
        const idxB = texts.findIndex((t) => t.includes(fileB.name));
        expect(idxA).toBeGreaterThanOrEqual(0);
        expect(idxB).toBeGreaterThan(idxA);
    });

    it('clicking a pinned item activates the document and highlights its row', async () => {
        await pin(fileA.path);
        await clickPinnedRow(fileA.name);

        await browser.waitUntil(
            async () => (await activeFilePath()) === fileA.path,
            { timeout: 15_000, interval: 100, timeoutMsg: 'Pinned click did not activate the document' },
        );

        // The active document's pinned row carries the active marker.
        await browser.waitUntil(
            async () => {
                const rows = await browser.$$('[aria-label="Pinned"] [role="button"]');
                for (const r of rows) {
                    if ((await r.getText()).includes(fileA.name)) {
                        const active = await r.getAttribute('data-active');
                        const current = await r.getAttribute('aria-current');
                        return active === 'true' || current === 'page';
                    }
                }
                return false;
            },
            { timeout: 10_000, interval: 100, timeoutMsg: 'Active pinned row did not receive the active highlight' },
        );
    });
});
