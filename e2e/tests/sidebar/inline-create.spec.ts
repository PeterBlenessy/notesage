import { test, expect, type Page } from '@playwright/test';
import { setupTauriMock, trackInvokeCalls } from '../../fixtures/tauri-mock';
import { SAMPLE_PROJECT_PATH, SAMPLE_FILE_TREE } from '../../fixtures/sample-data';

/**
 * Sidebar inline-create E2E coverage (QuietSidebar / ProjectsSection).
 *
 * The real WKWebView E2E harness can't type into React-controlled inputs, so
 * the new-note / new-project text-entry flows are covered here under Chromium.
 *
 * Trigger surface (verified against source):
 *   - `⌘N` (new note) — `QuietLayout`'s capture-phase keydown handler resolves
 *     the active tab's parent dir via `resolveCreateParent`, then sets
 *     `quiet-sidebar-store.pendingCreate = { parentDir }`. `ProjectsSection`
 *     renders a `SidebarInlineEdit` (mode="create", `aria-label="Create"`)
 *     under the owning project. Commit appends `.md` if no extension, then
 *     `createFile` → invoke('create_file', { path }).
 *     IMPORTANT: `resolveCreateParent` returns null unless the ACTIVE TAB is a
 *     file inside an open project — `⌘N` with no active tab only toasts. So the
 *     note-create tests open a file first, then press `⌘N`.
 *   - The per-project `+` button (`aria-label="New note in <project>"`) sets
 *     `pendingCreate` to the project root directly — used here as a
 *     no-active-tab path to open the same inline create row.
 *   - `⌘⇧N` (new project) — `QuietLayout` sets
 *     `quiet-sidebar-store.pendingCreateProject = true`. `ProjectsSection`
 *     renders a top-of-list `SidebarInlineEdit` (`aria-label="Create"`).
 *     Commit calls `createFolder(libraryRoot, name)` →
 *     invoke('create_directory', { path }). The commit bails with a toast if
 *     `notesRootPath` still carries a leading `~`, so we seed an absolute
 *     library root in settings-store.
 *
 * The mock returns success for `create_file` / `create_directory` without
 * touching a filesystem, so we assert the command was INVOKED with the right
 * args via `trackInvokeCalls`.
 */

const LIBRARY_ROOT = '/tmp/notesage-e2e-home/Notesage';

/**
 * Seed the workspace-store with a project so the Projects section renders.
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
 * Seed an ABSOLUTE notesRootPath into settings-store so the project-create
 * commit doesn't bail on the leading-`~` guard. We only set the single field
 * the flow reads; the persist `merge` fills in every other default.
 */
async function injectAbsoluteLibraryRoot(page: Page, libraryRoot: string): Promise<void> {
  await page.addInitScript(
    ({ libraryRoot }) => {
      localStorage.setItem(
        'notesage-settings',
        JSON.stringify({ state: { notesRootPath: libraryRoot }, version: 21 }),
      );
    },
    { libraryRoot },
  );
}

/** Expand the project and return the project treeitem row. */
async function getProjectRow(page: Page) {
  const projectRow = page.getByRole('treeitem', {
    name: /Open project notesage-e2e-project/i,
  });
  await expect(projectRow).toBeVisible({ timeout: 10000 });
  return projectRow;
}

/** Open a file so an active tab exists inside the project (required by ⌘N). */
async function openSampleFile(page: Page): Promise<void> {
  const projectRow = await getProjectRow(page);
  await projectRow.click(); // inline-expand
  const fileRow = page.getByRole('treeitem', { name: 'Open file welcome.md' });
  await expect(fileRow).toBeVisible({ timeout: 10000 });
  await fileRow.click();
  await expect(page.locator('.ProseMirror')).toContainText('Welcome to Notesage', {
    timeout: 10000,
  });
}

test.describe('Sidebar — inline create', () => {
  test.beforeEach(async ({ page }) => {
    await setupTauriMock(page);
    await injectWorkspaceState(page);
    await injectAbsoluteLibraryRoot(page, LIBRARY_ROOT);
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.waitForFunction(
      () => {
        const root = document.getElementById('root');
        return !!root && root.children.length > 0;
      },
      { timeout: 10000 },
    );
  });

  test('Cmd+N opens an inline create row under the active project', async ({ page }) => {
    // ⌘N resolves the parent from the active tab — open a file first.
    await openSampleFile(page);

    // Press ⌘N. The handler is capture-phase at window level; pressing from
    // the body (not a text input) lets it fire. Click the project row first to
    // move focus out of the editor's contenteditable (⌘N is skipped while a
    // text input / contentEditable is focused).
    await (await getProjectRow(page)).focus();
    await page.keyboard.press('Meta+n');

    const createInput = page.getByRole('textbox', { name: 'Create' });
    await expect(createInput).toBeVisible({ timeout: 5000 });
    // Create mode starts empty.
    await expect(createInput).toHaveValue('');
  });

  test('typing a note name + Enter invokes create_file under the project', async ({ page }) => {
    await openSampleFile(page);

    await (await getProjectRow(page)).focus();
    await page.keyboard.press('Meta+n');

    const createInput = page.getByRole('textbox', { name: 'Create' });
    await expect(createInput).toBeVisible({ timeout: 5000 });

    const getCalls = await trackInvokeCalls(page);

    await createInput.fill('my-new-note');
    await createInput.press('Enter');

    await page.waitForFunction(
      () => {
        const log = (window as Record<string, unknown>).__TAURI_INVOKE_LOG__ as
          | Array<{ cmd: string }>
          | undefined;
        return log?.some((c) => c.cmd === 'create_file');
      },
      { timeout: 5000 },
    );

    const calls = await getCalls();
    const createCalls = calls.filter((c) => c.cmd === 'create_file');
    expect(createCalls.length).toBeGreaterThanOrEqual(1);

    // `.md` is appended when the typed name has no extension. The parent dir is
    // the active tab's directory (the project root, since welcome.md sits at
    // the project root).
    const args = createCalls[createCalls.length - 1].args as { path?: string };
    expect(args.path).toBe(`${SAMPLE_PROJECT_PATH}/my-new-note.md`);
  });

  test('the per-project "+" button also opens an inline create row', async ({ page }) => {
    // Independent of ⌘N: hovering a project row reveals a "New note in
    // <project>" button that sets pendingCreate to the project root. This is
    // the no-active-tab path to the same inline create surface.
    const projectRow = await getProjectRow(page);
    await projectRow.click(); // expand so the row + its + button are present
    await expect(
      page.getByRole('treeitem', { name: 'Open file welcome.md' }),
    ).toBeVisible({ timeout: 10000 });

    const addButton = page.getByRole('button', {
      name: /New note in notesage-e2e-project/i,
    });
    // The button is hover-revealed (opacity-0 until hover); force the click
    // since Playwright's actionability check can race the opacity transition.
    await addButton.click({ force: true });

    const createInput = page.getByRole('textbox', { name: 'Create' });
    await expect(createInput).toBeVisible({ timeout: 5000 });

    const getCalls = await trackInvokeCalls(page);
    await createInput.fill('from-plus-button');
    await createInput.press('Enter');

    await page.waitForFunction(
      () => {
        const log = (window as Record<string, unknown>).__TAURI_INVOKE_LOG__ as
          | Array<{ cmd: string }>
          | undefined;
        return log?.some((c) => c.cmd === 'create_file');
      },
      { timeout: 5000 },
    );

    const calls = await getCalls();
    const createCalls = calls.filter((c) => c.cmd === 'create_file');
    const args = createCalls[createCalls.length - 1].args as { path?: string };
    // The + button routes the create to the project ROOT.
    expect(args.path).toBe(`${SAMPLE_PROJECT_PATH}/from-plus-button.md`);
  });

  test('Cmd+Shift+N opens a new-project row; typing + Enter invokes create_directory', async ({ page }) => {
    // No active tab required for project create. Focus a non-input element so
    // the capture-phase handler isn't skipped by the text-input guard.
    await (await getProjectRow(page)).focus();
    await page.keyboard.press('Meta+Shift+n');

    const createInput = page.getByRole('textbox', { name: 'Create' });
    await expect(createInput).toBeVisible({ timeout: 5000 });

    const getCalls = await trackInvokeCalls(page);

    await createInput.fill('Fresh Project');
    await createInput.press('Enter');

    await page.waitForFunction(
      () => {
        const log = (window as Record<string, unknown>).__TAURI_INVOKE_LOG__ as
          | Array<{ cmd: string }>
          | undefined;
        return log?.some((c) => c.cmd === 'create_directory');
      },
      { timeout: 5000 },
    );

    const calls = await getCalls();
    const dirCalls = calls.filter((c) => c.cmd === 'create_directory');
    expect(dirCalls.length).toBeGreaterThanOrEqual(1);

    // Project bootstrap fires multiple create_directory calls — the project
    // root AND its `.notesage` metadata subdir. Assert the project root is
    // among them (don't assume ordering / which is last).
    const dirPaths = dirCalls.map((c) => (c.args as { path?: string }).path);
    expect(dirPaths).toContain(`${LIBRARY_ROOT}/Fresh Project`);
  });

  test('Esc cancels project create — no create command invoked', async ({ page }) => {
    await (await getProjectRow(page)).focus();
    await page.keyboard.press('Meta+Shift+n');

    const createInput = page.getByRole('textbox', { name: 'Create' });
    await expect(createInput).toBeVisible({ timeout: 5000 });

    const getCalls = await trackInvokeCalls(page);

    await createInput.fill('Should Not Create');
    await createInput.press('Escape');

    await expect(createInput).toBeHidden({ timeout: 5000 });

    await page.waitForTimeout(300);
    const calls = await getCalls();
    expect(
      calls.filter(
        (c) => c.cmd === 'create_directory' || c.cmd === 'create_file',
      ),
    ).toHaveLength(0);
  });
});
