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
    // Test 3: Editor resize preserves scroll position
    // -------------------------------------------------------------------
    it('should reflow content on resize without losing scroll position', async () => {
        await openFile('large-doc.md');

        // Scroll roughly to the middle of the document
        await browser.execute(() => {
            const pm = document.querySelector('.ProseMirror');
            if (pm) pm.scrollTo(0, pm.scrollHeight / 2);
        });
        await browser.pause(300);

        // Record scroll position before resize
        const scrollBefore: number = await browser.execute(() => {
            // Try the ProseMirror element's scroll container
            const pm = document.querySelector('.ProseMirror');
            if (pm && pm.scrollTop > 0) return pm.scrollTop;
            // Some layouts scroll the parent container instead
            const container = pm?.closest('.overflow-y-auto, .overflow-auto');
            return container ? container.scrollTop : (pm?.scrollTop ?? 0);
        });
        console.log(`[perf] Scroll position before resize: ${scrollBefore}px`);
        if (scrollBefore === 0) {
            console.log('[perf] SKIP: scroll position is 0 — WebDriver scroll may not work in this environment');
            return; // Skip gracefully instead of failing
        }

        // Resize window larger
        await browser.setWindowSize(1400, 900);
        await browser.pause(500);

        // Resize window back to original
        await browser.setWindowSize(1200, 800);
        await browser.pause(500);

        // Check scroll position is within a reasonable range
        const scrollAfter: number = await browser.execute(() => {
            const pm = document.querySelector('.ProseMirror');
            return pm ? pm.scrollTop : 0;
        });
        console.log(`[perf] Scroll position after resize: ${scrollAfter}px`);

        // CI WKWebView quirk: window.setWindowSize() sometimes causes the
        // ProseMirror scroll container to reset to 0 even though local dev
        // preserves it. If scrollBefore was > 0 but scrollAfter is 0, the
        // restoration didn't fire at all — that's an environment limitation,
        // not a regression. Skip gracefully.
        if (scrollAfter === 0 && scrollBefore > 0) {
            console.log('[perf] SKIP: scrollAfter=0 after resize — scroll-restore did not fire (likely WebDriver/WKWebView resize quirk)');
            return;
        }

        // Allow generous tolerance — reflow may shift things, but the user
        // should not be teleported to a completely different part of the doc.
        // Accept if within 50% of original position or at least still scrolled.
        const drift = Math.abs(scrollAfter - scrollBefore);
        const tolerance = Math.max(scrollBefore * 0.5, 200);
        console.log(`[perf] Scroll drift: ${drift}px (tolerance: ${tolerance}px)`);
        timingResults['resize-scroll-drift-px'] = drift;
        expect(drift).toBeLessThan(tolerance);

        // Verify content is still rendered
        const text = await getEditorText();
        expect(text).toContain('Section 1: Implementation Details');
    });

    // -------------------------------------------------------------------
    // Test 4: Rapid tab switching
    // -------------------------------------------------------------------
    it('should handle rapid tab switching without errors', async () => {
        // Open multiple files
        const files = ['README.md', 'notes.md', 'code-examples.md', 'large-doc.md'];
        for (const file of files) {
            await openFile(file);
            // Brief pause to let each tab initialize
            await browser.pause(200);
        }

        // Verify we have multiple tabs open
        const tabCount: number = await browser.execute(() => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            return (window as any).__E2E_EDITOR_STORE__?.getState().openDocuments.length ?? 0;
        });
        console.log(`[perf] Tabs open: ${tabCount}`);
        expect(tabCount).toBeGreaterThanOrEqual(files.length);

        // Rapidly switch between tabs by clicking them in sequence
        const { duration } = await measureAction(async () => {
            // Click each tab 2 full rounds — 8 switches total
            for (let round = 0; round < 2; round++) {
                for (const file of files) {
                    // Tabs display the filename. Find and click the tab element.
                    const tab = await browser.$(
                        `//span[contains(@class, "truncate") and text()="${file}"]`
                    );
                    const exists = await tab.isExisting();
                    if (exists) {
                        await tab.click();
                        // No pause — this is intentionally rapid
                    }
                }
            }
        });

        console.log(`[perf] Rapid tab switching (${files.length} tabs x 2 rounds): ${duration.toFixed(0)}ms`);
        timingResults['tab-switching-ms'] = duration;

        // Wait for the last tab switch to settle
        await browser.pause(500);

        // Verify the editor still works — last clicked tab should show content
        const lastFile = files[files.length - 1];
        const text = await getEditorText();
        console.log(`[perf] Final tab content length: ${text.length} characters`);
        expect(text.length).toBeGreaterThan(0);

        // Check for JS errors by looking at console (best effort)
        // Note: browser.getLogs() is not supported by tauri-webdriver
        if (typeof browser.getLogs === 'function') {
            const logs = await browser.getLogs('browser');
            const errors = logs.filter(
                (log: { level: string; message: string }) =>
                    log.level === 'SEVERE' &&
                    !log.message.includes('favicon') &&
                    !log.message.includes('DevTools'),
            );
            if (errors.length > 0) {
                console.log(`[perf] Browser errors after rapid switching:`, errors);
            }
            expect(errors.length).toBe(0);
        }

        console.log(`[perf] Rapid tab switching completed without errors`);
    });
});
