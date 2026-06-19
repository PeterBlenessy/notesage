/**
 * FloatingCommandBar summon / collapse / pin E2E tests (issue #280, real-E2E half).
 *
 * Covers the shortcut- and state-driven behaviours that don't require typing
 * into the bar's textarea:
 *   - ⌘K summons (expands) the bar
 *   - double-tap ⌘ also summons it
 *   - Esc collapses it
 *   - pinned mode reflects in the DOM and unpinning restores the floating bar
 *
 * The six prefix-mode transitions and the `:file` verb require *typing* a query
 * into the textarea, which WKWebView's WebDriver can't reliably deliver to a
 * React input (same limitation that skips find-bar/slash typing in
 * editor.test.ts). Those are covered in the Playwright spec
 * `e2e/tests/command-bar-prefixes.spec.ts` (Chromium, where typing works).
 *
 * Run manually:
 *   Terminal 1: pnpm tauri:test
 *   Terminal 2: tauri-webdriver
 *   Terminal 3: pnpm test:e2e-real
 */
import { pressShortcut } from '../helpers/actions';

/** Two quick bare-⌘ press/releases within the double-tap window. */
async function doubleTapCmd(): Promise<void> {
    const META = '';
    await browser
        .action('key')
        .down(META).up(META)
        .pause(60)
        .down(META).up(META)
        .perform();
}

async function setPinned(pinned: boolean): Promise<void> {
    await browser.execute((p: boolean) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const s = (window as any).__E2E_SETTINGS_STORE__?.getState();
        s?.setCmdBarPinned?.(p);
    }, pinned);
}

async function collapseBar(): Promise<void> {
    const bar = await browser.$('[data-cmd-bar]');
    if ((await bar.getAttribute('data-expanded')) === 'true') {
        await pressShortcut(['Escape']);
        await browser.waitUntil(
            async () => (await bar.getAttribute('data-expanded')) === 'false',
            { timeout: 3000, interval: 50, timeoutMsg: 'Bar did not collapse' },
        ).catch(() => {});
    }
}

describe('FloatingCommandBar — summon / collapse / pin', () => {
    before(async () => {
        const root = await browser.$('#root');
        await root.waitForExist({ timeout: 10_000, timeoutMsg: 'App root not found' });
        await browser.setWindowSize(1200, 800);
    });

    beforeEach(async () => {
        await setPinned(false);
        await collapseBar();
    });

    afterEach(async () => {
        await setPinned(false);
        await collapseBar();
    });

    it('⌘K summons (expands) the command bar', async () => {
        const bar = await browser.$('[data-cmd-bar]');
        await bar.waitForExist({ timeout: 5000 });
        expect(await bar.getAttribute('data-expanded')).toBe('false');

        await pressShortcut(['Meta', 'k']);

        await browser.waitUntil(
            async () => (await bar.getAttribute('data-expanded')) === 'true',
            { timeout: 5000, interval: 50, timeoutMsg: 'Bar did not expand on ⌘K' },
        );
        // The combobox input is present once expanded.
        const input = await browser.$('[data-cmd-bar] textarea[role="combobox"]');
        expect(await input.isExisting()).toBe(true);
    });

    it('Esc collapses the command bar', async () => {
        const bar = await browser.$('[data-cmd-bar]');
        await pressShortcut(['Meta', 'k']);
        await browser.waitUntil(
            async () => (await bar.getAttribute('data-expanded')) === 'true',
            { timeout: 5000, interval: 50, timeoutMsg: 'Bar did not expand' },
        );

        await pressShortcut(['Escape']);
        await browser.waitUntil(
            async () => (await bar.getAttribute('data-expanded')) === 'false',
            { timeout: 5000, interval: 50, timeoutMsg: 'Bar did not collapse on Esc' },
        );
    });

    it('double-tap ⌘ summons the command bar', async () => {
        const bar = await browser.$('[data-cmd-bar]');
        expect(await bar.getAttribute('data-expanded')).toBe('false');

        await doubleTapCmd();

        await browser.waitUntil(
            async () => (await bar.getAttribute('data-expanded')) === 'true',
            { timeout: 5000, interval: 50, timeoutMsg: 'Bar did not expand on double-tap ⌘' },
        );
    });

    it('pinned mode reflects on the bar and unpinning restores the floating bar', async () => {
        // Pinning re-renders the bar into the docked side panel (a new DOM
        // node), so read the attribute via a fresh query each poll rather than
        // caching the element handle (which would go stale).
        const pinnedAttr = async (): Promise<string | null> => {
            const b = await browser.$('[data-cmd-bar]');
            return b.getAttribute('data-cmd-bar-pinned');
        };

        // Pin → the bar advertises pinned mode.
        await setPinned(true);
        await browser.waitUntil(async () => (await pinnedAttr()) === 'true', {
            timeout: 5000, interval: 50, timeoutMsg: 'Bar did not enter pinned mode',
        });

        // Unpin (the pin-button path; ⌘⇧C was removed as a summon/unpin chord
        // in the keyboard-shortcut overhaul) → back to the floating bar.
        await setPinned(false);
        await browser.waitUntil(async () => (await pinnedAttr()) === 'false', {
            timeout: 5000, interval: 50, timeoutMsg: 'Bar did not unpin',
        });
    });
});
