/**
 * Sidebar footer — the Settings button must be clickable.
 *
 * The status strip (word count + focus hint) shares the footer row with the
 * Settings button. A stylesheet rule written when the strip lived in the
 * editor column positioned it absolutely across its container whenever
 * "translucent chrome" was on; once the strip moved into the sidebar footer
 * that rule laid it over the Settings button, which then could not be
 * clicked. Layout bugs like this are invisible to jsdom, so this runs in a
 * real browser and asks the browser what is on top.
 */
import { tauriTest, expect, openFileInEditor } from '../../fixtures';

const SIDEBAR_WIDTHS = [200, 252, 340];

async function topElementAtSettingsButton(page: import('@playwright/test').Page) {
  return page.evaluate(() => {
    const button = document.querySelector<HTMLElement>(
      'nav[aria-label="Workspace sidebar"] button[aria-label="Settings"]',
    );
    if (!button) return { found: false, onTop: [] as boolean[], overlap: false };
    const rect = button.getBoundingClientRect();
    const y = rect.top + rect.height / 2;
    const onTop = [rect.left + 3, rect.left + rect.width / 2, rect.right - 3].map((x) => {
      const hit = document.elementFromPoint(x, y);
      return hit !== null && button.contains(hit);
    });
    const strip = document.querySelector<HTMLElement>('[data-quiet-status]');
    const s = strip?.getBoundingClientRect();
    const overlap = s ? s.left < rect.right && s.right > rect.left && s.top < rect.bottom && s.bottom > rect.top : false;
    return { found: true, onTop, overlap };
  });
}

tauriTest.describe('Sidebar footer — Settings button', () => {
  tauriTest.beforeEach(async ({ waitForAppReady, page }) => {
    await waitForAppReady();
    // A document must be open: the strip only shows its word count then.
    await openFileInEditor(page, 'welcome.md', 'Welcome to Notesage');
    await expect(page.locator('[data-quiet-status]')).toContainText('words');
  });

  for (const translucent of [false, true]) {
    tauriTest(`is not covered by the status strip (translucent chrome ${translucent ? 'on' : 'off'})`, async ({ page }) => {
      await page.evaluate((on) => {
        document.querySelector('.app')?.setAttribute('data-quiet-chrome-transparent', on ? 'true' : 'false');
      }, translucent);

      for (const width of SIDEBAR_WIDTHS) {
        await page.evaluate((w) => {
          document.documentElement.style.setProperty('--quiet-sidebar-width', `${w}px`);
        }, width);
        const result = await topElementAtSettingsButton(page);
        expect(result.found, `Settings button exists at ${width}px`).toBe(true);
        expect(result.overlap, `status strip overlaps the button at ${width}px`).toBe(false);
        expect(result.onTop, `button is the top element at ${width}px`).toEqual([true, true, true]);
      }
    });
  }

  tauriTest('opens Settings when clicked with translucent chrome on', async ({ page }) => {
    await page.evaluate(() => {
      document.querySelector('.app')?.setAttribute('data-quiet-chrome-transparent', 'true');
    });
    await page
      .locator('nav[aria-label="Workspace sidebar"]')
      .getByRole('button', { name: 'Settings' })
      .click();
    await expect(page.getByRole('dialog').filter({ hasText: 'Settings' }).first()).toBeVisible();
  });
});
