/**
 * Marketing screenshot capture (manual — NOT part of the CI real-E2E suite).
 * Drives the real app over the demo workspace (content/demo) and writes PNGs
 * into content/screenshots/. Run via scripts/capture-screenshots.sh.
 *
 * Robustness: opens docs via the editor store directly (not openFile's strict
 * sentinel), waits for the editor surface to exist, and always screenshots —
 * a failed pose leaves a shot to inspect rather than aborting the whole run.
 */
import { openProject, tauriInvoke, pressShortcut } from '../helpers/actions';
import path from 'node:path';
import { mkdirSync } from 'node:fs';

const REPO = process.cwd();
const DEMO = path.join(REPO, 'content', 'demo');
const OUT = path.join(REPO, 'content', 'screenshots');

/** Open the demo project + hero doc, waiting generously for the content to
 *  render. The startup indexer thrashes CPU on launch, so the doc-switch/parse
 *  pipeline can take a while — WAIT for the content rather than reload (a reload
 *  just restarts the pipeline and never lets it finish). */
async function openHero(): Promise<void> {
  await openProject(DEMO);
  await setSidebar(true);
  const fp = `${DEMO}/Essays/On Attention.md`;
  const content = await tauriInvoke<string>('read_file', { path: fp });
  await browser.execute((p: string, c: string) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).__E2E_EDITOR_STORE__?.getState().openTab(p, p.split('/').pop(), c);
  }, fp, content);
  try {
    await browser.waitUntil(
      async () =>
        browser.execute(() => {
          const pm = document.querySelector('.ProseMirror') as HTMLElement | null;
          return !!pm && (pm.innerText || '').includes('On Attention');
        }),
      { timeout: 30000, interval: 500 },
    );
  } catch {
    // Dump the live editor state so we can see WHY the content is blank instead
    // of guessing (does the tab hold content? is there an error boundary? how
    // many .ProseMirror nodes? source vs wysiwyg? load error?).
    const diag = await browser.execute(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const w = window as any;
      const es = w.__E2E_EDITOR_STORE__?.getState?.() ?? {};
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const active = (es.openDocuments || []).find((t: any) => t.id === es.activeTabId);
      const pm = document.querySelector('.ProseMirror') as HTMLElement | null;
      return {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        docs: (es.openDocuments || []).map((t: any) => ({
          name: t.fileName,
          active: t.id === es.activeTabId,
          loaded: t.contentLoaded,
          type: t.fileType,
          view: t.viewMode,
          len: t.content?.length,
          err: t.loadError,
        })),
        activeContentLen: active?.content?.length ?? null,
        pmCount: document.querySelectorAll('.ProseMirror').length,
        pmHtmlLen: pm ? pm.innerHTML.length : -1,
        pmText: pm ? pm.innerText.slice(0, 60) : null,
        docArea: (document.querySelector('[data-doc-area]') as HTMLElement)?.innerText?.slice(0, 140),
        errorBoundary: document.body.innerText.includes('Something went wrong'),
      };
    });
    // eslint-disable-next-line no-console
    console.log('[DIAG] blank editor →', JSON.stringify(diag));
  }
  await browser.pause(800);
}

async function setTheme(theme: 'light' | 'dark'): Promise<void> {
  await browser.execute((t: string) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).__E2E_SETTINGS_STORE__?.getState().setTheme(t);
  }, theme);
  await browser.pause(500);
}

async function setSidebar(pinned: boolean): Promise<void> {
  await browser.execute((p: boolean) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const s = (window as any).__E2E_SETTINGS_STORE__?.getState();
    if (s && s.sidebarPinned !== p) s.setSidebarPinned(p);
  }, pinned);
  await browser.pause(350);
}

/** Dismiss the alpha telemetry first-run notice by clicking its close button —
 *  a real dismissal, like a user would (the toast has `closeButton: true`). */
async function dismissNotice(): Promise<void> {
  const close = await browser.$('[data-sonner-toast] [data-close-button]');
  await close.waitForExist({ timeout: 5000 }).catch(() => {});
  if (await close.isExisting().catch(() => false)) {
    await close.click().catch(() => {});
    await browser.pause(400);
  }
}

/** Clear stray hover tooltips / suggestion popovers and blur the active target,
 *  then park the caret on the title so no link/tag tooltip lingers. Not for the
 *  command-bar shots (Escape would close the bar). */
async function clearTransient(): Promise<void> {
  await browser.keys(['Escape']);
  await browser.execute(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (document.activeElement as HTMLElement)?.blur?.();
    window.getSelection?.()?.removeAllRanges?.();
    // Remove any orphaned portal tooltips/popovers left at the viewport origin.
    document
      .querySelectorAll('[data-radix-popper-content-wrapper],[role="tooltip"]')
      .forEach((e) => (e as HTMLElement).remove());
  });
  await browser.pause(250);
}

async function shot(name: string): Promise<void> {
  // Strip transient chrome (sonner toasts, orphaned tooltips/popovers) right
  // before the frame so no notice bleeds into a marketing shot.
  await browser.execute(() => {
    document
      .querySelectorAll('[role="tooltip"],[data-radix-popper-content-wrapper]')
      .forEach((e) => (e as HTMLElement).remove());
  });
  await browser.pause(150);
  try {
    await browser.saveScreenshot(path.join(OUT, name));
    // eslint-disable-next-line no-console
    console.log('[shot] wrote ' + name);
  } catch (e) {
    // eslint-disable-next-line no-console
    console.log('[shot] FAILED ' + name + ' — ' + String(e));
  }
}

describe('marketing screenshots (manual)', () => {
  before(async () => {
    mkdirSync(OUT, { recursive: true });
    const root = await browser.$('#root');
    await root.waitForExist({ timeout: 20000 });
    // Window size is controlled at LAUNCH via the window-state plugin (see
    // scripts/capture-screenshots.sh) — NOT via a runtime browser.setWindowSize,
    // which wedges the Tiptap editor and leaves it blank.
    await browser.pause(1500);
    await openHero();
    await dismissNotice();
    await clearTransient();
  });

  it('editor — light + dark', async () => {
    await clearTransient();
    await setTheme('light');
    await shot('editor-light.png');
    await setTheme('dark');
    await shot('editor-dark.png');
    await setTheme('light');
  });

  it('quiet composer command bar — light + dark', async () => {
    await pressShortcut(['Meta', 'k']);
    await browser.pause(700);
    await setTheme('light');
    await shot('quiet-composer-light.png');
    await setTheme('dark');
    await shot('quiet-composer-dark.png');
    await pressShortcut(['Escape']);
    await setTheme('light');
  });

  it('sidebar', async () => {
    await setSidebar(true);
    await clearTransient();
    await shot('sidebar.png');
  });

  it('export dialog', async () => {
    await clearTransient();
    await pressShortcut(['Meta', 'Shift', 'e']);
    await browser.pause(1000);
    await shot('export-dialog.png');
    await pressShortcut(['Escape']);
    await browser.pause(300);
  });

  it('AI command bar', async () => {
    await pressShortcut(['Meta', 'k']);
    await browser.pause(600);
    await shot('ai-chat.png');
    await pressShortcut(['Escape']);
  });
});
