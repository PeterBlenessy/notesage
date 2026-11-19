import { test, expect, type Page } from '@playwright/test';
import { setupTauriMock } from '../../fixtures/tauri-mock';

/**
 * A Mac that did NOT run the library move, launching after another Mac moved
 * `iCloud Drive/Notesage` into Notesage's own iCloud folder.
 *
 * Before the fix this Mac removed each of its library projects ("directory no
 * longer exists"), then the cross-device scan added back whatever the new
 * folder held — so it came up with the other Mac's project list, and a
 * project removed here returned on the next launch. With the new folder
 * unreadable, the sidebar came up empty with no explanation.
 */

const HOME = '/tmp/notesage-e2e-home';
const ICLOUD = `${HOME}/Library/Mobile Documents/com~apple~CloudDocs`;
const OLD = `${ICLOUD}/Notesage`;
const NEW = `${HOME}/Library/Mobile Documents/iCloud~com~notesage~app/Documents`;

/** Directories that exist → their children. */
const DISK: Record<string, string[]> = {
  [`${HOME}/Notesage`]: [],
  [OLD]: [],
  [NEW]: ['Work', 'Recipes', 'Home Only', 'Archive'],
  [`${NEW}/Work`]: ['plan.md', '.notesage'],
  [`${NEW}/Work/.notesage`]: [],
  [`${NEW}/Recipes`]: ['pie.md', '.notesage'],
  [`${NEW}/Recipes/.notesage`]: [],
  [`${NEW}/Home Only`]: ['.notesage'],
  [`${NEW}/Home Only/.notesage`]: [],
  [`${NEW}/Archive`]: ['.notesage'],
  [`${NEW}/Archive/.notesage`]: [],
};

/**
 * Layered over the shared mock: its overrides are fixed values, and this
 * scenario needs a listing that depends on the path asked for.
 */
async function setupLibraryDisk(page: Page, access: 'ready' | 'denied'): Promise<void> {
  await page.addInitScript(
    ({ disk, home, icloud, oldRoot, newRoot, access }) => {
      const state = {
        state: {
          explorerFolders: [],
          projects: [
            { path: `${oldRoot}/Work`, fileTree: [] },
            { path: `${oldRoot}/Recipes`, fileTree: [] },
          ],
          recentProjects: [],
          pinnedFiles: [],
          dismissedLibraryProjects: [`${oldRoot}/Archive`],
          notesTree: [],
          expandedFolders: [],
          explorerCollapsed: false,
          projectsCollapsed: false,
          notesCollapsed: false,
        },
        version: 0,
      };
      localStorage.setItem('notesage-workspace', JSON.stringify(state));

      const readable = (p: string) => access === 'ready' || !p.startsWith(newRoot);
      const exists = (p: string) => {
        if (!readable(p)) return false;
        if (p in disk) return true;
        const parent = p.slice(0, p.lastIndexOf('/'));
        return (disk[parent] ?? []).includes(p.slice(parent.length + 1));
      };
      const internals = (window as unknown as Record<string, { invoke: (c: string, a?: Record<string, unknown>) => Promise<unknown> }>).__TAURI_INTERNALS__;
      const base = internals.invoke;
      internals.invoke = async (cmd, args) => {
        const path = (args?.path ?? args?.root) as string | undefined;
        switch (cmd) {
          case 'get_home_dir':
            return home;
          case 'get_icloud_path':
            return icloud;
          case 'get_library_container_path':
            return newRoot;
          case 'library_container_access':
            return access;
          case 'read_library_marker':
            if (access !== 'ready') throw new Error('Operation not permitted');
            return {
              version: 1,
              kind: 'container',
              createdBy: 'ios',
              createdAt: '2026-11-01T00:00:00Z',
              migratedFrom: '/Users/home/Library/Mobile Documents/com~apple~CloudDocs/Notesage',
            };
          case 'path_exists':
            return path ? exists(path) : false;
          case 'list_directory': {
            if (!path || !(path in disk) || !readable(path)) {
              throw new Error(`No such directory: ${path}`);
            }
            return disk[path].map((name: string) => ({
              name,
              path: `${path}/${name}`,
              is_directory: `${path}/${name}` in disk,
              hidden: name.startsWith('.'),
            }));
          }
          default:
            return base(cmd, args);
        }
      };
    },
    { disk: DISK, home: HOME, icloud: ICLOUD, oldRoot: OLD, newRoot: NEW, access },
  );
}

async function boot(page: Page, access: 'ready' | 'denied'): Promise<void> {
  await setupTauriMock(page);
  await setupLibraryDisk(page, access);
  await page.goto('/');
  await page.waitForFunction(
    () => {
      const root = document.getElementById('root');
      return root && root.children.length > 0;
    },
    { timeout: 10000 },
  );
}

async function workspaceProjects(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const raw = localStorage.getItem('notesage-workspace');
    const parsed = raw ? JSON.parse(raw) : null;
    return ((parsed?.state?.projects ?? []) as { path: string }[]).map((p) => p.path);
  });
}

test.describe('Library moved by another Mac', () => {
  test('this Mac keeps its own projects, now in the new folder', async ({ page }) => {
    await boot(page, 'ready');

    await expect(page.getByText('Work', { exact: true }).first()).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('Recipes', { exact: true }).first()).toBeVisible();
    await expect(page.getByText(/no longer exists/)).toHaveCount(0);

    await expect.poll(() => workspaceProjects(page)).toEqual(
      expect.arrayContaining([`${NEW}/Work`, `${NEW}/Recipes`]),
    );
    const projects = await workspaceProjects(page);
    expect(projects.some((p) => p.startsWith(`${OLD}/`))).toBe(false);
  });

  test('a project removed on this Mac stays removed, a new one is still discovered', async ({ page }) => {
    await boot(page, 'ready');

    await expect(page.getByText('Home Only', { exact: true }).first()).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('Archive', { exact: true })).toHaveCount(0);
  });

  test('an unreadable new folder keeps the projects and says how to fix it', async ({ page }) => {
    await boot(page, 'denied');

    await expect(page.getByText(/can't read its iCloud folder/)).toBeVisible({ timeout: 10000 });
    await expect(page.getByText(/no longer exists/)).toHaveCount(0);
    await expect.poll(() => workspaceProjects(page)).toEqual([`${OLD}/Work`, `${OLD}/Recipes`]);
  });
});
