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
 * Timing notes (from PR #281 post-mortem):
 *   - All waitUntil budgets are ≥10 s so CI runners under load don't false-fail.
 *   - browser.pause(≥300 ms) after every keyboard shortcut lets React re-render
 *     and CSS transitions settle before polling DOM attributes.
 *   - Prefix characters are typed via input.addValue() on the explicitly-clicked
 *     textarea, not via browser.keys() which relies on autofocus propagation.
 *
 * Run manually:
 *   Terminal 1: pnpm tauri:test
 *   Terminal 2: tauri-webdriver
 *   Terminal 3: pnpm test:e2e-real
 */

import { pressShortcut } from '../helpers/actions';

// WebDriver Unicode key constants
const WD_ESCAPE = '';
const WD_META   = '';

// ─── helpers ─────────────────────────────────────────────────────────────────

/**
 * Waits for the command bar to be present in the DOM.
 * Uses a generous timeout — the FloatingCommandBar is part of QuietLayout
 * (the only shell since Classic Layout removal), so it is always rendered, but
 * the React commit might not have happened yet on the first spec of a CI run.
 */
async function waitForBar(timeout = 15_000): Promise<WebdriverIO.Element> {
    const bar = await browser.$('[data-cmd-bar]');
    await bar.waitForExist({ timeout, timeoutMsg: `[data-cmd-bar] not in DOM within ${timeout}ms` });
    return bar;
}

/**
 * Collapses the command bar by pressing Escape twice (the first Escape only
 * clears an active prefix mode; the second collapses the bar).
 * Waits until data-expanded="false" before returning.
 */
async function collapseBar(): Promise<void> {
    await browser.keys([WD_ESCAPE]);
    // Allow the prefix-clear state change to settle before the second Escape.
    await browser.pause(250);
    await browser.keys([WD_ESCAPE]); // no-op when already collapsed
    // Pause to allow the collapse animation / React re-render before polling.
    await browser.pause(400);
    await browser.waitUntil(
        async () => {
            const bar = await browser.$('[data-cmd-bar]');
            if (!(await bar.isExisting())) return true;
            return (await bar.getAttribute('data-expanded')) === 'false';
        },
        { timeout: 10_000, interval: 100, timeoutMsg: 'Bar did not collapse after Escape(s)' },
    );
}

/**
 * Expands the command bar via ⌘K and waits until data-expanded="true".
 * Includes a post-shortcut pause so the React state update and lift
 * animation are done before callers poll DOM attributes.
 */
async function expandBar(bar: WebdriverIO.Element): Promise<void> {
    await pressShortcut(['Meta', 'k']);
    // Wait for React to update state and commit the render (the lift animation
    // is 200 ms ease; 400 ms covers the animation + one React tick).
    await browser.pause(400);
    await browser.waitUntil(
        async () => (await bar.getAttribute('data-expanded')) === 'true',
        { timeout: 10_000, interval: 100, timeoutMsg: 'Bar did not expand after ⌘K' },
    );
}

/**
 * Returns the command bar's textarea input element.
 * The textarea has role="combobox" and lives inside [data-cmd-bar].
 */
async function getInput(): Promise<WebdriverIO.Element> {
    return browser.$('[data-cmd-bar] textarea[role="combobox"]');
}

// ─── suite ───────────────────────────────────────────────────────────────────

describe('FloatingCommandBar', () => {
    before(async () => {
        // Wait for the React app to mount.
        const root = await browser.$('#root');
        await root.waitForExist({ timeout: 15_000, timeoutMsg: 'App root not found within 15s' });

        // Wait for the settings store to be exposed (set in src/main.tsx in dev mode).
        await browser.waitUntil(
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            async () => browser.execute(() => Boolean((window as any).__E2E_SETTINGS_STORE__)),
            {
                timeout: 15_000,
                interval: 200,
                timeoutMsg: '__E2E_SETTINGS_STORE__ not exposed within 15s',
            },
        );

        // Wait for the command bar to appear in the DOM.
        // QuietLayout is the only shell (Classic Layout removed in #325).
        await waitForBar(15_000);

        // Start from a known state: bar collapsed, not pinned.
        await browser.execute(() => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const s = (window as any).__E2E_SETTINGS_STORE__?.getState();
            if (s?.cmdBarPinned) s.setCmdBarPinned(false);
        });
        await browser.pause(300);
    });

    afterEach(async () => {
        // Collapse and reset between tests to prevent state leaks.
        await collapseBar();
        await browser.execute(() => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const s = (window as any).__E2E_SETTINGS_STORE__?.getState();
            if (s?.cmdBarPinned) s.setCmdBarPinned(false);
        });
        // Allow the unpin React update to settle before the next test.
        await browser.pause(300);
    });

    // ─── ⌘K expands ──────────────────────────────────────────────────────────

    it('⌘K should expand the command bar', async () => {
        const bar = await waitForBar();

        // Confirm the bar starts collapsed.
        await browser.waitUntil(
            async () => (await bar.getAttribute('data-expanded')) === 'false',
            { timeout: 5_000, interval: 100, timeoutMsg: 'Bar was not collapsed at test start' },
        );

        await expandBar(bar);

        console.log('[cmd-bar] ⌘K expanded the bar ✓');
    });

    // ─── Double-tap ⌘ expands ────────────────────────────────────────────────

    it('double-tap ⌘ (within 300 ms) should expand the command bar', async () => {
        const bar = await waitForBar();

        await browser.waitUntil(
            async () => (await bar.getAttribute('data-expanded')) === 'false',
            { timeout: 5_000, interval: 100, timeoutMsg: 'Bar was not collapsed at test start' },
        );

        // Two Meta keydown events within 300 ms triggers useDoubleTapCmd.
        // 60 ms gap is well within the 300 ms detection window.
        await browser
            .action('key')
            .down(WD_META).pause(20).up(WD_META)
            .pause(60)
            .down(WD_META).pause(20).up(WD_META)
            .perform();

        // Pause to allow the useDoubleTapCmd handler to fire and React to
        // re-render before polling data-expanded.
        await browser.pause(400);

        await browser.waitUntil(
            async () => (await bar.getAttribute('data-expanded')) === 'true',
            { timeout: 10_000, interval: 100, timeoutMsg: 'Bar did not expand after double-tap ⌘' },
        );

        console.log('[cmd-bar] double-tap ⌘ expanded the bar ✓');
    });

    // ─── Prefix-mode transitions ──────────────────────────────────────────────

    /**
     * Shared helper: expand the bar via ⌘K, click the input explicitly (so
     * focus is guaranteed and not reliant on autofocus propagation timing),
     * type one prefix character via addValue(), then assert data-prefix-mode.
     *
     * Using input.addValue() instead of browser.keys() is more reliable in
     * WKWebView because addValue() targets the element directly rather than
     * routing through the active-element heuristic.
     */
    async function assertPrefixMode(char: string, expectedModeId: string): Promise<void> {
        const bar = await waitForBar();

        await expandBar(bar);

        // Explicitly click the textarea to guarantee focus before typing.
        const input = await getInput();
        await input.click();
        // Allow the click-focus and any React autofocus RAF to complete.
        await browser.pause(300);

        // Type the prefix character directly into the focused textarea.
        await input.addValue(char);
        // Pause to allow React's onChange → recomputePrefix → setActivePrefix
        // state update chain to complete before polling the attribute.
        await browser.pause(300);

        await browser.waitUntil(
            async () => (await bar.getAttribute('data-prefix-mode')) === expectedModeId,
            {
                timeout: 10_000,
                interval: 100,
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

    it('⌘⇧F should expand the bar and open the FileMode picker tray', async () => {
        const bar = await waitForBar();

        // ⌘⇧F seeds the `:file ` verb prefix via useCommandBarShortcuts/useKeyboardShortcuts.
        // (PRD 2026-04-28-cmd-bar-verb-prefixes, §Find files shortcut.)
        await pressShortcut(['Meta', 'Shift', 'f']);
        // Pause to allow the shortcut handler, React state update, and bar
        // expand animation to complete before reading DOM attributes.
        await browser.pause(500);

        await browser.waitUntil(
            async () => (await bar.getAttribute('data-expanded')) === 'true',
            { timeout: 10_000, interval: 100, timeoutMsg: 'Bar did not expand after ⌘⇧F' },
        );

        // Verb modes open a picker tray (same data-cmd-picker-tray attribute
        // used by noun prefix pickers). Verb mode does NOT set data-prefix-mode
        // on the bar root (only noun prefixes do), so we verify:
        //   • data-cmd-picker-tray element is present in the DOM
        //   • data-prefix-mode is "" (no noun prefix active)
        await browser.waitUntil(
            async () => {
                const tray = await browser.$('[data-cmd-picker-tray]');
                const prefixMode = await bar.getAttribute('data-prefix-mode');
                return (await tray.isExisting()) && prefixMode === '';
            },
            {
                timeout: 10_000,
                interval: 100,
                timeoutMsg: 'FileMode picker tray did not appear after ⌘⇧F',
            },
        );

        console.log('[cmd-bar] ⌘⇧F → :file verb mode picker tray visible ✓');
    });

    // ─── Esc behaviour ───────────────────────────────────────────────────────

    it('first Esc clears typed prefix; second Esc collapses the bar', async () => {
        const bar = await waitForBar();

        // Expand and enter SkillMode via '/'.
        await expandBar(bar);

        const input = await getInput();
        await input.click();
        await browser.pause(300);
        await input.addValue('/');
        await browser.pause(300);

        await browser.waitUntil(
            async () => (await bar.getAttribute('data-prefix-mode')) === 'skill',
            { timeout: 10_000, interval: 100, timeoutMsg: 'SkillMode did not activate after "/"' },
        );

        // First Esc — clears the prefix (mode → ""), bar stays expanded.
        await browser.keys([WD_ESCAPE]);
        // Pause to let the Esc handler and React re-render complete.
        await browser.pause(400);

        await browser.waitUntil(
            async () => (await bar.getAttribute('data-prefix-mode')) === '',
            { timeout: 10_000, interval: 100, timeoutMsg: 'First Esc did not clear prefix mode' },
        );

        // The bar must still be expanded after the first Esc.
        expect(await bar.getAttribute('data-expanded')).toBe('true');
        console.log('[cmd-bar] first Esc cleared prefix; bar still expanded ✓');

        // Second Esc — collapses the bar.
        await browser.keys([WD_ESCAPE]);
        // Pause to let the collapse animation complete before reading data-expanded.
        await browser.pause(400);

        await browser.waitUntil(
            async () => (await bar.getAttribute('data-expanded')) === 'false',
            { timeout: 10_000, interval: 100, timeoutMsg: 'Second Esc did not collapse the bar' },
        );

        console.log('[cmd-bar] second Esc collapsed the bar ✓');
    });

    // ─── ⌘⇧C unpins when expanded + pinned ───────────────────────────────────

    it('⌘⇧C when expanded + pinned should unpin the bar', async () => {
        // Pin the bar directly via the settings store (no keyboard shortcut
        // needed — this avoids a separate expand + pin sequence that could race).
        await browser.execute(() => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (window as any).__E2E_SETTINGS_STORE__?.getState().setCmdBarPinned(true);
        });
        // Allow the React state change to propagate and the pinned layout to render.
        await browser.pause(400);

        const bar = await waitForBar();

        // Pinned bars are always effectively expanded (effectiveExpanded = isPinned || isExpanded).
        await browser.waitUntil(
            async () =>
                (await bar.getAttribute('data-cmd-bar-pinned')) === 'true' &&
                (await bar.getAttribute('data-expanded')) === 'true',
            { timeout: 10_000, interval: 100, timeoutMsg: 'Bar did not reach pinned+expanded state' },
        );

        console.log('[cmd-bar] bar is pinned and expanded ✓');

        // ⌘⇧C when isExpanded + isPinned → unpins (documented in
        // useKeyboardShortcuts.ts and docs/keyboard-shortcuts.md).
        await pressShortcut(['Meta', 'Shift', 'c']);
        // Pause before polling to avoid reading the attribute mid-animation.
        await browser.pause(400);

        await browser.waitUntil(
            async () => (await bar.getAttribute('data-cmd-bar-pinned')) === 'false',
            { timeout: 10_000, interval: 100, timeoutMsg: 'Bar did not unpin after ⌘⇧C' },
        );

        console.log('[cmd-bar] ⌘⇧C unpinned the bar ✓');
    });
});
