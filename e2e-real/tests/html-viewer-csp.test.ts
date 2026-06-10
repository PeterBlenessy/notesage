/**
 * HTML viewer CSP-render E2E (real Tauri WKWebView).
 *
 * Regression guard for the alpha.22 break where the app's Content-Security-Policy
 * (added in #444) refused the HTML viewer's own inline <style> blocks and web
 * fonts. The viewer's script-enabled / unsafe iframe paths now render from a
 * blob: URL instead of `srcDoc`, so the document is its OWN CSP context and its
 * styles apply — while staying sandboxed (`allow-scripts`, no allow-same-origin).
 *
 * This MUST run in the real webview: a `srcdoc` iframe inherits the host CSP and
 * a `blob:` one does not, and that inheritance behaviour is WKWebView-specific —
 * jsdom can't verify it. The test opens a styled .html fixture with
 * `htmlViewerAllowScripts` on, switches into the sandboxed frame, and asserts the
 * document's inline-style background actually applied (impossible if CSP-blocked).
 */
import * as path from 'path';

import { tauriInvoke } from '../helpers/actions';
import { ensureProjectOpen } from '../helpers/setup';

const TEST_PROJECT_PATH = path.resolve(process.cwd(), 'e2e-real/fixtures/test-project');
const HTML_FILE = 'csp-style-test.html';
// The exact background set by the fixture's inline <style>. A CSP-blocked inline
// style would leave the body transparent (rgba(0, 0, 0, 0)) instead.
const EXPECTED_BG = 'rgb(7, 13, 29)';

describe('HTML viewer renders document styles under the app CSP', () => {
    before(async () => {
        await ensureProjectOpen(TEST_PROJECT_PATH);
        // Enable the script-enabled iframe render path (persistent setting).
        await browser.execute(() => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const w = window as any;
            w.__E2E_SETTINGS_STORE__?.getState().setHtmlViewerAllowScripts(true);
        });
    });

    after(async () => {
        await browser.execute(() => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const w = window as any;
            w.__E2E_SETTINGS_STORE__?.getState().setHtmlViewerAllowScripts(false);
        });
    });

    beforeEach(async () => {
        await browser.switchToParentFrame().catch(() => {});
        // Close any open documents so the viewer mounts fresh.
        await browser.execute(() => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const w = window as any;
            const s = w.__E2E_EDITOR_STORE__?.getState();
            for (const tab of [...(s?.openDocuments ?? [])]) s.closeTab(tab.id);
        });
    });

    it('applies the document\'s own inline <style> (blob escapes the host CSP)', async () => {
        const filePath = `${TEST_PROJECT_PATH}/${HTML_FILE}`;
        const content = await tauriInvoke<string>('read_file', { path: filePath });

        // Open the .html file. fileType MUST be "other" — openTab defaults to
        // "markdown" (opens the ProseMirror editor, not the viewer). "other"
        // routes EditorViewerContainer → PlainTextViewer → HtmlViewer, which
        // (allowScripts ON) renders the document in a sandboxed blob: iframe.
        await browser.execute(
            (fp: string, name: string, html: string) => {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const w = window as any;
                w.__E2E_EDITOR_STORE__?.getState().openTab(fp, name, html, null, 'other');
            },
            filePath,
            HTML_FILE,
            content,
        );

        // The viewer must render an iframe sourced from a blob: URL (not srcdoc).
        const iframe = await browser.$('iframe');
        await iframe.waitForExist({ timeout: 10000 });
        await browser.waitUntil(
            async () => ((await iframe.getAttribute('src')) ?? '').startsWith('blob:'),
            { timeout: 10000, timeoutMsg: 'iframe never received a blob: src' },
        );
        expect((await iframe.getAttribute('sandbox')) ?? '').toContain('allow-scripts');

        // Switch into the sandboxed frame and read the computed background. If the
        // inline <style> were CSP-refused, this would be transparent, not navy.
        await browser.switchToFrame(iframe);
        try {
            await browser.waitUntil(
                async () =>
                    (await browser.execute(
                        () => getComputedStyle(document.body).backgroundColor,
                    )) === EXPECTED_BG,
                { timeout: 10000, timeoutMsg: `body background never became ${EXPECTED_BG}` },
            );
            const bg = await browser.execute(
                () => getComputedStyle(document.body).backgroundColor,
            );
            expect(bg).toBe(EXPECTED_BG);
        } finally {
            await browser.switchToParentFrame();
        }
    });
});
