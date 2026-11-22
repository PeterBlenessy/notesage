import { test, expect } from '@playwright/test';
import { setupTauriMock } from '../../fixtures/tauri-mock';

/**
 * The Folders `+` button. It was labelled "Add folder" while only ever
 * creating a new project; an existing folder could be added solely through
 * ⌘O, which nothing on screen mentioned. It now opens a menu offering both.
 */
test.describe('Folders + menu', () => {
  test.beforeEach(async ({ page }) => {
    await setupTauriMock(page);
    await page.goto('/');
    await expect(page.getByRole('button', { name: 'Add folder' })).toBeAttached({ timeout: 10000 });
  });

  test('adds an existing folder through the native picker', async ({ page }) => {
    await page.getByRole('heading', { name: 'Folders' }).hover();
    await page.getByRole('button', { name: 'Add folder' }).click();
    await page.getByRole('menuitem', { name: /Add existing folder/ }).click();

    // The mocked picker returns the sample project folder.
    await expect(page.getByText('notesage-e2e-project', { exact: true }).first()).toBeVisible({
      timeout: 10000,
    });
  });

  test('offers New project, which opens the inline create row', async ({ page }) => {
    await page.getByRole('heading', { name: 'Folders' }).hover();
    await page.getByRole('button', { name: 'Add folder' }).click();
    await page.getByRole('menuitem', { name: /New project/ }).click();

    await expect(page.getByPlaceholder('New project')).toBeVisible();
  });
});
