/**
 * Recording — start, watch and stop, in a real browser (U35).
 *
 * The recorder behind it is the mock in `e2e/fixtures/tauri-mock.ts`; what
 * this file is about is the part jsdom cannot see: that a live recording is
 * ALWAYS on screen (sidebar shown, sidebar hidden, focus mode, command bar
 * pinned), and that the indicator is never laid over the Settings button, the
 * status strip or the command bar — the browser is asked what is on top.
 */
import { tauriTest, expect, openFileInEditor, emitTauriEvent } from '../../fixtures';
import type { Page } from '@playwright/test';

const SIDEBAR_WIDTHS = [200, 252, 340];
/** Where screenshots go when a run asks for them (`RECORDING_SHOTS=<dir>`). */
const SHOTS = process.env.RECORDING_SHOTS;

const sidebarIndicator = (page: Page) => page.locator('[data-recording-indicator="sidebar"]');
const chip = (page: Page) => page.locator('[data-recording-chip]');

async function shot(page: Page, name: string) {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` });
}

async function startByShortcut(page: Page) {
  await page.keyboard.press('Meta+Shift+r');
  await expect(page.locator('[data-recording-phase="recording"]').first()).toBeAttached();
}

/** Pretend this much has been recorded: the mock reports it as recorded time. */
async function setRecorded(page: Page, seconds: number) {
  await page.evaluate((ms) => {
    (window as unknown as { __RECORDING_MOCK__: { elapsedMs: number | null } }).__RECORDING_MOCK__.elapsedMs = ms;
  }, seconds * 1000);
}

/**
 * Ask the browser whether the visible indicator is over anything it must
 * never cover. Rectangles AND hit-testing: an overlap can be invisible to one
 * of the two (a transparent box still eats clicks; a clipped box overlaps on
 * paper only).
 */
async function measure(page: Page) {
  return page.evaluate(() => {
    const visible = (el: Element | null): el is HTMLElement => {
      if (!(el instanceof HTMLElement)) return false;
      const r = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      if (r.width <= 0 || r.height <= 0 || style.display === 'none' || style.visibility === 'hidden') {
        return false;
      }
      // Something a person can see: not faded out with an ancestor (the
      // sidebar in focus mode is opacity 0 and slid off the left edge).
      for (let node: HTMLElement | null = el; node; node = node.parentElement) {
        if (Number(getComputedStyle(node).opacity) === 0) return false;
      }
      return r.right > 0 && r.bottom > 0 && r.left < innerWidth && r.top < innerHeight;
    };
    const indicators = [...document.querySelectorAll('[data-recording-indicator]')].filter(visible);
    const overlaps = (a: DOMRect, b: DOMRect) =>
      a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
    const settings = document.querySelector<HTMLElement>(
      'nav[aria-label="Workspace sidebar"] button[aria-label="Settings"]',
    );
    const strip = document.querySelector<HTMLElement>('[data-quiet-status]');
    const bar = document.querySelector<HTMLElement>('[data-cmd-bar]');
    const orb = document.querySelector<HTMLElement>('[data-testid="agent-orb"]');

    const against = (target: HTMLElement | null) => {
      // "Laid out", not "visible": the status strip fades to opacity 0 at
      // rest and must still not be covered — it comes back on hover.
      const t = target?.getBoundingClientRect();
      if (!target || !t || t.width <= 0 || t.height <= 0 || getComputedStyle(target).display === 'none') {
        return { present: false, overlap: false, onTop: true };
      }
      const overlap = indicators.some((i) => overlaps(i.getBoundingClientRect(), t));
      // Three points across the target: is the target (not the indicator) hit?
      const y = t.top + t.height / 2;
      const onTop = [t.left + 3, t.left + t.width / 2, t.right - 3].every((x) => {
        const hit = document.elementFromPoint(x, y);
        return hit !== null && !indicators.some((i) => i.contains(hit));
      });
      return { present: true, overlap, onTop };
    };

    const first = indicators[0]?.getBoundingClientRect();
    return {
      count: indicators.length,
      which: indicators.map((i) => i.getAttribute('data-recording-indicator')),
      inViewport: first
        ? first.left >= 0 && first.top >= 0 && first.right <= innerWidth && first.bottom <= innerHeight
        : false,
      // The indicator itself is hit at its own centre: nothing is over IT.
      hittable: first
        ? indicators[0].contains(
            document.elementFromPoint(first.left + first.width / 2, first.top + first.height / 2),
          )
        : false,
      opacity: indicators[0] ? Number(getComputedStyle(indicators[0]).opacity) : 0,
      settings: against(settings),
      strip: against(strip),
      bar: against(bar),
      orb: against(orb),
    };
  });
}

function expectClear(m: Awaited<ReturnType<typeof measure>>, label: string) {
  expect(m.count, `exactly one indicator is visible (${label})`).toBe(1);
  expect(m.inViewport, `the indicator is inside the window (${label})`).toBe(true);
  expect(m.hittable, `nothing covers the indicator (${label})`).toBe(true);
  expect(m.opacity, `the indicator is not dimmed (${label})`).toBe(1);
  for (const [name, target] of Object.entries({
    'Settings button': m.settings,
    'status strip': m.strip,
    'command bar': m.bar,
    orb: m.orb,
  })) {
    expect(target.overlap, `indicator overlaps the ${name} (${label})`).toBe(false);
    expect(target.onTop, `indicator is on top of the ${name} (${label})`).toBe(true);
  }
}

async function setTranslucent(page: Page, on: boolean) {
  await page.evaluate((value) => {
    document.querySelector('.app')?.setAttribute('data-quiet-chrome-transparent', value ? 'true' : 'false');
  }, on);
}

async function setSidebarWidth(page: Page, width: number) {
  await page.evaluate((w) => {
    document.documentElement.style.setProperty('--quiet-sidebar-width', `${w}px`);
    const nav = document.querySelector<HTMLElement>('nav[aria-label="Workspace sidebar"]');
    if (nav) nav.style.width = `${w}px`;
  }, width);
}

tauriTest.describe('Recording — start, watch, stop', () => {
  tauriTest.beforeEach(async ({ waitForAppReady, page }) => {
    await waitForAppReady();
    await openFileInEditor(page, 'welcome.md', 'Welcome to Notesage');
    await expect(page.locator('[data-quiet-status]')).toContainText('words');
  });

  tauriTest('⌘⇧R starts a recording, the indicator says so in words, and ⌘⇧R saves it', async ({ page }) => {
    await expect(sidebarIndicator(page)).toHaveCount(0);
    await startByShortcut(page);

    const indicator = sidebarIndicator(page);
    await expect(indicator).toBeVisible();
    await expect(indicator.locator('[data-recording-state]')).toHaveText('Recording');
    await expect(indicator.locator('[data-recording-source]')).toHaveText('Microphone');
    await expect(indicator.locator('[data-recording-time]')).toHaveText(/^00:0\d$/);
    // The live region announced the start (and only that).
    await expect(page.locator('[data-recording-announcer]')).toContainText('Recording started: Microphone');

    // Recorded time, not wall-clock: what the backend says was written.
    await setRecorded(page, 4503);
    await expect(indicator.locator('[data-recording-time]')).toHaveText('1:15:03');
    await shot(page, 'sidebar-recording');

    // Levels move the meter without anything else changing.
    await emitTauriEvent(page, 'recording-level', { mic: 0.5, system: null });
    await expect
      .poll(() =>
        page.evaluate(() => {
          const bar = document.querySelector<HTMLElement>(
            '[data-recording-indicator="sidebar"] [data-level-bar="mic"]',
          );
          return Number((bar?.style.transform ?? '').replace(/[^\d.]/g, ''));
        }),
      )
      .not.toBe(0);

    await page.keyboard.press('Meta+Shift+r');
    await expect(page.getByText('Recording saved (1:15:03)')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Open Recordings' })).toBeVisible();
    await expect(sidebarIndicator(page)).toHaveCount(0);
    await expect(chip(page)).toHaveCount(0);
    await shot(page, 'saved-toast');
  });

  tauriTest('a held or doubled ⌘⇧R starts exactly one recording', async ({ page }) => {
    await page.keyboard.down('Meta');
    await page.keyboard.down('Shift');
    await page.keyboard.down('r');
    // Auto-repeat while held.
    await page.keyboard.down('r');
    await page.keyboard.down('r');
    await page.keyboard.up('r');
    await page.keyboard.up('Shift');
    await page.keyboard.up('Meta');

    await expect(sidebarIndicator(page)).toBeVisible();
    await expect(sidebarIndicator(page).locator('[data-recording-state]')).toHaveText('Recording');
    // Still recording a moment later: the repeats did not stop it.
    await page.waitForTimeout(400);
    await expect(sidebarIndicator(page).locator('[data-recording-state]')).toHaveText('Recording');
  });

  tauriTest('pause (⌘⇧U and the button) and resume; the timer freezes while paused', async ({ page }) => {
    await startByShortcut(page);
    const indicator = sidebarIndicator(page);

    await page.keyboard.press('Meta+Shift+u');
    await expect(indicator.locator('[data-recording-state]')).toHaveText('Paused');
    const pause = indicator.getByRole('button', { name: 'Resume' });
    await expect(pause).toHaveAttribute('aria-pressed', 'true');
    const frozen = await indicator.locator('[data-recording-time]').textContent();
    await page.waitForTimeout(1300);
    await expect(indicator.locator('[data-recording-time]')).toHaveText(frozen ?? '');
    await shot(page, 'sidebar-paused');

    await pause.click();
    await expect(indicator.locator('[data-recording-state]')).toHaveText('Recording');
    await expect(indicator.getByRole('button', { name: 'Pause' })).toHaveAttribute('aria-pressed', 'false');
  });

  tauriTest('discard asks first; keeping carries on, confirming deletes without a "saved" toast', async ({ page }) => {
    await startByShortcut(page);
    const indicator = sidebarIndicator(page);

    await indicator.getByRole('button', { name: 'Discard recording' }).click();
    const dialog = page.getByRole('alertdialog');
    await expect(dialog).toContainText('Discard this recording?');
    await shot(page, 'discard-dialog');
    await dialog.getByRole('button', { name: 'Keep recording' }).click();
    await expect(dialog).toBeHidden();
    await expect(indicator.locator('[data-recording-state]')).toHaveText('Recording');

    await indicator.getByRole('button', { name: 'Discard recording' }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Discard recording' }).click();
    await expect(page.locator('[data-sonner-toast]', { hasText: 'Recording discarded' })).toBeVisible();
    await expect(sidebarIndicator(page)).toHaveCount(0);
    await expect(page.getByText(/Recording saved \(/)).toHaveCount(0);
  });

  tauriTest('a warning from the backend stays on the indicator until dismissed', async ({ page }) => {
    await startByShortcut(page);
    await emitTauriEvent(page, 'recording-warning', { kind: 'silence', message: 'no signal', fatal: false });
    const warning = sidebarIndicator(page).locator('[data-recording-warning="silence"]');
    await expect(warning).toContainText('No sound is reaching the recording (Microphone)');
    await shot(page, 'sidebar-warning');
    // It does not cover the footer either.
    expectClear(await measure(page), 'with a warning showing');

    await warning.getByRole('button', { name: 'Dismiss warning' }).click();
    await expect(warning).toHaveCount(0);
  });

  for (const translucent of [false, true]) {
    tauriTest(`with the sidebar shown, the indicator covers nothing at any sidebar width (translucent chrome ${translucent ? 'on' : 'off'})`, async ({ page }) => {
      await setTranslucent(page, translucent);
      await startByShortcut(page);
      await expect(sidebarIndicator(page)).toBeVisible();
      await setRecorded(page, 4503);
      await expect(sidebarIndicator(page).locator('[data-recording-time]')).toHaveText('1:15:03');

      for (const width of SIDEBAR_WIDTHS) {
        await setSidebarWidth(page, width);
        const m = await measure(page);
        expect(m.which, `the sidebar placement is the visible one at ${width}px`).toEqual(['sidebar']);
        expectClear(m, `sidebar ${width}px`);
        expect(m.settings.present, `Settings button exists at ${width}px`).toBe(true);
        expect(m.strip.present, `status strip exists at ${width}px`).toBe(true);

        // Nothing in the indicator is clipped: every control is a full 24px target.
        const controls = await page.evaluate(() =>
          [...document.querySelectorAll('[data-recording-indicator="sidebar"] button')].map((b) => {
            const r = b.getBoundingClientRect();
            const nav = document.querySelector('nav[aria-label="Workspace sidebar"]')!.getBoundingClientRect();
            return { w: r.width, h: r.height, inside: r.left >= nav.left && r.right <= nav.right };
          }),
        );
        expect(controls).toHaveLength(3);
        for (const c of controls) {
          expect(c.w, `control width at ${width}px`).toBeGreaterThanOrEqual(24);
          expect(c.h, `control height at ${width}px`).toBeGreaterThanOrEqual(24);
          expect(c.inside, `control inside the sidebar at ${width}px`).toBe(true);
        }
        await shot(page, `sidebar-${width}-${translucent ? 'translucent' : 'opaque'}`);
      }

      // The Settings button still opens Settings.
      await page
        .locator('nav[aria-label="Workspace sidebar"]')
        .getByRole('button', { name: 'Settings' })
        .click();
      const dialog = page.getByRole('dialog').filter({ hasText: 'Settings' }).first();
      await expect(dialog).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(dialog).toBeHidden();
      // And the recording is still running behind it.
      await expect(sidebarIndicator(page).locator('[data-recording-state]')).toHaveText('Recording');
    });
  }

  for (const translucent of [false, true]) {
    tauriTest(`with the sidebar hidden, a chip stays on screen and covers nothing (translucent chrome ${translucent ? 'on' : 'off'})`, async ({ page }) => {
      await setTranslucent(page, translucent);
      await startByShortcut(page);
      await page.keyboard.press('Meta+Shift+l');
      await expect(page.locator('nav[aria-label="Workspace sidebar"]')).toHaveCount(0);

      await expect(chip(page)).toBeVisible();
      await expect(chip(page).locator('[data-recording-state]')).toHaveText('Recording');
      await expect(chip(page).locator('[data-recording-source]')).toHaveText('Microphone');
      const m = await measure(page);
      expect(m.which).toEqual(['floating']);
      expectClear(m, 'sidebar hidden');
      await shot(page, `chip-sidebar-hidden-${translucent ? 'translucent' : 'opaque'}`);

      // With the command bar expanded, too.
      await page.keyboard.press('Meta+k');
      await expect(page.locator('[data-cmd-bar]')).toHaveAttribute('data-expanded', 'true');
      expectClear(await measure(page), 'sidebar hidden, command bar expanded');
      await shot(page, `chip-bar-expanded-${translucent ? 'translucent' : 'opaque'}`);
      await page.keyboard.press('Escape');

      // It can be stopped from the chip.
      await chip(page).getByRole('button', { name: 'Stop and save' }).click();
      await expect(page.getByText(/^Recording saved \(/)).toBeVisible();
      await expect(chip(page)).toHaveCount(0);
    });
  }

  tauriTest('in focus mode the chip takes over at full strength, at every sidebar width', async ({ page }) => {
    await startByShortcut(page);
    await expect(sidebarIndicator(page)).toBeVisible();

    for (const width of SIDEBAR_WIDTHS) {
      await setSidebarWidth(page, width);
      await page.keyboard.press('Meta+.');
      await expect(page.locator('.app.focus-mode')).toHaveCount(1);
      await expect(chip(page)).toBeVisible();
      // The sidebar has slid away; let its transition finish before measuring.
      await page.waitForTimeout(350);

      const m = await measure(page);
      // Focus mode dims the orb to 30% and hides the status strip. Not this.
      expect(m.opacity, `chip opacity in focus mode at ${width}px`).toBe(1);
      expect(m.inViewport, `chip on screen in focus mode at ${width}px`).toBe(true);
      expect(m.hittable, `chip clickable in focus mode at ${width}px`).toBe(true);
      expect(m.bar.overlap, `chip overlaps the command bar at ${width}px`).toBe(false);
      expect(m.bar.onTop, `chip on top of the command bar at ${width}px`).toBe(true);
      expect(m.orb.overlap, `chip overlaps the orb at ${width}px`).toBe(false);
      const left = await chip(page).evaluate((el) => el.getBoundingClientRect().left);
      expect(left, `chip hugs the window edge at ${width}px`).toBe(12);
      await shot(page, `chip-focus-${width}`);

      await page.keyboard.press('Meta+.');
      await expect(page.locator('.app.focus-mode')).toHaveCount(0);
      await expect(chip(page)).toBeHidden();
      await expect(sidebarIndicator(page)).toBeVisible();
    }
  });

  tauriTest('the dot is red in the light and the dark theme (not the accent, which is grey by default)', async ({ page }) => {
    await startByShortcut(page);
    const dotColour = () =>
      page.evaluate(() => {
        const dot = document.querySelector<HTMLElement>(
          '[data-recording-indicator="sidebar"] [data-recording-dot="recording"]',
        );
        // Resolve whatever colour space the theme uses to plain RGB.
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = 1;
        const ctx = canvas.getContext('2d')!;
        ctx.fillStyle = dot ? getComputedStyle(dot).backgroundColor : '#000';
        ctx.fillRect(0, 0, 1, 1);
        const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
        return { r, g, b };
      });

    for (const theme of ['light', 'dark'] as const) {
      const isDark = await page.evaluate(() => document.documentElement.classList.contains('dark'));
      if ((theme === 'dark') !== isDark) await page.keyboard.press('Meta+t');
      await expect
        .poll(() => page.evaluate(() => document.documentElement.classList.contains('dark')))
        .toBe(theme === 'dark');
      const { r, g, b } = await dotColour();
      expect(r, `red channel dominates in ${theme}`).toBeGreaterThan(g + 60);
      expect(r, `red channel dominates in ${theme}`).toBeGreaterThan(b + 60);
      await shot(page, `sidebar-${theme}`);

      // The chip, in the same theme.
      await page.keyboard.press('Meta+Shift+l');
      await expect(chip(page)).toBeVisible();
      await emitTauriEvent(page, 'recording-warning', { kind: 'device-lost', message: 'x', fatal: false });
      await expect(chip(page).locator('[data-recording-warning="device-lost"]')).toBeVisible();
      await shot(page, `chip-warning-${theme}`);
      await chip(page).getByRole('button', { name: 'Dismiss warning' }).click();
      await shot(page, `chip-${theme}`);
      await page.keyboard.press('Meta+Shift+l');
      await expect(sidebarIndicator(page)).toBeVisible();
    }
  });

  tauriTest('typing does not fade it away', async ({ page }) => {
    await startByShortcut(page);
    await page.locator('.ProseMirror[contenteditable="true"]').click();
    await page.keyboard.type('still recording while I write ');
    await expect(page.locator('.app.typing')).toHaveCount(1);
    await page.waitForTimeout(450);
    const m = await measure(page);
    expect(m.count).toBe(1);
    expect(m.opacity).toBe(1);
  });
});

tauriTest.describe('Recording — command bar pinned', () => {
  tauriTest.beforeEach(async ({ waitForAppReady, page }) => {
    // The orb — once the only recording surface — is `display: none` while
    // the command bar is pinned (U2).
    await page.addInitScript(() => {
      localStorage.setItem(
        'notesage-settings',
        JSON.stringify({ state: { cmdBarPinned: true }, version: 29 }),
      );
    });
    await page.reload();
    await waitForAppReady();
    await openFileInEditor(page, 'welcome.md', 'Welcome to Notesage');
    await expect(page.locator('[data-cmd-bar][data-cmd-bar-pinned="true"]')).toBeVisible();
  });

  for (const translucent of [false, true]) {
    tauriTest(`a recording is visible and stoppable (translucent chrome ${translucent ? 'on' : 'off'})`, async ({ page }) => {
      await setTranslucent(page, translucent);
      await expect(page.locator('[data-testid="agent-orb"]')).toBeHidden();
      await startByShortcut(page);

      // Sidebar shown: the sidebar row.
      await expect(sidebarIndicator(page)).toBeVisible();
      for (const width of SIDEBAR_WIDTHS) {
        await setSidebarWidth(page, width);
        const m = await measure(page);
        expect(m.which).toEqual(['sidebar']);
        expectClear(m, `pinned bar, sidebar ${width}px`);
      }
      await shot(page, `pinned-sidebar-${translucent ? 'translucent' : 'opaque'}`);

      // Sidebar hidden: the chip, clear of the pinned panel.
      await page.keyboard.press('Meta+Shift+l');
      await expect(chip(page)).toBeVisible();
      const m = await measure(page);
      expect(m.which).toEqual(['floating']);
      expectClear(m, 'pinned bar, sidebar hidden');
      expect(m.bar.present).toBe(true);
      await shot(page, `pinned-chip-${translucent ? 'translucent' : 'opaque'}`);

      await chip(page).getByRole('button', { name: 'Stop and save' }).click();
      await expect(page.getByText(/^Recording saved \(/)).toBeVisible();
    });
  }
});
