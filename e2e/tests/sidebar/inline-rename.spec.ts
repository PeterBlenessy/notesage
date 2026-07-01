import { test, expect, type Page } from '@playwright/test';
import { setupTauriMock, trackInvokeCalls } from '../../fixtures/tauri-mock';
import { SAMPLE_PROJECT_PATH, SAMPLE_FILE_TREE } from '../../fixtures/sample-data';

/**
 * Sidebar inline-rename E2E coverage (QuietSidebar / ProjectsSection).
 *
 * The real WKWebView E2E harness (e2e-real) can't drive React-controlled
 * text inputs, so the inline-edit text-entry flows are covered here under
 * Chromium where Playwright can type into the `<input>` directly.
 *
 * Trigger surface (verified against source):
 *   - Rename is started by a row-level F2 keypress (files) or a double-click
 *     (files + non-system folders) — `ChildRow.handleRowKeyDown` /
 *     `handleRowClick` in `ProjectsSection.tsx`. Both call `onStartRename`,
 *     which flips `renamingPath` and renders a `SidebarInlineEdit`
 *     (`aria-label="Rename"`).
 *   - Commit-on-Enter calls `commitRename` → `useFileOperations.renamePath`
 *     → `tauriApi.renamePath` → invoke('rename_path', { oldPath, newPath }).
 *   - Cancel-on-Esc / empty-input call `onCancel`, which never invokes
 *     `rename_path`.
 *   - `validateRenameBasename` rejects names containing `/` with the message
 *     "Name cannot contain slashes" rendered in a `role="alert"` element.
 *
 * The mock's `rename_path` returns success without touching a filesystem, so
 * we assert the command was INVOKED with the right args via `trackInvokeCalls`.
 */

/**
 * Seed the workspace-store with a project so the Projects section renders.
 * Mirrors `injectWorkspaceState` in file-operations.spec.ts — the Zustand
 * persist merge keeps the inline `fileTree`, so the rows are available
 * without an extra list_directory round-trip.
 */
async function injectWorkspaceState(page: Page): Promise<void> {
  await page.addInitScript(
    ({ projectPath, fileTree }) => {
      const state = {
        state: {
          explorerFolders: [],
          projects: [{ path: projectPath, fileTree }],
          recentProjects: [],
          notesTree: [],
          pinnedFiles: [],
          expandedFolders: [projectPath],
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
 * Expand the project so its child file rows render, then return the locator
 * for a specific child file row (a `[role="treeitem"]` whose accessible name
 * is "Open file <name>").
 */
async function expandProjectAndGetFileRow(page: Page, fileName: string) {
  const projectRow = page.getByRole('treeitem', {
    name: new RegExp(`Open project notesage-e2e-project`, 'i'),
  });
  await expect(projectRow).toBeVisible({ timeout: 10000 });

  // Click the project row to inline-expand it (click toggles expand).
  await projectRow.click();

  const fileRow = page.getByRole('treeitem', {
    name: `Open file ${fileName}`,
  });
  await expect(fileRow).toBeVisible({ timeout: 10000 });
  return fileRow;
}

test.describe('Sidebar — inline rename', () => {
  test.beforeEach(async ({ page }) => {
    await setupTauriMock(page);
    await injectWorkspaceState(page);
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    // Wait for React to mount.
    await page.waitForFunction(
      () => {
        const root = document.getElementById('root');
        return !!root && root.children.length > 0;
      },
      { timeout: 10000 },
    );
  });

  test('F2 on a file row shows an inline rename input', async ({ page }) => {
    const fileRow = await expandProjectAndGetFileRow(page, 'welcome.md');

    await fileRow.focus();
    await page.keyboard.press('F2');

    // The inline edit renders with aria-label="Rename" and is pre-filled with
    // the current filename, all selected.
    const renameInput = page.getByRole('textbox', { name: 'Rename' });
    await expect(renameInput).toBeVisible({ timeout: 5000 });
    await expect(renameInput).toHaveValue('welcome.md');
  });

  test('typing a new name + Enter invokes rename_path with old and new paths', async ({ page }) => {
    const fileRow = await expandProjectAndGetFileRow(page, 'welcome.md');

    await fileRow.focus();
    await page.keyboard.press('F2');

    const renameInput = page.getByRole('textbox', { name: 'Rename' });
    await expect(renameInput).toBeVisible({ timeout: 5000 });

    // Start tracking invokes only after the rename input is open so we don't
    // capture unrelated startup traffic.
    const getCalls = await trackInvokeCalls(page);

    // Replace the selected name and commit.
    await renameInput.fill('renamed-note');
    await renameInput.press('Enter');

    await page.waitForFunction(
      () => {
        const log = (window as Record<string, unknown>).__TAURI_INVOKE_LOG__ as
          | Array<{ cmd: string }>
          | undefined;
        return log?.some((c) => c.cmd === 'rename_path');
      },
      { timeout: 5000 },
    );

    const calls = await getCalls();
    const renameCalls = calls.filter((c) => c.cmd === 'rename_path');
    expect(renameCalls.length).toBeGreaterThanOrEqual(1);

    // The original extension (.md) is preserved by resolveRenamePath when the
    // typed name has none.
    const args = renameCalls[renameCalls.length - 1].args as {
      oldPath?: string;
      newPath?: string;
    };
    expect(args.oldPath).toBe(`${SAMPLE_PROJECT_PATH}/welcome.md`);
    expect(args.newPath).toBe(`${SAMPLE_PROJECT_PATH}/renamed-note.md`);
  });

  test('Esc cancels rename — no rename_path call, original name stays', async ({ page }) => {
    const fileRow = await expandProjectAndGetFileRow(page, 'welcome.md');

    await fileRow.focus();
    await page.keyboard.press('F2');

    const renameInput = page.getByRole('textbox', { name: 'Rename' });
    await expect(renameInput).toBeVisible({ timeout: 5000 });

    const getCalls = await trackInvokeCalls(page);

    // Type something, then bail out with Escape.
    await renameInput.fill('should-not-commit');
    await renameInput.press('Escape');

    // The input closes...
    await expect(renameInput).toBeHidden({ timeout: 5000 });
    // ...and the original row reappears unchanged.
    await expect(
      page.getByRole('treeitem', { name: 'Open file welcome.md' }),
    ).toBeVisible();

    // Give any (incorrect) async invoke a beat to land, then assert none did.
    await page.waitForTimeout(300);
    const calls = await getCalls();
    expect(calls.filter((c) => c.cmd === 'rename_path')).toHaveLength(0);
  });

  test('invalid name (slash) surfaces an error and does not invoke rename_path', async ({ page }) => {
    const fileRow = await expandProjectAndGetFileRow(page, 'welcome.md');

    await fileRow.focus();
    await page.keyboard.press('F2');

    const renameInput = page.getByRole('textbox', { name: 'Rename' });
    await expect(renameInput).toBeVisible({ timeout: 5000 });

    const getCalls = await trackInvokeCalls(page);

    // A slash is rejected by validateRenameBasename — the input stays open and
    // a role="alert" error appears. Enter does NOT commit.
    await renameInput.fill('bad/name');
    await renameInput.press('Enter');

    const error = page.getByRole('alert');
    await expect(error).toBeVisible({ timeout: 5000 });
    await expect(error).toContainText(/slash/i);

    // The input remains open (validation kept it from committing).
    await expect(renameInput).toBeVisible();

    await page.waitForTimeout(300);
    const calls = await getCalls();
    expect(calls.filter((c) => c.cmd === 'rename_path')).toHaveLength(0);
  });
});
