import { test, expect } from '@playwright/test';
import { setupTauriMock, trackInvokeCalls } from '../fixtures/tauri-mock';
import { SAMPLE_PROJECT_PATH, SAMPLE_FILES, SAMPLE_FILE_TREE } from '../fixtures/sample-data';

/**
 * Helper to inject the workspace state so the QuietSidebar renders the
 * project with its file tree in the Projects section.
 *
 * The workspace-store uses Zustand persist with the key "notesage-workspace".
 * We write directly to localStorage before the store rehydrates so that on
 * boot the QuietSidebar's ProjectsSection already has the project registered
 * with a populated fileTree. This avoids needing to trigger list_directory
 * via a UI interaction before the file tree is visible.
 *
 * Note: the persist partialize function strips fileTree when the app writes
 * state back to localStorage, but injecting here bypasses that — the
 * rehydration merge reads `p.projects` directly, preserving our fileTree.
 */
async function injectWorkspaceState(page: import('@playwright/test').Page): Promise<void> {
  await page.addInitScript(
    ({ projectPath, fileTree }) => {
      // Pre-seed the workspace with the project path and its file tree.
      // QuietSidebar's ProjectsSection reads workspace-store.projects.
      const state = {
        state: {
          explorerFolders: [],
          projects: [{ path: projectPath, fileTree }],
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
    { projectPath: SAMPLE_PROJECT_PATH, fileTree: SAMPLE_FILE_TREE },
  );
}

/**
 * Ensure the file tree is loaded and visible in the QuietSidebar.
 *
 * The QuietSidebar ProjectsSection shows the project basename as a row.
 * Clicking the project row toggles inline expansion, revealing child file rows.
 * The fileTree is pre-seeded via injectWorkspaceState, so children appear
 * immediately after expansion without a list_directory round-trip.
 */
async function waitForFileTree(page: import('@playwright/test').Page): Promise<void> {
  // The project basename should be visible in the sidebar Projects section
  const projectRow = page.getByText('notesage-e2e-project', { exact: true }).first();
  await expect(projectRow).toBeVisible({ timeout: 5000 });
  await projectRow.click();

  // Wait for file items to appear (tree expands inline after click)
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

  test.describe('Opening a second file changes editor content', () => {
    test('opening two files shows each file\'s content in the editor', async ({ page }) => {
      await waitForFileTree(page);

      // Open the first file
      await page.getByText('welcome.md', { exact: true }).first().click();
      const editorContent = page.locator('#editor-content .ProseMirror');
      await expect(editorContent).toContainText('Welcome to Notesage', { timeout: 10000 });

      // Open a second file — editor should switch to its content
      await page.getByText('todo.md', { exact: true }).first().click();
      await expect(editorContent).toContainText('Todo List', { timeout: 10000 });
    });
  });

  test.describe('Switching files via sidebar changes editor content', () => {
    test('clicking a different file in the sidebar updates the editor', async ({ page }) => {
      await waitForFileTree(page);

      // Open the first file
      await page.getByText('welcome.md', { exact: true }).first().click();
      const editorContent = page.locator('#editor-content .ProseMirror');
      await expect(editorContent).toContainText('Welcome to Notesage', { timeout: 10000 });

      // Open a second file
      await page.getByText('todo.md', { exact: true }).first().click();
      await expect(editorContent).toContainText('Todo List', { timeout: 10000 });

      // Switch back to the first file by clicking it in the sidebar again
      await page.getByText('welcome.md', { exact: true }).first().click();

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

      // Type something to make the tab dirty — Cmd+S is a no-op on clean tabs
      await editorContent.click();
      await page.keyboard.type(' test');

      // Start tracking invoke calls after the edit
      // (to avoid noise from file loading calls)
      const getCalls = await trackInvokeCalls(page);

      // Press Cmd+S (Meta+S on macOS)
      await page.keyboard.press('Meta+s');

      // Wait for write_file to be called (poll instead of fixed timeout)
      await page.waitForFunction(
        () => {
          const log = (window as Record<string, unknown>).__TAURI_INVOKE_LOG__ as
            | Array<{ cmd: string }> | undefined;
          return log?.some((c) => c.cmd === 'write_file');
        },
        { timeout: 5000 },
      );

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
