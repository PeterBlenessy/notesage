/**
 * Live diagnostic (manual). Opens the demo project + hero note WITHOUT the
 * sentinel wait, then dumps what's actually on screen so we can see why the
 * capture's openFile hangs (first-run modal? editor not rendering? wrong view?).
 */
import { openProject, tauriInvoke } from '../helpers/actions';
import path from 'node:path';

const REPO = process.cwd();
const DEMO = path.join(REPO, 'content', 'demo');

describe('diagnose (manual)', () => {
  it('dumps live state after opening the demo hero note', async () => {
    const root = await browser.$('#root');
    await root.waitForExist({ timeout: 20000 });
    await browser.pause(1200);

    const initial = await browser.execute(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const w = window as any;
      const overlays = Array.from(
        document.querySelectorAll('[role="dialog"],[role="alertdialog"],[data-radix-popper-content-wrapper]'),
      )
        .map((e) => (e as HTMLElement).innerText?.slice(0, 100))
        .filter(Boolean);
      const s = w.__E2E_SETTINGS_STORE__?.getState?.() ?? {};
      return {
        stores: {
          workspace: !!w.__E2E_WORKSPACE_STORE__,
          editor: !!w.__E2E_EDITOR_STORE__,
          settings: !!w.__E2E_SETTINGS_STORE__,
        },
        overlays,
        settings: {
          telemetryNoticeSeen: s.telemetryNoticeSeen,
          uiPreview: s.uiPreview,
          theme: s.theme,
          startupReady: s.startupReady,
          sidebarPinned: s.sidebarPinned,
        },
        pmExists: !!document.querySelector('.ProseMirror'),
        pmText: (document.querySelector('.ProseMirror') as HTMLElement)?.innerText?.slice(0, 120),
        bodyHead: document.body.innerText?.slice(0, 200),
      };
    });
    console.log('[diag] INITIAL:', JSON.stringify(initial, null, 2));

    await openProject(DEMO);
    console.log('[diag] project opened:', DEMO);

    const filePath = `${DEMO}/Essays/On Attention.md`;
    const content = await tauriInvoke<string>('read_file', { path: filePath });
    console.log('[diag] read_file len=' + content.length + ' head=' + JSON.stringify(content.slice(0, 50)));

    await browser.execute(
      (fp: string, c: string) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const w = window as any;
        w.__E2E_EDITOR_STORE__?.getState().openTab(fp, 'On Attention.md', c);
      },
      filePath,
      content,
    );
    await browser.pause(3000);

    const after = await browser.execute(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const w = window as any;
      const es = w.__E2E_EDITOR_STORE__?.getState?.() ?? {};
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const active = (es.openDocuments || []).find((t: any) => t.id === es.activeTabId);
      const overlays = Array.from(document.querySelectorAll('[role="dialog"],[role="alertdialog"]'))
        .map((e) => (e as HTMLElement).innerText?.slice(0, 120))
        .filter(Boolean);
      return {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        openDocs: (es.openDocuments || []).map((t: any) => ({
          name: t.fileName,
          active: t.id === es.activeTabId,
          loaded: t.contentLoaded,
          type: t.fileType,
          len: t.content?.length,
        })),
        activeName: active?.fileName,
        overlays,
        pmExists: !!document.querySelector('.ProseMirror'),
        pmText: (document.querySelector('.ProseMirror') as HTMLElement)?.innerText?.slice(0, 200),
        bodyHead: document.body.innerText?.slice(0, 240),
      };
    });
    console.log('[diag] AFTER openTab:', JSON.stringify(after, null, 2));

    await browser.saveScreenshot('/tmp/ns-diag.png');
    // eslint-disable-next-line no-console
    console.log('[diag] saved /tmp/ns-diag.png');
  });
});
