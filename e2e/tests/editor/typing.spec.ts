/**
 * Editor — typing behaviour.
 *
 * Covers: typing text in the editor and verifying content updates.
 */
import { tauriTest, expect, openFileInEditor } from '../../fixtures';

tauriTest.describe('Editor — typing', () => {
  tauriTest.beforeEach(async ({ waitForAppReady }) => {
    await waitForAppReady();
  });

  tauriTest('type text in editor and content updates', async ({ page }) => {
    await openFileInEditor(page, 'welcome.md', 'Welcome to Notesage');

    const editor = page.locator('.ProseMirror[contenteditable="true"]');
    await editor.click();
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');
    await page.keyboard.type('Hello from Playwright test');

    await expect(editor).toContainText('Hello from Playwright test');
  });
});
