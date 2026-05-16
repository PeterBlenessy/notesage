/**
 * Reusable action helpers for E2E tests.
 *
 * These helpers interact with the real running Notesage app through WebDriverIO.
 * They use Tauri's internal invoke API and Zustand store access via `browser.execute`
 * to bypass native dialogs that can't be automated through WebDriver.
 */

import { measureAction, type TimedResult } from './timing';

/**
 * Returns the first meaningful plain-text phrase from a markdown string,
 * stripped of leading markdown syntax (headings, list markers, blockquotes).
 * Used by openFile() as a content sentinel to poll ProseMirror after opening.
 *
 * Returns an empty string when the file has no significant text (e.g. empty files).
 */
export function extractFirstSignificantText(markdown: string): string {
    for (const line of markdown.split('\n')) {
        // Strip leading markdown syntax: #, -, *, >, [x], numbered list markers, whitespace
        const stripped = line.replace(/^[\s#*>\-\[\]x.()!0-9]+/, '').trim();
        if (stripped.length >= 3) {
            return stripped.substring(0, 40);
        }
    }
    return '';
}

// Bumped from 5s to 15s — on cold CI runners (macos-latest in GitHub Actions)
// the first spec's React render after the Tauri build is ready can take noticeably
// longer than local dev. Local rebuilds always complete in well under the original
// 5s; the wider ceiling only kicks in on first-spec CI pathway.
const DEFAULT_TIMEOUT = 15000;

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
    // Step 0: Wait for React to mount. On the FIRST spec of a CI session,
    // the page is loaded but React hasn't rendered yet — the workspace store
    // is undefined on `window`, sidebar containers don't exist, and the
    // file-tree-items wait at the end of this function would time out.
    // external-changes.test.ts works around this with an explicit `#root`
    // wait in its `before` hook; putting the wait here makes openProject
    // robust regardless of caller order.
    const root = await browser.$('#root');
    await root.waitForExist({ timeout: 10_000 });
    // Also wait for the workspace store to be exposed on `window` —
    // App.tsx exposes it via the e2e-testing feature flag, but the
    // assignment happens during React's first effect cycle.
    await browser.waitUntil(
        async () => browser.execute(() => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            return Boolean((window as any).__E2E_WORKSPACE_STORE__);
        }),
        {
            timeout: 10_000,
            timeoutMsg: '__E2E_WORKSPACE_STORE__ not exposed on window within 10s — app may not have started in e2e-testing mode',
            interval: 200,
        },
    );

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

    // Wait for the workspace store to confirm the explorer folder is loaded
    // with a non-empty file tree. The DOM-based wait we used before
    // (`.truncate.flex-1` count) was fragile: it only succeeded when the
    // sidebar was visibly open AND React had committed the render, which
    // for the first spec on cold CI was racing the addExplorerFolder
    // store-write. The store IS the source of truth — subsequent
    // openFile() helpers read from it directly, so we don't need the
    // DOM render to have happened, just the store mutation to be visible.
    await browser.waitUntil(
        async () =>
            await browser.execute((path: string) => {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const w = window as any;
                if (!w.__E2E_WORKSPACE_STORE__) return false;
                const s = w.__E2E_WORKSPACE_STORE__.getState();
                const folder = (s.explorerFolders ?? []).find(
                    (f: { path: string; fileTree?: unknown[] }) => f.path === path,
                );
                return Boolean(folder?.fileTree && folder.fileTree.length > 0);
            }, projectPath),
        {
            timeout: DEFAULT_TIMEOUT,
            timeoutMsg: `Explorer folder ${projectPath} did not appear in workspace store with children within ${DEFAULT_TIMEOUT}ms`,
            interval: 100,
        },
    );
}

/**
 * Opens a file by name from the current test project.
 * Uses Tauri invoke to read the file and the editor store to open a tab.
 * This is more reliable than clicking the sidebar DOM.
 *
 * After calling openTab() (which updates the editor store synchronously),
 * this helper polls ProseMirror until its rendered text contains a sentinel
 * derived from the file content. This prevents stale-content races where
 * the previous spec's content is still visible when the next test begins.
 *
 * @param fileName - The file name (e.g., "README.md") or relative path (e.g., "nested/deep-note.md")
 * @param projectPath - Optional project path override. If not provided, uses the last opened project.
 */
export async function openFile(fileName: string, projectPath?: string): Promise<void> {
    // Step 1: Determine the absolute file path.
    let filePath: string;
    if (projectPath) {
        filePath = `${projectPath}/${fileName}`;
    } else {
        // Get the base path from the workspace store (sync, already mounted)
        const basePath = await browser.execute(() => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const w = window as any;
            const folders: Array<{ path: string }> = w.__E2E_WORKSPACE_STORE__?.getState().explorerFolders ?? [];
            if (folders.length === 0) return null;
            return folders[folders.length - 1].path;
        }) as string | null;

        if (!basePath) {
            throw new Error('No explorer folders open');
        }
        filePath = `${basePath}/${fileName}`;
    }

    const bareFileName = fileName.includes('/') ? fileName.split('/').pop()! : fileName;

    // Step 2: Read file content via Tauri invoke (from Node.js side via tauriInvoke).
    const content = await tauriInvoke<string>('read_file', { path: filePath });

    // Step 3: Open the file in the editor store (synchronous store update).
    await browser.execute(
        (fp: string, fn: string, c: string) => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const w = window as any;
            if (w.__E2E_EDITOR_STORE__) {
                w.__E2E_EDITOR_STORE__.getState().openTab(fp, fn, c);
            }
        },
        filePath,
        bareFileName,
        content,
    );

    // Step 4: Wait for ProseMirror to render the new file's content.
    // After openTab() the store is updated immediately, but React's effect
    // cycle + worker parse + streaming hydrate in useEditorTabSwitch are
    // asynchronous. The previous ProseMirror DOM may still show the prior
    // spec's content. We poll until the rendered text contains our sentinel.
    const contentKey = extractFirstSignificantText(content);

    await browser.waitUntil(
        async () => {
            const editor = await browser.$('.ProseMirror');
            if (!(await editor.isExisting())) return false;
            const text = await editor.getText();

            if (contentKey) {
                // Primary signal: sentinel text is visible in ProseMirror.
                return text.includes(contentKey);
            }

            // Fallback for empty files: verify the store's active tab matches our path.
            return browser.execute((fp: string) => {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const w = window as any;
                if (!w.__E2E_EDITOR_STORE__) return false;
                const state = w.__E2E_EDITOR_STORE__.getState();
                const active = state.openDocuments.find(
                    (t: { id: string; filePath: string }) => t.id === state.activeTabId,
                ) as { filePath: string } | undefined;
                return active?.filePath === fp;
            }, filePath) as Promise<boolean>;
        },
        {
            timeout: DEFAULT_TIMEOUT,
            timeoutMsg: `Editor did not show content from "${fileName}" within ${DEFAULT_TIMEOUT}ms`,
            interval: 200,
        },
    );

    // Step 5: Mark the tab clean so dirty tracking starts from a known baseline.
    // Without this, the editor's setContent() triggers an onUpdate that
    // may mark the tab dirty before the user has typed anything.
    await browser.execute((fp: string) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const w = window as any;
        if (w.__E2E_EDITOR_STORE__) {
            const state = w.__E2E_EDITOR_STORE__.getState();
            const activeTab = state.openDocuments.find(
                (t: { id: string; filePath: string }) => t.filePath === fp,
            ) as { id: string; content: string } | undefined;
            if (activeTab) {
                state.markTabClean(activeTab.id, activeTab.content);
            }
        }
    }, filePath);
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
