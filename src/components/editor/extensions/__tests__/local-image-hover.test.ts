// @vitest-environment jsdom
/**
 * Regression tests for the image NodeView hover toolbar.
 *
 * Root-cause: the previous implementation used an editor-level `mouseover` plugin
 * to show the toolbar. That plugin fired correctly in JSDOM/dev but not in
 * production WebKit/Tauri builds (event-listener target divergence).
 *
 * The fix: direct `addEventListener('mouseenter')` on the wrapper DOM element.
 * These tests verify that approach by dispatching events directly on the wrapper,
 * which is the exact path that fails for a plugin-level listener — proving the
 * listener is attached to the element itself and will fire in production builds.
 */

import { describe, it, expect, vi } from 'vitest';

// local-image self-heals asset-scope races by calling tauriApi.allowAssetDir on
// an <img> error — mock it so we can assert.
vi.mock('@/lib/tauri', () => ({
  tauriApi: { allowAssetDir: vi.fn(() => Promise.resolve()) },
}));

import { LocalImage, assetDirFromUrl } from '../local-image';
import { tauriApi } from '@/lib/tauri';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function mockImageNode(attrs: Record<string, unknown> = {}) {
  return {
    type: { name: 'image' },
    attrs: {
      src: 'test.png',
      alt: null,
      title: null,
      blockWidth: null,
      align: null,
      ...attrs,
    },
  };
}

function mockEditor() {
  const setNodeMarkup = vi.fn().mockReturnThis();
  const run = vi.fn().mockReturnValue(true);
  const command = vi.fn().mockImplementation((fn: (ctx: { tr: { setNodeMarkup: typeof setNodeMarkup } }) => boolean) => {
    fn({ tr: { setNodeMarkup } });
    return { run };
  });
  const chain = vi.fn().mockReturnValue({ command });
  return {
    chain,
    _setNodeMarkup: setNodeMarkup,
    storage: {
      image: { documentDir: '' },
    },
  };
}

type NodeViewResult = {
  dom: HTMLElement;
  update?: (node: unknown) => boolean;
};

function buildNodeView(
  node = mockImageNode(),
  editor = mockEditor(),
  getPos: () => number = () => 5,
): NodeViewResult {
  type ExtConfig = { addNodeView?: () => (props: { node: unknown; editor: unknown; getPos: unknown }) => NodeViewResult };
  const config = LocalImage.config as ExtConfig;
  if (!config.addNodeView) throw new Error('addNodeView not defined on LocalImage');
  const factory = config.addNodeView.call(LocalImage);
  return factory({ node, editor, getPos });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('LocalImage NodeView — asset-scope self-heal', () => {
  function editorWithDir(dir: string) {
    const e = mockEditor();
    e.storage.image.documentDir = dir;
    return e;
  }

  it("grants the IMAGE's own directory on an asset-URL error (not just documentDir)", () => {
    vi.mocked(tauriApi.allowAssetDir).mockClear();
    // Image lives in a SIBLING dir of the document — proves we grant the image's
    // own dir (from the URL), not the doc dir.
    const { dom } = buildNodeView(
      mockImageNode({ src: 'http://asset.localhost/Users/x/assets/photo.png' }),
      editorWithDir('/Users/x/doc'),
    );
    const img = dom.querySelector('img') as HTMLImageElement;
    expect(img.src).toContain('asset.localhost');

    img.dispatchEvent(new Event('error'));
    expect(tauriApi.allowAssetDir).toHaveBeenCalledWith('/Users/x/assets');
  });

  it('does NOT self-heal a remote/data URL that fails (genuinely broken)', () => {
    vi.mocked(tauriApi.allowAssetDir).mockClear();
    const { dom } = buildNodeView(
      mockImageNode({ src: 'https://example.com/missing.png' }),
      editorWithDir('/Users/x/doc'),
    );
    const img = dom.querySelector('img') as HTMLImageElement;
    img.dispatchEvent(new Event('error'));
    expect(tauriApi.allowAssetDir).not.toHaveBeenCalled();
  });

  it('stops re-granting after 4 attempts (no infinite loop on a missing file)', () => {
    vi.mocked(tauriApi.allowAssetDir).mockClear();
    const { dom } = buildNodeView(
      mockImageNode({ src: 'http://asset.localhost/Users/x/doc/photo.png' }),
      editorWithDir('/Users/x/doc'),
    );
    const img = dom.querySelector('img') as HTMLImageElement;
    for (let i = 0; i < 6; i++) img.dispatchEvent(new Event('error'));
    expect(tauriApi.allowAssetDir).toHaveBeenCalledTimes(4);
  });
});

describe('assetDirFromUrl', () => {
  it('extracts the directory from an asset.localhost URL', () => {
    expect(assetDirFromUrl('http://asset.localhost/Users/me/proj/images/a.png')).toBe(
      '/Users/me/proj/images',
    );
  });
  it('decodes percent-encoded path segments (spaces)', () => {
    expect(assetDirFromUrl('http://asset.localhost/Users/me/my%20notes/a.png')).toBe(
      '/Users/me/my notes',
    );
  });
  it('returns null for an unparseable / non-path URL', () => {
    expect(assetDirFromUrl('not a url')).toBeNull();
  });
});

describe('LocalImage NodeView — hover toolbar', () => {
  // --- DOM structure ---

  it('wraps the img in a div container (not a bare img as dom)', () => {
    const { dom } = buildNodeView();
    expect(dom.tagName).toBe('DIV');
  });

  it('contains an img element inside the wrapper', () => {
    const { dom } = buildNodeView();
    const img = dom.querySelector('img');
    expect(img).not.toBeNull();
  });

  it('renders a toolbar with data-testid="image-block-size-toolbar"', () => {
    const { dom } = buildNodeView();
    const toolbar = dom.querySelector('[data-testid="image-block-size-toolbar"]');
    expect(toolbar).not.toBeNull();
  });

  // --- Default visibility ---

  it('toolbar is hidden by default', () => {
    const { dom } = buildNodeView();
    const toolbar = dom.querySelector<HTMLElement>('[data-testid="image-block-size-toolbar"]')!;
    expect(toolbar.style.display).toBe('none');
  });

  // --- Direct DOM event listeners (the production-build fix) ---

  it('shows the toolbar when mouseenter is dispatched directly on the wrapper', () => {
    const { dom } = buildNodeView();
    const toolbar = dom.querySelector<HTMLElement>('[data-testid="image-block-size-toolbar"]')!;

    // Dispatch directly on the element — this is the path that fails for
    // editor-level plugin listeners in production WebKit builds.
    dom.dispatchEvent(new Event('mouseenter'));

    expect(toolbar.style.display).not.toBe('none');
  });

  it('hides the toolbar when mouseleave is dispatched on the wrapper', () => {
    const { dom } = buildNodeView();
    const toolbar = dom.querySelector<HTMLElement>('[data-testid="image-block-size-toolbar"]')!;

    dom.dispatchEvent(new Event('mouseenter'));
    dom.dispatchEvent(new Event('mouseleave'));

    expect(toolbar.style.display).toBe('none');
  });

  // --- Width preset buttons ---

  it('toolbar contains buttons for each width preset (25, 50, 75, 100)', () => {
    const { dom } = buildNodeView();
    dom.dispatchEvent(new Event('mouseenter'));
    for (const w of [25, 50, 75, 100]) {
      const btn = dom.querySelector(`[data-width="${w}"]`);
      expect(btn, `missing button for ${w}%`).not.toBeNull();
    }
  });

  it('clicking a width button dispatches setNodeMarkup with that blockWidth', () => {
    const editor = mockEditor();
    const { dom } = buildNodeView(mockImageNode({ blockWidth: null }), editor);
    dom.dispatchEvent(new Event('mouseenter'));

    const btn = dom.querySelector<HTMLElement>('[data-width="50"]')!;
    btn.click();

    expect(editor._setNodeMarkup).toHaveBeenCalledWith(
      5,
      undefined,
      expect.objectContaining({ blockWidth: 50 }),
    );
  });

  it('clicking the active width button clears blockWidth (toggle off)', () => {
    const editor = mockEditor();
    const { dom } = buildNodeView(mockImageNode({ blockWidth: 75 }), editor);
    dom.dispatchEvent(new Event('mouseenter'));

    const btn = dom.querySelector<HTMLElement>('[data-width="75"]')!;
    btn.click();

    expect(editor._setNodeMarkup).toHaveBeenCalledWith(
      5,
      undefined,
      expect.objectContaining({ blockWidth: null }),
    );
  });

  // --- Alignment buttons ---

  it('toolbar contains buttons for each alignment (left, center, right)', () => {
    const { dom } = buildNodeView();
    dom.dispatchEvent(new Event('mouseenter'));
    for (const a of ['left', 'center', 'right']) {
      const btn = dom.querySelector(`[data-align="${a}"]`);
      expect(btn, `missing button for align=${a}`).not.toBeNull();
    }
  });

  it('clicking an align button dispatches setNodeMarkup with the chosen alignment', () => {
    const editor = mockEditor();
    const { dom } = buildNodeView(mockImageNode({ blockWidth: 75, align: null }), editor);
    dom.dispatchEvent(new Event('mouseenter'));

    const btn = dom.querySelector<HTMLElement>('[data-align="center"]')!;
    btn.click();

    expect(editor._setNodeMarkup).toHaveBeenCalledWith(
      5,
      undefined,
      expect.objectContaining({ align: 'center' }),
    );
  });

  it('clicking an align button with no blockWidth auto-sets blockWidth to 75', () => {
    const editor = mockEditor();
    const { dom } = buildNodeView(mockImageNode({ blockWidth: null, align: null }), editor);
    dom.dispatchEvent(new Event('mouseenter'));

    const btn = dom.querySelector<HTMLElement>('[data-align="left"]')!;
    btn.click();

    expect(editor._setNodeMarkup).toHaveBeenCalledWith(
      5,
      undefined,
      expect.objectContaining({ blockWidth: 75, align: 'left' }),
    );
  });

  // --- update() callback ---

  it('update() returns false for non-image nodes', () => {
    const { update } = buildNodeView();
    const result = update?.({ type: { name: 'paragraph' }, attrs: {} });
    expect(result).toBe(false);
  });

  it('update() reflects new blockWidth on the toolbar button active states', () => {
    const { dom, update } = buildNodeView(mockImageNode({ blockWidth: null }));

    update?.({ type: { name: 'image' }, attrs: { src: 'test.png', alt: null, title: null, blockWidth: 50, align: null } });
    dom.dispatchEvent(new Event('mouseenter'));

    const btn50 = dom.querySelector<HTMLElement>('[data-width="50"]')!;
    expect(btn50.classList.contains('active')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Design-token and icon compliance tests — issue #259
// ---------------------------------------------------------------------------

describe('LocalImage NodeView — design-token and icon compliance (#259)', () => {
  it('align buttons contain SVG icons, not Unicode arrow characters', () => {
    const { dom } = buildNodeView();
    dom.dispatchEvent(new Event('mouseenter'));
    for (const a of ['left', 'center', 'right']) {
      const btn = dom.querySelector<HTMLElement>(`[data-align="${a}"]`)!;
      expect(btn, `missing [data-align="${a}"] button`).not.toBeNull();
      // Must contain an SVG child — the lucide-react icon equivalent.
      const svg = btn.querySelector('svg');
      expect(svg, `[data-align="${a}"] must contain an SVG icon, not a Unicode character`).not.toBeNull();
    }
  });

  it('align buttons do not render Unicode arrow characters (⬅↔➡)', () => {
    const { dom } = buildNodeView();
    dom.dispatchEvent(new Event('mouseenter'));
    for (const a of ['left', 'center', 'right']) {
      const btn = dom.querySelector<HTMLElement>(`[data-align="${a}"]`)!;
      const text = btn.textContent ?? '';
      // Unicode arrows that the old implementation used
      expect(text, `[data-align="${a}"] must not use Unicode arrow characters`).not.toMatch(/[⬅↔➡←→]/u);
    }
  });

  it('active width button uses --color-accent-primary, not the wrong --color-accent token', () => {
    const { dom } = buildNodeView(mockImageNode({ blockWidth: 50 }));
    dom.dispatchEvent(new Event('mouseenter'));

    const activeBtn = dom.querySelector<HTMLElement>('[data-width="50"]')!;
    expect(activeBtn.classList.contains('active')).toBe(true);

    // style.background is preserved by JSDOM for CSS custom properties.
    // The old code used `var(--color-accent,...)` — the fix must remove it.
    const bg = activeBtn.style.background;
    // Must NOT reference --color-accent as the primary token (negative lookahead
    // distinguishes --color-accent from --color-accent-primary).
    expect(bg, 'active width button must not use var(--color-accent,...) pattern').not.toMatch(/var\(--color-accent(?!-)/);
  });

  it('active align button uses --color-accent-primary, not the wrong --color-accent token', () => {
    const { dom } = buildNodeView(mockImageNode({ blockWidth: 75, align: 'center' }));
    dom.dispatchEvent(new Event('mouseenter'));

    const activeBtn = dom.querySelector<HTMLElement>('[data-align="center"]')!;
    expect(activeBtn.classList.contains('active')).toBe(true);

    const bg = activeBtn.style.background;
    expect(bg, 'active align button must not use var(--color-accent,...) pattern').not.toMatch(/var\(--color-accent(?!-)/);
  });

  it('toolbar and all button style attributes contain no hardcoded hex colour values', () => {
    // Build with active states to trigger the widest set of inline styles.
    const { dom } = buildNodeView(mockImageNode({ blockWidth: 50, align: 'left' }));
    dom.dispatchEvent(new Event('mouseenter'));

    const toolbar = dom.querySelector<HTMLElement>('[data-testid="image-block-size-toolbar"]')!;
    const elements: HTMLElement[] = [toolbar, ...Array.from(toolbar.querySelectorAll<HTMLElement>('*'))];

    for (const el of elements) {
      // getAttribute('style') returns the serialized CSS including var() fallbacks.
      // JSDOM preserves #hex inside var() fallbacks even though it normalises
      // standalone colour literals to rgb() — so this catches var(--x, #abc) patterns.
      const style = el.getAttribute('style') ?? '';
      expect(style, `<${el.tagName.toLowerCase()}> must not have hardcoded hex colour: "${style}"`).not.toMatch(
        /#[0-9a-fA-F]{3,6}(?:[^0-9a-fA-F]|$)/,
      );
    }
  });
});
