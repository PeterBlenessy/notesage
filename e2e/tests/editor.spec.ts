import { test, expect } from '@playwright/test';
import { setupTauriMock } from '../fixtures/tauri-mock';
import { SAMPLE_PROJECT_PATH } from '../fixtures/sample-data';

/**
 * Pre-seed workspace-store so the sidebar renders a file tree on startup.
 */
async function injectWorkspaceState(page: import('@playwright/test').Page): Promise<void> {
  await page.addInitScript(
    ({ projectPath }) => {
      const state = {
        state: {
          explorerFolders: [{ path: projectPath }],
          projects: [],
          recentProjects: [],
          notesTree: [],
          expandedFolders: [],
          explorerCollapsed: false,
          projectsCollapsed: false,
          notesCollapsed: false,
        },
        version: 0,
      };
      localStorage.setItem('notesage-workspace', JSON.stringify(state));
    },
    { projectPath: SAMPLE_PROJECT_PATH },
  );
}

/**
 * Expand the folder in sidebar and click a file to open it in the editor.
 */
async function openFileInEditor(
  page: import('@playwright/test').Page,
  fileName: string,
  /**
   * Optional text known to be present in the file's content. When provided,
   * the helper waits for it to actually appear in the editor — guarding
   * against the race where `.ProseMirror[contenteditable]` is visible
   * from app start (empty editor) but the file's content hasn't streamed
   * in yet. Phase 3b's parse cache + streaming hydrate is async, so this
   * is more important than it used to be.
   */
  expectedText?: string,
) {
  // Click the folder name to expand and load the file tree
  const folderName = page.getByText('notesage-e2e-project', { exact: true }).first();
  if (await folderName.isVisible()) {
    await folderName.click();
  }

  // Wait for the file tree to populate
  await page.waitForFunction(
    (name) => document.body.textContent?.includes(name),
    fileName,
    { timeout: 10000 },
  );

  // Click the file
  await page.getByText(fileName, { exact: true }).first().click();

  // Wait for the ProseMirror editor to appear
  await expect(page.locator('.ProseMirror[contenteditable="true"]')).toBeVisible({ timeout: 5000 });

  // Wait for the file's actual content to land in the editor.
  // Without this, tests can interact with the empty editor before the
  // worker parse + streaming hydrate completes for the clicked file.
  if (expectedText) {
    await expect(page.locator('.ProseMirror[contenteditable="true"]'))
      .toContainText(expectedText, { timeout: 5000 });
  }
}

test.describe('Editor', () => {
  test.beforeEach(async ({ page }) => {
    await setupTauriMock(page);
    await injectWorkspaceState(page);
    await page.goto('/');
    // Wait for React to mount
    await page.waitForFunction(
      () => {
        const root = document.getElementById('root');
        return root && root.children.length > 0;
      },
      { timeout: 10000 },
    );
  });

  test('type text in editor and content updates', async ({ page }) => {
    await openFileInEditor(page, 'welcome.md', 'Welcome to Notesage');

    const editor = page.locator('.ProseMirror[contenteditable="true"]');

    // Click at the end of the editor content to place cursor
    await editor.click();

    // Press End to go to end of current line, then Enter for a new line
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');

    // Type some text
    await page.keyboard.type('Hello from Playwright test');

    // Verify the typed text appears in the editor
    await expect(editor).toContainText('Hello from Playwright test');
  });

  test('typing / triggers slash command menu', async ({ page }) => {
    await openFileInEditor(page, 'welcome.md', 'Welcome to Notesage');

    const editor = page.locator('.ProseMirror[contenteditable="true"]');

    // Click the editor and move to end, then create a new empty paragraph
    await editor.click();
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');

    // Type "/" at the start of the new line to trigger slash commands
    await page.keyboard.type('/');

    // The slash command menu should appear as a popup with command items
    // It renders a div with min-w-[240px] containing buttons like "Heading 1"
    const slashMenu = page.locator('[class*="min-w-\\[240px\\]"]').or(
      page.locator('.tippy-content'),
    );
    await expect(slashMenu.first()).toBeVisible({ timeout: 3000 });

    // Verify at least one command item is listed — use the slash menu item (has "Large section" description)
    await expect(page.getByRole('button', { name: /Heading 1.*Large section/ })).toBeVisible({ timeout: 2000 });
  });

  test('select heading from slash command menu inserts heading', async ({ page }) => {
    await openFileInEditor(page, 'welcome.md', 'Welcome to Notesage');

    const editor = page.locator('.ProseMirror[contenteditable="true"]');

    // Create a new line and trigger slash commands
    await editor.click();
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');
    await page.keyboard.type('/');

    // Wait for the slash command menu to appear
    const heading1Item = page.getByRole('button', { name: /Heading 1.*Large section/ });
    await expect(heading1Item).toBeVisible({ timeout: 3000 });

    // Click "Heading 1" to insert it
    await heading1Item.click();

    // The editor should now contain an h1 element (the slash command converts the paragraph to a heading)
    // Type some text into the new heading
    await page.keyboard.type('Test Heading');

    // Verify an h1 with our text exists in the editor
    const heading = editor.locator('h1');
    await expect(heading.filter({ hasText: 'Test Heading' })).toBeVisible({ timeout: 2000 });
  });

  test('Cmd+F opens the find bar', async ({ page }) => {
    await openFileInEditor(page, 'welcome.md', 'Welcome to Notesage');

    // Press Cmd+F to open the find bar
    await page.keyboard.press('Meta+f');

    // The find bar has an input with aria-label "Find in document" and placeholder "Find..."
    const findInput = page.locator('input[aria-label="Find in document"]');
    await expect(findInput).toBeVisible({ timeout: 3000 });
    await expect(findInput).toBeFocused();
  });

  test('typing search query highlights matches', async ({ page }) => {
    await openFileInEditor(page, 'welcome.md', 'Welcome to Notesage');

    // Open find bar
    await page.keyboard.press('Meta+f');

    const findInput = page.locator('input[aria-label="Find in document"]');
    await expect(findInput).toBeVisible({ timeout: 3000 });

    // Type a search query that should match content in welcome.md
    // welcome.md contains "sample" in "This is a sample note for E2E testing."
    await findInput.fill('sample');

    // Wait for the match count to update — it shows "X of Y" when matches are found
    // The match label span contains text like "1 of 1"
    const matchLabel = page.locator('text=/\\d+ of \\d+/');
    await expect(matchLabel).toBeVisible({ timeout: 3000 });

    // Verify the match count is at least 1
    const matchText = await matchLabel.textContent();
    expect(matchText).toMatch(/\d+ of \d+/);
    const totalMatches = parseInt(matchText!.split(' of ')[1], 10);
    expect(totalMatches).toBeGreaterThanOrEqual(1);
  });

  test('Escape closes the find bar', async ({ page }) => {
    await openFileInEditor(page, 'welcome.md', 'Welcome to Notesage');

    // Open find bar
    await page.keyboard.press('Meta+f');

    const findInput = page.locator('input[aria-label="Find in document"]');
    await expect(findInput).toBeVisible({ timeout: 3000 });

    // Press Escape to close the find bar
    await page.keyboard.press('Escape');

    // The find bar should no longer be visible
    await expect(findInput).not.toBeVisible({ timeout: 3000 });
  });
});
