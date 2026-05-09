/**
 * Two-layer Playwright fixture system for Notesage E2E tests.
 *
 * Layer 1 — browser-only: plain Playwright `test` with no Tauri mock.
 *   Use this for tests that only need basic browser APIs.
 *
 * Layer 2 — Tauri-mocked: `tauriTest` with:
 *   - Full `window.__TAURI_INTERNALS__` injection via `setupTauriMock()`
 *   - Per-test temporary workspace directory via `os.mkdtemp`
 *   - Pre-baked Zustand `localStorage` storage states
 *   - `waitForAppReady` probe that blocks until React has mounted
 *
 * Usage:
 *   import { tauriTest, expect } from '../../fixtures';
 *   tauriTest('my test', async ({ page, waitForAppReady, workspaceDir }) => { ... });
 */

import { test as base, expect } from '@playwright/test';
import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';
import { setupTauriMock, emitTauriEvent, trackInvokeCalls } from './tauri-mock';
import { SAMPLE_FILE_TREE, SAMPLE_FILES, SAMPLE_PROJECT_PATH } from './sample-data';
import type { Page } from '@playwright/test';

export { expect };

// Re-export utility functions so specs can use them without importing tauri-mock directly
export { emitTauriEvent, trackInvokeCalls };
export { SAMPLE_FILE_TREE, SAMPLE_FILES, SAMPLE_PROJECT_PATH };

// ---------------------------------------------------------------------------
// Layer 1 — browser-only (no Tauri mock)
// ---------------------------------------------------------------------------

export const browserTest = base;

// ---------------------------------------------------------------------------
// Layer 2 — Tauri-mocked fixtures
// ---------------------------------------------------------------------------

export type TauriFixtures = {
  /**
   * Real temporary directory created via os.mkdtemp() for this test.
   * Deleted automatically in fixture teardown.
   */
  workspaceDir: string;

  /**
   * Waits for the React root to mount with visible children.
   * Use this instead of bare page.waitForTimeout() for app-ready signals.
   */
  waitForAppReady: (options?: { timeout?: number }) => Promise<void>;
};

/**
 * Inject the workspace-store Zustand state into localStorage so the sidebar
 * renders with the test's workspaceDir as an explorer folder.
 */
async function injectWorkspaceState(page: Page, projectPath: string): Promise<void> {
  await page.addInitScript(
    ({ projectPath: p }) => {
      const state = {
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
      };
      localStorage.setItem('notesage-workspace', JSON.stringify(state));
    },
    { projectPath },
  );
}

// ---------------------------------------------------------------------------
// Shared editor helpers
// ---------------------------------------------------------------------------

/**
 * Expand the folder in sidebar and click a file to open it in the editor.
 * Waits for the file content to appear before returning.
 */
export async function openFileInEditor(
  page: Page,
  fileName: string,
  expectedText?: string,
): Promise<void> {
  const folderName = page.getByText('notesage-e2e-project', { exact: true }).first();
  if (await folderName.isVisible()) {
    await folderName.click();
  }

  await page.waitForFunction(
    (name) => document.body.textContent?.includes(name),
    fileName,
    { timeout: 10000 },
  );

  await page.getByText(fileName, { exact: true }).first().click();

  const { expect: pw_expect } = await import('@playwright/test');
  await pw_expect(page.locator('.ProseMirror[contenteditable="true"]')).toBeVisible({ timeout: 5000 });

  if (expectedText) {
    await pw_expect(page.locator('.ProseMirror[contenteditable="true"]'))
      .toContainText(expectedText, { timeout: 15000 });
  }
}

export const tauriTest = base.extend<TauriFixtures>({
  // Fixture: per-test isolated workspace directory
  workspaceDir: async ({}, use) => {
    // Create a real temporary directory for this test (sync version)
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'notesage-e2e-'));
    try {
      await use(tmpDir);
    } finally {
      // Clean up after the test
      try {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      } catch {
        // Best-effort cleanup — don't fail the test on teardown errors
      }
    }
  },

  // Fixture: Tauri mock setup + workspace injection + navigation
  // We extend the `page` fixture to add Tauri mock before goto()
  page: async ({ page, workspaceDir: _workspaceDir }, use) => {
    // Set up the Tauri IPC mock
    await setupTauriMock(page);
    // Inject workspace state so the sidebar renders
    await injectWorkspaceState(page, SAMPLE_PROJECT_PATH);
    // Navigate to the app
    await page.goto('/');
    await use(page);
  },

  // Fixture: waitForAppReady helper
  waitForAppReady: async ({ page }, use) => {
    const helper = async (options?: { timeout?: number }) => {
      await page.waitForFunction(
        () => {
          const root = document.getElementById('root');
          return root !== null && root.children.length > 0;
        },
        { timeout: options?.timeout ?? 10000 },
      );
    };
    await use(helper);
  },
});
