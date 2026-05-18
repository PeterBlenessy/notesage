/**
 * Editor — slash command menu.
 *
 * Covers: triggering the slash command menu and inserting block types.
 */
import { tauriTest, expect, openFileInEditor } from '../../fixtures';

tauriTest.describe('Editor — slash commands', () => {
  tauriTest.beforeEach(async ({ waitForAppReady }) => {
    await waitForAppReady();
  });

  tauriTest('typing / triggers slash command menu', async ({ page }) => {
    await openFileInEditor(page, 'welcome.md', 'Welcome to Notesage');

    const editor = page.locator('.ProseMirror[contenteditable="true"]');
    await editor.click();
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');
    await page.keyboard.type('/');

    const slashMenu = page.locator('[class*="min-w-\\[240px\\]"]').or(
      page.locator('.tippy-content'),
    );
    await expect(slashMenu.first()).toBeVisible({ timeout: 3000 });
    await expect(page.getByRole('button', { name: /Heading 1.*Large section/ })).toBeVisible({ timeout: 2000 });
  });

  tauriTest('select heading from slash command menu inserts heading', async ({ page }) => {
    await openFileInEditor(page, 'welcome.md', 'Welcome to Notesage');

    const editor = page.locator('.ProseMirror[contenteditable="true"]');
    await editor.click();
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');
    await page.keyboard.type('/');

    const heading1Item = page.getByRole('button', { name: /Heading 1.*Large section/ });
    await expect(heading1Item).toBeVisible({ timeout: 3000 });
    await heading1Item.click();

    await page.keyboard.type('Test Heading');

    const heading = editor.locator('h1');
    await expect(heading.filter({ hasText: 'Test Heading' })).toBeVisible({ timeout: 2000 });
  });
});
