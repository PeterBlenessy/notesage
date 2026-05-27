/**
 * Spike test: validates that tauri-plugin-webdriver + tauri-webdriver + webdriverio
 * can connect to the running Notesage app and interact with real DOM elements.
 *
 * Run manually:
 *   Terminal 1: pnpm tauri:test
 *   Terminal 2: tauri-webdriver
 *   Terminal 3: pnpm test:e2e-real
 */
describe('Spike — app loads and sidebar renders', () => {
    before(async () => {
        // Ensure sidebar is visible (may be hidden by focus mode from prior test runs)
        await browser.keys(['Escape']); // Exit focus mode (React useState, not in store)
        await browser.execute(() => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const w = window as any;
            if (w.__E2E_SETTINGS_STORE__) {
                const s = w.__E2E_SETTINGS_STORE__.getState();
                if (!s.sidebarPinned) s.setSidebarPinned(true);
                if (!s.sidebarOpen) s.setSidebarOpen(true);
            }
        });
        await browser.pause(300);
    });

    it('should connect to the running app', async () => {
        const title = await browser.getTitle();
        console.log(`[spike] Window title: "${title}"`);
        expect(title).toBeTruthy();
    });

    it('should find the sidebar within 3 seconds', async () => {
        const startTime = await browser.execute(() => performance.now());

        // QuietSidebar nav landmark — the old Classic-Layout `Settings`
        // button at the sidebar footer was deleted in PR #333. Settings
        // now opens via ⌘, or the cmd bar's `>settings`. The sidebar nav
        // itself is the visibility marker.
        const sidebarNav = await browser.$('nav[aria-label="Workspace sidebar"]');
        await sidebarNav.waitForExist({ timeout: 3000 });

        const endTime = await browser.execute(() => performance.now());
        const duration = endTime - startTime;

        console.log(`[spike] Sidebar nav found in ${duration.toFixed(0)}ms (informational only)`);
        expect(sidebarNav).toBeExisting();
    });

    it('should find the editor area', async () => {
        // The Tiptap editor renders a .ProseMirror div
        const editor = await browser.$('.ProseMirror');
        const exists = await editor.isExisting();

        // Editor may not exist if no file is open — that's OK for the spike.
        // We just want to confirm we can query the DOM.
        console.log(`[spike] Editor area exists: ${exists}`);

        // At minimum, the main app container should exist
        const appContainer = await browser.$('#root');
        await appContainer.waitForExist({ timeout: 3000 });
        expect(appContainer).toBeExisting();
        console.log('[spike] App root container found');
    });

    it('should be able to read computed styles (theme detection)', async () => {
        const bgColor = await browser.execute(() => {
            return window.getComputedStyle(document.documentElement).backgroundColor;
        });
        console.log(`[spike] Background color: ${bgColor}`);
        expect(bgColor).toBeTruthy();
    });

    it('should be able to execute JavaScript in the app context', async () => {
        const result = await browser.execute(() => {
            return {
                url: window.location.href,
                userAgent: navigator.userAgent,
                timestamp: Date.now(),
            };
        });
        console.log(`[spike] App URL: ${result.url}`);
        console.log(`[spike] User agent: ${result.userAgent}`);
        expect(result.url).toBeTruthy();
        expect(result.timestamp).toBeGreaterThan(0);
    });
});

describe('HTML viewer pill toolbar (#375)', () => {
    before(async () => {
        const { ensureProjectOpen } = await import('../helpers/setup');
        const path = await import('path');
        const testProjectPath = path.resolve(process.cwd(), 'e2e-real/fixtures/test-project');
        await ensureProjectOpen(testProjectPath);
    });

    it('should show both shield and search buttons in the pill for HTML files', async () => {
        const { tauriInvoke } = await import('../helpers/actions');
        const path = await import('path');
        const testProjectPath = path.resolve(process.cwd(), 'e2e-real/fixtures/test-project');
        const filePath = `${testProjectPath}/test-page.html`;
        const content = await tauriInvoke<string>('read_file', { path: filePath });

        // Open via editor store directly — HTML files don't render in ProseMirror
        await browser.execute(
            (fp: string, fileContent: string) => {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const w = window as any;
                if (w.__E2E_EDITOR_STORE__) {
                    w.__E2E_EDITOR_STORE__.getState().openTab(fp, 'test-page.html', fileContent);
                }
            },
            filePath,
            content,
        );
        await browser.pause(1000);

        // Wait for the pill toolbar to appear
        const pill = await browser.$('[data-viewer-id="html"]');
        await pill.waitForExist({ timeout: 10000 });
        console.log('[html-pill] Pill toolbar found');

        // Both buttons must be visible
        const findBtn = await pill.$('button[aria-label="Find"]');
        expect(await findBtn.isExisting()).toBe(true);
        expect(await findBtn.isDisplayed()).toBe(true);
        console.log('[html-pill] Find button: visible');

        const unsafeBtn = await pill.$('button[aria-label="Unsafe preview mode"]');
        expect(await unsafeBtn.isExisting()).toBe(true);
        expect(await unsafeBtn.isDisplayed()).toBe(true);
        console.log('[html-pill] Unsafe preview button: visible');

        // Click find and verify the search input morphs in
        await findBtn.click();
        const searchInput = await browser.$('input[aria-label="Find in document"]');
        await searchInput.waitForExist({ timeout: 5000 });
        expect(await searchInput.isDisplayed()).toBe(true);
        console.log('[html-pill] Search input appeared after click');

        // Type a query and verify matches
        await searchInput.setValue('Hello');
        await browser.pause(500);
        const pillText = await pill.getText();
        console.log(`[html-pill] Pill text after search: "${pillText}"`);
        expect(pillText).toContain('/');
        console.log('[html-pill] Search button verified — visible and functional');
    });
});
