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
import { LocalImage } from '../local-image';

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
