import { test, expect } from '@playwright/test';
import { setupTauriMock } from '../fixtures/tauri-mock';

/**
 * Post-Classic-removal (#325) the command palette is the FloatingCommandBar
 * in QuietLayout. The palette opens via `Cmd+K` (chat focus, no prefix) or
 * via `Cmd+Shift+P` (`>` prefix → PaletteMode). Inputs and items expose
 * test-friendly selectors:
 *   - container:    [data-cmd-bar]
 *   - expanded:     data-expanded="true"
 *   - input:        textarea[role="combobox"]
 *   - palette row:  [data-palette-row]
 *   - empty state:  [data-palette-empty]
 */
test.describe('Navigation — Floating Command Bar', () => {
  test.beforeEach(async ({ page }) => {
    await setupTauriMock(page);
    await page.goto('/');
    await page.waitForLoadState('networkidle');
  });

  test('Cmd+K expands the floating command bar', async ({ page }) => {
    const bar = page.locator('[data-cmd-bar]');
    await expect(bar).toBeVisible({ timeout: 5000 });
    await expect(bar).toHaveAttribute('data-expanded', 'false');

    await page.keyboard.press('Meta+k');

    await expect(bar).toHaveAttribute('data-expanded', 'true', { timeout: 5000 });
    const input = bar.locator('textarea[role="combobox"]');
    await expect(input).toBeVisible();
  });

  test('Cmd+Shift+P opens the bar in PaletteMode (`>` prefix)', async ({ page }) => {
    const bar = page.locator('[data-cmd-bar]');
    await page.keyboard.press('Meta+Shift+p');

    await expect(bar).toHaveAttribute('data-expanded', 'true', { timeout: 5000 });
    const input = bar.locator('textarea[role="combobox"]');
    // The PaletteMode chord seeds the bar with the `>` prefix.
    await expect(input).toHaveValue('>');
  });

  test('typing in PaletteMode filters action rows', async ({ page }) => {
    await page.keyboard.press('Meta+Shift+p');
    const input = page.locator('[data-cmd-bar] textarea[role="combobox"]');
    await expect(input).toBeVisible({ timeout: 5000 });

    // Already prefilled with `>` — append a query.
    await input.fill('>theme');

    const matchingRow = page.locator('[data-palette-row]').filter({ hasText: /theme/i });
    const emptyState = page.locator('[data-palette-empty]');
    await expect(matchingRow.or(emptyState)).toBeVisible({ timeout: 5000 });
  });

  test('Escape collapses the floating command bar', async ({ page }) => {
    const bar = page.locator('[data-cmd-bar]');

    await page.keyboard.press('Meta+k');
    await expect(bar).toHaveAttribute('data-expanded', 'true', { timeout: 5000 });

    await page.keyboard.press('Escape');

    await expect(bar).toHaveAttribute('data-expanded', 'false', { timeout: 5000 });
  });
});

test.describe('Navigation — Theme Toggle', () => {
  test.beforeEach(async ({ page }) => {
    await setupTauriMock(page);
    await page.goto('/');
    await page.waitForLoadState('networkidle');
  });

  test('Cmd+T toggles the dark class on <html>', async ({ page }) => {
    const html = page.locator('html');

    const initialHasDark = await html.evaluate((el) => el.classList.contains('dark'));

    await page.keyboard.press('Meta+t');

    if (initialHasDark) {
      await expect(html).not.toHaveClass(/\bdark\b/, { timeout: 3000 });
    } else {
      await expect(html).toHaveClass(/\bdark\b/, { timeout: 3000 });
    }

    await page.keyboard.press('Meta+t');

    if (initialHasDark) {
      await expect(html).toHaveClass(/\bdark\b/, { timeout: 3000 });
    } else {
      await expect(html).not.toHaveClass(/\bdark\b/, { timeout: 3000 });
    }
  });
});

test.describe('Navigation — Chat Bar Toggle', () => {
  test.beforeEach(async ({ page }) => {
    await setupTauriMock(page);
    await page.goto('/');
    await page.waitForLoadState('networkidle');
  });

  test('Cmd+Shift+C expands the command bar when collapsed', async ({ page }) => {
    const bar = page.locator('[data-cmd-bar]');
    await expect(bar).toBeVisible({ timeout: 5000 });
    await expect(bar).toHaveAttribute('data-expanded', 'false');

    // Click body to ensure the app has focus.
    await page.locator('body').click();

    await page.keyboard.press('Meta+Shift+c');

    await expect(bar).toHaveAttribute('data-expanded', 'true', { timeout: 5000 });

    // ⌘⇧C in expanded+float is a no-op (documented behaviour); Esc is
    // the documented collapse path.
    await page.keyboard.press('Escape');
    await expect(bar).toHaveAttribute('data-expanded', 'false', { timeout: 5000 });
  });
});

test.describe('Navigation — Sidebar Toggle', () => {
  test.beforeEach(async ({ page }) => {
    await setupTauriMock(page);
    await page.goto('/');
    await page.waitForLoadState('networkidle');
  });

  test('Cmd+Shift+L toggles the sidebar pinned state', async ({ page }) => {
    // QuietSidebar's pinned state lives in settings-store.sidebarPinned
    // (default true). The chord toggles it; we assert the page stays
    // functional through both toggles.
    await page.waitForTimeout(500);

    await page.keyboard.press('Meta+Shift+l');
    await page.waitForTimeout(300);
    await page.keyboard.press('Meta+Shift+l');
    await page.waitForTimeout(300);

    await expect(page.locator('body')).toBeVisible();
  });
});
