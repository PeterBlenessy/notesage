/**
 * QuietSidebar inline tree-navigation E2E tests (issue #279, reinterpreted).
 *
 * The original issue targeted the TreeOverlay (⌘⇧E), which has since been
 * DELETED (sidebar-simplification; regression-locked by no-tree-overlay.test.ts,
 * and ⌘⇧E now opens Export). Its replacement is the QuietSidebar's inline
 * tree-expand on ProjectsSection rows: a project row expands one level in place
 * to reveal its children. This spec covers that replacement surface.
 *
 * Inline expand is click-drivable (`ProjectRow` onClick → `toggleExpanded`) —
 * the WKWebView-safe path. (ArrowRight also expands for keyboard users, but
 * WebDriver doesn't reliably deliver bare navigation keys to WKWebView, same
 * limitation seen with ⌃Tab; the keyboard path is exercised by unit tests.)
 *
 * Markers (per ProjectsSection.tsx):
 *   - project row: [data-row-type="project"], aria-expanded, role="treeitem"
 *   - child row:   [data-row-type="child"]
 *   - only workspace-store.projects render here (explorer folders / notes-tree
 *     are intentionally excluded from the Quiet sidebar).
 *
 * Run manually:
 *   Terminal 1: pnpm tauri:test
 *   Terminal 2: tauri-webdriver
 *   Terminal 3: pnpm test:e2e-real
 */
import * as path from 'path';

import { tauriInvoke } from '../helpers/actions';
import { ensureCleanState } from '../helpers/setup';

const TEST_PROJECT_PATH = path.resolve(process.cwd(), 'e2e-real/fixtures/test-project');
const PROJECT_BASENAME = 'test-project';

async function showSidebar(): Promise<void> {
    await browser.execute(() => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const s = (window as any).__E2E_SETTINGS_STORE__?.getState();
        if (!s) return;
        if (!s.sidebarPinned) s.setSidebarPinned(true);
        if (!s.sidebarOpen) s.setSidebarOpen(true);
    });
}

/** Adds the fixture as a workspace PROJECT (not an explorer folder). */
async function addFixtureProject(): Promise<void> {
    const tree = await tauriInvoke('list_directory', { path: TEST_PROJECT_PATH });
    await browser.execute(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (p: string, t: any) => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const w = window as any;
            const s = w.__E2E_WORKSPACE_STORE__?.getState();
            if (!s) return;
            // Remove any explorer-folder copy so it only shows as a project.
            for (const f of [...(s.explorerFolders ?? [])]) {
                if (f.path === p) s.removeExplorerFolder(p);
            }
            s.addProject(p, t);
        },
        TEST_PROJECT_PATH,
        tree,
    );
}

function projectRow() {
    return browser.$(`[data-row-type="project"]`);
}

async function isExpanded(): Promise<boolean> {
    const row = await projectRow();
    return (await row.getAttribute('aria-expanded')) === 'true';
}

/** Ensures the project row is collapsed (expand state persists across tests). */
async function ensureCollapsed(): Promise<void> {
    const row = await projectRow();
    await row.waitForExist({ timeout: 10_000 });
    if (await isExpanded()) {
        await row.click();
        await browser.waitUntil(async () => !(await isExpanded()), {
            timeout: 5_000, interval: 100, timeoutMsg: 'Project did not collapse',
        });
    }
}

async function childRowCount(): Promise<number> {
    return (await browser.$$(`[data-row-type="child"]`)).length;
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

describe('QuietSidebar — inline tree navigation', () => {
    before(async () => {
        await addFixtureProject();
        await browser.setWindowSize(1200, 800);
    });

    beforeEach(async () => {
        await ensureCleanState();
        await showSidebar();
        await ensureCollapsed();
    });

    it('renders the workspace project as a treeitem row', async () => {
        const row = await projectRow();
        await row.waitForExist({ timeout: 10_000 });
        expect(await row.getText()).toContain(PROJECT_BASENAME);
        // Collapsed projects expose no child rows.
        expect(await childRowCount()).toBe(0);
    });

    it('clicking a project row expands it one level in place', async () => {
        const row = await projectRow();
        await row.click();

        await browser.waitUntil(async () => await isExpanded(), {
            timeout: 5_000, interval: 100, timeoutMsg: 'Project row did not expand on click',
        });
        await browser.waitUntil(async () => (await childRowCount()) > 0, {
            timeout: 5_000, interval: 100, timeoutMsg: 'No child rows appeared after expand',
        });
    });

    it('clicking a child file row opens that file in the editor', async () => {
        const row = await projectRow();
        await row.click();
        await browser.waitUntil(async () => (await childRowCount()) > 0, {
            timeout: 5_000, interval: 100, timeoutMsg: 'No child rows appeared after expand',
        });

        // Click a child FILE row (notes.md). Folders sort first, so match by name.
        const children = await browser.$$(`[data-row-type="child"]`);
        let clicked = false;
        for (const c of children) {
            if ((await c.getText()).includes('notes.md')) {
                await c.click();
                clicked = true;
                break;
            }
        }
        expect(clicked).toBe(true);

        await browser.waitUntil(
            async () => (await activeFilePath()) === path.join(TEST_PROJECT_PATH, 'notes.md'),
            { timeout: 15_000, interval: 100, timeoutMsg: 'Child file click did not open the document' },
        );
    });

    it('clicking an expanded project row collapses it', async () => {
        const row = await projectRow();
        await row.click();
        await browser.waitUntil(async () => await isExpanded(), {
            timeout: 5_000, interval: 100, timeoutMsg: 'Project did not expand',
        });

        await row.click();
        await browser.waitUntil(async () => !(await isExpanded()), {
            timeout: 5_000, interval: 100, timeoutMsg: 'Project did not collapse on second click',
        });
        await browser.waitUntil(async () => (await childRowCount()) === 0, {
            timeout: 5_000, interval: 100, timeoutMsg: 'Child rows remained after collapse',
        });
    });
});
