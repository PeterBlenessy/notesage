/**
 * Input-rule fidelity tests — macOS/WKWebView only.
 *
 * These exercise the editor through the REAL WebDriver "send keys" endpoint
 * (helpers/actions.ts → typeViaSendKeys) rather than the execCommand shim that
 * typeInEditor uses. The input-fidelity spike established that send-keys
 * delivers trusted `beforeinput`/`input` events to ProseMirror's
 * contenteditable on this stack (tauri-plugin-webdriver 0.2.1), which means
 * text *input rules* fire — something a test should be able to assert against
 * the real running app.
 *
 * Scope deliberately avoids keymap behaviour (Enter/Tab/Mod-B), which needs a
 * `keydown` the send-keys path does not emit — those belong with pressShortcut.
 *
 * RUN (on a Mac):
 *   pnpm test:e2e-real-full
 */
import * as path from 'path';

import { waitForElement, openFile, typeViaSendKeys, clearEditor, pressShortcut } from '../helpers/actions';
import { ensureCleanState, ensureProjectOpen } from '../helpers/setup';

const TEST_PROJECT_PATH = path.resolve(process.cwd(), 'e2e-real/fixtures/test-project');

async function editorHtml(): Promise<string> {
    return browser.execute(() => document.querySelector('.ProseMirror')?.innerHTML ?? '');
}

describe('Editor input rules via real WebDriver send-keys', () => {
    before(async () => {
        console.log(`[input-rules] Test project path: ${TEST_PROJECT_PATH}`);
        await ensureProjectOpen(TEST_PROJECT_PATH);
    });

    beforeEach(async () => {
        await ensureCleanState();
        await openFile('empty.md', TEST_PROJECT_PATH);
        await clearEditor();
    });

    it('converts "## " into a heading (markdown input rule)', async () => {
        // Send the trigger ("## " ending in space) in its own call so the input
        // rule matches, then the heading text in a second call.
        await typeViaSendKeys('## ');
        await typeViaSendKeys('Section heading');

        const heading = await browser.$('.ProseMirror h2');
        await heading.waitForExist({
            timeout: 5000,
            timeoutMsg: `Expected an <h2> from "## " input rule. Editor HTML: ${await editorHtml()}`,
        });
        expect(await heading.getText()).toContain('Section heading');
    });

    it('converts "- " into a bullet list item (markdown input rule)', async () => {
        await typeViaSendKeys('- ');
        await typeViaSendKeys('first item');

        const listItem = await browser.$('.ProseMirror ul li');
        await listItem.waitForExist({
            timeout: 5000,
            timeoutMsg: `Expected a <ul><li> from "- " input rule. Editor HTML: ${await editorHtml()}`,
        });
        expect(await listItem.getText()).toContain('first item');
    });

    it('opens the slash-command menu when "/" is typed', async () => {
        await typeViaSendKeys('/');

        // Slash options render as <button id="…-slash-option-N"> in a body-level
        // tippy popup; the id suffix is stable even though useId() prefixes it.
        const firstOption = await browser.$('[id$="-slash-option-0"]');
        await firstOption.waitForExist({
            timeout: 5000,
            timeoutMsg: `Slash menu did not open on "/". Editor HTML: ${await editorHtml()}`,
        });
        expect(firstOption).toBeExisting();

        // Close the menu so it doesn't leak into the next test.
        await pressShortcut(['Escape']);
        await waitForElement('.ProseMirror');
    });
});
