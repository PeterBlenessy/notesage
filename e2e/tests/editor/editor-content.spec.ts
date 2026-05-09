/**
 * Editor — content rendering.
 *
 * Covers: opening files and verifying content is rendered correctly.
 */
import { tauriTest, expect, openFileInEditor } from '../../fixtures';

tauriTest.describe('Editor — content rendering', () => {
  tauriTest.beforeEach(async ({ waitForAppReady }) => {
    await waitForAppReady();
  });

  tauriTest('opens a markdown file and renders its content', async ({ page }) => {
    await openFileInEditor(page, 'welcome.md', 'Welcome to Notesage');

    const editor = page.locator('.ProseMirror[contenteditable="true"]');
    // The heading should be rendered as an h1
    await expect(editor.locator('h1').first()).toContainText('Welcome to Notesage');
  });

  tauriTest('renders list items from a markdown file', async ({ page }) => {
    await openFileInEditor(page, 'welcome.md', 'Welcome to Notesage');

    const editor = page.locator('.ProseMirror[contenteditable="true"]');
    // welcome.md has 3 list items
    await expect(editor.locator('li')).toHaveCount(3, { timeout: 5000 });
  });
});
