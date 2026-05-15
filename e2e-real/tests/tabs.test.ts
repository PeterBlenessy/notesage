/**
 * Tab management E2E tests.
 *
 * Validates multi-tab editing, tab switching performance, dirty indicators,
 * tab closing, and per-tab undo/redo history preservation.
 *
 * Run manually:
 *   Terminal 1: pnpm tauri:test
 *   Terminal 2: tauri-webdriver
 *   Terminal 3: pnpm test:e2e-real
 */

import * as path from 'path';
import { waitForElement, openProject, openFile, typeInEditor, pressShortcut, getEditorText } from '../helpers/actions';
import { ensureCleanState, ensureProjectOpen } from '../helpers/setup';
import { measureAction } from '../helpers/timing';

const PROJECT_PATH = path.resolve(process.cwd(), 'e2e-real/fixtures/test-project');

/**
 * Returns all tab button elements from the tab bar.
 * Tabs are rendered as <button> elements inside a .tabbar-scrollbar container,
 * each with a <span class="truncate"> child showing the file name.
 */
async function getTabButtons(): Promise<WebdriverIO.Element[]> {
    // The tab bar container has the class tabbar-scrollbar.
    // Each tab is a <button> inside it.
    const container = await browser.$('.tabbar-scrollbar');
    const exists = await container.isExisting();
    if (!exists) return [];
    return container.$$('button');
}

/**
 * Returns the file name text from a tab button element.
 */
async function getTabName(tab: WebdriverIO.Element): Promise<string> {
    const nameSpan = await tab.$('span.truncate');
    return nameSpan.getText();
}

/**
 * Returns the currently active tab button (the one with bg-muted in its class).
 */
async function getActiveTab(): Promise<WebdriverIO.Element | null> {
    const tabs = await getTabButtons();
    for (const tab of tabs) {
        const cls = await tab.getAttribute('class') ?? '';
        // Active tabs have bg-muted but not bg-accent (inactive tabs have bg-accent)
        if (cls.includes('bg-muted') && !cls.includes('bg-accent')) {
            return tab;
        }
    }
    return null;
}

describe('Tab Management', () => {
    before(async () => {
        // Ensure the app is loaded
        const root = await browser.$('#root');
        await root.waitForExist({ timeout: 5000, timeoutMsg: 'App root not found within 5s' });

        // Open the test project
        await ensureProjectOpen(PROJECT_PATH);
    });

    // ---------------------------------------------------------------
    // Test 1: Open multiple files and verify tabs
    // ---------------------------------------------------------------
    describe('opening multiple files', () => {
        before(async () => {
            await ensureCleanState();
            await browser.pause(300);
        });

        it('should render a tab for each opened file', async () => {
            const filesToOpen = ['README.md', 'notes.md', 'code-examples.md', 'empty.md'];

            for (const fileName of filesToOpen) {
                await openFile(fileName);
                await browser.pause(200); // Allow tab to render
            }

            const tabs = await getTabButtons();
            console.log(`[tabs] Tab count after opening 4 files: ${tabs.length}`);
            expect(tabs.length).toBe(4);

            // Verify each tab has the correct file name
            const tabNames: string[] = [];
            for (const tab of tabs) {
                const name = await getTabName(tab);
                tabNames.push(name);
            }
            console.log(`[tabs] Tab names: ${tabNames.join(', ')}`);

            for (const fileName of filesToOpen) {
                expect(tabNames).toContain(fileName);
            }
        });
    });

    // ---------------------------------------------------------------
    // Test 2: Switch between tabs and verify content
    // ---------------------------------------------------------------
    describe('tab switching', () => {
        before(async () => {
            await ensureCleanState();
            await browser.pause(300);

            // Open multiple files for tab switching tests
            await openFile('README.md');
            await browser.pause(200);
            await openFile('notes.md');
            await browser.pause(200);
            await openFile('code-examples.md');
            await browser.pause(200);
        });

        it('should switch tab content within 300ms and show correct text', async () => {
            const tabs = await getTabButtons();
            expect(tabs.length).toBeGreaterThanOrEqual(3);

            // Expected content snippets for each file
            const expectedContent: Record<string, string> = {
                'README.md': 'Test Project',
                'notes.md': 'Shopping List',
                'code-examples.md': 'Code Examples',
            };

            for (const tab of tabs) {
                const tabName = await getTabName(tab);
                const expected = expectedContent[tabName];
                if (!expected) continue;

                const { duration } = await measureAction(async () => {
                    await tab.click();
                    // Wait for editor content to update
                    await browser.waitUntil(
                        async () => {
                            const text = await getEditorText();
                            return text.includes(expected);
                        },
                        {
                            timeout: 2000,
                            interval: 50,
                            timeoutMsg: `Editor did not show "${expected}" after clicking tab "${tabName}"`,
                        },
                    );
                });

                console.log(`[tabs] Switched to "${tabName}" in ${duration.toFixed(0)}ms`);
                expect(duration).toBeLessThan(300);

                // Verify the content matches the expected file
                const editorText = await getEditorText();
                expect(editorText).toContain(expected);
            }
        });
    });

    // ---------------------------------------------------------------
    // Test 3: Dirty indicator
    // ---------------------------------------------------------------
    describe('dirty indicator', () => {
        beforeEach(async () => {
            await ensureCleanState();
            await browser.pause(300);
        });

        it('should show dirty state after typing and clear it after saving', async () => {
            await openFile('empty.md');

            // Save twice to establish clean baseline (first save may have roundtrip diff)
            await pressShortcut(['Meta', 's']);
            await browser.pause(500);
            await pressShortcut(['Meta', 's']);
            await browser.pause(500);

            // Check dirty state via store (more reliable than DOM dot)
            const isDirtyBefore = await browser.execute(() => {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const w = window as any;
                const state = w.__E2E_EDITOR_STORE__?.getState();
                const tab = state?.openDocuments?.find((t: { id: string }) => t.id === state.activeTabId);
                return tab?.isDirty ?? false;
            });
            console.log(`[tabs] Dirty before typing: ${isDirtyBefore}`);
            expect(isDirtyBefore).toBe(false);

            // Type text to make dirty
            await typeInEditor('Test dirty indicator');
            await browser.pause(300);

            // Verify dirty state
            const isDirtyAfterType = await browser.execute(() => {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const w = window as any;
                const state = w.__E2E_EDITOR_STORE__?.getState();
                const tab = state?.openDocuments?.find((t: { id: string }) => t.id === state.activeTabId);
                return tab?.isDirty ?? false;
            });
            console.log(`[tabs] Dirty after typing: ${isDirtyAfterType}`);
            expect(isDirtyAfterType).toBe(true);

            // Save with Cmd+S
            await pressShortcut(['Meta', 's']);

            // Verify dirty clears after save
            await browser.waitUntil(
                async () => {
                    return browser.execute(() => {
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        const w = window as any;
                        const state = w.__E2E_EDITOR_STORE__?.getState();
                        const tab = state?.openDocuments?.find((t: { id: string }) => t.id === state.activeTabId);
                        return tab?.isDirty === false;
                    });
                },
                {
                    timeout: 3000,
                    interval: 100,
                    timeoutMsg: 'Dirty dot did not disappear after saving',
                },
            );
            console.log('[tabs] Dirty dot disappeared after save');

            // Restore the original file content by undoing changes and saving
            await pressShortcut(['Meta', 'a']); // Select all
            await browser.pause(100);
            // Multiple undos to restore original content
            for (let i = 0; i < 30; i++) {
                await pressShortcut(['Meta', 'z']);
            }
            await browser.pause(200);
            await pressShortcut(['Meta', 's']);
            await browser.pause(300);
        });
    });

    // ---------------------------------------------------------------
    // Test 4: Close tab
    // ---------------------------------------------------------------
    describe('closing tabs', () => {
        before(async () => {
            await ensureCleanState();
            await browser.pause(300);

            // Open multiple files
            await openFile('README.md');
            await browser.pause(200);
            await openFile('notes.md');
            await browser.pause(200);
            await openFile('code-examples.md');
            await browser.pause(200);
        });

        it('should close a tab and decrease tab count', async () => {
            const tabsBefore = await getTabButtons();
            const countBefore = tabsBefore.length;
            console.log(`[tabs] Tab count before close: ${countBefore}`);
            expect(countBefore).toBe(3);

            // Find the "notes.md" tab to close
            let targetTab: WebdriverIO.Element | null = null;
            for (const tab of tabsBefore) {
                const name = await getTabName(tab);
                if (name === 'notes.md') {
                    targetTab = tab;
                    break;
                }
            }
            expect(targetTab).not.toBeNull();

            // Hover over the tab to reveal the close button
            await targetTab!.moveTo();
            await browser.pause(200);

            // Click the close button (span with aria-label="Close tab")
            const closeBtn = await targetTab!.$('[aria-label="Close tab"]');
            await closeBtn.waitForExist({ timeout: 2000, timeoutMsg: 'Close button not found on tab' });
            await closeBtn.click();

            // Wait for tab count to decrease
            await browser.waitUntil(
                async () => {
                    const tabs = await getTabButtons();
                    return tabs.length === countBefore - 1;
                },
                {
                    timeout: 2000,
                    interval: 100,
                    timeoutMsg: 'Tab count did not decrease after closing',
                },
            );

            const tabsAfter = await getTabButtons();
            console.log(`[tabs] Tab count after close: ${tabsAfter.length}`);
            expect(tabsAfter.length).toBe(countBefore - 1);

            // Verify "notes.md" is no longer in the tab bar
            const remainingNames: string[] = [];
            for (const tab of tabsAfter) {
                remainingNames.push(await getTabName(tab));
            }
            console.log(`[tabs] Remaining tabs: ${remainingNames.join(', ')}`);
            expect(remainingNames).not.toContain('notes.md');
            expect(remainingNames).toContain('README.md');
            expect(remainingNames).toContain('code-examples.md');
        });
    });

    // ---------------------------------------------------------------
    // Test 5: Undo/redo preserved across tab switches
    // ---------------------------------------------------------------
    describe('per-tab undo history', () => {
        before(async () => {
            await ensureCleanState();
            await browser.pause(300);

            // Open two files
            await openFile('README.md');
            await browser.pause(200);
            await openFile('empty.md');
            await browser.pause(200);
        });

        it('should preserve undo history when switching tabs', async () => {
            // We are on the "empty.md" tab (the last opened file).
            // Read active tab from the store directly — the DOM-class heuristic
            // in getActiveTab() is fragile across renders. The store is the
            // single source of truth.
            const activeTabName: string = await browser.execute(() => {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const w = window as any;
                if (!w.__E2E_EDITOR_STORE__) return '';
                const state = w.__E2E_EDITOR_STORE__.getState();
                const activeTab = state?.openDocuments?.find((t: { id: string }) => t.id === state.activeTabId);
                if (!activeTab) return '';
                // openDocuments items have a filePath; the tab "name" is the file's basename.
                const path = activeTab.filePath ?? '';
                return path.split('/').pop() ?? '';
            });
            console.log(`[tabs] Active tab: ${activeTabName}`);
            expect(activeTabName).toBe('empty.md');

            // Get the original editor text
            const originalText = await getEditorText();
            console.log(`[tabs] Original text in empty.md: "${originalText.substring(0, 50)}"`);

            // Type some text
            const testText = 'UNDO_TEST_TEXT';
            await typeInEditor(testText);
            await browser.pause(200);

            // Verify text was typed
            const afterType = await getEditorText();
            expect(afterType).toContain(testText);
            console.log('[tabs] Text typed into empty.md');

            // Switch to README.md tab
            const tabs = await getTabButtons();
            let readmeTab: WebdriverIO.Element | null = null;
            for (const tab of tabs) {
                const name = await getTabName(tab);
                if (name === 'README.md') {
                    readmeTab = tab;
                    break;
                }
            }
            expect(readmeTab).not.toBeNull();
            await readmeTab!.click();
            await browser.pause(300);

            // Verify we are now on README.md
            const readmeText = await getEditorText();
            expect(readmeText).toContain('Test Project');
            console.log('[tabs] Switched to README.md');

            // Switch back to empty.md
            const tabsAgain = await getTabButtons();
            let emptyTab: WebdriverIO.Element | null = null;
            for (const tab of tabsAgain) {
                const name = await getTabName(tab);
                if (name === 'empty.md') {
                    emptyTab = tab;
                    break;
                }
            }
            expect(emptyTab).not.toBeNull();
            await emptyTab!.click();
            await browser.pause(300);

            // Verify our typed text is still there
            const backText = await getEditorText();
            expect(backText).toContain(testText);
            console.log('[tabs] Returned to empty.md — text preserved');

            // Press Cmd+Z to undo the typed text
            // Click editor first to ensure focus
            const editor = await waitForElement('.ProseMirror');
            await editor.click();
            await browser.pause(100);

            // Undo multiple times to remove the typed text
            for (let i = 0; i < testText.length + 5; i++) {
                await pressShortcut(['Meta', 'z']);
            }
            await browser.pause(300);

            // Verify the typed text is removed
            const afterUndo = await getEditorText();
            console.log(`[tabs] Text after undo: "${afterUndo.substring(0, 50)}"`);
            expect(afterUndo).not.toContain(testText);
            console.log('[tabs] Undo successfully removed typed text after tab switch');

            // Save to restore file to original state
            await pressShortcut(['Meta', 's']);
            await browser.pause(300);
        });
    });
});
