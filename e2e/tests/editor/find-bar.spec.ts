/**
 * Editor — find bar.
 *
 * Covers: opening, searching, and closing the find bar.
 */
import { tauriTest, expect, openFileInEditor } from '../../fixtures';

tauriTest.describe('Editor — find bar', () => {
  tauriTest.beforeEach(async ({ waitForAppReady }) => {
    await waitForAppReady();
  });

  tauriTest('Cmd+F opens the find bar', async ({ page }) => {
    await openFileInEditor(page, 'welcome.md', 'Welcome to Notesage');

    await page.keyboard.press('Meta+f');

    const findInput = page.locator('input[aria-label="Find in document"]');
    await expect(findInput).toBeVisible({ timeout: 3000 });
    await expect(findInput).toBeFocused();
  });

  tauriTest('typing search query highlights matches', async ({ page }) => {
    await openFileInEditor(page, 'welcome.md', 'Welcome to Notesage');

    await page.keyboard.press('Meta+f');

    const findInput = page.locator('input[aria-label="Find in document"]');
    await expect(findInput).toBeVisible({ timeout: 3000 });

    await findInput.fill('sample');

    const matchLabel = page.locator('text=/\\d+ of \\d+/');
    await expect(matchLabel).toBeVisible({ timeout: 3000 });

    const matchText = await matchLabel.textContent();
    expect(matchText).toMatch(/\d+ of \d+/);
    const totalMatches = parseInt(matchText!.split(' of ')[1], 10);
    expect(totalMatches).toBeGreaterThanOrEqual(1);
  });

  tauriTest('Escape closes the find bar', async ({ page }) => {
    await openFileInEditor(page, 'welcome.md', 'Welcome to Notesage');

    await page.keyboard.press('Meta+f');

    const findInput = page.locator('input[aria-label="Find in document"]');
    await expect(findInput).toBeVisible({ timeout: 3000 });

    await page.keyboard.press('Escape');

    await expect(findInput).not.toBeVisible({ timeout: 3000 });
  });
});
