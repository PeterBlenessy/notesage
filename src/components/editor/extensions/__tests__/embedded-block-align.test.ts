/**
 * @vitest-environment jsdom
 *
 * Unit tests for the EmbeddedBlockAlign Tiptap Extension.
 *
 * Red-test list (must fail before implementation):
 *  1. setEmbeddedBlockAlign sets align on a NodeSelection-focused image node.
 *  2. setEmbeddedBlockAlign sets align on a NodeSelection-focused chart node.
 *  3. setEmbeddedBlockAlign sets align on a NodeSelection-focused drawing node.
 *  4. setEmbeddedBlockAlign sets align on a NodeSelection-focused linkPreview node.
 *  5. setEmbeddedBlockAlign sets blockWidth=75 when blockWidth is currently null.
 *  6. setEmbeddedBlockAlign preserves an existing blockWidth value.
 *  7. setEmbeddedBlockAlign returns false for a text selection (falls through).
 */

import { describe, it, expect, afterEach } from 'vitest';
import { Editor, Node, mergeAttributes } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { NodeSelection } from '@tiptap/pm/state';
import { EmbeddedBlockAlign } from '../embedded-block-align';

// ---------------------------------------------------------------------------
// Minimal shims for embedded block node types — same name + attribute schema
// as the production extensions, no React/Tauri dependencies.
// ---------------------------------------------------------------------------

const ImageShim = Node.create({
  name: 'image',
  group: 'block',
  atom: true,
  addAttributes() {
    return {
      src: { default: '' },
      align: { default: null as string | null },
      blockWidth: { default: null as number | null },
    };
  },
  parseHTML() {
    return [{ tag: 'img' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ['img', mergeAttributes(HTMLAttributes)];
  },
});

const ChartShim = Node.create({
  name: 'chart',
  group: 'block',
  atom: true,
  addAttributes() {
    return {
      chartJson: { default: '{}' },
      align: { default: null as string | null },
      blockWidth: { default: null as number | null },
    };
  },
  parseHTML() {
    return [{ tag: 'div[data-chart-json]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'chart' })];
  },
});

const DrawingShim = Node.create({
  name: 'drawing',
  group: 'block',
  atom: true,
  addAttributes() {
    return {
      drawingJson: { default: '{}' },
      align: { default: null as string | null },
      blockWidth: { default: null as number | null },
    };
  },
  parseHTML() {
    return [{ tag: 'div[data-drawing-json]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'drawing' })];
  },
});

const LinkPreviewShim = Node.create({
  name: 'linkPreview',
  group: 'block',
  atom: true,
  addAttributes() {
    return {
      url: { default: '' },
      align: { default: null as string | null },
      blockWidth: { default: null as number | null },
    };
  },
  parseHTML() {
    return [{ tag: 'div[data-link-preview]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'linkPreview' })];
  },
});

// ---------------------------------------------------------------------------
// Editor lifecycle helpers
// ---------------------------------------------------------------------------

const editors: Editor[] = [];

afterEach(() => {
  while (editors.length > 0) {
    editors.pop()?.destroy();
  }
});

function createEditor(jsonContent: object): Editor {
  const el = document.createElement('div');
  const editor = new Editor({
    element: el,
    extensions: [
      StarterKit,
      ImageShim,
      ChartShim,
      DrawingShim,
      LinkPreviewShim,
      EmbeddedBlockAlign,
    ],
    content: jsonContent as never,
    editable: true,
  });
  editors.push(editor);
  return editor;
}

/** Place a NodeSelection on the first top-level node of a given type. */
function selectBlock(editor: Editor, typeName: string): void {
  const { doc } = editor.state;
  let pos: number | null = null;
  doc.forEach((node, offset) => {
    if (pos === null && node.type.name === typeName) {
      pos = offset;
    }
  });
  if (pos === null) throw new Error(`No node of type '${typeName}' found in doc`);
  const sel = NodeSelection.create(doc, pos);
  editor.view.dispatch(editor.state.tr.setSelection(sel));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('EmbeddedBlockAlign — setEmbeddedBlockAlign', () => {
  it('sets align on a NodeSelection-focused image node', () => {
    const editor = createEditor({
      type: 'doc',
      content: [
        { type: 'image', attrs: { src: 'test.png', align: null, blockWidth: null } },
        { type: 'paragraph', content: [{ type: 'text', text: 'hello' }] },
      ],
    });

    selectBlock(editor, 'image');
    const ran = editor.chain().focus().setEmbeddedBlockAlign('center').run();

    expect(ran).toBe(true);
    const node = editor.state.doc.firstChild!;
    expect(node.type.name).toBe('image');
    expect(node.attrs.align).toBe('center');
  });

  it('sets align on a NodeSelection-focused chart node', () => {
    const editor = createEditor({
      type: 'doc',
      content: [
        { type: 'chart', attrs: { chartJson: '{}', align: null, blockWidth: null } },
        { type: 'paragraph', content: [{ type: 'text', text: 'hello' }] },
      ],
    });

    selectBlock(editor, 'chart');
    const ran = editor.chain().focus().setEmbeddedBlockAlign('right').run();

    expect(ran).toBe(true);
    const node = editor.state.doc.firstChild!;
    expect(node.type.name).toBe('chart');
    expect(node.attrs.align).toBe('right');
  });

  it('sets align on a NodeSelection-focused drawing node', () => {
    const editor = createEditor({
      type: 'doc',
      content: [
        { type: 'drawing', attrs: { drawingJson: '{}', align: null, blockWidth: null } },
        { type: 'paragraph', content: [{ type: 'text', text: 'hello' }] },
      ],
    });

    selectBlock(editor, 'drawing');
    const ran = editor.chain().focus().setEmbeddedBlockAlign('left').run();

    expect(ran).toBe(true);
    const node = editor.state.doc.firstChild!;
    expect(node.type.name).toBe('drawing');
    expect(node.attrs.align).toBe('left');
  });

  it('sets align on a NodeSelection-focused linkPreview node', () => {
    const editor = createEditor({
      type: 'doc',
      content: [
        { type: 'linkPreview', attrs: { url: 'https://example.com', align: null, blockWidth: null } },
        { type: 'paragraph', content: [{ type: 'text', text: 'hello' }] },
      ],
    });

    selectBlock(editor, 'linkPreview');
    const ran = editor.chain().focus().setEmbeddedBlockAlign('center').run();

    expect(ran).toBe(true);
    const node = editor.state.doc.firstChild!;
    expect(node.type.name).toBe('linkPreview');
    expect(node.attrs.align).toBe('center');
  });

  it('sets blockWidth to 75 when blockWidth is currently null', () => {
    const editor = createEditor({
      type: 'doc',
      content: [
        { type: 'chart', attrs: { chartJson: '{}', align: null, blockWidth: null } },
        { type: 'paragraph', content: [{ type: 'text', text: 'hello' }] },
      ],
    });

    selectBlock(editor, 'chart');
    editor.chain().focus().setEmbeddedBlockAlign('center').run();

    const node = editor.state.doc.firstChild!;
    expect(node.attrs.blockWidth).toBe(75);
  });

  it('preserves an existing blockWidth when setting align', () => {
    const editor = createEditor({
      type: 'doc',
      content: [
        { type: 'chart', attrs: { chartJson: '{}', align: 'left', blockWidth: 50 } },
        { type: 'paragraph', content: [{ type: 'text', text: 'hello' }] },
      ],
    });

    selectBlock(editor, 'chart');
    editor.chain().focus().setEmbeddedBlockAlign('right').run();

    const node = editor.state.doc.firstChild!;
    expect(node.attrs.blockWidth).toBe(50);
  });

  it('returns false for a plain paragraph selection (falls through to TextAlign)', () => {
    const editor = createEditor({
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'hello' }] },
      ],
    });

    // Place cursor inside the paragraph (TextSelection)
    editor.commands.setTextSelection(1);
    const ran = editor.chain().focus().setEmbeddedBlockAlign('center').run();

    expect(ran).toBe(false);
  });
});
