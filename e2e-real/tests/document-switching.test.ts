/**
 * Document-switching E2E tests for the Quiet Composer shell.
 *
 * Covers two cross-surface behaviours:
 *
 *   1. Dirty indicator — appears when the active doc has unsaved edits;
 *      disappears on switch; does NOT return when switching back because
 *      Quiet Composer reloads the file from disk with a fresh tab UUID
 *      (the EditorState cache is keyed by UUID, so a new UUID is always
 *      a cache miss).
 *
 *   2. Per-doc undo history — undo works within a session (before any
 *      switch).  After switching away and back the undo stack is reset:
 *      Quiet Composer opens a new tab UUID on every re-activation,
 *      which produces a cache miss and reloads from disk with a fresh
 *      ProseMirror EditorState.
 *
 * Four switching surfaces are parameterised:
 *   • Pinned sidebar   (QuietSidebar PinnedSection)
 *   • Recent sidebar   (QuietSidebar RecentSection)
 *   • MRU cycle        (⌃Tab / notesage:cycle-recent CustomEvent)
 *   • FloatingCommandBar :file mode  (⌘⇧F)
 *
 * Run manually:
 *   Terminal 1: pnpm tauri:test
 *   Terminal 2: tauri-webdriver
 *   Terminal 3: pnpm test:e2e-real
 */

import * as path from 'path';
import {
    waitForElement,
    openFile,
    typeInEditor,
    pressShortcut,
    getEditorText,
    tauriInvoke,
} from '../helpers/actions';
import { ensureCleanState, ensureProjectOpen } from '../helpers/setup';

const PROJECT_PATH = path.resolve(process.cwd(), 'e2e-real/fixtures/test-project');
// FILE_A is edited during tests; FILE_B is the switch target.
const FILE_A = 'README.md';
const FILE_B = 'notes.md';
const FILE_A_PATH = `${PROJECT_PATH}/${FILE_A}`;
const FILE_B_PATH = `${PROJECT_PATH}/${FILE_B}`;

// ─── Quiet Composer lifecycle ───────────────────────────────────────────────

async function enableQuietComposer(): Promise<void> {
    await browser.execute(() => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const w = window as any;
        w.__E2E_SETTINGS_STORE__.getState().setUiPreview('quiet-composer');
        w.__E2E_SETTINGS_STORE__.getState().setSidebarPinned(true);
        // Ensure the command bar is floating, not docked (some surfaces open it)
        if (w.__E2E_SETTINGS_STORE__.getState().cmdBarPinned) {
            w.__E2E_SETTINGS_STORE__.getState().setCmdBarPinned(false);
        }
    });
    await browser.pause(300);
}

async function disableQuietComposer(): Promise<void> {
    await browser.execute(() => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const w = window as any;
        w.__E2E_SETTINGS_STORE__.getState().setUiPreview('legacy');
        w.__E2E_SETTINGS_STORE__.getState().setSidebarPinned(false);
        w.__E2E_SETTINGS_STORE__.getState().setSidebarOpen(false);
    });
    await browser.pause(200);
}

// ─── Store helpers ──────────────────────────────────────────────────────────

async function isDirtyDotVisible(): Promise<boolean> {
    // TitleBar renders <span role="status" aria-label="Unsaved changes"> when
    // uiPreview === "quiet-composer" and the active tab is dirty.
    const dot = await browser.$('span[role="status"][aria-label="Unsaved changes"]');
    return dot.isExisting();
}

async function getActiveFilePath(): Promise<string | null> {
    return browser.execute(() => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const w = window as any;
        const s = w.__E2E_EDITOR_STORE__.getState();
        const tab = s.openDocuments.find(
            (t: { id: string; filePath: string }) => t.id === s.activeTabId,
        );
        return tab?.filePath ?? null;
    });
}

/**
 * Marks the active tab as clean (lastSavedContent = current content, isDirty
 * = false) without writing to disk.  Used after an in-editor undo to prevent
 * the 1-second auto-save debounce from overwriting the on-disk fixture with
 * the undone content before we switch documents.
 */
async function markActiveTabClean(): Promise<void> {
    await browser.execute(() => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const w = window as any;
        const s = w.__E2E_EDITOR_STORE__.getState();
        const tab = s.openDocuments.find(
            (t: { id: string }) => t.id === s.activeTabId,
        );
        if (tab) s.markTabClean(tab.id, tab.content);
    });
}

// ─── Switching surface helpers ──────────────────────────────────────────────

async function switchViaSidebarSection(
    sectionLabel: string,
    filePath: string,
): Promise<void> {
    const fileName = filePath.split('/').pop()!;
    const section = await browser.$(`section[aria-label="${sectionLabel}"]`);
    await section.waitForExist({
        timeout: 5000,
        timeoutMsg: `Sidebar section "${sectionLabel}" not found within 5s`,
    });
    const rows = await section.$$('div[role="button"]');
    let clicked = false;
    for (const row of rows) {
        const text = await row.getText();
        if (text.includes(fileName)) {
            await row.click();
            clicked = true;
            break;
        }
    }
    if (!clicked) {
        throw new Error(
            `No row matching "${fileName}" found in sidebar section "${sectionLabel}"`,
        );
    }
    await browser.waitUntil(
        async () => (await getActiveFilePath()) === filePath,
        {
            timeout: 8000,
            timeoutMsg: `Active file did not switch to ${filePath} via ${sectionLabel} sidebar`,
        },
    );
    await waitForElement('.ProseMirror', 5000);
}

async function switchViaMRU(filePath: string): Promise<void> {
    // With exactly 2 files in recentFiles, direction:"next" always goes to the
    // other file regardless of which one is currently active.
    await browser.execute(() => {
        window.dispatchEvent(
            new CustomEvent('notesage:cycle-recent', {
                detail: { direction: 'next' },
            }),
        );
    });
    await browser.waitUntil(
        async () => (await getActiveFilePath()) === filePath,
        {
            timeout: 8000,
            timeoutMsg: `MRU cycle did not switch active file to ${filePath}`,
        },
    );
    await waitForElement('.ProseMirror', 5000);
}

async function switchViaCommandBar(filePath: string): Promise<void> {
    const fileName = filePath.split('/').pop()!;
    // ⌘⇧F → emits { type:"focus", prefix:":file " } → FloatingCommandBar
    // opens with the ":file " prefix pre-filled; the empty query shows an MRU
    // list built from editor-store.recentFiles.
    await pressShortcut(['Meta', 'Shift', 'f']);
    await waitForElement('[role="combobox"]', 5000);
    await browser.pause(200);
    // Wait for the file-mode listbox and the target option to appear.
    await browser.waitUntil(
        async () => {
            const listbox = await browser.$('[role="listbox"]');
            if (!(await listbox.isExisting())) return false;
            const opts = await listbox.$$('[role="option"]');
            for (const opt of opts) {
                if ((await opt.getText()).includes(fileName)) return true;
            }
            return false;
        },
        {
            timeout: 5000,
            timeoutMsg: `FileMode option for "${fileName}" did not appear`,
        },
    );
    // Click the matching option.
    const listbox = await browser.$('[role="listbox"]');
    const opts = await listbox.$$('[role="option"]');
    let clicked = false;
    for (const opt of opts) {
        if ((await opt.getText()).includes(fileName)) {
            await opt.click();
            clicked = true;
            break;
        }
    }
    if (!clicked) {
        throw new Error(`Could not click option for "${fileName}" in CommandBar FileMode`);
    }
    await browser.waitUntil(
        async () => (await getActiveFilePath()) === filePath,
        {
            timeout: 8000,
            timeoutMsg: `Active file did not switch to ${filePath} via CommandBar :file`,
        },
    );
    await waitForElement('.ProseMirror', 5000);
}

// ─── Surface definitions ────────────────────────────────────────────────────

interface Surface {
    name: string;
    /** Called after openFile() in beforeEach — e.g. pin files. */
    setup: () => Promise<void>;
    /** Navigate to the given file path via this surface. */
    switchTo: (filePath: string) => Promise<void>;
    /** Cleanup after the describe block — e.g. unpin files. */
    teardown?: () => Promise<void>;
}

const SURFACES: Surface[] = [
    {
        name: 'pinned sidebar',
        setup: async () => {
            await browser.execute(
                (pathA: string, pathB: string) => {
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    const w = window as any;
                    const s = w.__E2E_WORKSPACE_STORE__.getState();
                    s.pinFile(pathA);
                    s.pinFile(pathB);
                },
                FILE_A_PATH,
                FILE_B_PATH,
            );
            await browser.pause(200);
        },
        switchTo: (filePath) => switchViaSidebarSection('Pinned', filePath),
        teardown: async () => {
            await browser.execute(
                (pathA: string, pathB: string) => {
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    const w = window as any;
                    const s = w.__E2E_WORKSPACE_STORE__.getState();
                    s.unpinFile(pathA);
                    s.unpinFile(pathB);
                },
                FILE_A_PATH,
                FILE_B_PATH,
            );
        },
    },
    {
        name: 'recent sidebar',
        setup: async () => {
            // Both files appear in recentFiles after beforeEach opens them;
            // the Recent section renders them automatically.
            await browser.pause(200);
        },
        switchTo: (filePath) => switchViaSidebarSection('Recent', filePath),
    },
    {
        name: 'MRU cycle',
        setup: async () => {
            // recentFiles = [FILE_A_PATH, FILE_B_PATH] after beforeEach (A most
            // recent).  With exactly 2 entries, direction:"next" from index 0
            // wraps to index 1 — always the other file.
            await browser.pause(200);
        },
        switchTo: (filePath) => switchViaMRU(filePath),
    },
    {
        name: 'FloatingCommandBar :file',
        setup: async () => {
            await browser.pause(200);
        },
        switchTo: (filePath) => switchViaCommandBar(filePath),
    },
];

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('Document switching — Quiet Composer', () => {
    before(async () => {
        await ensureProjectOpen(PROJECT_PATH);
    });

    for (const surface of SURFACES) {
        describe(`via ${surface.name}`, () => {
            before(async () => {
                await enableQuietComposer();
            });

            after(async () => {
                if (surface.teardown) await surface.teardown();
                await disableQuietComposer();
            });

            beforeEach(async () => {
                await ensureCleanState();
                // ensureCleanState() hides the sidebar; restore it so the
                // sidebar-based surfaces can find their rows.
                await browser.execute(() => {
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    const w = window as any;
                    w.__E2E_SETTINGS_STORE__.getState().setSidebarPinned(true);
                });
                // Open FILE_B first, then FILE_A so that:
                //   • FILE_A is the active document
                //   • recentFiles = [FILE_A_PATH, FILE_B_PATH]
                // (Quiet Composer evicts the previous doc on each openTab call.)
                await openFile(FILE_B, PROJECT_PATH);
                await openFile(FILE_A, PROJECT_PATH);
                await surface.setup();
            });

            // ── Dirty indicator ─────────────────────────────────────────────

            it('should show dirty indicator while editing and clear it after switching back (disk reload)', async () => {
                // FILE_A is active and clean after beforeEach.
                expect(await isDirtyDotVisible()).toBe(false);

                // Edit FILE_A → dirty dot appears.
                await typeInEditor('DIRTY_INDICATOR_TEST');
                await browser.pause(300);
                expect(await isDirtyDotVisible()).toBe(true);

                // Switch to FILE_B → no dot (FILE_B is active and clean).
                await surface.switchTo(FILE_B_PATH);
                await browser.pause(300);
                expect(await isDirtyDotVisible()).toBe(false);

                // Switch back to FILE_A.  Quiet Composer creates a new tab UUID
                // on re-opening → cache miss → loads from disk → isDirty = false.
                // The typed text was never saved, so the reload shows the original
                // content and the dirty dot does not reappear.
                await surface.switchTo(FILE_A_PATH);
                await browser.pause(300);
                expect(await isDirtyDotVisible()).toBe(false);
            });

            // ── Undo history ────────────────────────────────────────────────

            it('should reset undo history when switching back (Quiet Composer reloads from disk into a fresh UUID)', async () => {
                const MARKER = 'UNDO_HISTORY_TEST_MARKER';
                // Capture the file's original content for cleanup in finally.
                const originalContent = await tauriInvoke<string>('read_file', {
                    path: FILE_A_PATH,
                });

                try {
                    // ── Part 1: in-session undo works ────────────────────────

                    // Type MARKER and save so the on-disk content contains it.
                    await typeInEditor(MARKER);
                    await browser.pause(200);
                    await pressShortcut(['Meta', 's']);
                    await browser.pause(500); // wait for Tauri write to complete
                    expect(await getEditorText()).toContain(MARKER);

                    // Undo — MARKER is removed from the editor view.
                    // `document.execCommand('insertText')` inserts the whole string
                    // as one ProseMirror transaction, so one Cmd+Z suffices.
                    const editor = await waitForElement('.ProseMirror');
                    await editor.click();
                    await pressShortcut(['Meta', 'z']);
                    await browser.pause(300);
                    // In-session undo removed MARKER.
                    expect(await getEditorText()).not.toContain(MARKER);

                    // After undo the tab is dirty (content ≠ lastSavedContent).
                    // Mark it clean so the 1-second auto-save debounce does not
                    // overwrite the on-disk MARKER with the undone (pre-MARKER)
                    // content before we switch documents.
                    await markActiveTabClean();

                    // ── Part 2: undo history lost after switching back ────────

                    // Switch to FILE_B.
                    await surface.switchTo(FILE_B_PATH);
                    await browser.pause(300);

                    // Switch back to FILE_A.  Quiet Composer creates a new tab UUID
                    // → EditorState cache miss → reloads from disk.  Disk still
                    // holds MARKER (saved in Part 1; the undo was never persisted).
                    await surface.switchTo(FILE_A_PATH);
                    await browser.pause(300);
                    expect(await getEditorText()).toContain(MARKER);

                    // Undo after a disk reload has no effect — the fresh EditorState
                    // has an empty undo stack.
                    const editor2 = await waitForElement('.ProseMirror');
                    await editor2.click();
                    await pressShortcut(['Meta', 'z']);
                    await browser.pause(300);
                    // MARKER is still present: nothing was on the undo stack.
                    expect(await getEditorText()).toContain(MARKER);
                } finally {
                    // Restore FILE_A to its original on-disk content so subsequent
                    // test cases start from a known state.
                    await tauriInvoke('write_file', {
                        path: FILE_A_PATH,
                        content: originalContent,
                    });
                }
            });
        });
    }
});
