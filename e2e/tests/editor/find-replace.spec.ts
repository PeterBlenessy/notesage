/**
 * Editor — find AND replace.
 *
 * Covers the Cmd+Shift+H flow that opens the find bar with the replace row
 * already expanded, plus replace / replace-all / match navigation. This path
 * can't run under the real WKWebView E2E harness (it can't type into inputs),
 * so it lives here where Chromium drives the keyboard reliably.
 *
 * The `welcome.md` sample contains the repeated word "Item" three times
 * (`Item one`, `Item two`, `Item three`), which is what these tests
 * find/replace against.
 */
import { tauriTest, expect, openFileInEditor } from '../../fixtures';

const findInputSel = 'input[aria-label="Find in document"]';
const replaceInputSel = 'input[aria-label="Replace"]';

tauriTest.describe('Editor — find and replace', () => {
  tauriTest.beforeEach(async ({ waitForAppReady }) => {
    await waitForAppReady();
  });

  tauriTest('Cmd+Shift+H opens the find bar with the replace row visible', async ({ page }) => {
    await openFileInEditor(page, 'welcome.md', 'Welcome to Notesage');

    await page.keyboard.press('Meta+Shift+h');

    const findInput = page.locator(findInputSel);
    await expect(findInput).toBeVisible({ timeout: 3000 });
    await expect(findInput).toBeFocused();

    // The replace row is expanded by the Cmd+Shift+H entry point.
    const replaceInput = page.locator(replaceInputSel);
    await expect(replaceInput).toBeVisible({ timeout: 3000 });
  });

  tauriTest('typing a query highlights matches and shows a match count', async ({ page }) => {
    await openFileInEditor(page, 'welcome.md', 'Welcome to Notesage');

    await page.keyboard.press('Meta+Shift+h');

    const findInput = page.locator(findInputSel);
    await expect(findInput).toBeVisible({ timeout: 3000 });

    await findInput.fill('Item');

    const matchLabel = page.locator('text=/\\d+ of \\d+/');
    await expect(matchLabel).toBeVisible({ timeout: 3000 });

    const matchText = await matchLabel.textContent();
    expect(matchText).toMatch(/\d+ of \d+/);
    const totalMatches = parseInt(matchText!.split(' of ')[1], 10);
    // "Item" appears three times in welcome.md.
    expect(totalMatches).toBe(3);

    // Visual highlight decorations should be present.
    await expect(page.locator('.find-match').first()).toBeVisible({ timeout: 3000 });
  });

  tauriTest('Replace replaces a single occurrence', async ({ page }) => {
    await openFileInEditor(page, 'welcome.md', 'Welcome to Notesage');

    const editor = page.locator('.ProseMirror[contenteditable="true"]');
    await expect(editor).toContainText('Item one');

    await page.keyboard.press('Meta+Shift+h');

    const findInput = page.locator(findInputSel);
    await expect(findInput).toBeVisible({ timeout: 3000 });
    await findInput.fill('Item');

    const matchLabel = page.locator('text=/\\d+ of \\d+/');
    await expect(matchLabel).toBeVisible({ timeout: 3000 });

    const replaceInput = page.locator(replaceInputSel);
    await replaceInput.fill('Task');

    // Replace the current (first) match only.
    await page.locator('button[title^="Replace ("]').click();

    // One occurrence becomes "Task"; the rest stay "Item".
    await expect(editor).toContainText('Task one');
    await expect(editor).toContainText('Item two');
    await expect(editor).toContainText('Item three');

    // Match count drops from 3 to 2.
    await expect(page.locator('text=/\\d+ of 2/')).toBeVisible({ timeout: 3000 });
  });

  tauriTest('Replace All replaces every occurrence', async ({ page }) => {
    await openFileInEditor(page, 'welcome.md', 'Welcome to Notesage');

    const editor = page.locator('.ProseMirror[contenteditable="true"]');
    await expect(editor).toContainText('Item one');

    await page.keyboard.press('Meta+Shift+h');

    const findInput = page.locator(findInputSel);
    await expect(findInput).toBeVisible({ timeout: 3000 });
    await findInput.fill('Item');

    await expect(page.locator('text=/\\d+ of 3/')).toBeVisible({ timeout: 3000 });

    const replaceInput = page.locator(replaceInputSel);
    await replaceInput.fill('Task');

    await page.locator('button[title^="Replace All"]').click();

    // Every "Item" is replaced; none remain.
    await expect(editor).toContainText('Task one');
    await expect(editor).toContainText('Task two');
    await expect(editor).toContainText('Task three');
    await expect(editor).not.toContainText('Item');
  });

  tauriTest('Next and Previous navigate between matches', async ({ page }) => {
    await openFileInEditor(page, 'welcome.md', 'Welcome to Notesage');

    await page.keyboard.press('Meta+Shift+h');

    const findInput = page.locator(findInputSel);
    await expect(findInput).toBeVisible({ timeout: 3000 });
    await findInput.fill('Item');

    const matchLabel = page.locator('text=/\\d+ of 3/');
    await expect(matchLabel).toBeVisible({ timeout: 3000 });

    const readIndex = async (): Promise<number> => {
      const text = await matchLabel.textContent();
      return parseInt(text!.split(' of ')[0], 10);
    };

    const start = await readIndex();

    // Next advances the current-match index.
    await page.locator('button[aria-label="Next match"]').click();
    await expect
      .poll(async () => readIndex(), { timeout: 3000 })
      .not.toBe(start);
    const afterNext = await readIndex();

    // Previous returns to the starting index.
    await page.locator('button[aria-label="Previous match"]').click();
    await expect
      .poll(async () => readIndex(), { timeout: 3000 })
      .toBe(start);
    expect(afterNext).not.toBe(start);
  });

  tauriTest('Escape closes the find bar', async ({ page }) => {
    await openFileInEditor(page, 'welcome.md', 'Welcome to Notesage');

    await page.keyboard.press('Meta+Shift+h');

    const findInput = page.locator(findInputSel);
    await expect(findInput).toBeVisible({ timeout: 3000 });

    await page.keyboard.press('Escape');

    await expect(findInput).not.toBeVisible({ timeout: 3000 });
  });
});
