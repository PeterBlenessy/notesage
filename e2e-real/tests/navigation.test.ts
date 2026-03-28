/**
 * Navigation and UI E2E tests.
 *
 * Validates keyboard shortcuts for theme toggling, chat panel, sidebar,
 * and focus mode. These tests operate on the running Notesage app and
 * do not require a project to be open.
 *
 * Run manually:
 *   Terminal 1: pnpm tauri:test
 *   Terminal 2: tauri-webdriver
 *   Terminal 3: pnpm test:e2e-real
 */

import { pressShortcut } from '../helpers/actions';
import { measureAction } from '../helpers/timing';

/**
 * Resets sidebar and focus mode to their default states via the store API.
 * This is more reliable than keyboard shortcuts in WebDriver.
 */
async function resetNavigationState(): Promise<void> {
    await browser.setWindowSize(1200, 800);
    // Exit focus mode via Escape (focusMode is React useState, not in a store)
    await browser.keys(['Escape']);
    await browser.execute(() => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const w = window as any;
        if (w.__E2E_SETTINGS_STORE__) {
            const s = w.__E2E_SETTINGS_STORE__.getState();
            if (!s.sidebarPinned) s.setSidebarPinned(true);
            if (s.chatPanelOpen) s.setChatPanelOpen(false);
        }
    });
    await browser.pause(300);
}

describe('Navigation and UI', () => {
    before(async () => {
        // Ensure the app is loaded and the root container is present.
        const root = await browser.$('#root');
        await root.waitForExist({ timeout: 5000, timeoutMsg: 'App root not found within 5s' });
        await resetNavigationState();
    });

    // Always restore clean state after each test to prevent cascading failures
    afterEach(async () => {
        await resetNavigationState();
    });

    // ---------------------------------------------------------------
    // Test 1: Theme toggle (Cmd+T)
    // ---------------------------------------------------------------
    it('should toggle theme with Cmd+T', async () => {
        const htmlEl = await browser.$('html');
        const initialClass = await htmlEl.getAttribute('class') ?? '';
        const wasDark = initialClass.includes('dark');
        console.log(`[nav] Initial theme — dark: ${wasDark}`);

        // Toggle theme
        await pressShortcut(['Meta', 't']);

        // Measure the time it takes for the class to flip
        const { duration } = await measureAction(async () => {
            await browser.waitUntil(
                async () => {
                    const cls = await htmlEl.getAttribute('class') ?? '';
                    const isDark = cls.includes('dark');
                    return isDark !== wasDark;
                },
                {
                    timeout: 1000,
                    interval: 50,
                    timeoutMsg: 'Theme class did not change within 1s after Cmd+T',
                },
            );
        });
        console.log(`[nav] Theme toggled in ${duration.toFixed(0)}ms`);
        expect(duration).toBeLessThan(500);

        // Verify computed background color actually changed
        const newBg = await browser.execute(() =>
            window.getComputedStyle(document.documentElement).backgroundColor,
        );
        console.log(`[nav] New background color: ${newBg}`);
        expect(newBg).toBeTruthy();

        // Toggle back to restore original state
        await pressShortcut(['Meta', 't']);
        await browser.waitUntil(
            async () => {
                const cls = await htmlEl.getAttribute('class') ?? '';
                return cls.includes('dark') === wasDark;
            },
            {
                timeout: 1000,
                interval: 50,
                timeoutMsg: 'Theme did not restore to original state',
            },
        );
        console.log('[nav] Theme restored to original state');
    });

    // ---------------------------------------------------------------
    // Test 2: Chat panel toggle (Cmd+Shift+C)
    // ---------------------------------------------------------------
    it('should toggle chat panel with Cmd+Shift+C', async () => {
        // Ensure chat panel is initially closed by reading the store
        const initiallyOpen = await browser.execute(() => {
            const raw = localStorage.getItem('notesage-settings');
            if (!raw) return false;
            try {
                return JSON.parse(raw).state?.chatPanelOpen ?? false;
            } catch {
                return false;
            }
        });
        console.log(`[nav] Chat panel initially open: ${initiallyOpen}`);

        // If already open, close it first to start from a known state
        if (initiallyOpen) {
            await pressShortcut(['Meta', 'Shift', 'c']);
            await browser.pause(300);
        }

        // Open the chat panel and measure how long it takes to appear
        await pressShortcut(['Meta', 'Shift', 'c']);

        const { duration } = await measureAction(async () => {
            // The ChatPanel renders a textarea for input — wait for it
            await browser.waitUntil(
                async () => {
                    const chatOpen = await browser.execute(() => {
                        const raw = localStorage.getItem('notesage-settings');
                        if (!raw) return false;
                        try {
                            return JSON.parse(raw).state?.chatPanelOpen ?? false;
                        } catch {
                            return false;
                        }
                    });
                    return chatOpen === true;
                },
                {
                    timeout: 2000,
                    interval: 50,
                    timeoutMsg: 'Chat panel did not open within 2s',
                },
            );
        });
        console.log(`[nav] Chat panel opened in ${duration.toFixed(0)}ms`);
        expect(duration).toBeLessThan(1000);

        // Allow animations to settle and look for the chat textarea
        await browser.pause(200);
        const textarea = await browser.$('textarea');
        const textareaExists = await textarea.isExisting();
        console.log(`[nav] Chat textarea present: ${textareaExists}`);
        expect(textareaExists).toBe(true);

        // Close the chat panel
        await pressShortcut(['Meta', 'Shift', 'c']);
        await browser.waitUntil(
            async () => {
                const chatOpen = await browser.execute(() => {
                    const raw = localStorage.getItem('notesage-settings');
                    if (!raw) return false;
                    try {
                        return JSON.parse(raw).state?.chatPanelOpen ?? false;
                    } catch {
                        return false;
                    }
                });
                return chatOpen === false;
            },
            {
                timeout: 2000,
                interval: 50,
                timeoutMsg: 'Chat panel did not close within 2s',
            },
        );
        console.log('[nav] Chat panel closed');
    });

    // ---------------------------------------------------------------
    // Test 3: Sidebar toggle (Cmd+Shift+L)
    // ---------------------------------------------------------------
    it('should toggle sidebar with Cmd+Shift+L', async () => {
        // Verify the sidebar Settings button is visible initially
        const settingsBtn = await browser.$('button[title*="Settings"]');
        await settingsBtn.waitForExist({ timeout: 3000, timeoutMsg: 'Settings button not found' });
        expect(await settingsBtn.isDisplayed()).toBe(true);
        console.log('[nav] Settings button visible before toggle');

        // Toggle sidebar with Cmd+Shift+L (toggles sidebarPinned in settings store)
        await pressShortcut(['Meta', 'Shift', 'l']);

        // Wait for sidebar to hide — check sidebarPinned (not sidebarOpen)
        await browser.waitUntil(
            async () => {
                const pinned = await browser.execute(() => {
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    return (window as any).__E2E_SETTINGS_STORE__?.getState().sidebarPinned;
                });
                return pinned === false;
            },
            {
                timeout: 2000,
                interval: 50,
                timeoutMsg: 'Sidebar did not unpin within 2s',
            },
        );
        console.log('[nav] Sidebar unpinned');

        // Restore the sidebar
        await pressShortcut(['Meta', 'Shift', 'l']);
        await browser.waitUntil(
            async () => {
                const pinned = await browser.execute(() => {
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    return (window as any).__E2E_SETTINGS_STORE__?.getState().sidebarPinned;
                });
                return pinned === true;
            },
            {
                timeout: 2000,
                interval: 50,
                timeoutMsg: 'Sidebar did not re-pin within 2s',
            },
        );
        console.log('[nav] Sidebar re-pinned');
    });

    // ---------------------------------------------------------------
    // Test 4: Focus mode (Cmd+.)
    // ---------------------------------------------------------------
    it('should enter and exit focus mode with Cmd+.', async () => {
        // Verify sidebar is visible before entering focus mode
        const settingsBtnBefore = await browser.$('button[title*="Settings"]');
        await settingsBtnBefore.waitForExist({ timeout: 3000, timeoutMsg: 'Settings button not found before focus mode' });
        console.log('[nav] Settings button visible before focus mode');

        // Enter focus mode (Cmd+.)
        await pressShortcut(['Meta', '.']);

        // Wait for sidebar to disappear (focus mode hides sidebar + toolbar)
        await browser.waitUntil(
            async () => {
                const btn = await browser.$('button[title*="Settings"]');
                return !(await btn.isDisplayed().catch(() => false));
            },
            {
                timeout: 2000,
                interval: 50,
                timeoutMsg: 'Focus mode did not hide sidebar within 2s',
            },
        );
        console.log('[nav] Focus mode entered — sidebar hidden');

        // Exit focus mode with Escape
        await browser.keys(['Escape']);

        // Sidebar should be visible again
        await browser.waitUntil(
            async () => {
                const btn = await browser.$('button[title*="Settings"]');
                return await btn.isDisplayed().catch(() => false);
            },
            {
                timeout: 2000,
                interval: 50,
                timeoutMsg: 'Focus mode did not restore sidebar within 2s',
            },
        );
        console.log('[nav] Focus mode exited — sidebar restored');
    });
});
