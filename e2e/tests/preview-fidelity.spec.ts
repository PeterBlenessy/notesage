/**
 * Phase 1 of the large-file instant-load pipeline (PRD § "Layer 1") replaces
 * the synchronous Tiptap parse on tab-open with a fast comrak HTML preview
 * that paints first; the editor then hydrates in the background and swaps in.
 * This spec exercises that flow end-to-end against the mocked Tauri backend:
 *
 *   1. The preview surface (`[data-preview="true"]`) renders before the live
 *      editor (`.ProseMirror:not([data-preview])`).
 *   2. After the deferred hydration callback fires, the editor takes over and
 *      the preview is unmounted.
 *   3. Both surfaces produce comparable scroll heights, so the swap is layout-
 *      stable (the foundation for Phase 2's invisible swap).
 *
 * Pixel-level screenshot diffs (PRD acceptance criterion: <2% pixel diff
 * outside the caret region, 1×/2× DPR, light/dark) require a human to approve
 * the golden baselines on first run, so they live in a follow-up batch. This
 * spec asserts the structural and behavioural invariants that the diff would
 * otherwise catch.
 *
 * Known divergences vs. the live editor (PRD § "Fidelity gaps to manage"):
 *
 *   - `#tag`, `@mention`, `//YYYY-MM-DD` render as plain text in the preview
 *     and as styled badges in the editor.
 *   - `excalidraw` and `chart` fenced code blocks render as syntax-highlighted
 *     code instead of their node-view renders.
 *
 * These will be masked when pixel-diff testing lands.
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { setupTauriMock } from '../fixtures/tauri-mock';
import { SAMPLE_PROJECT_PATH } from '../fixtures/sample-data';

const FIXTURE_PATH = resolve(__dirname, '../../tests/fixtures/preview-fidelity/mixed-small.md');
const FIXTURE_NAME = 'mixed-small.md';
const FIXTURE_FILE_PATH = `${SAMPLE_PROJECT_PATH}/${FIXTURE_NAME}`;

/**
 * Hand-written approximation of what comrak emits for the fixture body.
 * The structural shape — `<h1>`, lists, `<table>`, `<pre><code>` —
 * matches the editor's render closely enough that the swap is layout-
 * stable; we don't need exact comrak parity in the mock since the real
 * render_markdown_preview command isn't exercised in unit/E2E tests.
 */
const PREVIEW_HTML = `
<h1>Heading 1 — Mixed content fixture</h1>
<p>This fixture exercises the comrak HTML preview pipeline.</p>
<h2>Lists, code, blockquotes</h2>
<ul>
  <li>Bullet item one with <strong>bold</strong> and <em>italic</em></li>
  <li>Item two with <code>inline code</code></li>
  <li>Item three with <a href="./other.md">an internal link</a> and <a href="https://example.com">an external link</a>
    <ul>
      <li>Nested item</li>
      <li>Another nested item</li>
    </ul>
  </li>
</ul>
<ol>
  <li>Numbered item one</li>
  <li>Numbered item two</li>
</ol>
<blockquote><p>Blockquote with a <code>code span</code> inside it.</p></blockquote>
<pre><code class="language-rust">fn main() {
    let value = 42;
    println!("{}", value);
}
</code></pre>
<h2>Tables</h2>
<table>
  <thead>
    <tr><th>Item</th><th>Quantity</th><th>Price (USD)</th></tr>
  </thead>
  <tbody>
    <tr><td>Coffee</td><td>2</td><td>3.50</td></tr>
    <tr><td>Tea</td><td>1</td><td>2.75</td></tr>
    <tr><td>Pastry</td><td>3</td><td>4.25</td></tr>
  </tbody>
</table>
<h2>Plain-text divergences (intentional)</h2>
<ul>
  <li>Tag: #productivity</li>
  <li>Mention: @peter</li>
  <li>Date: //2026-05-05</li>
</ul>
<h2>Closing paragraph</h2>
<p>Final paragraph so the document has a non-trivial vertical extent for the scroll-height parity check.</p>
`.trim();

async function injectWorkspaceState(page: import('@playwright/test').Page): Promise<void> {
  await page.addInitScript(
    ({ projectPath }) => {
      const state = {
        state: {
          explorerFolders: [{ path: projectPath }],
          projects: [],
          recentProjects: [],
          notesTree: [],
          expandedFolders: [],
          explorerCollapsed: false,
          projectsCollapsed: false,
          notesCollapsed: false,
        },
        version: 0,
      };
      localStorage.setItem('notesage-workspace', JSON.stringify(state));
    },
    { projectPath: SAMPLE_PROJECT_PATH },
  );
}

test.describe('Large-file instant-load preview (Phase 1)', () => {
  test.beforeEach(async ({ page }) => {
    const fixtureContent = readFileSync(FIXTURE_PATH, 'utf-8');

    await setupTauriMock(page, {
      files: {
        [FIXTURE_FILE_PATH]: fixtureContent,
      },
      fileTree: [
        {
          name: FIXTURE_NAME,
          path: FIXTURE_FILE_PATH,
          is_directory: false,
          children: null,
        },
      ],
      overrides: {
        // The frontend calls renderMarkdownPreview as soon as a markdown tab
        // activates. Return our pre-baked HTML body fragment so the preview
        // surface mounts before the editor finishes hydrating.
        render_markdown_preview: PREVIEW_HTML,
      },
    });
    await injectWorkspaceState(page);
    await page.goto('/');
    await page.waitForFunction(() => !!document.querySelector('[data-quiet-layout-root], #root'));
  });

  test('preview surface renders before the live editor hydrates', async ({ page }) => {
    // Click the file in the sidebar to open it.
    const folderName = page.getByText('notesage-e2e-project', { exact: true }).first();
    if (await folderName.isVisible()) await folderName.click();
    await page.waitForFunction(
      (name) => document.body.textContent?.includes(name),
      FIXTURE_NAME,
      { timeout: 10000 },
    );
    await page.getByText(FIXTURE_NAME, { exact: true }).first().click();

    // The preview wrapper should appear before the editor finishes hydrating.
    // It carries the same `.ProseMirror` class as the live editor for visual
    // identity — we disambiguate via `data-preview="true"`.
    const preview = page.locator('.ProseMirror[data-preview="true"]');
    await expect(preview).toBeVisible({ timeout: 5000 });

    // Preview content must include text that came from our PREVIEW_HTML mock.
    await expect(preview).toContainText('Mixed content fixture');
    await expect(preview).toContainText('Coffee');
  });

  test('preview unmounts once the editor hydrates', async ({ page }) => {
    const folderName = page.getByText('notesage-e2e-project', { exact: true }).first();
    if (await folderName.isVisible()) await folderName.click();
    await page.waitForFunction(
      (name) => document.body.textContent?.includes(name),
      FIXTURE_NAME,
      { timeout: 10000 },
    );
    await page.getByText(FIXTURE_NAME, { exact: true }).first().click();

    // Wait for the preview to appear first.
    await expect(page.locator('.ProseMirror[data-preview="true"]')).toBeVisible({ timeout: 5000 });

    // The deferred hydration callback (requestIdleCallback / setTimeout(0))
    // fires inside `useEditorTabSwitch`, runs `loadRawMarkdownIntoEditor`, and
    // flips previewState to "hydrated", which unmounts the preview wrapper.
    // The live editor — same `.ProseMirror` class but without `data-preview` —
    // takes over.
    await expect(page.locator('.ProseMirror[data-preview="true"]')).toBeHidden({ timeout: 10000 });
    await expect(page.locator('.ProseMirror[contenteditable="true"]')).toBeVisible({ timeout: 5000 });
  });

  test('scroll height parity within ±10% between preview and editor', async ({ page }) => {
    const folderName = page.getByText('notesage-e2e-project', { exact: true }).first();
    if (await folderName.isVisible()) await folderName.click();
    await page.waitForFunction(
      (name) => document.body.textContent?.includes(name),
      FIXTURE_NAME,
      { timeout: 10000 },
    );
    await page.getByText(FIXTURE_NAME, { exact: true }).first().click();

    // Capture preview scrollHeight while it's still mounted.
    await expect(page.locator('.ProseMirror[data-preview="true"]')).toBeVisible({ timeout: 5000 });
    const previewHeight = await page
      .locator('.ProseMirror[data-preview="true"]')
      .evaluate((el) => (el as HTMLElement).scrollHeight);

    // Wait for editor hydration to complete and capture editor scrollHeight.
    await expect(page.locator('.ProseMirror[data-preview="true"]')).toBeHidden({ timeout: 10000 });
    const editorHeight = await page
      .locator('.ProseMirror[contenteditable="true"]')
      .first()
      .evaluate((el) => (el as HTMLElement).scrollHeight);

    // ±10% tolerance — comrak and Tiptap render the same content but produce
    // marginally different DOMs (different line-break choices on long
    // paragraphs, slight padding differences on lists). A bigger drift signals
    // a CSS regression that breaks the layout-stable swap.
    const ratio = previewHeight / editorHeight;
    expect(ratio).toBeGreaterThan(0.9);
    expect(ratio).toBeLessThan(1.1);
  });
});

/**
 * TODO — pixel-level screenshot diff.
 *
 * The PRD's hard fidelity gate is "<2% pixel diff outside the caret region,
 * tested at 1× and 2× DPR, light + dark mode". Implementing it requires
 * Playwright's `toHaveScreenshot` baselines, which a human must visually
 * approve on first run. Spec stub:
 *
 *   await expect(preview).toHaveScreenshot('preview-light.png', { mask: [
 *     // Mask known-divergent ranges: tag/mention/date plain-text runs and
 *     // chart/excalidraw fenced blocks.
 *     page.locator('text=#productivity'),
 *     page.locator('text=@peter'),
 *     page.locator('text=//2026-05-05'),
 *   ]});
 *
 * The structural assertions in this file ensure the surface, the swap, and
 * the layout are correct — once a human signs off on the pixel goldens the
 * masked diff slots in cleanly on top.
 */
