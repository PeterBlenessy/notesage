/**
 * Reusable action helpers for E2E tests.
 *
 * These helpers interact with the real running Notesage app through WebDriverIO.
 * They use Tauri's internal invoke API and Zustand store access via `browser.execute`
 * to bypass native dialogs that can't be automated through WebDriver.
 */

import { measureAction, type TimedResult } from './timing';

const DEFAULT_TIMEOUT = 5000;

/**
 * WebDriver Unicode key constants for modifier and special keys.
 * See: https://www.w3.org/TR/webdriver/#keyboard-actions
 */
/**
 * Invokes a Tauri command from the browser context, properly awaiting the async result.
 * Must use executeAsync because browser.execute doesn't handle Promises from Tauri invoke.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function tauriInvoke<T = unknown>(command: string, args: Record<string, unknown> = {}): Promise<T> {
    const result = await browser.executeAsync(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (cmd: string, cmdArgs: Record<string, unknown>, done: (r: any) => void) => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (window as any).__TAURI_INTERNALS__
                .invoke(cmd, cmdArgs)
                .then((res: unknown) => done({ ok: true, value: res }))
                .catch((err: Error) => done({ ok: false, error: String(err) }));
        },
        command,
        args,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ) as any;

    if (!result.ok) {
        throw new Error(`tauriInvoke(${command}) failed: ${result.error}`);
    }
    return result.value as T;
}

const WD_KEYS: Record<string, string> = {
    Meta: '\uE03D',
    Shift: '\uE008',
    Control: '\uE009',
    Alt: '\uE00A',
    Enter: '\uE007',
    Escape: '\uE00C',
    Tab: '\uE004',
    Backspace: '\uE003',
    ArrowUp: '\uE013',
    ArrowDown: '\uE015',
    ArrowLeft: '\uE012',
    ArrowRight: '\uE014',
};

/**
 * Waits for an element matching the given CSS selector to exist in the DOM.
 *
 * @param selector - CSS selector string
 * @param timeout - Maximum wait time in ms (default 5000)
 * @returns The matched WebdriverIO element
 */
export async function waitForElement(selector: string, timeout: number = DEFAULT_TIMEOUT): Promise<WebdriverIO.Element> {
    const el = await browser.$(selector);
    await el.waitForExist({ timeout, timeoutMsg: `Element "${selector}" not found within ${timeout}ms` });
    return el;
}

/**
 * Opens a project folder in the sidebar by invoking Tauri commands and
 * updating the workspace store directly (bypasses native folder dialog).
 *
 * Waits for file tree items to appear in the sidebar after opening.
 *
 * @param projectPath - Absolute path to the project folder
 */
export async function openProject(projectPath: string): Promise<void> {
    // Step 1: List directory via Tauri invoke (async — must use executeAsync)
    const tree = await browser.executeAsync(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (path: string, done: (result: any) => void) => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (window as any).__TAURI_INTERNALS__
                .invoke('list_directory', { path })
                .then((result: unknown) => done(result))
                .catch((err: Error) => {
                    console.error('[e2e] list_directory failed:', err);
                    done(null);
                });
        },
        projectPath,
    );

    if (!tree) {
        throw new Error(`Failed to list directory: ${projectPath}`);
    }

    // Step 2: Push result into workspace store and expand the folder (sync)
    await browser.execute(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (path: string, fileTree: any) => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const w = window as any;
            if (w.__E2E_WORKSPACE_STORE__) {
                const store = w.__E2E_WORKSPACE_STORE__.getState();
                store.addExplorerFolder(path, fileTree);
                // Expand the folder so its contents are visible in the sidebar
                if (!store.isExpanded(path)) {
                    store.toggleFolder(path);
                }
                // Also ensure the Folders section itself is not collapsed
                store.setExplorerCollapsed(false);
            } else {
                throw new Error('__E2E_WORKSPACE_STORE__ not found — app must be running in dev mode');
            }
        },
        projectPath,
        tree,
    );

    // Wait for the folder's children to render in the sidebar.
    // We need more than just the folder header — we need to see the actual files.
    // The folder itself counts as 1 item, so we wait for > 1 items.
    await browser.waitUntil(
        async () => {
            const items = await browser.$$('.truncate.flex-1');
            return items.length > 1;
        },
        {
            timeout: DEFAULT_TIMEOUT,
            timeoutMsg: `No file tree items appeared within ${DEFAULT_TIMEOUT}ms after opening project`,
        },
    );
}

/**
 * Opens a file by name from the current test project.
 * Uses Tauri invoke to read the file and the editor store to open a tab.
 * This is more reliable than clicking the sidebar DOM.
 *
 * @param fileName - The file name (e.g., "README.md") or relative path (e.g., "nested/deep-note.md")
 * @param projectPath - Optional project path override. If not provided, uses the last opened project.
 */
export async function openFile(fileName: string, projectPath?: string): Promise<void> {
    // Read file content via Tauri invoke and open it in the editor store
    await browser.executeAsync(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (name: string, basePath: string | undefined, done: (result: any) => void) => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const w = window as any;

            // Determine the file path
            let filePath: string;
            if (basePath) {
                filePath = `${basePath}/${name}`;
            } else {
                // Use the first explorer folder as the base
                const folders = w.__E2E_WORKSPACE_STORE__?.getState().explorerFolders ?? [];
                if (folders.length === 0) {
                    done({ error: 'No explorer folders open' });
                    return;
                }
                filePath = `${folders[folders.length - 1].path}/${name}`;
            }

            w.__TAURI_INTERNALS__
                .invoke('read_file', { path: filePath })
                .then((content: string) => {
                    // Open the file in the editor store
                    if (w.__E2E_EDITOR_STORE__) {
                        const bareFileName = name.includes('/') ? name.split('/').pop()! : name;
                        w.__E2E_EDITOR_STORE__.getState().openTab(filePath, bareFileName, content);
                    }
                    done({ ok: true });
                })
                .catch((err: Error) => {
                    done({ error: `Failed to read ${filePath}: ${err}` });
                });
        },
        fileName,
        projectPath,
    );

    // Wait for the ProseMirror editor to appear
    await browser.waitUntil(
        async () => {
            const editor = await browser.$('.ProseMirror');
            return editor.isExisting();
        },
        {
            timeout: DEFAULT_TIMEOUT,
            timeoutMsg: `Editor did not appear within ${DEFAULT_TIMEOUT}ms after opening "${fileName}"`,
        },
    );

    // Mark the tab clean so dirty tracking starts from a known baseline.
    // Without this, the editor's setContent() triggers an onUpdate that
    // may mark the tab dirty before the user has typed anything.
    await browser.pause(200);
    await browser.execute(() => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const w = window as any;
        if (w.__E2E_EDITOR_STORE__) {
            const state = w.__E2E_EDITOR_STORE__.getState();
            const activeTab = state.tabs.find((t: { id: string }) => t.id === state.activeTabId);
            if (activeTab) {
                state.markTabClean(activeTab.id, activeTab.content);
            }
        }
    });
}

/**
 * Focuses the ProseMirror editor and types text character by character.
 * Returns the duration of the typing action.
 *
 * @param text - The text to type into the editor
 * @returns TimedResult with the duration in ms
 */
export async function typeInEditor(text: string): Promise<TimedResult<void>> {
    const editor = await waitForElement('.ProseMirror');
    await editor.click();

    return measureAction(async () => {
        // WebDriver keys() doesn't reliably work with ProseMirror's contenteditable
        // in WKWebView. Use execCommand('insertText') which ProseMirror handles natively.
        await browser.execute((t: string) => {
            document.execCommand('insertText', false, t);
        }, text);
    });
}

/**
 * Sends a keyboard shortcut using the WebDriver Actions API.
 *
 * @param keys - Array of key names (e.g., `['Meta', 's']` for Cmd+S)
 *
 * @example
 * ```ts
 * await pressShortcut(['Meta', 's']);       // Cmd+S (save)
 * await pressShortcut(['Meta', 'Shift', 'c']); // Cmd+Shift+C (toggle chat)
 * ```
 */
export async function pressShortcut(keys: string[]): Promise<void> {
    if (keys.length === 0) return;

    // Map named keys to WebDriver Unicode constants
    const resolveKey = (k: string): string => WD_KEYS[k] ?? k;

    // Build a single action chain: press all modifiers, press+release the final key,
    // then release modifiers in reverse. Using one chain ensures atomicity.
    const modifiers = keys.slice(0, -1).map(resolveKey);
    const finalKey = resolveKey(keys[keys.length - 1]);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let chain: any = browser.action('key');

    // Press modifiers in order
    for (const mod of modifiers) {
        chain = chain.down(mod);
    }

    // Press and release the final key
    chain = chain.down(finalKey).pause(10).up(finalKey);

    // Release modifiers in reverse order
    for (let i = modifiers.length - 1; i >= 0; i--) {
        chain = chain.up(modifiers[i]);
    }

    await chain.perform();
}

/**
 * Returns the plain text content from the ProseMirror editor.
 *
 * Reads `textContent` from the `.ProseMirror` element, which gives the
 * rendered text without HTML markup.
 *
 * @returns The editor's plain text content
 */
export async function getEditorText(): Promise<string> {
    const editor = await waitForElement('.ProseMirror');
    const text = await editor.getText();
    return text;
}
