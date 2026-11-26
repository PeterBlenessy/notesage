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
import { tauriTest, expect, openFileInEditor, emitTauriEvent } from '../../fixtures';

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

/**
 * The indexing progress bar lies along the footer's top border. Where it is,
 * whether the footer grew for it, and whether it (or anything else) is over
 * the Settings button or the status strip.
 */
async function measureFooterWithBar(page: import('@playwright/test').Page) {
  return page.evaluate(() => {
    const bar = document.querySelector<HTMLElement>('[data-activity-bar]');
    const button = document.querySelector<HTMLElement>(
      'nav[aria-label="Workspace sidebar"] button[aria-label="Settings"]',
    );
    const strip = document.querySelector<HTMLElement>('[data-quiet-status]');
    const footer = button?.parentElement ?? null;
    if (!bar || !button || !strip || !footer) return null;
    const overlaps = (a: DOMRect, b: DOMRect) =>
      a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
    const b = bar.getBoundingClientRect();
    const f = footer.getBoundingClientRect();
    const stripRect = strip.getBoundingClientRect();
    const stripHit = document.elementFromPoint(
      stripRect.left + stripRect.width / 2,
      stripRect.top + stripRect.height / 2,
    );
    return {
      barInFooter: bar.parentElement === footer,
      barHeight: b.height,
      barWidth: b.width,
      footerWidth: f.width,
      footerHeight: f.height,
      // Along the top border: it starts on the footer's top edge.
      barTopOffset: b.top - f.top,
      coversButton: overlaps(b, button.getBoundingClientRect()),
      coversStrip: overlaps(b, stripRect),
      pointerEvents: getComputedStyle(bar).pointerEvents,
      // Nothing that is hit-tested at the bar's own position is the bar.
      barIsHit: bar.contains(document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2)),
      stripOnTop: stripHit !== null && strip.contains(stripHit),
    };
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

  for (const translucent of [false, true]) {
    tauriTest(`is not covered while the indexing bar is showing (translucent chrome ${translucent ? 'on' : 'off'})`, async ({ page }) => {
      await page.evaluate((on) => {
        document.querySelector('.app')?.setAttribute('data-quiet-chrome-transparent', on ? 'true' : 'false');
      }, translucent);

      const footerHeightIdle = await page.evaluate(
        () =>
          document
            .querySelector('nav[aria-label="Workspace sidebar"] button[aria-label="Settings"]')
            ?.parentElement?.getBoundingClientRect().height ?? -1,
      );
      await expect(page.locator('[data-activity-bar]')).toHaveCount(0);

      // What the backend emits during a pass over the library.
      await emitTauriEvent(page, 'index-progress', { project_path: null, current: 1200, total: 3000 });
      const bar = page.getByRole('progressbar', { name: 'Indexing your library, 1,200 of 3,000 files' });
      await expect(bar).toBeVisible();
      await expect(bar).toHaveAttribute('aria-valuenow', '40');

      for (const width of SIDEBAR_WIDTHS) {
        await page.evaluate((w) => {
          document.documentElement.style.setProperty('--quiet-sidebar-width', `${w}px`);
        }, width);

        const result = await topElementAtSettingsButton(page);
        expect(result.found, `Settings button exists at ${width}px`).toBe(true);
        expect(result.overlap, `status strip overlaps the button at ${width}px`).toBe(false);
        expect(result.onTop, `button is the top element at ${width}px`).toEqual([true, true, true]);

        const footer = await measureFooterWithBar(page);
        expect(footer, `bar, button and strip exist at ${width}px`).not.toBeNull();
        if (!footer) continue;
        expect(footer.barInFooter).toBe(true);
        expect(footer.barHeight, `bar is 2px at ${width}px`).toBe(2);
        expect(footer.barWidth, `bar spans the footer at ${width}px`).toBeCloseTo(footer.footerWidth, 0);
        expect(footer.barTopOffset, `bar sits on the footer's top border at ${width}px`).toBe(0);
        expect(footer.footerHeight, `footer height is unchanged at ${width}px`).toBe(footerHeightIdle);
        expect(footer.coversButton, `bar covers the Settings button at ${width}px`).toBe(false);
        expect(footer.coversStrip, `bar covers the status strip at ${width}px`).toBe(false);
        expect(footer.pointerEvents).toBe('none');
        expect(footer.barIsHit, `bar takes pointer events at ${width}px`).toBe(false);
        expect(footer.stripOnTop, `status strip is the top element at ${width}px`).toBe(true);
      }

      // Still clickable with the bar up.
      await page
        .locator('nav[aria-label="Workspace sidebar"]')
        .getByRole('button', { name: 'Settings' })
        .click();
      const dialog = page.getByRole('dialog').filter({ hasText: 'Settings' }).first();
      await expect(dialog).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(dialog).toBeHidden();

      // The pass ends: the bar goes, and the footer is as it was.
      await emitTauriEvent(page, 'index-ready', { project_path: null });
      await expect(page.locator('[data-activity-bar]')).toHaveCount(0);
      const after = await topElementAtSettingsButton(page);
      expect(after.onTop).toEqual([true, true, true]);
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

  // The recording indicator is the third thing to arrive next to this footer
  // (after the status strip and the indexing bar). It gets a row of its own
  // ABOVE the footer, so the footer row must be exactly what it was: same
  // height, same button position, nothing over the button or the strip —
  // with the indexing bar up at the same time, and with a warning making the
  // indicator taller.
  for (const translucent of [false, true]) {
    tauriTest(`is not covered while a recording is live (translucent chrome ${translucent ? 'on' : 'off'})`, async ({ page }) => {
      await page.evaluate((on) => {
        document.querySelector('.app')?.setAttribute('data-quiet-chrome-transparent', on ? 'true' : 'false');
      }, translucent);

      const footerIdle = await page.evaluate(() => {
        const button = document.querySelector<HTMLElement>(
          'nav[aria-label="Workspace sidebar"] button[aria-label="Settings"]',
        );
        const footer = button?.parentElement;
        if (!button || !footer) return null;
        const nav = footer.closest('nav')!.getBoundingClientRect();
        return {
          height: footer.getBoundingClientRect().height,
          // Measured from the sidebar's bottom edge: the footer stays put.
          fromBottom: nav.bottom - button.getBoundingClientRect().bottom,
        };
      });
      expect(footerIdle).not.toBeNull();

      await page.keyboard.press('Meta+Shift+r');
      const indicator = page.locator('[data-recording-indicator="sidebar"]');
      await expect(indicator).toBeVisible();
      await expect(indicator.locator('[data-recording-state]')).toHaveText('Recording');
      // Both at once: indexing bar and a recording with a warning.
      await emitTauriEvent(page, 'index-progress', { project_path: null, current: 1200, total: 3000 });
      await expect(page.locator('[data-activity-bar]')).toHaveCount(1);
      await emitTauriEvent(page, 'recording-warning', { kind: 'silence', message: 'no signal', fatal: false });
      await expect(indicator.locator('[data-recording-warning="silence"]')).toBeVisible();

      for (const width of SIDEBAR_WIDTHS) {
        await page.evaluate((w) => {
          document.documentElement.style.setProperty('--quiet-sidebar-width', `${w}px`);
          const nav = document.querySelector<HTMLElement>('nav[aria-label="Workspace sidebar"]');
          if (nav) nav.style.width = `${w}px`;
        }, width);

        const result = await topElementAtSettingsButton(page);
        expect(result.found, `Settings button exists at ${width}px`).toBe(true);
        expect(result.overlap, `status strip overlaps the button at ${width}px`).toBe(false);
        expect(result.onTop, `button is the top element at ${width}px`).toEqual([true, true, true]);

        const m = await page.evaluate(() => {
          const ind = document.querySelector<HTMLElement>('[data-recording-indicator="sidebar"]');
          const button = document.querySelector<HTMLElement>(
            'nav[aria-label="Workspace sidebar"] button[aria-label="Settings"]',
          );
          const strip = document.querySelector<HTMLElement>('[data-quiet-status]');
          const footer = button?.parentElement ?? null;
          if (!ind || !button || !strip || !footer) return null;
          const overlaps = (a: DOMRect, b: DOMRect) =>
            a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
          const i = ind.getBoundingClientRect();
          const f = footer.getBoundingClientRect();
          const s = strip.getBoundingClientRect();
          const nav = footer.closest('nav')!.getBoundingClientRect();
          const stripHit = document.elementFromPoint(s.left + s.width / 2, s.top + s.height / 2);
          return {
            // A sibling of the footer, entirely above it.
            inFooter: footer.contains(ind),
            aboveFooter: i.bottom <= f.top,
            coversFooter: overlaps(i, f),
            coversButton: overlaps(i, button.getBoundingClientRect()),
            coversStrip: overlaps(i, s),
            stripOnTop: stripHit !== null && strip.contains(stripHit),
            insideSidebar: i.left >= nav.left && i.right <= nav.right,
            footerHeight: f.height,
            buttonFromBottom: nav.bottom - button.getBoundingClientRect().bottom,
          };
        });
        expect(m, `indicator, button and strip exist at ${width}px`).not.toBeNull();
        if (!m || !footerIdle) continue;
        expect(m.inFooter, `indicator is not inside the footer row at ${width}px`).toBe(false);
        expect(m.aboveFooter, `indicator is above the footer at ${width}px`).toBe(true);
        expect(m.coversFooter, `indicator covers the footer at ${width}px`).toBe(false);
        expect(m.coversButton, `indicator covers the Settings button at ${width}px`).toBe(false);
        expect(m.coversStrip, `indicator covers the status strip at ${width}px`).toBe(false);
        expect(m.stripOnTop, `status strip is the top element at ${width}px`).toBe(true);
        expect(m.insideSidebar, `indicator stays inside the sidebar at ${width}px`).toBe(true);
        expect(m.footerHeight, `footer height is unchanged at ${width}px`).toBe(footerIdle.height);
        expect(m.buttonFromBottom, `Settings button has not moved at ${width}px`).toBe(footerIdle.fromBottom);
      }

      // Still clickable with the indicator up.
      await page
        .locator('nav[aria-label="Workspace sidebar"]')
        .getByRole('button', { name: 'Settings' })
        .click();
      const dialog = page.getByRole('dialog').filter({ hasText: 'Settings' }).first();
      await expect(dialog).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(dialog).toBeHidden();

      // The recording ends: the indicator goes and the footer is as it was.
      await page.keyboard.press('Meta+Shift+r');
      await expect(indicator).toHaveCount(0);
      const after = await topElementAtSettingsButton(page);
      expect(after.onTop).toEqual([true, true, true]);
    });
  }
});
