/**
 * Relations panel (OKF wiki-navigation) — smoke test.
 *
 * Verifies the panel mounts and renders against a mocked link graph: the
 * collapsed handle appears with the relation count when the active document has
 * relations, and opening it reveals both the "Links to" and "Linked from"
 * sections. Uses `browserTest` + an explicit `setupTauriMock` so we can inject
 * relations via `overrides` (the static value is returned for any path, so it
 * applies to whichever document we open).
 *
 * This is the headless-runnable counterpart to the unit tests — it catches
 * "the panel crashes on mount / never appears" failures that mocked unit tests
 * can't, without needing the real backend or a running Tauri app.
 */
import {
  browserTest as test,
  expect,
  openFileInEditor,
  SAMPLE_PROJECT_PATH,
} from '../../fixtures';
import { setupTauriMock } from '../../fixtures/tauri-mock';

const BACKLINK_GROUP = {
  source_path: `${SAMPLE_PROJECT_PATH}/notes.md`,
  source_title: 'Meeting Notes',
  source_type: 'note',
  source_description: 'Notes from the planning meeting.',
  occurrences: [
    { link_text: 'welcome', context: 'See the welcome guide for onboarding steps.' },
  ],
};

const FORWARD_LINK = {
  source_path: `${SAMPLE_PROJECT_PATH}/welcome.md`,
  target_path: `${SAMPLE_PROJECT_PATH}/todo.md`,
  link_text: 'todo list',
  context: 'Check the todo list to get started.',
  is_internal: true,
  resolved: true,
  target_title: 'Todo List',
  target_type: 'note',
  target_description: 'Outstanding tasks.',
};

/** Mirror of the fixture's private injectWorkspaceState so the sidebar renders. */
async function injectWorkspace(page: import('@playwright/test').Page): Promise<void> {
  await page.addInitScript((p) => {
    localStorage.setItem(
      'notesage-workspace',
      JSON.stringify({
        state: {
          explorerFolders: [{ path: p }],
          projects: [],
          recentProjects: [],
          notesTree: [],
          expandedFolders: [],
          explorerCollapsed: false,
          projectsCollapsed: false,
          notesCollapsed: false,
        },
        version: 0,
      }),
    );
  }, SAMPLE_PROJECT_PATH);
}

test.describe('Relations panel (OKF wiki-navigation)', () => {
  test('shows the handle with a count and opens both sections', async ({ page }) => {
    await setupTauriMock(page, {
      overrides: {
        get_backlinks: [BACKLINK_GROUP],
        get_outlinks: [FORWARD_LINK],
      },
    });
    await injectWorkspace(page);
    await page.goto('/');

    await openFileInEditor(page, 'welcome.md', 'Welcome to Notesage');

    // Collapsed handle appears with the total relation count (1 backlink + 1 forward).
    const handle = page.getByTestId('relations-handle');
    await expect(handle).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId('relations-handle-count')).toHaveText('2');

    // Opening it reveals both directions.
    await handle.click();
    const panel = page.getByTestId('relations-panel');
    await expect(panel).toBeVisible();
    await expect(panel.getByText('Links to')).toBeVisible();
    await expect(panel.getByText('Linked from')).toBeVisible();
    await expect(panel.getByText('Meeting Notes')).toBeVisible();
    await expect(panel.getByText('Todo List')).toBeVisible();
  });

  test('hides the handle when the document has no relations', async ({ page }) => {
    // Default mock handlers return empty relations.
    await setupTauriMock(page);
    await injectWorkspace(page);
    await page.goto('/');

    await openFileInEditor(page, 'welcome.md', 'Welcome to Notesage');

    // Give the relations query time to settle on empty, then assert no handle.
    await page.waitForTimeout(800);
    await expect(page.getByTestId('relations-handle')).toHaveCount(0);
  });
});
