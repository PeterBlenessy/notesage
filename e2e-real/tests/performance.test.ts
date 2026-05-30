/**
 * Performance E2E tests.
 *
 * Validates that the editor handles large documents, rapid interactions,
 * and layout changes without degrading below acceptable thresholds.
 *
 * Run manually:
 *   Terminal 1: pnpm tauri:test
 *   Terminal 2: tauri-webdriver
 *   Terminal 3: pnpm test:e2e-real
 *
 * In CI this spec runs via `.github/workflows/test-perf-e2e.yml` (post-merge,
 * push to main only). It does NOT run in the PR gate (`test.yml`).
 */

import * as fs from 'fs';
import * as path from 'path';
import { waitForElement, openFile, getEditorText } from '../helpers/actions';
import { measureAction } from '../helpers/timing';
import { ensureCleanState, ensureProjectOpen } from '../helpers/setup';

const TEST_PROJECT = path.resolve(process.cwd(), 'e2e-real/fixtures/test-project');

// Accumulated timing results — written to perf-results.json in after().
const timingResults: Record<string, number> = {};

describe('Performance', function () {
    // These tests involve large documents and multiple file operations —
    // give them generous timeouts.
    this.timeout(30000);

    before(async () => {
        await browser.setWindowSize(1200, 800);
        const root = await browser.$('#root');
        await root.waitForExist({ timeout: 5000, timeoutMsg: 'App root not found within 5s' });
        await ensureProjectOpen(TEST_PROJECT);
    });

    beforeEach(async () => {
        await ensureCleanState();
        // Brief pause to let the UI settle after clearing tabs
        await browser.pause(300);
    });

    after(async () => {
        // Restore the default window size in case a test changed it
        await browser.setWindowSize(1200, 800);

        // Write timing measurements to perf-results.json for CI artifact upload.
        const output = {
            timestamp: new Date().toISOString(),
            commitSha: process.env.GITHUB_SHA ?? 'local',
            runner: process.env.RUNNER_NAME ?? 'local',
            measurements: timingResults,
        };
        const outPath = path.resolve(process.cwd(), 'perf-results.json');
        fs.writeFileSync(outPath, JSON.stringify(output, null, 2));
        console.log(`[perf] Results written to ${outPath}`);
    });

    // -------------------------------------------------------------------
    // Test 1: Large document load time
    // -------------------------------------------------------------------
    it('should load a 1000+ line document within 3 seconds', async () => {
        const { duration } = await measureAction(async () => {
            await openFile('large-doc.md');
        });

        console.log(`[perf] Large document load time: ${duration.toFixed(0)}ms`);
        timingResults['large-document-load-ms'] = duration;
        expect(duration).toBeLessThan(3000);

        // Verify some expected content actually rendered
        const text = await getEditorText();
        expect(text).toContain('Section 1: Implementation Details');
        expect(text).toContain('Section 50: Performance Profiling');
        console.log(`[perf] Document content verified — ${text.length} characters rendered`);
    });

    // -------------------------------------------------------------------
    // Test 2: Keystroke latency in a large document
    // -------------------------------------------------------------------
    it('should maintain < 100ms average keystroke latency in a large document', async () => {
        await openFile('large-doc.md');

        // Scroll to the bottom so we are typing deep in the document
        await browser.execute(() => {
            const pm = document.querySelector('.ProseMirror');
            if (pm) pm.scrollTo(0, 999999);
        });
        await browser.pause(300);

        // Focus the editor
        const editor = await waitForElement('.ProseMirror');
        await editor.click();

        // Move cursor to the end of the document
        await browser.execute(() => {
            const pm = document.querySelector('.ProseMirror');
            if (!pm) return;
            const selection = window.getSelection();
            if (!selection) return;
            const range = document.createRange();
            range.selectNodeContents(pm);
            range.collapse(false); // collapse to end
            selection.removeAllRanges();
            selection.addRange(range);
        });
        await browser.pause(100);

        // Type 10 characters one at a time, measuring each keystroke
        const latencies: number[] = [];
        const chars = 'abcdefghij'.split('');

        for (const char of chars) {
            const before: number = await browser.execute(() => performance.now());
            await browser.keys([char]);
            // Wait a tick for ProseMirror to process the transaction.
            // NOTE: cannot `browser.execute(() => new Promise(...))` because
            // WebDriver/WKWebView cannot marshal Promise return values back
            // through `execute/sync`. `browser.pause(16)` is one frame and
            // achieves the same purpose.
            await browser.pause(16);
            const after: number = await browser.execute(() => performance.now());
            latencies.push(after - before);
        }

        const avg = latencies.reduce((a, b) => a + b, 0) / latencies.length;
        const max = Math.max(...latencies);
        const min = Math.min(...latencies);

        console.log(`[perf] Keystroke latencies (ms): ${latencies.map((l) => l.toFixed(1)).join(', ')}`);
        console.log(`[perf] Keystroke avg: ${avg.toFixed(1)}ms, min: ${min.toFixed(1)}ms, max: ${max.toFixed(1)}ms`);
        timingResults['keystroke-avg-ms'] = avg;
        timingResults['keystroke-max-ms'] = max;
        timingResults['keystroke-min-ms'] = min;

        expect(avg).toBeLessThan(100);
    });

    // -------------------------------------------------------------------
    // Test 3 (removed): "reflow content on resize without losing scroll
    // position".
    //
    // Removed because it was low-value and high-cost. Value: it only verified
    // that scroll position is roughly preserved when the window is resized — a
    // minor UX nicety — and on CI WKWebView it self-skipped most of the time
    // anyway (the very `setWindowSize` quirk it probed resets scrollTop to 0,
    // tripping its own `scrollAfter === 0` bail-out). Cost: the mid-test
    // `browser.setWindowSize()` is the confirmed trigger of the real-E2E
    // session-timeout cascade — it wedges tauri-plugin-webdriver's session
    // teardown, after which every subsequent spec fails to create a session.
    // This `performance.test.ts` was the spec in the traced cascade runs.
    // run-real-e2e.sh now also restarts-on-failure as defence-in-depth, but
    // dropping this dynamic resize removes the most frequent trigger outright.
    // (The static setWindowSize(1200, 800) in setup is benign and stays.)

    // -------------------------------------------------------------------
    // Test 4: Rapid sequential file opens (Quiet Composer single-doc shell)
    //
    // Originally "rapid tab switching" — that test opened 4 files and
    // expected 4 tabs in `openDocuments`. PR #333 (Classic Layout removal)
    // made the shell single-document: `openTab` evicts the prior active
    // document, so the array is always length 1. The replacement here
    // measures the same underlying concern (no crash / no stale content
    // under rapid file-open pressure) reshaped for the new semantics —
    // open 4 files back-to-back, assert the last one's content is what's
    // visible and no JS errors fired.
    //
    // (The "no stale content" invariant is also covered by
    // `startup.test.ts > should not show stale content from previous file
    // after sequential open`. This case adds the "rapid + multiple files"
    // pressure that the old tab-switching test was probing.)
    // -------------------------------------------------------------------
    it('should handle rapid sequential file opens without errors', async () => {
        const files = ['README.md', 'notes.md', 'code-examples.md', 'large-doc.md'];

        const { duration } = await measureAction(async () => {
            for (const file of files) {
                await openFile(file);
            }
        });

        console.log(`[perf] Rapid sequential opens (${files.length} files): ${duration.toFixed(0)}ms`);
        timingResults['rapid-open-ms'] = duration;

        // Single-doc shell: exactly 1 entry in openDocuments after the
        // last open, and the active tab is the last file.
        const state: { count: number; activePath: string | null } = await browser.execute(() => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const s = (window as any).__E2E_EDITOR_STORE__?.getState();
            if (!s) return { count: 0, activePath: null };
            const active = s.openDocuments.find((t: { id: string; filePath: string }) => t.id === s.activeTabId);
            return { count: s.openDocuments.length, activePath: active?.filePath ?? null };
        });
        console.log(`[perf] Active doc after rapid opens: ${state.activePath} (openDocuments.length=${state.count})`);
        expect(state.count).toBe(1);
        expect(state.activePath ?? '').toContain(files[files.length - 1]);

        // Settle, then verify the editor renders the last file's content.
        await browser.pause(500);
        const text = await getEditorText();
        console.log(`[perf] Final editor content length: ${text.length} characters`);
        expect(text.length).toBeGreaterThan(0);

        // Best-effort console error sweep (tauri-webdriver doesn't expose
        // browser logs — gated behind getLogs availability).
        if (typeof browser.getLogs === 'function') {
            const logs = await browser.getLogs('browser');
            const errors = logs.filter(
                (log: { level: string; message: string }) =>
                    log.level === 'SEVERE' &&
                    !log.message.includes('favicon') &&
                    !log.message.includes('DevTools'),
            );
            if (errors.length > 0) {
                console.log(`[perf] Browser errors after rapid opens:`, errors);
            }
            expect(errors.length).toBe(0);
        }

        console.log(`[perf] Rapid sequential opens completed without errors`);
    });
});
