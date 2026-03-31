/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from 'vitest';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { Markdown } from 'tiptap-markdown';
import { PageBreakNode } from '../page-break-node';

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

function createEditor(content?: string): Editor {
  return new Editor({
    extensions: [
      StarterKit,
      PageBreakNode,
      Markdown.configure({ html: true }),
    ],
    content: content || '<p>Hello</p>',
  });
}

function getMarkdown(editor: Editor): string {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (editor.storage as Record<string, any>).markdown.getMarkdown();
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('PageBreakNode', () => {
  it('registers the pageBreak node type in the schema', () => {
    const editor = createEditor();
    expect(editor.schema.nodes.pageBreak).toBeDefined();
    editor.destroy();
  });

  it('node spec is atom (not editable)', () => {
    const editor = createEditor();
    expect(editor.schema.nodes.pageBreak.spec.atom).toBe(true);
    editor.destroy();
  });

  it('node spec is selectable', () => {
    const editor = createEditor();
    // Tiptap sets selectable: true in the extension definition
    // ProseMirror NodeSpec defaults selectable to true for atom nodes
    // but we explicitly set it — verify via the extension config
    const ext = editor.extensionManager.extensions.find(
      (e) => e.name === 'pageBreak',
    );
    expect(ext).toBeDefined();
    // The extension options include selectable from Node.create config
    expect(editor.schema.nodes.pageBreak.spec.selectable).not.toBe(false);
    editor.destroy();
  });

  it('node spec is draggable', () => {
    const editor = createEditor();
    expect(editor.schema.nodes.pageBreak.spec.draggable).toBe(true);
    editor.destroy();
  });

  it('node spec belongs to block group', () => {
    const editor = createEditor();
    expect(editor.schema.nodes.pageBreak.spec.group).toBe('block');
    editor.destroy();
  });

  it('inserts page break via insertPageBreak command', () => {
    const editor = createEditor('<p>Before</p><p>After</p>');
    // Place cursor at the end of the first paragraph
    editor.commands.setTextSelection(7);
    const success = editor.commands.insertPageBreak();
    expect(success).toBe(true);

    const json = editor.getJSON();
    const types = json.content?.map((n) => n.type) ?? [];
    expect(types).toContain('pageBreak');
    editor.destroy();
  });

  it('page break appears between surrounding paragraphs', () => {
    const editor = createEditor('<p>Before</p><p>After</p>');
    editor.commands.setTextSelection(7);
    editor.commands.insertPageBreak();

    const json = editor.getJSON();
    const types = json.content?.map((n) => n.type) ?? [];
    const idx = types.indexOf('pageBreak');
    expect(idx).toBeGreaterThan(0);
    // Should have paragraph nodes around it
    expect(types.filter((t) => t === 'paragraph').length).toBeGreaterThanOrEqual(1);
    editor.destroy();
  });

  it('page break node has no content (atom)', () => {
    const editor = createEditor('<p>Before</p><div data-page-break></div><p>After</p>');
    const json = editor.getJSON();
    const pb = json.content?.find((n) => n.type === 'pageBreak');
    expect(pb).toBeDefined();
    expect(pb!.content).toBeUndefined();
    editor.destroy();
  });

  it('serializes to markdown as <!-- pagebreak -->', () => {
    const editor = createEditor(
      '<p>Before</p><div data-page-break></div><p>After</p>',
    );
    const md = getMarkdown(editor);
    expect(md).toContain('<!-- pagebreak -->');
    editor.destroy();
  });

  it('parses from HTML div with data-page-break attribute', () => {
    const editor = createEditor(
      '<div data-page-break="true"></div>',
    );
    const json = editor.getJSON();
    const types = json.content?.map((n) => n.type) ?? [];
    expect(types).toContain('pageBreak');
    editor.destroy();
  });

  it('can delete page break node', () => {
    const editor = createEditor(
      '<p>Before</p><div data-page-break></div><p>After</p>',
    );

    // Find the page break node position
    let pbPos = -1;
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === 'pageBreak') {
        pbPos = pos;
        return false;
      }
      return true;
    });

    expect(pbPos).toBeGreaterThan(-1);

    // Select and delete the page break node
    editor.commands.setNodeSelection(pbPos);
    editor.commands.deleteSelection();

    const json = editor.getJSON();
    const types = json.content?.map((n) => n.type) ?? [];
    expect(types).not.toContain('pageBreak');
    editor.destroy();
  });

  it('renders HTML with data-page-break attribute and page-break-node class', () => {
    const editor = createEditor(
      '<div data-page-break></div>',
    );
    const html = editor.getHTML();
    expect(html).toContain('data-page-break');
    expect(html).toContain('page-break-node');
    expect(html).toContain('Page Break');
    editor.destroy();
  });

  it('multiple page breaks in same document', () => {
    const editor = createEditor(
      '<p>Part 1</p><div data-page-break></div><p>Part 2</p><div data-page-break></div><p>Part 3</p>',
    );
    const json = editor.getJSON();
    const pageBreaks = json.content?.filter((n) => n.type === 'pageBreak') ?? [];
    expect(pageBreaks).toHaveLength(2);

    const md = getMarkdown(editor);
    const matches = md.match(/<!-- pagebreak -->/g);
    expect(matches).toHaveLength(2);
    editor.destroy();
  });
});
