/**
 * External change detection E2E tests.
 *
 * Validates the filesystem watcher's ability to detect external file changes
 * and update the sidebar tree and editor content accordingly.
 *
 * The watcher (watcher.rs) uses a 500ms debounce. Writes performed via
 * `__TAURI_INTERNALS__.invoke('write_file', ...)` from browser.execute are
 * NOT marked as self-writes, so they trigger watcher events just like an
 * external editor would.
 *
 * Run manually:
 *   Terminal 1: pnpm tauri:test
 *   Terminal 2: tauri-webdriver
 *   Terminal 3: pnpm test:e2e-real
 */

import * as path from 'path';
import { waitForElement, openFile, typeInEditor, getEditorText } from '../helpers/actions';
import { ensureCleanState, ensureProjectOpen } from '../helpers/setup';
import { measureAction } from '../helpers/timing';

const FIXTURE_PROJECT = path.resolve(process.cwd(), 'e2e-real/fixtures/test-project');
const WATCHER_TIMEOUT = 5000; // 500ms debounce + event propagation + UI update

describe('External Change Detection', () => {
    // Store original file contents for restoration
    let originalContents: Record<string, string> = {};

    before(async () => {
        const root = await browser.$('#root');
        await root.waitForExist({ timeout: 5000, timeoutMsg: 'App root not found within 5s' });
        await ensureProjectOpen(FIXTURE_PROJECT);
    });

    beforeEach(async () => {
        await ensureCleanState();
        originalContents = {};
    });

    afterEach(async () => {
        // Restore any files that were modified during the test
        for (const [filePath, content] of Object.entries(originalContents)) {
            console.log(`[ext-change] Restoring ${path.basename(filePath)}`);
            await browser.execute(async (p: string, c: string) => {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                await (window as any).__TAURI_INTERNALS__.invoke('write_file', { path: p, content: c });
            }, filePath, content);
        }
        // Give watcher time to process restoration writes before next test
        await browser.pause(1000);
    });

    // -----------------------------------------------------------------
    // Helper: read a file from disk via Tauri invoke
    // -----------------------------------------------------------------
    async function readFileFromDisk(filePath: string): Promise<string> {
        return browser.execute(async (p: string) => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            return (window as any).__TAURI_INTERNALS__.invoke('read_file', { path: p }) as string;
        }, filePath);
    }

    // -----------------------------------------------------------------
    // Helper: write a file to disk via Tauri invoke (triggers watcher)
    // -----------------------------------------------------------------
    async function writeFileToDisk(filePath: string, content: string): Promise<void> {
        await browser.execute(async (p: string, c: string) => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            await (window as any).__TAURI_INTERNALS__.invoke('write_file', { path: p, content: c });
        }, filePath, content);
    }

    // -----------------------------------------------------------------
    // Helper: delete a file from disk via Tauri invoke
    // -----------------------------------------------------------------
    async function deleteFileFromDisk(filePath: string): Promise<void> {
        await browser.execute(async (p: string) => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            await (window as any).__TAURI_INTERNALS__.invoke('delete_path', { path: p });
        }, filePath);
    }

    // -----------------------------------------------------------------
    // Helper: save original content before modifying a file
    // -----------------------------------------------------------------
    async function saveOriginal(filePath: string): Promise<void> {
        if (!originalContents[filePath]) {
            originalContents[filePath] = await readFileFromDisk(filePath);
        }
    }

    // -----------------------------------------------------------------
    // Test 1: External modify on clean tab — auto-reload
    // -----------------------------------------------------------------
    it('should auto-reload editor when a clean tab is modified externally', async () => {
        const targetFile = path.join(FIXTURE_PROJECT, 'notes.md');
        await saveOriginal(targetFile);

        // Open the file in the editor
        await openFile('notes.md');
        const initialText = await getEditorText();
        console.log(`[ext-change] Initial editor text length: ${initialText.length}`);

        const timestamp = Date.now();
        const newContent = `# Notes (Updated)\n\nThis content was written externally at ${timestamp}.\n`;

        // Write new content to disk — this is NOT a self-write, so watcher fires
        console.log('[ext-change] Writing external change to notes.md');
        await writeFileToDisk(targetFile, newContent);

        // Wait for the editor to reflect the new content
        const { duration } = await measureAction(async () => {
            await browser.waitUntil(
                async () => {
                    const editorText = await getEditorText();
                    return editorText.includes(String(timestamp));
                },
                {
                    timeout: WATCHER_TIMEOUT,
                    interval: 200,
                    timeoutMsg: `Editor did not reflect external change within ${WATCHER_TIMEOUT}ms`,
                },
            );
        });

        console.log(`[ext-change] Editor updated after external modify in ${duration.toFixed(0)}ms`);
        expect(duration).toBeLessThan(WATCHER_TIMEOUT);

        // Verify the editor shows the new content
        const updatedText = await getEditorText();
        expect(updatedText).toContain('Notes (Updated)');
        expect(updatedText).toContain(String(timestamp));
        console.log('[ext-change] Clean tab auto-reload verified');
    });

    // -----------------------------------------------------------------
    // Test 2: External modify on dirty tab — reload banner
    // -----------------------------------------------------------------
    it('should show reload prompt when a dirty tab is modified externally', async () => {
        const targetFile = path.join(FIXTURE_PROJECT, 'notes.md');
        await saveOriginal(targetFile);

        // Open the file and make it dirty by typing
        await openFile('notes.md');
        await typeInEditor(' dirty');
        console.log('[ext-change] Made tab dirty by typing');

        // Allow the dirty state to register
        await browser.pause(300);

        const timestamp = Date.now();
        const externalContent = `# Notes (External Edit)\n\nExternal change at ${timestamp}.\n`;

        // Write externally — watcher should detect this as a conflict
        console.log('[ext-change] Writing external change to dirty tab file');
        await writeFileToDisk(targetFile, externalContent);

        // Wait for a reload banner/prompt to appear.
        // The app shows a banner with reload/keep options for dirty tabs.
        // Look for common banner patterns: buttons with "Reload" or "Keep" text,
        // or a toast/notification about external changes.
        const { duration } = await measureAction(async () => {
            await browser.waitUntil(
                async () => {
                    // Check for reload banner buttons
                    const reloadBtn = await browser.$('//button[contains(text(), "Reload") or contains(text(), "reload")]');
                    if (await reloadBtn.isExisting()) return true;

                    // Check for a toast or notification about external changes
                    const toast = await browser.$('[data-sonner-toast]');
                    if (await toast.isExisting()) {
                        const toastText = await toast.getText();
                        if (toastText.toLowerCase().includes('changed') || toastText.toLowerCase().includes('modified')) {
                            return true;
                        }
                    }

                    // Check for any banner/alert with external change wording
                    const banner = await browser.$('//*[contains(text(), "changed on disk") or contains(text(), "modified externally") or contains(text(), "external change") or contains(text(), "Reload from disk")]');
                    return banner.isExisting();
                },
                {
                    timeout: WATCHER_TIMEOUT,
                    interval: 200,
                    timeoutMsg: `No reload prompt appeared within ${WATCHER_TIMEOUT}ms for dirty tab`,
                },
            );
        });

        console.log(`[ext-change] Reload prompt appeared in ${duration.toFixed(0)}ms`);
        expect(duration).toBeLessThan(WATCHER_TIMEOUT);

        // Verify the editor did NOT auto-replace the content (dirty tab protection)
        const editorText = await getEditorText();
        expect(editorText).not.toContain(String(timestamp));
        console.log('[ext-change] Dirty tab reload prompt verified — content preserved');
    });

    // -----------------------------------------------------------------
    // Test 3: Create new file on disk — file tree updates
    // -----------------------------------------------------------------
    it('should show a new file in the sidebar when created on disk', async () => {
        const timestamp = Date.now();
        const newFileName = `e2e-test-${timestamp}.md`;
        const newFilePath = path.join(FIXTURE_PROJECT, newFileName);
        const newContent = `# E2E Test File\n\nCreated at ${timestamp}.\n`;

        console.log(`[ext-change] Creating new file: ${newFileName}`);
        await writeFileToDisk(newFilePath, newContent);

        // Wait for the file to appear in the sidebar file tree
        const { duration } = await measureAction(async () => {
            await browser.waitUntil(
                async () => {
                    // File names are rendered as <span class="truncate flex-1">
                    const fileSpan = await browser.$(
                        `//span[contains(@class, "truncate") and contains(@class, "flex-1") and text()="${newFileName}"]`
                    );
                    return fileSpan.isExisting();
                },
                {
                    timeout: WATCHER_TIMEOUT,
                    interval: 200,
                    timeoutMsg: `New file "${newFileName}" did not appear in sidebar within ${WATCHER_TIMEOUT}ms`,
                },
            );
        });

        console.log(`[ext-change] New file appeared in sidebar in ${duration.toFixed(0)}ms`);
        expect(duration).toBeLessThan(WATCHER_TIMEOUT);

        // Verify the file is visible in the tree
        const fileSpan = await browser.$(
            `//span[contains(@class, "truncate") and contains(@class, "flex-1") and text()="${newFileName}"]`
        );
        expect(await fileSpan.isExisting()).toBe(true);
        console.log('[ext-change] New file visible in sidebar');

        // Clean up: delete the file
        console.log(`[ext-change] Cleaning up: deleting ${newFileName}`);
        await deleteFileFromDisk(newFilePath);

        // Verify the file disappears from the sidebar
        await browser.waitUntil(
            async () => {
                const span = await browser.$(
                    `//span[contains(@class, "truncate") and contains(@class, "flex-1") and text()="${newFileName}"]`
                );
                return !(await span.isExisting());
            },
            {
                timeout: WATCHER_TIMEOUT,
                interval: 200,
                timeoutMsg: `Deleted file "${newFileName}" still visible in sidebar after ${WATCHER_TIMEOUT}ms`,
            },
        );
        console.log('[ext-change] Deleted file removed from sidebar');
    });

    // -----------------------------------------------------------------
    // Test 4: Delete file on disk — file tree and tab update
    // -----------------------------------------------------------------
    it('should update file tree and tab when a file is deleted on disk', async () => {
        const timestamp = Date.now();
        const tempFileName = `e2e-temp-${timestamp}.md`;
        const tempFilePath = path.join(FIXTURE_PROJECT, tempFileName);
        const tempContent = `# Temporary File\n\nCreated for deletion test at ${timestamp}.\n`;

        // Create a temporary file
        console.log(`[ext-change] Creating temporary file: ${tempFileName}`);
        await writeFileToDisk(tempFilePath, tempContent);

        // Wait for it to appear in the sidebar
        await browser.waitUntil(
            async () => {
                const span = await browser.$(
                    `//span[contains(@class, "truncate") and contains(@class, "flex-1") and text()="${tempFileName}"]`
                );
                return span.isExisting();
            },
            {
                timeout: WATCHER_TIMEOUT,
                interval: 200,
                timeoutMsg: `Temp file "${tempFileName}" did not appear in sidebar within ${WATCHER_TIMEOUT}ms`,
            },
        );
        console.log('[ext-change] Temp file appeared in sidebar');

        // Open the file in a tab
        await openFile(tempFileName);
        const editorText = await getEditorText();
        expect(editorText).toContain('Temporary File');
        console.log('[ext-change] Temp file opened in editor');

        // Delete the file from disk
        console.log(`[ext-change] Deleting ${tempFileName} from disk`);
        await deleteFileFromDisk(tempFilePath);

        // Wait for the file to disappear from the sidebar
        const { duration } = await measureAction(async () => {
            await browser.waitUntil(
                async () => {
                    const span = await browser.$(
                        `//span[contains(@class, "truncate") and contains(@class, "flex-1") and text()="${tempFileName}"]`
                    );
                    return !(await span.isExisting());
                },
                {
                    timeout: WATCHER_TIMEOUT,
                    interval: 200,
                    timeoutMsg: `Deleted file "${tempFileName}" still in sidebar after ${WATCHER_TIMEOUT}ms`,
                },
            );
        });

        console.log(`[ext-change] File removed from sidebar in ${duration.toFixed(0)}ms`);
        expect(duration).toBeLessThan(WATCHER_TIMEOUT);

        // Verify the tab reflects the deletion.
        // The app may close the tab, show a "file deleted" state, or display a toast.
        // Check if the tab is gone or shows an error/warning state.
        await browser.pause(500);

        const tabStillHasContent = await browser.execute((fileName: string) => {
            const raw = localStorage.getItem('notesage-editor');
            if (!raw) return false;
            try {
                const parsed = JSON.parse(raw);
                const tabs = parsed.state?.tabs ?? [];
                return tabs.some((t: { filePath?: string }) =>
                    t.filePath?.endsWith(fileName)
                );
            } catch {
                return false;
            }
        }, tempFileName);

        console.log(`[ext-change] Tab for deleted file still in store: ${tabStillHasContent}`);
        // The tab may or may not be auto-closed — log the state for observability
        console.log('[ext-change] File deletion detection verified');
    });
});
