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
import * as zlib from 'node:zlib';

import { tauriInvoke } from '../helpers/actions';
import { ensureProjectOpen } from '../helpers/setup';

const TEST_PROJECT_PATH = path.resolve(process.cwd(), 'e2e-real/fixtures/test-project');
const HTML_FILE = 'csp-style-test.html';

/**
 * Decode the centre pixel of a base64 PNG (built-in zlib only — no image dep).
 *
 * We can't read computed styles INSIDE the viewer's iframe: it is
 * `sandbox="allow-scripts"` with no `allow-same-origin` (opaque origin), and
 * WebDriver cannot execute script in that context. So we screenshot the frame
 * and inspect a pixel instead. The fixture's inline <style> paints the body a
 * distinctive navy; if the inline <style> were CSP-refused the frame would be
 * the default white. Dark centre pixel ⇒ inline styles applied ⇒ blob escaped
 * the host CSP.
 */
function centrePixel(b64: string): { r: number; g: number; b: number } {
    const buf = Buffer.from(b64, 'base64');
    let pos = 8; // skip PNG signature
    let width = 0;
    let height = 0;
    let colorType = 0;
    const idat: Buffer[] = [];
    while (pos < buf.length) {
        const len = buf.readUInt32BE(pos);
        const type = buf.toString('ascii', pos + 4, pos + 8);
        const data = buf.subarray(pos + 8, pos + 8 + len);
        if (type === 'IHDR') {
            width = data.readUInt32BE(0);
            height = data.readUInt32BE(4);
            colorType = data[9];
        } else if (type === 'IDAT') {
            idat.push(data);
        } else if (type === 'IEND') {
            break;
        }
        pos += 12 + len;
    }
    const raw = zlib.inflateSync(Buffer.concat(idat));
    const bpp = colorType === 6 ? 4 : colorType === 2 ? 3 : colorType === 0 ? 1 : 4;
    const rowBytes = width * bpp;
    const stride = rowBytes + 1;
    const out = Buffer.alloc(rowBytes * height);
    for (let y = 0; y < height; y++) {
        const filter = raw[y * stride];
        for (let x = 0; x < rowBytes; x++) {
            const rb = raw[y * stride + 1 + x];
            const a = x >= bpp ? out[y * rowBytes + x - bpp] : 0;
            const b = y > 0 ? out[(y - 1) * rowBytes + x] : 0;
            const c = x >= bpp && y > 0 ? out[(y - 1) * rowBytes + x - bpp] : 0;
            let v = rb;
            if (filter === 1) v = rb + a;
            else if (filter === 2) v = rb + b;
            else if (filter === 3) v = rb + ((a + b) >> 1);
            else if (filter === 4) {
                const p = a + b - c;
                const pa = Math.abs(p - a);
                const pb = Math.abs(p - b);
                const pc = Math.abs(p - c);
                v = rb + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
            }
            out[y * rowBytes + x] = v & 0xff;
        }
    }
    const cx = Math.floor(width / 2);
    const cy = Math.floor(height / 2);
    const i = cy * rowBytes + cx * bpp;
    return { r: out[i], g: out[i + 1], b: out[i + 2] };
}

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

        // Screenshot the frame and check its centre pixel is the fixture's navy
        // (inline <style> applied → blob escaped the CSP). White/light ⇒ the
        // inline style was CSP-refused or the doc didn't render. Poll: the blob
        // document + its layout may take a beat after the iframe element exists.
        let pixel = { r: 255, g: 255, b: 255 };
        await browser.waitUntil(
            async () => {
                const shot = await iframe.takeScreenshot().catch(() => null);
                if (!shot) return false;
                pixel = centrePixel(shot);
                // navy is dark (7+13+29 = 49); white is 765. Use a generous dark cutoff.
                return pixel.r + pixel.g + pixel.b < 150;
            },
            {
                timeout: 15000,
                timeoutMsg: () =>
                    `frame centre pixel never went dark — got rgb(${pixel.r}, ${pixel.g}, ${pixel.b}); ` +
                    `inline <style> appears CSP-blocked (blob did not escape the host CSP)`,
            },
        );
        // Sanity: it should be navy-ish, not just any dark colour.
        expect(pixel.b).toBeGreaterThan(pixel.r);
        console.log(`[csp-test] frame centre pixel: rgb(${pixel.r}, ${pixel.g}, ${pixel.b}) — styles applied`);
    });
});
