/**
 * FloatingCommandBar E2E tests (issue #280 — chore: add real E2E spec).
 *
 * Validates the command-bar keyboard interactions and prefix-mode transitions
 * against the real running Notesage app (Tauri + WebDriverIO).
 *
 * Coverage:
 *   - ⌘K expands the bar
 *   - Double-tap ⌘ (within 300 ms) expands the bar
 *   - Six prefix-mode transitions: / → SkillMode, @ → ReferenceMode, # → TagMode,
 *     ! → TaskMode, ? → ResearchMode, > → PaletteMode
 *   - :file verb mode (seeded via ⌘⇧F) → FileMode picker
 *   - Esc clears the active typed prefix; second Esc collapses the bar
 *   - ⌘⇧C when expanded + pinned → unpins the bar (sets data-cmd-bar-pinned="false")
 *
 * Run manually:
 *   Terminal 1: pnpm tauri:test
 *   Terminal 2: tauri-webdriver
 *   Terminal 3: pnpm test:e2e-real
 */

import { pressShortcut } from '../helpers/actions';

// WebDriver Unicode key constants used in this file.
// Full table lives in e2e-real/helpers/actions.ts (WD_KEYS).
const WD_ESCAPE = '';
const WD_META = '';

// ─── helpers ─────────────────────────────────────────────────────────────────

/** Switch to quiet-composer preview mode via the settings store. */
async function enableQuietComposer(): Promise<void> {
    await browser.execute(() => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const w = window as any;
        w.__E2E_SETTINGS_STORE__?.getState().setUiPreview('quiet-composer');
    });
}

/** Restore legacy preview mode and reset cmd-bar state. */
async function disableQuietComposer(): Promise<void> {
    await browser.execute(() => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const w = window as any;
        const s = w.__E2E_SETTINGS_STORE__?.getState();
        if (!s) return;
        // Unpin the bar first so it doesn't stay docked after the suite.
        if (s.cmdBarPinned) s.setCmdBarPinned(false);
        s.setUiPreview('legacy');
    });
}

/**
 * Collapses the command bar by pressing Escape. When a prefix mode is active
 * the first Escape only clears the prefix, so we send a second Escape to
 * guarantee full collapse. Waits until `data-expanded="false"`.
 */
async function collapseBar(): Promise<void> {
    await browser.keys([WD_ESCAPE]);
    await browser.pause(100);
    await browser.keys([WD_ESCAPE]); // no-op if already collapsed
    await browser.waitUntil(
        async () => {
            const bar = await browser.$('[data-cmd-bar]');
            if (!(await bar.isExisting())) return true;
            return (await bar.getAttribute('data-expanded')) === 'false';
        },
        { timeout: 2000, interval: 50, timeoutMsg: 'Bar did not collapse after Escape(s)' },
    );
}

/**
 * Waits for the command bar element to appear in the DOM (it only renders in
 * quiet-composer mode).
 */
async function waitForBar(timeout = 5000): Promise<WebdriverIO.Element> {
    const bar = await browser.$('[data-cmd-bar]');
    await bar.waitForExist({ timeout, timeoutMsg: `[data-cmd-bar] not found within ${timeout}ms` });
    return bar;
}

// ─── suite ───────────────────────────────────────────────────────────────────

describe('FloatingCommandBar', () => {
    before(async () => {
        // Wait for the React app to mount.
        const root = await browser.$('#root');
        await root.waitForExist({ timeout: 10_000, timeoutMsg: 'App root not found within 10s' });

        // Wait for the settings store to be exposed on window (set during
        // app startup in src/main.tsx in DEV mode).
        await browser.waitUntil(
            async () =>
                browser.execute(
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    () => Boolean((window as any).__E2E_SETTINGS_STORE__),
                ),
            {
                timeout: 10_000,
                interval: 200,
                timeoutMsg: '__E2E_SETTINGS_STORE__ not exposed within 10s',
            },
        );

        await enableQuietComposer();
        // The command bar renders once the layout re-mounts in quiet mode.
        await waitForBar(5000);
    });

    afterEach(async () => {
        // Collapse and clear any active prefix mode between tests.
        await collapseBar();

        // Ensure the bar is not left pinned (some tests pin it).
        await browser.execute(() => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const w = window as any;
            const s = w.__E2E_SETTINGS_STORE__?.getState();
            if (s?.cmdBarPinned) s.setCmdBarPinned(false);
        });
        await browser.pause(150);
    });

    after(async () => {
        await disableQuietComposer();
    });

    // ─── ⌘K expands ──────────────────────────────────────────────────────────

    it('⌘K should expand the command bar', async () => {
        const bar = await waitForBar();

        // Confirm collapsed before pressing the shortcut.
        expect(await bar.getAttribute('data-expanded')).toBe('false');

        await pressShortcut(['Meta', 'k']);

        await browser.waitUntil(
            async () => (await bar.getAttribute('data-expanded')) === 'true',
            { timeout: 2000, interval: 50, timeoutMsg: 'Bar did not expand after ⌘K' },
        );

        console.log('[cmd-bar] ⌘K expanded the bar ✓');
    });

    // ─── Double-tap ⌘ expands ────────────────────────────────────────────────

    it('double-tap ⌘ (within 300 ms) should expand the command bar', async () => {
        const bar = await waitForBar();
        expect(await bar.getAttribute('data-expanded')).toBe('false');

        // Two Meta keydown events within 300 ms triggers useDoubleTapCmd.
        // We send down+up for each tap with a 60 ms gap between them (well under
        // the 300 ms window the hook uses for detection).
        await browser
            .action('key')
            .down(WD_META).pause(20).up(WD_META)
            .pause(60)
            .down(WD_META).pause(20).up(WD_META)
            .perform();

        await browser.waitUntil(
            async () => (await bar.getAttribute('data-expanded')) === 'true',
            { timeout: 2000, interval: 50, timeoutMsg: 'Bar did not expand after double-tap ⌘' },
        );

        console.log('[cmd-bar] double-tap ⌘ expanded the bar ✓');
    });

    // ─── Prefix-mode transitions ──────────────────────────────────────────────

    /**
     * Expand the bar via ⌘K, type one prefix character into the autofocused
     * input, then assert `data-prefix-mode` equals the expected mode id.
     */
    async function assertPrefixMode(char: string, expectedModeId: string): Promise<void> {
        const bar = await waitForBar();

        // Expand.
        await pressShortcut(['Meta', 'k']);
        await browser.waitUntil(
            async () => (await bar.getAttribute('data-expanded')) === 'true',
            { timeout: 2000, interval: 50, timeoutMsg: 'Bar did not expand before typing prefix' },
        );

        // Type the single prefix character into the autofocused input.
        await browser.keys([char]);

        await browser.waitUntil(
            async () => (await bar.getAttribute('data-prefix-mode')) === expectedModeId,
            {
                timeout: 2000,
                interval: 50,
                timeoutMsg: `data-prefix-mode did not become "${expectedModeId}" after typing "${char}"`,
            },
        );

        console.log(`[cmd-bar] "${char}" → mode "${expectedModeId}" ✓`);
    }

    it('/ should activate SkillMode (data-prefix-mode = "skill")', async () => {
        await assertPrefixMode('/', 'skill');
    });

    it('@ should activate ReferenceMode (data-prefix-mode = "reference")', async () => {
        await assertPrefixMode('@', 'reference');
    });

    it('# should activate TagMode (data-prefix-mode = "tag")', async () => {
        await assertPrefixMode('#', 'tag');
    });

    it('! should activate TaskMode (data-prefix-mode = "task")', async () => {
        await assertPrefixMode('!', 'task');
    });

    it('? should activate ResearchMode (data-prefix-mode = "research")', async () => {
        await assertPrefixMode('?', 'research');
    });

    it('> should activate PaletteMode (data-prefix-mode = "palette")', async () => {
        await assertPrefixMode('>', 'palette');
    });

    // ─── :file verb mode via ⌘⇧F ─────────────────────────────────────────────

    it('⌘⇧F should seed :file verb mode and open the FileMode picker tray', async () => {
        const bar = await waitForBar();

        // ⌘⇧F seeds the `:file ` verb prefix via useKeyboardShortcuts.
        // (PRD 2026-04-28-cmd-bar-verb-prefixes, §Find files shortcut.)
        await pressShortcut(['Meta', 'Shift', 'f']);

        // The bar must expand.
        await browser.waitUntil(
            async () => (await bar.getAttribute('data-expanded')) === 'true',
            { timeout: 2000, interval: 50, timeoutMsg: 'Bar did not expand after ⌘⇧F' },
        );

        // A picker tray appears for verb modes (same attribute used for noun
        // prefix pickers). Since verb mode does NOT set data-prefix-mode on the
        // bar root (only noun prefixes do), we confirm verb mode by checking:
        //   • data-cmd-picker-tray is present in the DOM
        //   • data-prefix-mode is "" (no noun prefix is active)
        await browser.waitUntil(
            async () => {
                const tray = await browser.$('[data-cmd-picker-tray]');
                const prefixMode = await bar.getAttribute('data-prefix-mode');
                return (await tray.isExisting()) && prefixMode === '';
            },
            {
                timeout: 2000,
                interval: 50,
                timeoutMsg: 'FileMode picker tray did not appear after ⌘⇧F',
            },
        );

        console.log('[cmd-bar] ⌘⇧F → :file verb mode picker tray visible ✓');
    });

    // ─── Esc behaviour ───────────────────────────────────────────────────────

    it('first Esc clears typed prefix; second Esc collapses the bar', async () => {
        const bar = await waitForBar();

        // Expand and type a prefix character to enter a mode.
        await pressShortcut(['Meta', 'k']);
        await browser.waitUntil(
            async () => (await bar.getAttribute('data-expanded')) === 'true',
            { timeout: 2000, interval: 50, timeoutMsg: 'Bar did not expand' },
        );

        await browser.keys(['/']);
        await browser.waitUntil(
            async () => (await bar.getAttribute('data-prefix-mode')) === 'skill',
            { timeout: 2000, interval: 50, timeoutMsg: 'SkillMode did not activate after "/"' },
        );

        // First Esc — clears the prefix (mode back to ""), bar still expanded.
        await browser.keys([WD_ESCAPE]);
        await browser.waitUntil(
            async () => (await bar.getAttribute('data-prefix-mode')) === '',
            { timeout: 2000, interval: 50, timeoutMsg: 'First Esc did not clear prefix mode' },
        );

        // Bar must remain expanded after the first Esc.
        expect(await bar.getAttribute('data-expanded')).toBe('true');
        console.log('[cmd-bar] first Esc cleared prefix; bar still expanded ✓');

        // Second Esc — collapses the bar.
        await browser.keys([WD_ESCAPE]);
        await browser.waitUntil(
            async () => (await bar.getAttribute('data-expanded')) === 'false',
            { timeout: 2000, interval: 50, timeoutMsg: 'Second Esc did not collapse the bar' },
        );

        console.log('[cmd-bar] second Esc collapsed the bar ✓');
    });

    // ─── ⌘⇧C unpins when expanded + pinned ───────────────────────────────────

    it('⌘⇧C when expanded + pinned should unpin the bar', async () => {
        // Pin the bar via the store.
        await browser.execute(() => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const w = window as any;
            w.__E2E_SETTINGS_STORE__?.getState().setCmdBarPinned(true);
        });

        const bar = await waitForBar();

        // Pinned bars have effectiveExpanded = true always, so both
        // data-cmd-bar-pinned and data-expanded should be "true".
        await browser.waitUntil(
            async () =>
                (await bar.getAttribute('data-cmd-bar-pinned')) === 'true' &&
                (await bar.getAttribute('data-expanded')) === 'true',
            { timeout: 2000, interval: 50, timeoutMsg: 'Bar did not enter pinned+expanded state' },
        );

        console.log('[cmd-bar] bar is pinned and expanded ✓');

        // ⌘⇧C when isQuiet + isExpanded + isPinned → emits toggle-pin → unpins.
        // (Documented in useKeyboardShortcuts.ts and docs/keyboard-shortcuts.md)
        await pressShortcut(['Meta', 'Shift', 'c']);

        await browser.waitUntil(
            async () => (await bar.getAttribute('data-cmd-bar-pinned')) === 'false',
            { timeout: 2000, interval: 50, timeoutMsg: 'Bar did not unpin after ⌘⇧C' },
        );

        console.log('[cmd-bar] ⌘⇧C unpinned the bar ✓');
    });
});
