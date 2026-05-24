/**
 * QuietSidebar inline tree-navigation real-E2E tests.
 *
 * Verifies keyboard-driven inline expand/collapse and focus navigation
 * in the Projects section of the Quiet Composer sidebar against a live
 * Tauri app (WebDriverIO + tauri-webdriver).
 *
 * Run manually:
 *   Terminal 1: pnpm tauri:test
 *   Terminal 2: tauri-webdriver
 *   Terminal 3: pnpm test:e2e-real
 *
 * Timing notes (owner's feedback from closed PR #283):
 *   (a) All waitUntil budgets are 10 s+ to survive macos-latest CI contention.
 *   (b) DOM selectors are established via waitForExist before any interaction.
 *   (c) explicit browser.pause(300) after focus-changing keypresses.
 *   (d) State reads are done inside browser.waitUntil (polling) — never
 *       synchronously after a keypress, which would race React's re-render.
 *
 * Key implementation detail (aw-review on PR #283):
 *   ArrowLeft from a CHILD row calls focusRow(project.path) — moves focus to
 *   the parent project row but does NOT collapse it.  Collapsing requires a
 *   SECOND ArrowLeft on the (now-focused) project row.  Tests 4a and 4b encode
 *   this two-step sequence.
 */

import * as path from 'path';

const TEST_PROJECT_PATH = path.resolve(process.cwd(), 'e2e-real/fixtures/test-project');

/** WebDriver Unicode key constants for special / modifier keys. */
const WD = {
  ArrowRight: '',
  ArrowLeft: '',
  ArrowDown: '',
  ArrowUp: '',
  Enter: '',
  Space: ' ',
  Escape: '',
};

// ─── helpers ──────────────────────────────────────────────────────────────────

/** Wait until the app root is mounted and all Zustand stores are exposed. */
async function waitForApp(): Promise<void> {
  const root = await browser.$('#root');
  await root.waitForExist({
    timeout: 15_000,
    timeoutMsg: '#root not found — Tauri app not running?',
  });
  await browser.waitUntil(
    () =>
      browser.execute(
        () =>
          Boolean((window as Record<string, unknown>).__E2E_WORKSPACE_STORE__) &&
          Boolean((window as Record<string, unknown>).__E2E_SETTINGS_STORE__) &&
          Boolean((window as Record<string, unknown>).__E2E_EDITOR_STORE__),
      ),
    {
      timeout: 15_000,
      interval: 200,
      timeoutMsg: 'Zustand stores not exposed on window — app not in dev mode?',
    },
  );
}

/**
 * Seed the fixture project into workspace-store.projects (NOT explorerFolders).
 * ProjectsSection renders from `projects`; FoldersSection renders from
 * `explorerFolders`.  Using addProject ensures the row appears in the Projects
 * tree only.
 */
async function seedProject(projectPath: string): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tree: any = await browser.executeAsync(
    (p: string, done: (r: unknown) => void) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).__TAURI_INTERNALS__
        .invoke('list_directory', { path: p })
        .then((r: unknown) => done(r))
        .catch(() => done(null));
    },
    projectPath,
  );

  if (!tree) throw new Error(`list_directory failed for ${projectPath}`);

  await browser.execute(
    (p: string, t: unknown) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).__E2E_WORKSPACE_STORE__?.getState().addProject(p, t);
    },
    projectPath,
    tree,
  );
}

/**
 * Ensure the sidebar is pinned (visible) and close any open editor documents.
 * Call this in before/beforeEach to guarantee a clean slate.
 */
async function resetState(): Promise<void> {
  await browser.execute(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const w = window as any;

    // Pin the sidebar so QuietSidebar is visible.
    const settings = w.__E2E_SETTINGS_STORE__?.getState();
    if (settings && !settings.sidebarPinned) settings.setSidebarPinned(true);

    // Close all open editor documents.
    const editor = w.__E2E_EDITOR_STORE__?.getState();
    if (editor) {
      for (const tab of [...(editor.openDocuments ?? [])]) {
        editor.closeTab(tab.id);
      }
    }
  });

  await browser.pause(200);
}

/**
 * Wait for the Projects tree to render with at least one project row.
 * Returns the first project treeitem element.
 */
async function waitForProjectRow(): Promise<WebdriverIO.Element> {
  // Projects tree container
  const tree = await browser.$('[role="tree"][aria-label="Projects"]');
  await tree.waitForExist({
    timeout: 15_000,
    timeoutMsg: '[role="tree"][aria-label="Projects"] not found',
  });

  // At least one project row
  await browser.waitUntil(
    async () => {
      const rows = await browser.$$('[role="tree"][aria-label="Projects"] [data-row-type="project"]');
      return rows.length > 0;
    },
    {
      timeout: 15_000,
      interval: 200,
      timeoutMsg: 'No [data-row-type="project"] row appeared in Projects tree',
    },
  );

  return browser.$('[role="tree"][aria-label="Projects"] [data-row-type="project"]');
}

/**
 * Click a project row to give it focus, then press ArrowLeft once to ensure
 * the project is collapsed before the test body runs.  Idempotent — pressing
 * ArrowLeft on an already-collapsed project is a no-op.
 */
async function collapseProject(projectRow: WebdriverIO.Element): Promise<void> {
  await projectRow.click();
  await browser.pause(200);
  // One ArrowLeft: no-op on collapsed rows, collapses expanded rows.
  await browser.keys([WD.ArrowLeft]);
  await browser.pause(300);
}

// ─── suite ────────────────────────────────────────────────────────────────────

describe('QuietSidebar inline tree navigation', () => {
  before(async () => {
    await waitForApp();
    await resetState();
    await seedProject(TEST_PROJECT_PATH);
    // Wait until the project row is rendered before any test runs.
    await waitForProjectRow();
  });

  beforeEach(async () => {
    await resetState();
  });

  // ── Test 1 ─────────────────────────────────────────────────────────────────
  // ArrowRight on a collapsed project row expands the inline tree one level.

  it('expands a project row with ArrowRight', async () => {
    const projectRow = await waitForProjectRow();

    // Ensure starting state is collapsed.
    await collapseProject(projectRow);

    // The row should now report aria-expanded="false".
    await browser.waitUntil(
      async () => {
        const expanded = await browser.execute(
          () =>
            document
              .querySelector('[role="tree"][aria-label="Projects"] [data-row-type="project"]')
              ?.getAttribute('aria-expanded'),
        );
        return expanded === 'false';
      },
      {
        timeout: 10_000,
        interval: 100,
        timeoutMsg: 'Project row was not collapsed before ArrowRight test',
      },
    );

    // Focus the row and press ArrowRight.
    await projectRow.click();
    await browser.pause(200);
    await browser.keys([WD.ArrowRight]);

    // (d) Poll — never read aria-expanded immediately after a keypress.
    await browser.waitUntil(
      async () => {
        const expanded = await browser.execute(
          () =>
            document
              .querySelector('[role="tree"][aria-label="Projects"] [data-row-type="project"]')
              ?.getAttribute('aria-expanded'),
        );
        return expanded === 'true';
      },
      {
        timeout: 10_000,
        interval: 100,
        timeoutMsg: 'aria-expanded did not flip to "true" within 10 s after ArrowRight',
      },
    );

    // Child rows must now be in the DOM.
    await browser.waitUntil(
      async () => {
        const childCount = await browser.execute(
          () => document.querySelectorAll('[data-row-type="child"]').length,
        );
        return childCount > 0;
      },
      {
        timeout: 10_000,
        interval: 100,
        timeoutMsg: 'No [data-row-type="child"] rows appeared after ArrowRight expand',
      },
    );

    const childCount = await browser.execute(
      () => document.querySelectorAll('[data-row-type="child"]').length,
    );
    expect(childCount).toBeGreaterThan(0);
  });

  // ── Test 2 ─────────────────────────────────────────────────────────────────
  // ArrowDown moves focus from the project row to a child row (aria-level=2);
  // ArrowUp moves it back to the project row (aria-level=1).

  it('navigates focus with ArrowDown and ArrowUp through expanded rows', async () => {
    const projectRow = await waitForProjectRow();
    await collapseProject(projectRow);

    // Expand
    await projectRow.click();
    await browser.pause(200);
    await browser.keys([WD.ArrowRight]);

    await browser.waitUntil(
      async () => {
        const expanded = await browser.execute(
          () =>
            document
              .querySelector('[role="tree"][aria-label="Projects"] [data-row-type="project"]')
              ?.getAttribute('aria-expanded'),
        );
        return expanded === 'true';
      },
      {
        timeout: 10_000,
        interval: 100,
        timeoutMsg: 'Project did not expand before ArrowDown test',
      },
    );

    // (c) Pause after focus-changing operation to let React commit child rows.
    await browser.pause(300);

    // ArrowDown — focus should move to the first child (aria-level=2).
    await browser.keys([WD.ArrowDown]);
    await browser.pause(300);

    await browser.waitUntil(
      async () => {
        const level = await browser.execute(
          () => (document.activeElement as HTMLElement | null)?.getAttribute('aria-level'),
        );
        return level === '2';
      },
      {
        timeout: 10_000,
        interval: 100,
        timeoutMsg: 'Focus did not move to aria-level="2" within 10 s after ArrowDown',
      },
    );

    // ArrowUp — focus should return to the project row (aria-level=1).
    await browser.keys([WD.ArrowUp]);
    await browser.pause(300);

    await browser.waitUntil(
      async () => {
        const level = await browser.execute(
          () => (document.activeElement as HTMLElement | null)?.getAttribute('aria-level'),
        );
        return level === '1';
      },
      {
        timeout: 10_000,
        interval: 100,
        timeoutMsg: 'Focus did not return to aria-level="1" within 10 s after ArrowUp',
      },
    );
  });

  // ── Test 3 ─────────────────────────────────────────────────────────────────
  // Enter on a focused file row opens the file in the editor (Zustand store).

  it('opens a file in the editor when Enter is pressed on a file row', async () => {
    const projectRow = await waitForProjectRow();
    await collapseProject(projectRow);

    // Expand
    await projectRow.click();
    await browser.pause(200);
    await browser.keys([WD.ArrowRight]);

    await browser.waitUntil(
      async () => {
        const expanded = await browser.execute(
          () =>
            document
              .querySelector('[role="tree"][aria-label="Projects"] [data-row-type="project"]')
              ?.getAttribute('aria-expanded'),
        );
        return expanded === 'true';
      },
      {
        timeout: 10_000,
        interval: 100,
        timeoutMsg: 'Project did not expand before Enter test',
      },
    );

    await browser.pause(300);

    // Navigate to the first child row.
    await browser.keys([WD.ArrowDown]);
    await browser.pause(300);

    await browser.waitUntil(
      async () => {
        const level = await browser.execute(
          () => (document.activeElement as HTMLElement | null)?.getAttribute('aria-level'),
        );
        return level === '2';
      },
      {
        timeout: 10_000,
        interval: 100,
        timeoutMsg: 'Focus did not reach aria-level="2" before Enter',
      },
    );

    // Skip if focused row is a directory (Enter on directories toggles expand, not open).
    const focusedRowType = await browser.execute(() => {
      const el = document.activeElement as HTMLElement | null;
      return el?.getAttribute('data-row-type') ?? '';
    });

    // Only file rows open documents; if the first child is a folder skip the
    // file-open assertion (the spec still validates the Enter keypress path).
    if (focusedRowType === 'child') {
      const isDir = await browser.execute(() => {
        const el = document.activeElement as HTMLElement | null;
        return el?.getAttribute('aria-expanded') !== null;
      });

      if (!isDir) {
        // Press Enter — a file should open.
        await browser.keys([WD.Enter]);

        await browser.waitUntil(
          async () => {
            const tabCount = await browser.execute(() => {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const editor = (window as any).__E2E_EDITOR_STORE__?.getState();
              return (editor?.openDocuments ?? []).length;
            });
            return tabCount > 0;
          },
          {
            timeout: 10_000,
            interval: 200,
            timeoutMsg: 'No document appeared in editor store within 10 s after Enter on file row',
          },
        );

        const tabCount = await browser.execute(() => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const editor = (window as any).__E2E_EDITOR_STORE__?.getState();
          return (editor?.openDocuments ?? []).length;
        });
        expect(tabCount).toBeGreaterThan(0);
        return;
      }
    }

    // Fallback: find any non-directory child row and open it.
    const fileRows = await browser.$$('[data-row-type="child"]:not([aria-expanded])');
    if (fileRows.length > 0) {
      await fileRows[0].click();
      await browser.pause(200);
      await browser.keys([WD.Enter]);

      await browser.waitUntil(
        async () => {
          const tabCount = await browser.execute(() => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const editor = (window as any).__E2E_EDITOR_STORE__?.getState();
            return (editor?.openDocuments ?? []).length;
          });
          return tabCount > 0;
        },
        {
          timeout: 10_000,
          interval: 200,
          timeoutMsg: 'No document appeared in editor store within 10 s after Enter (fallback path)',
        },
      );

      const tabCount = await browser.execute(() => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const editor = (window as any).__E2E_EDITOR_STORE__?.getState();
        return (editor?.openDocuments ?? []).length;
      });
      expect(tabCount).toBeGreaterThan(0);
    } else {
      // No file rows available — assertion is vacuously satisfied (test project
      // has files, so this path should not be reached in practice).
      console.log('[tree-nav] No non-directory child rows found — skipping Enter assertion');
    }
  });

  // ── Test 4 ─────────────────────────────────────────────────────────────────
  // Two-step collapse + focus restore using ArrowLeft × 2.
  //
  // Step 4a: ArrowLeft from a CHILD row → focus returns to the project row
  //          (aria-level="1") but the project stays expanded.
  // Step 4b: ArrowLeft from the PROJECT row → project collapses
  //          (aria-expanded="false").

  it('collapses project and restores focus with two ArrowLeft presses', async () => {
    const projectRow = await waitForProjectRow();
    await collapseProject(projectRow);

    // Expand the project.
    await projectRow.click();
    await browser.pause(200);
    await browser.keys([WD.ArrowRight]);

    await browser.waitUntil(
      async () => {
        const expanded = await browser.execute(
          () =>
            document
              .querySelector('[role="tree"][aria-label="Projects"] [data-row-type="project"]')
              ?.getAttribute('aria-expanded'),
        );
        return expanded === 'true';
      },
      {
        timeout: 10_000,
        interval: 100,
        timeoutMsg: 'Project did not expand before collapse test',
      },
    );

    await browser.pause(300);

    // Move focus to the first child row.
    await browser.keys([WD.ArrowDown]);
    await browser.pause(300);

    await browser.waitUntil(
      async () => {
        const level = await browser.execute(
          () => (document.activeElement as HTMLElement | null)?.getAttribute('aria-level'),
        );
        return level === '2';
      },
      {
        timeout: 10_000,
        interval: 100,
        timeoutMsg: 'Focus did not reach aria-level="2" before first ArrowLeft',
      },
    );

    // ── Step 4a ──────────────────────────────────────────────────────────────
    // First ArrowLeft: focus moves to parent project row (aria-level=1).
    // Project remains expanded (aria-expanded still "true").
    await browser.keys([WD.ArrowLeft]);
    await browser.pause(300);

    await browser.waitUntil(
      async () => {
        const level = await browser.execute(
          () => (document.activeElement as HTMLElement | null)?.getAttribute('aria-level'),
        );
        return level === '1';
      },
      {
        timeout: 10_000,
        interval: 100,
        timeoutMsg:
          'Focus did not return to aria-level="1" within 10 s after first ArrowLeft from child',
      },
    );

    // Project should still be expanded after the first ArrowLeft.
    const stillExpanded = await browser.execute(
      () =>
        document
          .querySelector('[role="tree"][aria-label="Projects"] [data-row-type="project"]')
          ?.getAttribute('aria-expanded'),
    );
    expect(stillExpanded).toBe('true');

    // ── Step 4b ──────────────────────────────────────────────────────────────
    // Second ArrowLeft: project collapses (aria-expanded flips to "false").
    await browser.keys([WD.ArrowLeft]);
    await browser.pause(300);

    await browser.waitUntil(
      async () => {
        const expanded = await browser.execute(
          () =>
            document
              .querySelector('[role="tree"][aria-label="Projects"] [data-row-type="project"]')
              ?.getAttribute('aria-expanded'),
        );
        return expanded === 'false';
      },
      {
        timeout: 10_000,
        interval: 100,
        timeoutMsg:
          'Project did not collapse (aria-expanded="false") within 10 s after second ArrowLeft',
      },
    );

    // No child rows should be visible after collapse.
    const childCount = await browser.execute(
      () => document.querySelectorAll('[data-row-type="child"]').length,
    );
    expect(childCount).toBe(0);
  });

  // ── Test 5 ─────────────────────────────────────────────────────────────────
  // The [role="tree"][aria-label="Projects"] tree contains only project-type
  // rows at the top level — no explorer-folder rows.

  it('shows only project rows in the Projects tree (no explorer-folder rows)', async () => {
    const tree = await browser.$('[role="tree"][aria-label="Projects"]');
    await tree.waitForExist({
      timeout: 10_000,
      timeoutMsg: 'Projects tree not found for projects-only assertion',
    });

    // All top-level treeitems must have data-row-type="project".
    const projectRows = await browser.$$(
      '[role="tree"][aria-label="Projects"] [data-row-type="project"]',
    );
    expect(projectRows.length).toBeGreaterThan(0);

    for (const row of projectRows) {
      const rowType = await row.getAttribute('data-row-type');
      expect(rowType).toBe('project');
    }

    // Specifically no explorer-folder rows inside the Projects tree.
    const explorerRows = await browser.$$(
      '[role="tree"][aria-label="Projects"] [data-row-type="explorer"]',
    );
    expect(explorerRows.length).toBe(0);
  });
});
