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

describe('Navigation and UI', () => {
    before(async () => {
        // Ensure the app is loaded and the root container is present.
        const root = await browser.$('#root');
        await root.waitForExist({ timeout: 5000, timeoutMsg: 'App root not found within 5s' });
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
        // Check the initial sidebar state from the store
        const initiallyOpen = await browser.execute(() => {
            const raw = localStorage.getItem('notesage-settings');
            if (!raw) return true; // default is open
            try {
                return JSON.parse(raw).state?.sidebarOpen ?? true;
            } catch {
                return true;
            }
        });
        console.log(`[nav] Sidebar initially open: ${initiallyOpen}`);

        // Ensure sidebar starts open
        if (!initiallyOpen) {
            await pressShortcut(['Meta', 'Shift', 'l']);
            await browser.pause(300);
        }

        // Verify the sidebar Settings button is visible (known child of SidebarPanel)
        const settingsBtn = await browser.$('button[title*="Settings"]');
        const settingsBtnVisible = await settingsBtn.isExisting();
        console.log(`[nav] Settings button visible before toggle: ${settingsBtnVisible}`);
        expect(settingsBtnVisible).toBe(true);

        // Hide the sidebar
        await pressShortcut(['Meta', 'Shift', 'l']);

        const { duration: hideDuration } = await measureAction(async () => {
            await browser.waitUntil(
                async () => {
                    const open = await browser.execute(() => {
                        const raw = localStorage.getItem('notesage-settings');
                        if (!raw) return true;
                        try {
                            return JSON.parse(raw).state?.sidebarOpen ?? true;
                        } catch {
                            return true;
                        }
                    });
                    return open === false;
                },
                {
                    timeout: 2000,
                    interval: 50,
                    timeoutMsg: 'Sidebar did not hide within 2s',
                },
            );
        });
        console.log(`[nav] Sidebar hidden in ${hideDuration.toFixed(0)}ms`);
        expect(hideDuration).toBeLessThan(1000);

        // Allow the collapse animation to complete
        await browser.pause(300);

        // The Settings button should no longer be displayed
        const settingsBtnAfterHide = await browser.$('button[title*="Settings"]');
        const visibleAfterHide = await settingsBtnAfterHide.isDisplayed().catch(() => false);
        console.log(`[nav] Settings button visible after hide: ${visibleAfterHide}`);
        expect(visibleAfterHide).toBe(false);

        // Restore the sidebar
        await pressShortcut(['Meta', 'Shift', 'l']);
        await browser.waitUntil(
            async () => {
                const open = await browser.execute(() => {
                    const raw = localStorage.getItem('notesage-settings');
                    if (!raw) return false;
                    try {
                        return JSON.parse(raw).state?.sidebarOpen ?? true;
                    } catch {
                        return false;
                    }
                });
                return open === true;
            },
            {
                timeout: 2000,
                interval: 50,
                timeoutMsg: 'Sidebar did not restore within 2s',
            },
        );
        await browser.pause(300);

        const settingsBtnRestored = await browser.$('button[title*="Settings"]');
        const restoredVisible = await settingsBtnRestored.isDisplayed().catch(() => false);
        console.log(`[nav] Settings button visible after restore: ${restoredVisible}`);
        expect(restoredVisible).toBe(true);
    });

    // ---------------------------------------------------------------
    // Test 4: Focus mode (Cmd+.)
    // ---------------------------------------------------------------
    it('should enter and exit focus mode with Cmd+.', async () => {
        // Read initial focus mode state
        const initialFocus = await browser.execute(() => {
            const raw = localStorage.getItem('notesage-settings');
            if (!raw) return false;
            try {
                return JSON.parse(raw).state?.focusMode ?? false;
            } catch {
                return false;
            }
        });
        console.log(`[nav] Initial focus mode: ${initialFocus}`);

        // Ensure we start outside focus mode
        if (initialFocus) {
            await browser.keys(['Escape']);
            await browser.pause(300);
        }

        // Verify sidebar Settings button is visible before entering focus mode
        const settingsBtnBefore = await browser.$('button[title*="Settings"]');
        const visibleBefore = await settingsBtnBefore.isDisplayed().catch(() => false);
        console.log(`[nav] Settings button visible before focus: ${visibleBefore}`);

        // Enter focus mode
        await pressShortcut(['Meta', '.']);

        const { duration: enterDuration } = await measureAction(async () => {
            await browser.waitUntil(
                async () => {
                    const focus = await browser.execute(() => {
                        const raw = localStorage.getItem('notesage-settings');
                        if (!raw) return false;
                        try {
                            return JSON.parse(raw).state?.focusMode ?? false;
                        } catch {
                            return false;
                        }
                    });
                    return focus === true;
                },
                {
                    timeout: 2000,
                    interval: 50,
                    timeoutMsg: 'Focus mode did not activate within 2s',
                },
            );
        });
        console.log(`[nav] Focus mode entered in ${enterDuration.toFixed(0)}ms`);
        expect(enterDuration).toBeLessThan(1000);

        // Allow animations to settle
        await browser.pause(300);

        // In focus mode, the sidebar and title bar should be hidden.
        // The Settings button (sidebar child) should not be displayed.
        const settingsBtnInFocus = await browser.$('button[title*="Settings"]');
        const visibleInFocus = await settingsBtnInFocus.isDisplayed().catch(() => false);
        console.log(`[nav] Settings button visible in focus mode: ${visibleInFocus}`);
        expect(visibleInFocus).toBe(false);

        // Exit focus mode with Escape
        await browser.keys(['Escape']);

        const { duration: exitDuration } = await measureAction(async () => {
            await browser.waitUntil(
                async () => {
                    const focus = await browser.execute(() => {
                        const raw = localStorage.getItem('notesage-settings');
                        if (!raw) return false;
                        try {
                            return JSON.parse(raw).state?.focusMode ?? false;
                        } catch {
                            return false;
                        }
                    });
                    return focus === false;
                },
                {
                    timeout: 2000,
                    interval: 50,
                    timeoutMsg: 'Focus mode did not deactivate within 2s',
                },
            );
        });
        console.log(`[nav] Focus mode exited in ${exitDuration.toFixed(0)}ms`);
        expect(exitDuration).toBeLessThan(1000);

        // Sidebar should be visible again
        await browser.pause(300);
        const settingsBtnAfterExit = await browser.$('button[title*="Settings"]');
        const visibleAfterExit = await settingsBtnAfterExit.isDisplayed().catch(() => false);
        console.log(`[nav] Settings button visible after exit: ${visibleAfterExit}`);
        expect(visibleAfterExit).toBe(true);
    });
});
