import { test, expect } from '@playwright/test';
import { setupTauriMock } from '../fixtures/tauri-mock';

test.describe('App loads', () => {
  test.beforeEach(async ({ page }) => {
    await setupTauriMock(page);
    await page.goto('/');
  });

  test('renders without errors', async ({ page }) => {
    // The app root should be present
    await expect(page.locator('#root')).toBeVisible();

    // Wait for React to mount — the root should have children
    await page.waitForFunction(
      () => {
        const root = document.getElementById('root');
        return root && root.children.length > 0;
      },
      { timeout: 10000 },
    );

    // Verify the app rendered something meaningful
    const rootContent = await page.locator('#root').innerHTML();
    expect(rootContent.length).toBeGreaterThan(0);
  });

  test('no console errors on startup', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        errors.push(msg.text());
      }
    });

    // Give the app time to initialize
    await page.waitForTimeout(3000);

    // Filter out known benign warnings (e.g., Tauri mock unhandled commands)
    const realErrors = errors.filter(
      (e) => !e.includes('[tauri-mock]') && !e.includes('ResizeObserver'),
    );
    expect(realErrors).toEqual([]);
  });
});
