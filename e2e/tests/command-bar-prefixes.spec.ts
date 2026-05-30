/**
 * FloatingCommandBar prefix-mode transitions (issue #280, Playwright half).
 *
 * The six single-character prefixes and the `:file` verb morph the command
 * bar into mode-specific pickers. Driving them requires *typing* a query into
 * the bar's textarea — which WKWebView's WebDriver (the e2e-real harness)
 * cannot reliably deliver to a React input. Chromium under Playwright types
 * normally, so the prefix-grammar coverage lives here; the summon / Esc / pin
 * shortcuts (which don't need typed input) are covered in the real-E2E
 * command-bar spec.
 *
 * Selectors (per `src/components/cmd/FloatingCommandBar.tsx` + modes/):
 *   - container: [data-cmd-bar]
 *   - input:     textarea[role="combobox"]
 *   - PaletteMode: [data-palette-list] / [data-palette-row] / [data-palette-empty]
 *   - TagMode:     [data-cmd-mode="tag"]
 *   - all pickers render a [role="listbox"] dropdown
 */
import { test, expect } from '@playwright/test';
import { setupTauriMock } from '../fixtures/tauri-mock';

test.describe('Command bar — prefix modes', () => {
    test.beforeEach(async ({ page }) => {
        await setupTauriMock(page);
        await page.goto('/');
        await page.waitForLoadState('networkidle');
    });

    /** Expands the bar and returns the combobox input locator. */
    async function expandBar(page: import('@playwright/test').Page) {
        const bar = page.locator('[data-cmd-bar]');
        await page.keyboard.press('Meta+k');
        await expect(bar).toHaveAttribute('data-expanded', 'true', { timeout: 5000 });
        const input = bar.locator('textarea[role="combobox"]');
        await expect(input).toBeVisible({ timeout: 5000 });
        return input;
    }

    // Each single-char prefix, typed as the first character, must morph the
    // bar into its picker (a role="listbox" dropdown) rather than treating the
    // character as literal chat text.
    const PREFIXES: { char: string; mode: string }[] = [
        { char: '/', mode: 'SkillMode' },
        { char: '@', mode: 'ReferenceMode' },
        { char: '#', mode: 'TagMode' },
        { char: '!', mode: 'TaskMode' },
        { char: '?', mode: 'ResearchMode' },
        { char: '>', mode: 'PaletteMode' },
    ];

    for (const { char, mode } of PREFIXES) {
        test(`typing "${char}" activates ${mode}`, async ({ page }) => {
            const input = await expandBar(page);
            await input.fill(char);
            await expect(input).toHaveValue(char);

            // A picker dropdown appears inside the bar (proves the prefix
            // activated a mode rather than staying literal chat text).
            const picker = page.locator('[data-cmd-bar] [role="listbox"]');
            await expect(picker.first()).toBeVisible({ timeout: 5000 });
        });
    }

    test('`>` PaletteMode renders action rows and filters on query', async ({ page }) => {
        const input = await expandBar(page);
        await input.fill('>theme');
        const matchingRow = page.locator('[data-palette-row]').filter({ hasText: /theme/i });
        const emptyState = page.locator('[data-palette-empty]');
        await expect(matchingRow.or(emptyState)).toBeVisible({ timeout: 5000 });
    });

    test('`#` TagMode renders the tag picker', async ({ page }) => {
        const input = await expandBar(page);
        await input.fill('#');
        await expect(page.locator('[data-cmd-mode="tag"]').first()).toBeVisible({ timeout: 5000 });
    });

    test('`:file ` verb activates FileMode', async ({ page }) => {
        const input = await expandBar(page);
        await input.fill(':file ');
        // FileMode shows its filename-search listbox (empty query lists MRU).
        const picker = page.locator('[data-cmd-bar] [role="listbox"]');
        await expect(picker.first()).toBeVisible({ timeout: 5000 });
    });

    test('backspacing past the prefix returns to default chat mode', async ({ page }) => {
        const input = await expandBar(page);
        await input.fill('#');
        await expect(page.locator('[data-cmd-mode="tag"]').first()).toBeVisible({ timeout: 5000 });

        await input.fill('');
        // The tag picker is gone once the prefix is removed.
        await expect(page.locator('[data-cmd-mode="tag"]')).toHaveCount(0, { timeout: 5000 });
    });
});
