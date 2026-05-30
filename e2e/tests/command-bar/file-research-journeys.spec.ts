/**
 * Command bar — `:file` FileMode and `?` ResearchMode journeys.
 *
 * Both are SQLite-index-backed. The mock now answers the real commands these
 * modes invoke (`index_search_filenames`, `index_search_research`) with
 * fixtures from `e2e/fixtures/sample-data.ts`.
 *
 * Journey: type the prefix + query → assert index-backed rows appear → select
 * a row → assert the file opens.
 *   - FileMode opens via `useFileOperations.openFile` directly (→ `read_file`).
 *   - ResearchMode fires `notesage:open-file`, App.tsx routes to `openFile`
 *     (→ `read_file`).
 *
 * Selectors (both modes render a [role="listbox"] with [role="option"][data-index] rows):
 *   - FileMode:     [role="listbox"][aria-label="File search results"]
 *   - ResearchMode: [role="listbox"][aria-label="Research results"]
 */
import { test, expect } from '@playwright/test';
import { setupTauriMock, trackInvokeCalls } from '../../fixtures/tauri-mock';
import { SAMPLE_PROJECT_PATH } from '../../fixtures/sample-data';

test.describe('Command bar — FileMode (`:file`) journeys', () => {
  test.beforeEach(async ({ page }) => {
    await setupTauriMock(page);
    await page.goto('/');
    await page.waitForLoadState('networkidle');
  });

  async function expandBar(page: import('@playwright/test').Page) {
    const bar = page.locator('[data-cmd-bar]');
    await page.keyboard.press('Meta+k');
    await expect(bar).toHaveAttribute('data-expanded', 'true', { timeout: 5000 });
    const input = bar.locator('textarea[role="combobox"]');
    await expect(input).toBeVisible({ timeout: 5000 });
    return input;
  }

  // `:file note` → filename search lists the `notes.md` fixture row.
  test('`:file note` lists matching filename rows from the index', async ({ page }) => {
    const input = await expandBar(page);
    await input.fill(':file note');

    const fileList = page.locator('[role="listbox"][aria-label="File search results"]');
    await expect(fileList).toBeVisible({ timeout: 5000 });
    await expect(
      fileList.locator('[role="option"]').filter({ hasText: 'notes.md' }),
    ).toBeVisible({ timeout: 5000 });
  });

  // Full journey: search → select a result → the file opens (read_file fires).
  test('`:file note` → select result opens the file', async ({ page }) => {
    const getCalls = await trackInvokeCalls(page);
    const input = await expandBar(page);
    await input.fill(':file notes');

    const row = page
      .locator('[role="listbox"][aria-label="File search results"] [role="option"]')
      .filter({ hasText: 'notes.md' });
    await expect(row).toBeVisible({ timeout: 5000 });
    await row.click();

    await expect
      .poll(async () => {
        const calls = await getCalls();
        return calls.some(
          (c) =>
            c.cmd === 'read_file' &&
            (c.args as { path?: string })?.path === `${SAMPLE_PROJECT_PATH}/notes.md`,
        );
      }, { timeout: 5000 })
      .toBe(true);
  });

  // A query that matches no filename shows FileMode's empty state.
  test('`:file zzznomatch` shows the no-results state', async ({ page }) => {
    const input = await expandBar(page);
    await input.fill(':file zzznomatch');

    const fileList = page.locator('[role="listbox"][aria-label="File search results"]');
    await expect(fileList).toBeVisible({ timeout: 5000 });
    await expect(fileList).toContainText('No files matching', { timeout: 5000 });
  });
});

test.describe('Command bar — ResearchMode (`?`) journeys', () => {
  test.beforeEach(async ({ page }) => {
    await setupTauriMock(page);
    await page.goto('/');
    await page.waitForLoadState('networkidle');
  });

  async function expandBar(page: import('@playwright/test').Page) {
    const bar = page.locator('[data-cmd-bar]');
    await page.keyboard.press('Meta+k');
    await expect(bar).toHaveAttribute('data-expanded', 'true', { timeout: 5000 });
    const input = bar.locator('textarea[role="combobox"]');
    await expect(input).toBeVisible({ timeout: 5000 });
    return input;
  }

  // `?climate` → research search lists the "Climate Policy Overview" fixture.
  // ResearchMode debounces the backend query 300 ms, so allow the extra time.
  test('`?climate` lists matching research rows from the index', async ({ page }) => {
    const input = await expandBar(page);
    await input.fill('?climate');

    const researchList = page.locator('[role="listbox"][aria-label="Research results"]');
    await expect(researchList).toBeVisible({ timeout: 5000 });
    await expect(
      researchList.locator('[role="option"]').filter({ hasText: 'Climate Policy Overview' }),
    ).toBeVisible({ timeout: 5000 });
  });

  // Full journey: search → select a research row → the research file opens.
  test('`?climate` → select result opens the research file', async ({ page }) => {
    const getCalls = await trackInvokeCalls(page);
    const input = await expandBar(page);
    await input.fill('?climate');

    const row = page
      .locator('[role="listbox"][aria-label="Research results"] [role="option"]')
      .filter({ hasText: 'Climate Policy Overview' });
    await expect(row).toBeVisible({ timeout: 5000 });
    await row.click();

    // ResearchMode → notesage:open-file → openFile → read_file on the
    // research fixture's `file` path.
    await expect
      .poll(async () => {
        const calls = await getCalls();
        return calls.some(
          (c) =>
            c.cmd === 'read_file' &&
            (c.args as { path?: string })?.path ===
              `${SAMPLE_PROJECT_PATH}/research/climate-policy.md`,
        );
      }, { timeout: 5000 })
      .toBe(true);
  });
});
