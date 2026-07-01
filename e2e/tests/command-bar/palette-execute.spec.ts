/**
 * Command bar — PaletteMode (`>`) execute journeys.
 *
 * PaletteMode is static (no IPC): the `>` prefix morphs the FloatingCommandBar
 * into a command-action picker. Picking a row fires `notesage:palette-command`,
 * which App.tsx maps to the same callbacks the keyboard chords use. This spec
 * drives "type `>query` → pick the row → observe the real side effect".
 *
 * No mock changes needed — these actions are pure frontend state.
 *
 * Selectors (per `src/components/cmd/modes/PaletteMode.tsx`):
 *   - list:  [data-palette-list]
 *   - row:   [data-palette-row="<id>"]
 *   - empty: [data-palette-empty]
 */
import { test, expect } from '@playwright/test';
import { setupTauriMock } from '../../fixtures/tauri-mock';

test.describe('Command bar — PaletteMode execute', () => {
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

  // `>theme` filters to the theme-toggle action; clicking the row toggles the
  // `dark` class on <html> — the same side effect as the ⌘T chord.
  test('`>theme` → click toggles the theme (dark class flips)', async ({ page }) => {
    const html = page.locator('html');
    const initialHasDark = await html.evaluate((el) => el.classList.contains('dark'));

    const input = await expandBar(page);
    await input.fill('>theme');

    const themeRow = page.locator('[data-palette-row="toggle-theme"]');
    await expect(themeRow).toBeVisible({ timeout: 5000 });

    await themeRow.click();

    if (initialHasDark) {
      await expect(html).not.toHaveClass(/\bdark\b/, { timeout: 5000 });
    } else {
      await expect(html).toHaveClass(/\bdark\b/, { timeout: 5000 });
    }
  });

  // The bar stays open after a palette pick (documented behaviour), so a second
  // pick on the same row toggles the theme back — Enter on the highlighted row.
  test('`>theme` → Enter toggles the theme via keyboard', async ({ page }) => {
    const html = page.locator('html');
    const initialHasDark = await html.evaluate((el) => el.classList.contains('dark'));

    const input = await expandBar(page);
    await input.fill('>theme');

    const themeRow = page.locator('[data-palette-row="toggle-theme"]');
    await expect(themeRow).toBeVisible({ timeout: 5000 });

    // First palette row is auto-highlighted; Enter picks it.
    await page.keyboard.press('Enter');

    if (initialHasDark) {
      await expect(html).not.toHaveClass(/\bdark\b/, { timeout: 5000 });
    } else {
      await expect(html).toHaveClass(/\bdark\b/, { timeout: 5000 });
    }
  });

  // `>sidebar` filters to the sidebar-toggle action and picking it runs without
  // error (settings-store side effect isn't externally observable in the DOM,
  // so we assert the app stays functional through the pick).
  test('`>sidebar` → click toggles the sidebar without crashing', async ({ page }) => {
    const input = await expandBar(page);
    await input.fill('>sidebar');

    const sidebarRow = page.locator('[data-palette-row="toggle-sidebar"]');
    await expect(sidebarRow).toBeVisible({ timeout: 5000 });

    await sidebarRow.click();

    // App remains responsive after the command fires.
    await expect(page.locator('body')).toBeVisible();
    await expect(page.locator('[data-cmd-bar]')).toBeVisible();
  });

  // A query that matches nothing shows the empty state rather than stale rows.
  test('`>zzznotacommand` shows the palette empty state', async ({ page }) => {
    const input = await expandBar(page);
    await input.fill('>zzznotacommand');

    await expect(page.locator('[data-palette-empty]')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('[data-palette-row]')).toHaveCount(0);
  });
});
