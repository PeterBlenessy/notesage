/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { Markdown } from 'tiptap-markdown';

// Mock the editor-styles-store fontFamilyCSS import used by typography-overrides.
// The real function resolves preset keys to CSS font stacks — we just need it to
// return a recognizable string so we can verify it does NOT appear in serialized markdown.
vi.mock('@/stores/editor-styles-store', () => ({
  fontFamilyCSS: (key: string) => key || 'system-ui',
}));

import {
  HeadingWithOverrides,
  ParagraphWithOverrides,
  TypographyOverrides,
  buildOverrideStyles,
} from '../typography-overrides';

// ---------------------------------------------------------------------------
// Helper — create editor with typography override extensions
// ---------------------------------------------------------------------------

// Why: ProseMirror's DOMObserver schedules timers that can fire after jsdom
// teardown if the EditorView isn't destroyed. Track every instance so afterEach
// can drain them — without this, "ReferenceError: document is not defined" leaks
// from prosemirror-view into the full-suite run.
const editors: Editor[] = [];

afterEach(() => {
  while (editors.length > 0) {
    editors.pop()?.destroy();
  }
});

function createEditor(content: string): Editor {
  const editor = new Editor({
    extensions: [
      StarterKit.configure({ heading: false, paragraph: false }),
      HeadingWithOverrides.configure({ levels: [1, 2, 3, 4, 5, 6] }),
      ParagraphWithOverrides,
      TypographyOverrides,
      Markdown.configure({ html: true }),
    ],
    content,
  });
  editors.push(editor);
  return editor;
}

function getMarkdown(editor: Editor): string {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (editor.storage as Record<string, any>).markdown.getMarkdown();
}

// ---------------------------------------------------------------------------
// buildOverrideStyles unit tests
// ---------------------------------------------------------------------------

describe('buildOverrideStyles', () => {
  it('returns null when all attrs are null/undefined', () => {
    expect(buildOverrideStyles({})).toBeNull();
    expect(
      buildOverrideStyles({
        fontFamily: null,
        fontSize: null,
        fontWeight: null,
        lineHeight: null,
        color: null,
      }),
    ).toBeNull();
  });

  it('builds a style string from non-null attrs', () => {
    const style = buildOverrideStyles({ fontFamily: 'georgia', fontSize: 24 });
    expect(style).toContain('font-family');
    expect(style).toContain('font-size: 24px');
  });

  it('includes all specified attrs', () => {
    const style = buildOverrideStyles({
      fontFamily: 'inter',
      fontSize: 16,
      fontWeight: 600,
      lineHeight: 1.5,
      color: '#333',
    });
    expect(style).toContain('font-family');
    expect(style).toContain('font-size: 16px');
    expect(style).toContain('font-weight: 600');
    expect(style).toContain('line-height: 1.5');
    expect(style).toContain('color: #333');
  });
});

// ---------------------------------------------------------------------------
// Markdown round-trip safety tests
// ---------------------------------------------------------------------------

describe('typography overrides markdown safety', () => {
  it('heading with overrides serializes as plain markdown heading', () => {
    const editor = createEditor('<h2>My Heading</h2>');
    // Set override attrs via setNode command
    editor.commands.setNode('heading', {
      level: 2,
      fontFamily: 'georgia',
      fontSize: 24,
    });
    const md = getMarkdown(editor);
    expect(md.trim()).toBe('## My Heading');
  });

  it('paragraph with overrides serializes as plain text', () => {
    const editor = createEditor('<p>Hello world</p>');
    // Apply overrides via direct transaction
    const { state } = editor.view;
    const firstChild = state.doc.firstChild;
    expect(firstChild).not.toBeNull();
    const tr = state.tr.setNodeMarkup(0, undefined, {
      ...firstChild!.attrs,
      fontFamily: 'inter',
      fontSize: 18,
    });
    editor.view.dispatch(tr);
    const md = getMarkdown(editor);
    expect(md.trim()).toBe('Hello world');
  });

  it('round-trips heading without override leakage', () => {
    const input = '## My Heading\n\nSome text here.';
    const editor1 = createEditor(input);

    // Add overrides to the heading
    editor1.commands.setNode('heading', {
      level: 2,
      fontFamily: 'georgia',
      fontSize: 28,
      fontWeight: 700,
    });
    const md1 = getMarkdown(editor1);

    // Parse the serialized markdown into a second editor
    const editor2 = createEditor(md1);
    const md2 = getMarkdown(editor2);

    // Should be stable across round-trips
    expect(md2).toBe(md1);

    // Should not contain any style-related content
    expect(md1).not.toContain('georgia');
    expect(md1).not.toContain('font');
    expect(md1).not.toContain('style');
  });

  it('round-trips paragraph without override leakage', () => {
    const input = 'A simple paragraph.';
    const editor1 = createEditor(input);

    // Add overrides to the paragraph
    const { state } = editor1.view;
    const firstChild = state.doc.firstChild;
    expect(firstChild).not.toBeNull();
    const tr = state.tr.setNodeMarkup(0, undefined, {
      ...firstChild!.attrs,
      fontFamily: 'source-serif-4',
      fontSize: 18,
      lineHeight: 1.8,
      color: '#222222',
    });
    editor1.view.dispatch(tr);
    const md1 = getMarkdown(editor1);

    // Parse into a second editor
    const editor2 = createEditor(md1);
    const md2 = getMarkdown(editor2);

    // Should be stable
    expect(md2).toBe(md1);

    // Should not contain override-related content
    expect(md1).not.toContain('source-serif');
    expect(md1).not.toContain('font');
    expect(md1).not.toContain('style');
    expect(md1).not.toContain('#222222');
    expect(md1).not.toContain('1.8');
  });

  it('multiple headings with different overrides serialize cleanly', () => {
    const input = '# Title\n\n## Section A\n\n## Section B\n\nBody text.';
    const editor = createEditor(input);

    // Apply overrides to first heading (H1 at position 0)
    const { state } = editor.view;
    const h1 = state.doc.firstChild;
    expect(h1).not.toBeNull();
    const tr = state.tr.setNodeMarkup(0, undefined, {
      ...h1!.attrs,
      fontFamily: 'source-serif-4',
      fontSize: 36,
      fontWeight: 800,
    });
    editor.view.dispatch(tr);

    const md = getMarkdown(editor);

    // Verify no overrides leaked
    expect(md).not.toContain('source-serif');
    expect(md).not.toContain('font');
    expect(md).not.toContain('style');
    expect(md).not.toContain('36');
    expect(md).not.toContain('800');

    // Verify the headings are structurally correct
    expect(md).toContain('# Title');
    expect(md).toContain('## Section A');
    expect(md).toContain('## Section B');
    expect(md).toContain('Body text.');
  });
});

// ---------------------------------------------------------------------------
// Extension structure tests
// ---------------------------------------------------------------------------

describe('typography overrides extension structure', () => {
  it('HeadingWithOverrides exports a valid Tiptap extension', () => {
    expect(HeadingWithOverrides).toBeDefined();
    expect(HeadingWithOverrides.name).toBe('heading');
  });

  it('ParagraphWithOverrides exports a valid Tiptap extension', () => {
    expect(ParagraphWithOverrides).toBeDefined();
    expect(ParagraphWithOverrides.name).toBe('paragraph');
  });

  it('TypographyOverrides exports a valid Tiptap extension', () => {
    expect(TypographyOverrides).toBeDefined();
    expect(TypographyOverrides.name).toBe('typographyOverrides');
  });

  it('override attrs default to null', () => {
    const editor = createEditor('<p>Test</p>');
    const node = editor.state.doc.firstChild;
    expect(node).not.toBeNull();
    expect(node!.attrs.fontFamily).toBeNull();
    expect(node!.attrs.fontSize).toBeNull();
    expect(node!.attrs.fontWeight).toBeNull();
    expect(node!.attrs.lineHeight).toBeNull();
    expect(node!.attrs.color).toBeNull();
  });

  it('clearTypographyOverrides resets all override attrs to null', () => {
    const editor = createEditor('<h2>Test</h2>');
    // Set overrides
    editor.commands.setNode('heading', {
      level: 2,
      fontFamily: 'georgia',
      fontSize: 24,
    });

    // Verify overrides are set
    let node = editor.state.doc.firstChild;
    expect(node!.attrs.fontFamily).toBe('georgia');
    expect(node!.attrs.fontSize).toBe(24);

    // Clear overrides
    editor.commands.clearTypographyOverrides();

    // Verify overrides are cleared
    node = editor.state.doc.firstChild;
    expect(node!.attrs.fontFamily).toBeNull();
    expect(node!.attrs.fontSize).toBeNull();
  });
});
