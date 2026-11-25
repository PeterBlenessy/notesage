/**
 * Editor — the line being written stays above the floating command bar.
 *
 * The command bar floats over the bottom of the editor. ProseMirror only
 * knows the scroll container, so when it scrolled the caret into view it
 * parked it at the container's bottom edge, behind the bar: notes typed at
 * the end of a document went into a line you could not see. jsdom has no
 * layout, so this is measured in a real browser.
 */
import type { Page } from '@playwright/test';
import { tauriTest, expect, openFileInEditor } from '../../fixtures';

async function caretAndBar(page: Page) {
  return page.evaluate(() => {
    const bar = document.querySelector<HTMLElement>('[data-cmd-bar]');
    const selection = window.getSelection();
    const range = selection && selection.rangeCount ? selection.getRangeAt(0) : null;
    const rects = range?.getClientRects();
    let caretBottom: number | null = null;
    if (range && rects && rects.length) {
      caretBottom = range.getBoundingClientRect().bottom;
    } else if (selection?.focusNode) {
      // A collapsed caret in an empty line has no rects. Measure the line:
      // the text node's parent, or the child the caret sits before when the
      // selection is anchored on a block container.
      const node = selection.focusNode;
      let line: Element | null =
        node.nodeType === 1 ? (node as Element) : node.parentElement;
      if (node.nodeType === 1 && (node as Element).classList.contains('ProseMirror')) {
        const children = (node as Element).children;
        line = children[Math.min(selection.focusOffset, children.length - 1)] ?? null;
      }
      caretBottom = line?.getBoundingClientRect().bottom ?? null;
    }
    return {
      barTop: bar?.getBoundingClientRect().top ?? null,
      pinned: bar?.getAttribute('data-cmd-bar-pinned') ?? null,
      caretBottom,
    };
  });
}

tauriTest.describe('Editor — caret stays above the command bar', () => {
  tauriTest.beforeEach(async ({ waitForAppReady, page }) => {
    await waitForAppReady();
    await openFileInEditor(page, 'welcome.md', 'Welcome to Notesage');
    await page.locator('.ProseMirror[contenteditable="true"]').click();
    await page.keyboard.press('Control+End');
    await page.keyboard.press('Meta+End');
  });

  tauriTest('typing new lines past the bottom of the window', async ({ page }) => {
    for (let i = 0; i < 30; i++) {
      await page.keyboard.press('Enter');
      await page.keyboard.type(`line ${i}`);
      if (i >= 14) {
        // By now the document is taller than the window on every line.
        const { barTop, caretBottom, pinned } = await caretAndBar(page);
        expect(pinned, 'the bar is floating in this layout').not.toBe('true');
        expect(barTop).not.toBeNull();
        expect(caretBottom, `caret row after line ${i}`).toBeLessThanOrEqual(barTop! - 20);
      }
    }
  });

  tauriTest('pasting a block of text at the end', async ({ page }) => {
    const block = Array.from({ length: 40 }, (_, i) => `pasted ${i}`).join('\n');
    await page.evaluate((text) => {
      const data = new DataTransfer();
      data.setData('text/plain', text);
      document.activeElement?.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
    }, block);
    await expect(page.locator('.ProseMirror')).toContainText('pasted 39');
    const { barTop, caretBottom } = await caretAndBar(page);
    expect(caretBottom).toBeLessThanOrEqual(barTop! - 20);
  });

  tauriTest('moving down through the document with the arrow key', async ({ page }) => {
    for (let i = 0; i < 30; i++) {
      await page.keyboard.press('Enter');
      await page.keyboard.type(`line ${i}`);
    }
    await page.keyboard.press('Control+Home');
    await page.keyboard.press('Meta+Home');
    for (let i = 0; i < 34; i++) await page.keyboard.press('ArrowDown');
    // The browser moves the caret itself here and the editor reads the new
    // selection back on the next `selectionchange`, so allow it a moment.
    await expect
      .poll(async () => {
        const { barTop, caretBottom } = await caretAndBar(page);
        return barTop! - caretBottom!;
      })
      .toBeGreaterThanOrEqual(20);
  });
});
