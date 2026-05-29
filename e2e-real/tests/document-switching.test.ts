/**
 * Document-switching E2E tests (issue #276).
 *
 * Replaces the deleted Classic-Layout `tabs.test.ts`. Covers the two
 * behaviours from that spec that remain meaningful in Quiet Composer:
 *
 *   1. Dirty indicator — editing the active document surfaces the dirty dot
 *      on the `TitleBar` (`span[aria-label="Unsaved changes"]`).
 *   2. Per-document editor-state preserved across a switch-away-and-return —
 *      exercises the `cachedEditorStatesRef` map in `Editor.tsx`, which is
 *      keyed by file path so a document's in-memory edits survive eviction
 *      when another document is opened (Quiet Composer is a single-document
 *      shell: opening a new document evicts the prior one).
 *
 * Surface matrix (verified against current Quiet Composer, May 2026):
 *   - MRU cycle (⌃Tab / ⌃⇧Tab) — global shortcut, walks editor-store.recentFiles
 *   - Sidebar Recent section — click a `[aria-label="Recent"] [role="button"]` row
 *   - Sidebar Pinned section — click a `[aria-label="Pinned"] [role="button"]` row
 *
 * Deliberately NOT in the matrix:
 *   - TreeOverlay (⌘⇧E) — deleted in sidebar-simplification (regression-locked
 *     by no-tree-overlay.test.ts); ⌘⇧E now opens Export. There is no overlay
 *     switching surface to drive.
 *   - FloatingCommandBar `:file` mode — switching via the command bar requires
 *     typing a query into the bar's textarea, which WKWebView's WebDriver does
 *     not reliably deliver to React inputs (same limitation that skips the
 *     find-bar / slash-menu input tests in editor.test.ts). The command bar's
 *     own behaviours are covered by the dedicated spec in issue #280.
 *
 * Why the dirty-indicator test is NOT parameterized across surfaces: in a
 * single-document shell there is only ever one open document, and switching
 * away auto-saves it (debounced) — so "dirty on a non-active doc" has no
 * meaning. The dirty indicator is a property of the active document and is
 * verified once. The switch-surface matrix applies to the state-preservation
 * test, which is inherently about leaving and returning.
 *
 * Run manually:
 *   Terminal 1: pnpm tauri:test
 *   Terminal 2: tauri-webdriver
 *   Terminal 3: pnpm test:e2e-real
 */
import * as path from 'path';

import { openFile, typeInEditor, pressShortcut, getEditorText, tauriInvoke } from '../helpers/actions';
import { ensureCleanState, ensureProjectOpen } from '../helpers/setup';

const TEST_PROJECT_PATH = path.resolve(process.cwd(), 'e2e-real/fixtures/test-project');

// Two distinct, small markdown fixtures with stable heading text used as
// "open" sentinels. `editFile` is the document we type into and assert
// preservation on; `otherFile` is the document we switch away to.
const editFile = { name: 'notes.md', sentinel: 'My Notes' };
const otherFile = { name: 'code-examples.md', sentinel: 'Code Examples' };

const editFilePath = path.join(TEST_PROJECT_PATH, editFile.name);

/** Marker text typed into the editor; unique per test run to avoid collisions. */
function marker(): string {
    return `DOCSWITCH_${Date.now()}`;
}

/** Reads the active editor-store tab via the exposed e2e store. */
async function activeTab(): Promise<{ filePath: string; isDirty: boolean } | null> {
    return browser.execute(() => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const w = window as any;
        const s = w.__E2E_EDITOR_STORE__?.getState();
        if (!s) return null;
        const t = s.openDocuments.find((d: { id: string }) => d.id === s.activeTabId);
        return t ? { filePath: t.filePath, isDirty: t.isDirty } : null;
    });
}

/** Polls until the active document's path matches `filePath`. */
async function waitForActiveFile(filePath: string, msg: string): Promise<void> {
    await browser.waitUntil(
        async () => (await activeTab())?.filePath === filePath,
        { timeout: 15_000, interval: 100, timeoutMsg: msg },
    );
}

/** Makes the sidebar visible (ensureCleanState hides it for editor width). */
async function showSidebar(): Promise<void> {
    await browser.execute(() => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const w = window as any;
        const s = w.__E2E_SETTINGS_STORE__?.getState();
        if (!s) return;
        if (!s.sidebarPinned) s.setSidebarPinned(true);
        if (!s.sidebarOpen) s.setSidebarOpen(true);
    });
}

/**
 * Clicks the row whose visible filename equals `name` inside the sidebar
 * section with the given aria-label ("Recent" or "Pinned").
 */
async function clickSidebarRow(section: 'Recent' | 'Pinned', name: string): Promise<void> {
    const rows = await browser.$$(`[aria-label="${section}"] [role="button"]`);
    for (const row of rows) {
        const text = await row.getText();
        if (text.includes(name)) {
            await row.click();
            return;
        }
    }
    throw new Error(`No "${section}" sidebar row found for "${name}"`);
}

describe('Document switching (Quiet Composer)', () => {
    let originalEditContent = '';

    before(async () => {
        console.log(`[doc-switch] Test project path: ${TEST_PROJECT_PATH}`);
        await ensureProjectOpen(TEST_PROJECT_PATH);
        // Snapshot the file we edit so each test can restore it — typing may
        // auto-save to disk when a switch crosses the debounce window.
        originalEditContent = await tauriInvoke<string>('read_file', { path: editFilePath });
    });

    beforeEach(async () => {
        await ensureCleanState();
    });

    afterEach(async () => {
        // Always restore the edited fixture so a typed marker never leaks into
        // the next test (or the committed fixture).
        await tauriInvoke('write_file', { path: editFilePath, content: originalEditContent });
    });

    // ── Behaviour 1: dirty indicator ────────────────────────────────────────
    it('shows the TitleBar dirty dot after editing the active document', async () => {
        await openFile(editFile.name, TEST_PROJECT_PATH);

        // Clean baseline: openFile() marks the tab clean, so no dirty dot yet.
        const dotBefore = await browser.$('span[aria-label="Unsaved changes"]');
        expect(await dotBefore.isExisting()).toBe(false);
        expect((await activeTab())?.isDirty).toBe(false);

        const text = marker();
        await typeInEditor(text);

        // Guard: confirm the edit actually landed in ProseMirror before
        // asserting on dirty state (typeInEditor can no-op if focus misses).
        await browser.waitUntil(
            async () => (await getEditorText()).includes(text),
            { timeout: 5_000, interval: 100, timeoutMsg: `Editor never showed "${text}" after typing` },
        );

        // The dirty dot is driven by activeTab.isDirty — assert both the store
        // flag and the rendered TitleBar affordance.
        await browser.waitUntil(
            async () => (await activeTab())?.isDirty === true,
            { timeout: 5_000, interval: 100, timeoutMsg: 'Active tab never became dirty after typing' },
        );
        const dotAfter = await browser.$('span[aria-label="Unsaved changes"]');
        await dotAfter.waitForExist({
            timeout: 5_000,
            timeoutMsg: 'TitleBar dirty dot did not appear after editing',
        });
    });

    // ── Behaviour 2: per-document state preserved across switch + return ─────
    //
    // The cachedEditorStatesRef map (keyed by file path) restores a document's
    // in-memory EditorState — including unsaved edits — when it is reopened
    // after being evicted by opening another document. We type a marker, leave,
    // return, and assert the marker is still present.
    //
    // (The undo-stack assertion from the old tabs.test.ts is intentionally not
    // reproduced: WKWebView's WebDriver does not reliably dispatch ⌘Z to
    // ProseMirror, and the Tiptap editor instance is not exposed for
    // programmatic undo. Verifying that edited content survives the round-trip
    // exercises the same cachedEditorStatesRef path the undo test targeted.)

    /**
     * Shared body: open `editFile`, type a marker, switch away to `otherFile`
     * and back to `editFile` via `switchAway`/`switchBack`, then assert the
     * marker survived the round-trip.
     */
    async function assertStatePreserved(
        switchAway: () => Promise<void>,
        switchBack: () => Promise<void>,
    ): Promise<void> {
        await openFile(editFile.name, TEST_PROJECT_PATH);
        const text = marker();
        await typeInEditor(text);
        await browser.waitUntil(
            async () => (await getEditorText()).includes(text),
            { timeout: 5_000, interval: 100, timeoutMsg: `Editor never showed "${text}" after typing` },
        );

        await switchAway();
        await waitForActiveFile(
            path.join(TEST_PROJECT_PATH, otherFile.name),
            `Did not switch away to ${otherFile.name}`,
        );
        // Confirm the editor actually shows the other document's content.
        await browser.waitUntil(
            async () => (await getEditorText()).includes(otherFile.sentinel),
            { timeout: 15_000, interval: 100, timeoutMsg: `Editor never showed ${otherFile.name} content` },
        );

        await switchBack();
        await waitForActiveFile(editFilePath, `Did not switch back to ${editFile.name}`);

        // The marker must be restored from the per-document cache.
        await browser.waitUntil(
            async () => (await getEditorText()).includes(text),
            {
                timeout: 15_000,
                interval: 100,
                timeoutMsg: `Marker "${text}" was not restored on return to ${editFile.name} — cachedEditorStatesRef did not preserve in-memory edits`,
            },
        );
    }

    it('preserves edits across an MRU cycle round-trip (⌃Tab)', async () => {
        // Seed recentFiles with exactly two entries so a two-press ⌃Tab cycle
        // deterministically returns to the starting document regardless of
        // cycle direction. Open `otherFile` first, then `editFile` (active).
        await openFile(otherFile.name, TEST_PROJECT_PATH);
        await assertStatePreserved(
            async () => {
                await pressShortcut(['Control', 'Tab']);
            },
            async () => {
                await pressShortcut(['Control', 'Tab']);
            },
        );
    });

    it('preserves edits across a Recent-section round-trip (sidebar click)', async () => {
        // Both documents must appear in Recent — open both, then start on edit.
        await openFile(otherFile.name, TEST_PROJECT_PATH);
        await showSidebar();
        await assertStatePreserved(
            async () => clickSidebarRow('Recent', otherFile.name),
            async () => clickSidebarRow('Recent', editFile.name),
        );
    });

    it('preserves edits across a Pinned-section round-trip (sidebar click)', async () => {
        // Pin both documents via the workspace store so both render in Pinned.
        await browser.execute(
            (a: string, b: string) => {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const w = window as any;
                const s = w.__E2E_WORKSPACE_STORE__?.getState();
                if (!s) return;
                s.pinFile(a);
                s.pinFile(b);
            },
            editFilePath,
            path.join(TEST_PROJECT_PATH, otherFile.name),
        );
        await showSidebar();
        await assertStatePreserved(
            async () => clickSidebarRow('Pinned', otherFile.name),
            async () => clickSidebarRow('Pinned', editFile.name),
        );
    });

    after(async () => {
        // Unpin everything we added so pinned state doesn't leak to other specs.
        await browser.execute(() => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const w = window as any;
            const s = w.__E2E_WORKSPACE_STORE__?.getState();
            if (!s) return;
            for (const p of [...(s.pinnedFiles ?? [])]) s.unpinFile(p);
        });
    });
});
