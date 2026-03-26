import { test, expect } from '@playwright/test';
import { setupTauriMock, trackInvokeCalls } from '../fixtures/tauri-mock';
import { SAMPLE_PROJECT_PATH, SAMPLE_FILES, SAMPLE_FILE_TREE } from '../fixtures/sample-data';

/**
 * Helper to inject an explorer folder into the workspace-store so the sidebar
 * renders a file tree. The workspace-store uses Zustand persist with the key
 * "notesage-workspace", so we write directly to localStorage before the store
 * rehydrates. Because setupTauriMock's addInitScript runs before the app boots,
 * we can also use addInitScript for this.
 */
async function injectWorkspaceState(page: import('@playwright/test').Page): Promise<void> {
  await page.addInitScript(
    ({ projectPath }) => {
      // Pre-seed the workspace with the explorer folder path.
      // The file tree will be loaded via list_directory when we trigger a refresh.
      const state = {
        state: {
          explorerFolders: [{ path: projectPath }],
          projects: [],
          recentProjects: [],
          notesTree: [],
          expandedFolders: [projectPath],
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
 * Ensure the file tree is loaded and visible. The Zustand persist merge
 * strips fileTree from explorer folders, so we need to trigger list_directory
 * by clicking the folder to expand it, or by programmatically calling
 * the store's refreshExplorerFolder method.
 */
async function waitForFileTree(page: import('@playwright/test').Page): Promise<void> {
  // The folder name should be visible in the sidebar — click it to expand and load the tree
  const folderName = page.getByText('notesage-e2e-project', { exact: true }).first();
  await expect(folderName).toBeVisible({ timeout: 5000 });
  await folderName.click();

  // Wait for file items to appear (list_directory is called on expand)
  await page.waitForFunction(
    () => document.body.textContent?.includes('welcome.md'),
    { timeout: 10000 },
  );
}

test.describe('File operations', () => {
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

  test.describe('Sidebar file click opens file in editor', () => {
    test('clicking a file in the sidebar shows its content in the editor', async ({ page }) => {
      await waitForFileTree(page);

      // Click on welcome.md in the sidebar
      const fileItem = page.getByText('welcome.md', { exact: true }).first();
      await fileItem.click();

      // Wait for the editor content area to appear and contain the file's content
      // Tiptap renders into a .ProseMirror div inside #editor-content
      const editorContent = page.locator('#editor-content .ProseMirror');
      await expect(editorContent).toBeVisible({ timeout: 10000 });

      // The welcome.md file has "Welcome to Notesage" as the H1
      await expect(editorContent).toContainText('Welcome to Notesage');
    });
  });

  test.describe('Opening a second file creates a new tab', () => {
    test('opening two files shows two tabs', async ({ page }) => {
      await waitForFileTree(page);

      // Open the first file
      await page.getByText('welcome.md', { exact: true }).first().click();
      const editorContent = page.locator('#editor-content .ProseMirror');
      await expect(editorContent).toContainText('Welcome to Notesage', { timeout: 10000 });

      // Open a second file
      await page.getByText('todo.md', { exact: true }).first().click();
      await expect(editorContent).toContainText('Todo List', { timeout: 10000 });

      // Both tabs should be visible in the tab bar
      // TabBar renders buttons with the filename text
      const welcomeTab = page.getByRole('button', { name: /welcome\.md/ }).first();
      const todoTab = page.getByRole('button', { name: /todo\.md/ }).first();
      await expect(welcomeTab).toBeVisible();
      await expect(todoTab).toBeVisible();
    });
  });

  test.describe('Switching tabs changes editor content', () => {
    test('clicking a tab switches the displayed content', async ({ page }) => {
      await waitForFileTree(page);

      // Open two files
      await page.getByText('welcome.md', { exact: true }).first().click();
      const editorContent = page.locator('#editor-content .ProseMirror');
      await expect(editorContent).toContainText('Welcome to Notesage', { timeout: 10000 });

      await page.getByText('todo.md', { exact: true }).first().click();
      await expect(editorContent).toContainText('Todo List', { timeout: 10000 });

      // Switch back to the first tab by clicking it
      const welcomeTab = page.getByRole('button', { name: /welcome\.md/ }).first();
      await welcomeTab.click();

      // Editor should now show welcome.md content again
      await expect(editorContent).toContainText('Welcome to Notesage', { timeout: 10000 });

      // Verify it no longer shows todo.md content
      await expect(editorContent).not.toContainText('Todo List');
    });
  });

  test.describe('Cmd+S triggers save', () => {
    test('pressing Cmd+S calls write_file with the correct path', async ({ page }) => {
      await waitForFileTree(page);

      // Open a file first
      await page.getByText('welcome.md', { exact: true }).first().click();
      const editorContent = page.locator('#editor-content .ProseMirror');
      await expect(editorContent).toContainText('Welcome to Notesage', { timeout: 10000 });

      // Start tracking invoke calls after the file is loaded
      // (to avoid noise from file loading calls)
      const getCalls = await trackInvokeCalls(page);

      // Press Cmd+S (Meta+S on macOS)
      await page.keyboard.press('Meta+s');

      // Give the app a moment to process the save
      await page.waitForTimeout(500);

      // Check that write_file was called
      const calls = await getCalls();
      const writeCalls = calls.filter((c) => c.cmd === 'write_file');

      expect(writeCalls.length).toBeGreaterThanOrEqual(1);

      // Verify the write_file call targets the correct file path
      const lastWriteCall = writeCalls[writeCalls.length - 1];
      const args = lastWriteCall.args as { path?: string; content?: string };
      expect(args.path).toBe(`${SAMPLE_PROJECT_PATH}/welcome.md`);

      // The content should be a string (markdown serialized from ProseMirror)
      expect(typeof args.content).toBe('string');
      expect((args.content as string).length).toBeGreaterThan(0);
    });
  });
});
