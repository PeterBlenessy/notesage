/**
 * Input-fidelity spike — diagnostic, macOS/WKWebView only.
 *
 * PURPOSE
 * -------
 * Empirically determine whether `tauri-plugin-webdriver` 0.2.1 (the latest
 * published version, already pinned in src-tauri/Cargo.toml) can deliver
 * synthetic keyboard input to the kinds of elements Notesage's UI is built
 * from, and — critically — whether those events arrive as TRUSTED events that
 * React's controlled inputs and ProseMirror's contenteditable actually honour.
 *
 * This is the wall the other real-E2E specs work around with
 * `document.execCommand('insertText')` (see helpers/actions.ts → typeInEditor).
 * Before deciding whether the WKWebView WebDriver path can ever drive real
 * keystrokes, we need data, not inference. This spec produces that data.
 *
 * It probes a 3×3 matrix:
 *
 *   Targets:
 *     A. Plain native <input>          (baseline — should be the easy case)
 *     B. React-controlled input        (the find bar — DOM .value only reflects
 *                                        typed text if React's onChange fired)
 *     C. ProseMirror contenteditable   (the editor — the case that matters most)
 *
 *   Input methods:
 *     1. WebDriver "send keys"         (element.addValue → POST .../value)
 *     2. WebDriver Actions API         (browser.action('key') → POST .../actions)
 *     3. execCommand('insertText')     (CONTROL — the in-page workaround; should
 *                                        always land text, used to prove the test
 *                                        mechanics and the element are sound)
 *
 * For each cell we record:
 *   - landed:    did the target's text/value actually change?
 *   - isTrusted: did the resulting input/beforeinput event report isTrusted=true?
 *
 * The RESULT MATRIX printed in the `after` hook IS the deliverable. The `expect`
 * assertions are intentionally limited to invariants (app connected, probe
 * installed, control path works) so the spec REPORTS rather than fails on the
 * unknown behaviour it exists to discover.
 *
 * RUN (on a Mac — WKWebView does not exist on Linux/CI-Linux):
 *   pnpm test:e2e-real-full          # full lifecycle (build + driver + tests)
 * or, against an already-running app:
 *   Terminal 1: pnpm tauri:test
 *   Terminal 2: tauri-webdriver
 *   Terminal 3: pnpm test:e2e-real
 */
import * as path from 'path';

import { waitForElement, pressShortcut, openFile, clearEditor } from '../helpers/actions';
import { ensureCleanState, ensureProjectOpen } from '../helpers/setup';

const TEST_PROJECT_PATH = path.resolve(process.cwd(), 'e2e-real/fixtures/test-project');

const PLAIN_INPUT_ID = 'spike-plain-input';
const FIND_INPUT_MARK = 'data-spike-find';

interface ProbeEvent {
    type: string;
    isTrusted: boolean;
    target: string | null;
}

interface CellResult {
    landed: boolean | 'n/a';
    isTrusted: boolean | 'n/a';
    note?: string;
}

// Module-level result store, printed as a matrix in `after`.
const results: Record<string, CellResult> = {};

/** Installs capture-phase listeners that record event.isTrusted for keystroke-driven events. */
async function installProbe(): Promise<void> {
    await browser.execute(() => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const w = window as any;
        if (w.__SPIKE_INSTALLED__) return;
        w.__SPIKE_EVENTS__ = [] as ProbeEvent[];
        const rec = (e: Event) => {
            w.__SPIKE_EVENTS__.push({
                type: e.type,
                isTrusted: e.isTrusted,
                target: (e.target as HTMLElement | null)?.tagName ?? null,
            });
        };
        document.addEventListener('keydown', rec, true);
        document.addEventListener('beforeinput', rec, true);
        document.addEventListener('input', rec, true);
        w.__SPIKE_INSTALLED__ = true;
    });
}

/** Clears the recorded event buffer immediately before an input action. */
async function clearEvents(): Promise<void> {
    await browser.execute(() => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (window as any).__SPIKE_EVENTS__ = [];
    });
}

async function readEvents(): Promise<ProbeEvent[]> {
    return browser.execute(() => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return ((window as any).__SPIKE_EVENTS__ ?? []) as ProbeEvent[];
    });
}

/** True if any input/beforeinput event in the buffer reported isTrusted. */
function anyTrustedInput(events: ProbeEvent[]): boolean {
    return events.some((e) => (e.type === 'input' || e.type === 'beforeinput') && e.isTrusted === true);
}

/** Types a string via the WebDriver Actions API (down/up per character). */
async function typeViaActions(text: string): Promise<void> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let chain: any = browser.action('key');
    for (const ch of text) {
        chain = chain.down(ch).pause(5).up(ch).pause(5);
    }
    await chain.perform();
}

describe('Input-fidelity spike (tauri-plugin-webdriver 0.2.1 / WKWebView)', () => {
    before(async () => {
        console.log('[spike] tauri-plugin-webdriver 0.2.1 input-fidelity probe');
        console.log(`[spike] platform reported by webview: ${await browser.execute(() => navigator.platform)}`);
        await waitForElement('#root');
        await installProbe();
        await ensureProjectOpen(TEST_PROJECT_PATH);
    });

    beforeEach(async () => {
        await ensureCleanState();
    });

    // ---- Target A: plain native <input> -------------------------------------

    describe('A. Plain native <input>', () => {
        async function freshInput() {
            await browser.execute((id: string) => {
                let input = document.getElementById(id) as HTMLInputElement | null;
                if (!input) {
                    input = document.createElement('input');
                    input.id = id;
                    input.type = 'text';
                    input.style.position = 'fixed';
                    input.style.top = '8px';
                    input.style.left = '8px';
                    input.style.zIndex = '2147483647';
                    document.body.appendChild(input);
                }
                input.value = '';
                input.focus();
            }, PLAIN_INPUT_ID);
            return waitForElement(`#${PLAIN_INPUT_ID}`);
        }

        it('1. send keys (element.addValue)', async () => {
            const input = await freshInput();
            await input.click();
            await clearEvents();
            await input.addValue('abc');
            const value = await input.getValue();
            const events = await readEvents();
            results['A1 plain / sendKeys'] = { landed: value === 'abc', isTrusted: anyTrustedInput(events) };
            console.log(`[spike] A1 value="${value}" events=${JSON.stringify(events)}`);
            // Invariant: the probe ran and produced a value reading.
            expect(typeof value).toBe('string');
        });

        it('2. Actions API (browser.action)', async () => {
            const input = await freshInput();
            await input.click();
            await clearEvents();
            await typeViaActions('xyz');
            const value = await input.getValue();
            const events = await readEvents();
            results['A2 plain / actions'] = { landed: value === 'xyz', isTrusted: anyTrustedInput(events) };
            console.log(`[spike] A2 value="${value}" events=${JSON.stringify(events)}`);
            expect(typeof value).toBe('string');
        });
    });

    // ---- Target B: React-controlled input (find bar) ------------------------

    describe('B. React-controlled input (find bar)', () => {
        it('1. send keys into the find bar input', async () => {
            // Remove the leftover plain <input> from target A first. Without
            // this, a "first visible input" fallback could mis-target it and
            // report a plain-input result mislabelled as the React find bar.
            await browser.execute((id: string) => {
                document.getElementById(id)?.remove();
            }, PLAIN_INPUT_ID);

            // Open the find bar (⌘F), then accept ONLY the input that actually
            // received focus — no broad fallback. If the find bar didn't open or
            // didn't focus an input, report n/a rather than measure the wrong node.
            await pressShortcut(['Meta', 'f']);
            await browser.pause(400);

            const tagged = await browser.execute((mark: string, plainId: string) => {
                const ae = document.activeElement as HTMLElement | null;
                if (ae && ae.tagName === 'INPUT' && ae.id !== plainId) {
                    ae.setAttribute(mark, '1');
                    return true;
                }
                return false;
            }, FIND_INPUT_MARK, PLAIN_INPUT_ID);

            if (!tagged) {
                results['B1 react-input / sendKeys'] = { landed: 'n/a', isTrusted: 'n/a', note: 'find input not found' };
                console.log('[spike] B1 SKIP — could not locate a focused find-bar input');
                return;
            }

            const findInput = await browser.$(`[${FIND_INPUT_MARK}="1"]`);
            await clearEvents();
            await findInput.addValue('hello');
            await browser.pause(150);
            // For a CONTROLLED input, DOM .value reflects typed text ONLY if
            // React's onChange fired and re-rendered. Empty value ⇒ onChange
            // never ran ⇒ the keystrokes were not honoured by React.
            const value = await findInput.getValue();
            const events = await readEvents();
            results['B1 react-input / sendKeys'] = { landed: value.includes('hello'), isTrusted: anyTrustedInput(events) };
            console.log(`[spike] B1 value="${value}" events=${JSON.stringify(events)}`);

            await pressShortcut(['Escape']);
            expect(typeof value).toBe('string');
        });
    });

    // ---- Target C: ProseMirror contenteditable ------------------------------

    describe('C. ProseMirror contenteditable (the editor)', () => {
        async function freshEditor() {
            await openFile('empty.md', TEST_PROJECT_PATH);
            const editor = await waitForElement('.ProseMirror');
            // empty.md ships as `# Empty Note`, and the per-tab EditorState cache
            // can restore a prior cell's doc on reopen — clear to a true blank so
            // each cell's landed/isTrusted reading is isolated.
            await clearEditor();
            await editor.click();
            return editor;
        }

        it('1. send keys (element.addValue)', async () => {
            const editor = await freshEditor();
            await clearEvents();
            await editor.addValue('AAA');
            await browser.pause(150);
            const text = await editor.getText();
            const events = await readEvents();
            results['C1 prosemirror / sendKeys'] = { landed: text.includes('AAA'), isTrusted: anyTrustedInput(events) };
            console.log(`[spike] C1 text="${text}" events=${JSON.stringify(events)}`);
            expect(typeof text).toBe('string');
        });

        it('2. Actions API (browser.action)', async () => {
            const editor = await freshEditor();
            await clearEvents();
            await typeViaActions('BBB');
            await browser.pause(150);
            const text = await editor.getText();
            const events = await readEvents();
            results['C2 prosemirror / actions'] = { landed: text.includes('BBB'), isTrusted: anyTrustedInput(events) };
            console.log(`[spike] C2 text="${text}" events=${JSON.stringify(events)}`);
            expect(typeof text).toBe('string');
        });

        it('3. execCommand insertText (CONTROL — expected to work)', async () => {
            const editor = await freshEditor();
            await clearEvents();
            await browser.execute(() => {
                document.execCommand('insertText', false, 'CCC');
            });
            await browser.pause(150);
            const text = await editor.getText();
            const events = await readEvents();
            results['C3 prosemirror / execCommand'] = { landed: text.includes('CCC'), isTrusted: anyTrustedInput(events) };
            console.log(`[spike] C3 text="${text}" events=${JSON.stringify(events)}`);
            // The control path is the in-page workaround the harness already
            // relies on. If THIS can't insert text, the test mechanics are
            // broken — so this one is a hard assertion.
            expect(text).toContain('CCC');
        });
    });

    after(() => {
        const rows = Object.entries(results);
        console.log('\n=========== INPUT-FIDELITY RESULT MATRIX ===========');
        console.log('tauri-plugin-webdriver 0.2.1  (cell = landed / isTrusted)');
        console.log('----------------------------------------------------');
        for (const [cell, r] of rows) {
            const landed = r.landed === true ? 'LANDED ' : r.landed === false ? 'no     ' : 'n/a    ';
            const trusted = r.isTrusted === true ? 'trusted' : r.isTrusted === false ? 'synthetic' : 'n/a';
            console.log(`  ${cell.padEnd(28)} ${landed} | ${trusted}${r.note ? `  (${r.note})` : ''}`);
        }
        console.log('====================================================');
        console.log('Interpretation:');
        console.log('  - If send-keys / Actions land text on the PLAIN input but');
        console.log('    NOT on the React input or ProseMirror, the events are');
        console.log('    arriving but not as trusted/React-observable input.');
        console.log('  - If isTrusted is false anywhere text DID land, the plugin');
        console.log('    is injecting via JS, not OS-level events — the documented');
        console.log('    wall. Upgrading the crate (already latest) will not fix it.');
        console.log('  - If C1/C2 land AND are trusted, the harness can drop the');
        console.log('    execCommand workaround and use real keystrokes.\n');
    });
});
