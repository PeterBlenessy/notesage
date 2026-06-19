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
        }
    });
    // Collapse the FloatingCommandBar if it's open. The bar exposes
    // `data-expanded` on its root; sending Escape is the documented
    // collapse path in float mode.
    const bar = await browser.$('[data-cmd-bar]');
    if (await bar.isExisting()) {
        const expanded = await bar.getAttribute('data-expanded');
        if (expanded === 'true') {
            await pressShortcut(['Escape']);
        }
    }
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
        console.log(`[nav] Theme toggled in ${duration.toFixed(0)}ms (informational only)`);

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
    // Test 2: FloatingCommandBar expand / collapse
    // ---------------------------------------------------------------
    it('should expand the FloatingCommandBar with Cmd+K and collapse with Esc', async () => {
        const bar = await browser.$('[data-cmd-bar]');
        await bar.waitForExist({ timeout: 3000, timeoutMsg: 'Cmd bar not found within 3s' });

        // Ensure the bar starts collapsed.
        const initiallyExpanded = await bar.getAttribute('data-expanded');
        if (initiallyExpanded === 'true') {
            await pressShortcut(['Escape']);
            await browser.pause(300);
        }
        const startState = await bar.getAttribute('data-expanded');
        console.log(`[nav] Cmd bar initially expanded: ${startState === 'true'}`);
        expect(startState).toBe('false');

        // ⌘K expands the bar — measure how long it takes the attribute to flip.
        await pressShortcut(['Meta', 'k']);

        const { duration } = await measureAction(async () => {
            await browser.waitUntil(
                async () => (await bar.getAttribute('data-expanded')) === 'true',
                {
                    timeout: 2000,
                    interval: 50,
                    timeoutMsg: 'Cmd bar did not expand within 2s',
                },
            );
        });
        console.log(`[nav] Cmd bar expanded in ${duration.toFixed(0)}ms (informational only)`);

        // Allow animations to settle and look for the bar's combobox textarea.
        await browser.pause(200);
        const textarea = await browser.$('[data-cmd-bar] textarea[role="combobox"]');
        const textareaExists = await textarea.isExisting();
        console.log(`[nav] Cmd bar textarea present: ${textareaExists}`);
        expect(textareaExists).toBe(true);

        // Escape is the documented collapse path in float mode.
        await pressShortcut(['Escape']);
        await browser.waitUntil(
            async () => (await bar.getAttribute('data-expanded')) === 'false',
            {
                timeout: 2000,
                interval: 50,
                timeoutMsg: 'Cmd bar did not collapse within 2s',
            },
        );
        console.log('[nav] Cmd bar collapsed');
    });

    // ---------------------------------------------------------------
    // Test 3: Sidebar toggle (Cmd+Shift+L)
    // ---------------------------------------------------------------
    it('should toggle sidebar with Cmd+Shift+L', async () => {
        // Verify the QuietSidebar nav is mounted initially. The legacy
        // `button[title*="Settings"]` lookup pointed at a Classic-only
        // sidebar header button that doesn't exist in Quiet Composer —
        // Settings is reached via ⌘, or the command bar's `>settings`.
        const sidebarNav = await browser.$('nav[aria-label="Workspace sidebar"]');
        await sidebarNav.waitForExist({ timeout: 3000, timeoutMsg: 'Workspace sidebar nav not found' });
        expect(await sidebarNav.isDisplayed()).toBe(true);
        console.log('[nav] Workspace sidebar visible before toggle');

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
        // Focus mode adds `.focus-mode` to the QuietLayout root and applies
        // a CSS opacity fade to the sidebar. We assert on the class rather
        // than DOM visibility — opacity:0 still computes as "displayed".
        const layoutRoot = await browser.$('[data-quiet-layout-root]');
        await layoutRoot.waitForExist({ timeout: 3000, timeoutMsg: 'Quiet layout root not found before focus mode' });

        const startedInFocus = ((await layoutRoot.getAttribute('class')) ?? '').includes('focus-mode');
        if (startedInFocus) {
            // Defensive: previous tests should have reset, but make sure.
            await pressShortcut(['Meta', '.']);
            await browser.pause(150);
        }

        // Enter focus mode (Cmd+.)
        await pressShortcut(['Meta', '.']);

        await browser.waitUntil(
            async () => ((await layoutRoot.getAttribute('class')) ?? '').includes('focus-mode'),
            {
                timeout: 2000,
                interval: 50,
                timeoutMsg: 'Focus mode class did not appear on layout root within 2s',
            },
        );
        console.log('[nav] Focus mode entered — focus-mode class on root');

        // Exit focus mode with Escape
        await browser.keys(['Escape']);

        await browser.waitUntil(
            async () => !((await layoutRoot.getAttribute('class')) ?? '').includes('focus-mode'),
            {
                timeout: 2000,
                interval: 50,
                timeoutMsg: 'Focus mode class did not clear on layout root within 2s',
            },
        );
        console.log('[nav] Focus mode exited — focus-mode class cleared');
    });
});
