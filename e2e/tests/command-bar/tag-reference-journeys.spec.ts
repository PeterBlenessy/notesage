/**
 * Command bar — `#` TagMode and `@` ReferenceMode journeys.
 *
 * Both modes are SQLite-index-backed. The mock (`e2e/fixtures/tauri-mock.ts`)
 * now answers the real commands these modes invoke (`index_tags`,
 * `index_tag_occurrences`, `index_mentions`, `index_mention_occurrences`)
 * with fixtures from `e2e/fixtures/sample-data.ts`.
 *
 * Journey: type the prefix + query → assert index-backed rows appear → drill
 * into a tag/person → select an occurrence → assert the file opens (the
 * occurrence pick fires `notesage:open-file-at-tag`, App.tsx routes it to
 * `openFileAtTag`, which reads the file via `read_file`).
 *
 * Selectors:
 *   - TagMode L1:  [data-cmd-mode="tag"][data-cmd-mode-level="tags"], rows [role="option"]
 *   - TagMode L2:  [data-cmd-mode="tag"][data-cmd-mode-level="occurrences"], rows [role="option"]
 *   - ReferenceMode L1: [data-reference-list], rows [role="option"][data-result-kind]
 *   - ReferenceMode L2: [data-cmd-mode-level="occurrences"], rows [role="option"]
 */
import { test, expect } from '@playwright/test';
import { setupTauriMock, trackInvokeCalls } from '../../fixtures/tauri-mock';
import { SAMPLE_PROJECT_PATH } from '../../fixtures/sample-data';

test.describe('Command bar — TagMode (`#`) journeys', () => {
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

  // `#road` → TagMode level 1 shows the `roadmap` tag row from the fixtures.
  test('`#road` lists matching tag rows from the index', async ({ page }) => {
    const input = await expandBar(page);
    await input.fill('#road');

    const tagList = page.locator('[data-cmd-mode="tag"][data-cmd-mode-level="tags"]');
    await expect(tagList).toBeVisible({ timeout: 5000 });
    await expect(tagList.locator('[role="option"]').filter({ hasText: 'roadmap' })).toBeVisible({
      timeout: 5000,
    });
  });

  // Full journey: pick a tag → occurrences level → pick an occurrence → file opens.
  test('`#` → select tag → select occurrence opens the file', async ({ page }) => {
    const getCalls = await trackInvokeCalls(page);
    const input = await expandBar(page);
    await input.fill('#roadmap');

    // Level 1 — pick the roadmap tag.
    const tagRow = page
      .locator('[data-cmd-mode="tag"][data-cmd-mode-level="tags"] [role="option"]')
      .filter({ hasText: 'roadmap' });
    await expect(tagRow).toBeVisible({ timeout: 5000 });
    await tagRow.click();

    // Level 2 — occurrences for #roadmap.
    const occList = page.locator('[data-cmd-mode="tag"][data-cmd-mode-level="occurrences"]');
    await expect(occList).toBeVisible({ timeout: 5000 });
    const firstOcc = occList.locator('[role="option"]').first();
    await expect(firstOcc).toBeVisible({ timeout: 5000 });
    await firstOcc.click();

    // Picking the occurrence routes through openFileAtTag → read_file on the
    // occurrence's path (notes.md is the first #roadmap occurrence fixture).
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

  // Esc at the occurrences level returns to the tag list (does not dismiss).
  test('`#` → select tag → Esc returns to the tag list', async ({ page }) => {
    const input = await expandBar(page);
    await input.fill('#roadmap');

    const tagRow = page
      .locator('[data-cmd-mode="tag"][data-cmd-mode-level="tags"] [role="option"]')
      .filter({ hasText: 'roadmap' });
    await expect(tagRow).toBeVisible({ timeout: 5000 });
    await tagRow.click();

    await expect(
      page.locator('[data-cmd-mode="tag"][data-cmd-mode-level="occurrences"]'),
    ).toBeVisible({ timeout: 5000 });

    await page.keyboard.press('Escape');

    await expect(
      page.locator('[data-cmd-mode="tag"][data-cmd-mode-level="tags"]'),
    ).toBeVisible({ timeout: 5000 });
  });
});

test.describe('Command bar — ReferenceMode (`@`) journeys', () => {
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

  // `@alice` → ReferenceMode surfaces a "person" row from the mention index.
  test('`@alice` lists a person reference from the mention index', async ({ page }) => {
    const input = await expandBar(page);
    await input.fill('@alice');

    const refList = page.locator('[data-reference-list]');
    await expect(refList.first()).toBeVisible({ timeout: 5000 });
    const personRow = refList
      .locator('[role="option"][data-result-kind="person"]')
      .filter({ hasText: 'alice' });
    await expect(personRow).toBeVisible({ timeout: 5000 });
  });

  // Full journey: pick the person → occurrences drilldown → pick occurrence → file opens.
  test('`@` → select person → select occurrence opens the file', async ({ page }) => {
    const getCalls = await trackInvokeCalls(page);
    const input = await expandBar(page);
    await input.fill('@alice');

    const personRow = page
      .locator('[data-reference-list] [role="option"][data-result-kind="person"]')
      .filter({ hasText: 'alice' });
    await expect(personRow).toBeVisible({ timeout: 5000 });
    await personRow.click();

    // Level 2 — @alice occurrences across files.
    const occList = page.locator('[data-cmd-mode-level="occurrences"]');
    await expect(occList).toBeVisible({ timeout: 5000 });
    const firstOcc = occList.locator('[role="option"]').first();
    await expect(firstOcc).toBeVisible({ timeout: 5000 });
    await firstOcc.click();

    // notes.md is the first @alice occurrence fixture.
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
});
