/**
 * @vitest-environment jsdom
 *
 * Tests for the EmbeddedBlockAlign Tiptap extension.
 *
 * The extension adds a `setEmbeddedBlockAlign(align)` command that sets the
 * `align` (and conditionally `blockWidth`) attribute on embedded atom block
 * nodes (image, chart, drawing, linkPreview) when one of those nodes is
 * selected — either via NodeSelection or by cursor adjacency.
 *
 * Keyboard shortcuts Mod-Shift-l/e/r call this command first; if no embedded
 * block is in scope they return false and fall through to TextAlign.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { NodeSelection } from '@tiptap/pm/state';
import TextAlign from '@tiptap/extension-text-align';
import { EmbeddedBlockAlign } from '../embedded-block-align';

// ---------------------------------------------------------------------------
// Minimal stub nodes for image, chart, drawing, linkPreview
// We don't need full extension behaviour — just schema nodes with align/blockWidth attrs
// ---------------------------------------------------------------------------

import { Node as TiptapNode } from '@tiptap/core';

const StubImage = TiptapNode.create({
  name: 'image',
  group: 'block',
  atom: true,
  addAttributes() {
    return {
      src: { default: '' },
      align: { default: null },
      blockWidth: { default: null },
    };
  },
  parseHTML() { return [{ tag: 'img' }]; },
  renderHTML({ HTMLAttributes }) { return ['img', HTMLAttributes]; },
});

const StubChart = TiptapNode.create({
  name: 'chart',
  group: 'block',
  atom: true,
  addAttributes() {
    return {
      chartId: { default: null },
      align: { default: null },
      blockWidth: { default: null },
    };
  },
  parseHTML() { return [{ tag: 'div[data-type="chart"]' }]; },
  renderHTML({ HTMLAttributes }) { return ['div', mergeStub({ 'data-type': 'chart' }, HTMLAttributes)]; },
});

const StubDrawing = TiptapNode.create({
  name: 'drawing',
  group: 'block',
  atom: true,
  addAttributes() {
    return {
      drawingId: { default: null },
      align: { default: null },
      blockWidth: { default: null },
    };
  },
  parseHTML() { return [{ tag: 'div[data-type="drawing"]' }]; },
  renderHTML({ HTMLAttributes }) { return ['div', mergeStub({ 'data-type': 'drawing' }, HTMLAttributes)]; },
});

const StubLinkPreview = TiptapNode.create({
  name: 'linkPreview',
  group: 'block',
  atom: true,
  addAttributes() {
    return {
      href: { default: '' },
      align: { default: null },
      blockWidth: { default: null },
    };
  },
  parseHTML() { return [{ tag: 'div[data-type="link-preview"]' }]; },
  renderHTML({ HTMLAttributes }) { return ['div', mergeStub({ 'data-type': 'link-preview' }, HTMLAttributes)]; },
});

function mergeStub(base: Record<string, string>, attrs: Record<string, unknown>): Record<string, unknown> {
  return { ...base, ...attrs };
}

// ---------------------------------------------------------------------------
// Editor lifecycle helpers
// ---------------------------------------------------------------------------

const editors: Editor[] = [];

afterEach(() => {
  while (editors.length > 0) {
    editors.pop()?.destroy();
  }
});

function createEditor(): Editor {
  const editor = new Editor({
    extensions: [
      StarterKit,
      TextAlign.configure({ types: ['heading', 'paragraph'] }),
      StubImage,
      StubChart,
      StubDrawing,
      StubLinkPreview,
      EmbeddedBlockAlign,
    ],
  });
  editors.push(editor);
  return editor;
}

/** Insert a node of the given type as the sole doc content and select it (NodeSelection). */
function insertAndSelectNode(editor: Editor, nodeName: string, attrs: Record<string, unknown> = {}): void {
  // Use setContent with JSON to ensure the node is in the document
  editor.commands.setContent({ type: 'doc', content: [{ type: nodeName, attrs }] });

  // Find the node's position by traversal
  let nodePos = -1;
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name === nodeName) {
      nodePos = pos;
      return false;
    }
  });
  if (nodePos === -1) throw new Error(`Node "${nodeName}" not found in document after setContent`);

  const tr = editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, nodePos));
  editor.view.dispatch(tr);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('EmbeddedBlockAlign extension', () => {
  describe('command registration', () => {
    it('registers setEmbeddedBlockAlign command on the editor', () => {
      const editor = createEditor();
      expect(typeof editor.commands.setEmbeddedBlockAlign).toBe('function');
    });
  });

  describe('setEmbeddedBlockAlign on NodeSelection', () => {
    it.each([
      ['image', { src: 'test.png' }],
      ['chart', { chartId: 'chart-1' }],
      ['drawing', { drawingId: 'draw-1' }],
      ['linkPreview', { href: 'https://example.com' }],
    ])('sets align on %s node when it is NodeSelected', (nodeName, attrs) => {
      const editor = createEditor();
      insertAndSelectNode(editor, nodeName, attrs);

      const result = editor.commands.setEmbeddedBlockAlign('center');
      expect(result).toBe(true);

      // Find the node in the document and check its align attribute
      let foundAlign: string | null = null;
      editor.state.doc.descendants((node) => {
        if (node.type.name === nodeName) {
          foundAlign = node.attrs.align as string | null;
        }
      });
      expect(foundAlign).toBe('center');
    });

    it.each([
      ['image', { src: 'test.png' }],
      ['chart', { chartId: 'chart-1' }],
      ['drawing', { drawingId: 'draw-1' }],
      ['linkPreview', { href: 'https://example.com' }],
    ])('sets blockWidth=75 when %s node has no blockWidth', (nodeName, attrs) => {
      const editor = createEditor();
      insertAndSelectNode(editor, nodeName, attrs);

      editor.commands.setEmbeddedBlockAlign('right');

      let foundBlockWidth: number | null = null;
      editor.state.doc.descendants((node) => {
        if (node.type.name === nodeName) {
          foundBlockWidth = node.attrs.blockWidth as number | null;
        }
      });
      expect(foundBlockWidth).toBe(75);
    });

    it('preserves existing blockWidth when already set', () => {
      const editor = createEditor();
      insertAndSelectNode(editor, 'chart', { chartId: 'c1', blockWidth: 50 });

      editor.commands.setEmbeddedBlockAlign('center');

      let foundBlockWidth: number | null = null;
      editor.state.doc.descendants((node) => {
        if (node.type.name === 'chart') {
          foundBlockWidth = node.attrs.blockWidth as number | null;
        }
      });
      expect(foundBlockWidth).toBe(50);
    });
  });

  describe('setEmbeddedBlockAlign returns false for non-embedded selections', () => {
    it('returns false when cursor is in a paragraph (no embedded block)', () => {
      const editor = createEditor();
      editor.commands.setContent('<p>Hello</p>');
      // Cursor is in paragraph by default — no embedded block
      const result = editor.commands.setEmbeddedBlockAlign('center');
      expect(result).toBe(false);
    });
  });

  describe('align values', () => {
    it('sets align to "left"', () => {
      const editor = createEditor();
      insertAndSelectNode(editor, 'chart', { chartId: 'c1' });
      editor.commands.setEmbeddedBlockAlign('left');
      let found: string | null = null;
      editor.state.doc.descendants((n) => { if (n.type.name === 'chart') found = n.attrs.align; });
      expect(found).toBe('left');
    });

    it('sets align to "right"', () => {
      const editor = createEditor();
      insertAndSelectNode(editor, 'chart', { chartId: 'c1' });
      editor.commands.setEmbeddedBlockAlign('right');
      let found: string | null = null;
      editor.state.doc.descendants((n) => { if (n.type.name === 'chart') found = n.attrs.align; });
      expect(found).toBe('right');
    });
  });
});
