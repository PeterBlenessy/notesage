/**
 * Settings dialog search / filter (Playwright).
 *
 * Covers the Settings search text-entry flow, which the real WKWebView E2E
 * harness can't test (can't type into inputs). Chromium/WebKit type fine.
 *
 * Search model (SettingsDialogV2): a non-empty query switches the dialog into
 * a global cross-panel "leaf search" — every panel renders at once and each
 * `SettingsRow` self-hides when its label/description doesn't match. Matched
 * labels are wrapped in highlight segments, so assert row presence with
 * non-exact text matching. The sr-only `role="status"` readout shows
 * "N of M matches" (nav-label based) while a query is active.
 */
import { test, expect } from '@playwright/test';
import { setupTauriMock } from '../../fixtures/tauri-mock';

async function openSettings(page: import('@playwright/test').Page) {
    await page.keyboard.press('Meta+,');
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 10000 });
    return dialog;
}

test.describe('Settings — search / filter', () => {
    test.beforeEach(async ({ page }) => {
        await setupTauriMock(page);
        await page.goto('/');
        await page.waitForLoadState('networkidle');
    });

    test('Cmd+, opens the settings dialog with a search box', async ({ page }) => {
        const dialog = await openSettings(page);
        await expect(dialog.getByRole('searchbox')).toBeVisible({ timeout: 5000 });
    });

    test('typing a query filters settings rows to matches', async ({ page }) => {
        const dialog = await openSettings(page);
        await dialog.getByRole('searchbox').fill('Accent color');

        // The matching row (Appearance panel) stays; matched label text is
        // highlight-wrapped, so match non-exact.
        await expect(dialog.getByText('Accent color')).toBeVisible({ timeout: 5000 });
        // An unrelated row from another panel self-hides.
        await expect(dialog.getByText('Show in menu bar', { exact: true })).toHaveCount(0, {
            timeout: 5000,
        });
    });

    test('the result-count status reflects the query', async ({ page }) => {
        const dialog = await openSettings(page);
        const status = dialog.getByRole('status');

        await dialog.getByRole('searchbox').fill('Voice');
        await expect(status).toHaveText(/^1 of \d+ matches$/, { timeout: 5000 });

        await dialog.getByRole('searchbox').fill('zzqqxx-no-such-setting');
        await expect(status).toHaveText(/^0 of \d+ matches$/, { timeout: 5000 });
    });

    test('the clear button resets the search', async ({ page }) => {
        const dialog = await openSettings(page);
        const search = dialog.getByRole('searchbox');

        await search.fill('Accent color');
        await expect(dialog.getByText('Show in menu bar', { exact: true })).toHaveCount(0, {
            timeout: 5000,
        });

        // The clear button renders only while the query is non-empty.
        const clear = dialog.getByRole('button', { name: 'Clear search' });
        await expect(clear).toBeVisible();
        await clear.click();

        // Search resets: input empties, the clear button disappears, and the
        // dialog leaves leaf-search back to the single active panel (Appearance,
        // whose "Accent color" row is shown again).
        await expect(search).toHaveValue('');
        await expect(clear).toHaveCount(0);
        await expect(dialog.getByText('Accent color')).toBeVisible({ timeout: 5000 });
    });
});
