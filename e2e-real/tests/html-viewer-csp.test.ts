/**
 * HTML viewer CSP-render E2E (real Tauri WKWebView).
 *
 * Regression guard for the alpha.22 break where the app's Content-Security-Policy
 * (added in #444) refused the HTML viewer's own inline <style> blocks and blanked
 * the frame outright. The viewer's script-enabled / unsafe iframe paths render
 * from the `htmlpreview://` custom scheme — a real origin whose response carries
 * its OWN empty CSP — so the document's styles apply while it stays sandboxed
 * (`allow-scripts`, no allow-same-origin).
 *
 * This MUST run in the real webview. Both `srcDoc` and `blob:` documents INHERIT
 * the host CSP — `blob:` only *appeared* to escape it because that inheritance is
 * WebKit-version-specific (older WebKit, incl. the CI runner, didn't inherit;
 * macOS Tahoe does, which is how the production blanking slipped past this very
 * test). A custom-scheme response inherits nothing on every WebKit, so this test
 * is now version-independent. It opens a styled .html fixture with
 * `htmlViewerAllowScripts` on and asserts the inline-style background applied.
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
 * the default white. Dark centre pixel ⇒ inline styles applied ⇒ the document
 * rendered under its own empty CSP.
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

    it('applies the document\'s own inline <style> (custom scheme has its own empty CSP)', async () => {
        const filePath = `${TEST_PROJECT_PATH}/${HTML_FILE}`;
        const content = await tauriInvoke<string>('read_file', { path: filePath });

        // Open the .html file. fileType MUST be "other" — openTab defaults to
        // "markdown" (opens the ProseMirror editor, not the viewer). "other"
        // routes EditorViewerContainer → PlainTextViewer → HtmlViewer, which
        // (allowScripts ON) renders the document in a sandboxed htmlpreview://
        // iframe.
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

        // The viewer must render an iframe sourced from the htmlpreview:// scheme.
        const iframe = await browser.$('iframe');
        await iframe.waitForExist({ timeout: 10000 });
        await browser.waitUntil(
            async () => ((await iframe.getAttribute('src')) ?? '').startsWith('htmlpreview://'),
            { timeout: 10000, timeoutMsg: 'iframe never received an htmlpreview:// src' },
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
                    `inline <style> appears CSP-blocked (document did not render under its own CSP)`,
            },
        );
        // Sanity: it should be navy-ish, not just any dark colour.
        expect(pixel.b).toBeGreaterThan(pixel.r);
        console.log(`[csp-test] frame centre pixel: rgb(${pixel.r}, ${pixel.g}, ${pixel.b}) — styles applied`);
    });

    it('searches inside the sandboxed iframe via postMessage (find-in-document)', async () => {
        const filePath = `${TEST_PROJECT_PATH}/${HTML_FILE}`;
        const content = await tauriInvoke<string>('read_file', { path: filePath });
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
        const iframe = await browser.$('iframe');
        await iframe.waitForExist({ timeout: 10000 });
        await browser.waitUntil(
            async () => ((await iframe.getAttribute('src')) ?? '').startsWith('htmlpreview://'),
            { timeout: 10000, timeoutMsg: 'iframe never received an htmlpreview:// src' },
        );

        // Open the find bar (Cmd+F path) and search for a word that appears once
        // in the fixture body ("navy"). The host can't reach into the sandboxed
        // frame — the match count below only updates if the injected in-frame
        // script received the query over postMessage, searched, and posted back.
        //
        // Robustness: the query may be typed before the sandboxed document has
        // finished loading its injected find script, in which case the first
        // `search` postMessage is dropped. HtmlViewer re-sends the active query on
        // the iframe `load` event (handleIframeLoad), so the count is guaranteed
        // to arrive once the document is ready — no race, no flake.
        await browser.execute(() => window.dispatchEvent(new Event('notesage:find-open')));
        const input = await browser.$('input[aria-label="Find in document"]');
        await input.waitForExist({ timeout: 10000 });
        await input.setValue('navy');

        await browser.waitUntil(
            async () => {
                const count = await browser.execute(() => {
                    const spans = Array.from(document.querySelectorAll('span'));
                    const el = spans.find((s) => /^\d+\/\d+$/.test((s.textContent || '').trim()));
                    return el ? (el.textContent || '').trim() : null;
                });
                return count === '1/1';
            },
            { timeout: 15000, timeoutMsg: 'find bar never showed the in-frame match count (1/1)' },
        );
        console.log('[csp-test] in-frame search reported 1/1 for "navy"');
    });
});
