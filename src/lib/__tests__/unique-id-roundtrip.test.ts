import { describe, it, expect } from 'vitest';
import {
  stripNodeIdComments,
  injectNodeIdComments,
} from '../markdown';

describe('UniqueID markdown round-tripping', () => {
  describe('stripNodeIdComments', () => {
    it('strips id comments and records them by block index', () => {
      const md = [
        '<!-- id:a1b2c3d4-e5f6-7890-abcd-ef1234567890 -->',
        '# Hello',
        '',
        '<!-- id:11111111-2222-3333-4444-555555555555 -->',
        'Some paragraph text.',
      ].join('\n');

      const { cleaned, nodeIds } = stripNodeIdComments(md);

      // Comments should be stripped
      expect(cleaned).not.toContain('<!-- id:');
      expect(cleaned).toContain('# Hello');
      expect(cleaned).toContain('Some paragraph text.');

      // Node IDs should be recorded (0-based block index)
      expect(nodeIds.size).toBe(2);
      expect(nodeIds.get(0)).toBe('a1b2c3d4-e5f6-7890-abcd-ef1234567890');
      expect(nodeIds.get(1)).toBe('11111111-2222-3333-4444-555555555555');
    });

    it('returns empty map when no id comments exist', () => {
      const md = '# Hello\n\nSome text.';
      const { cleaned, nodeIds } = stripNodeIdComments(md);
      expect(cleaned).toBe(md);
      expect(nodeIds.size).toBe(0);
    });

    it('ignores non-matching HTML comments', () => {
      const md = [
        '<!-- type:currency,summary:sum -->',
        '# Hello',
        '',
        '<!-- toc -->',
        'Some text.',
      ].join('\n');

      const { cleaned, nodeIds } = stripNodeIdComments(md);
      expect(cleaned).toBe(md);
      expect(nodeIds.size).toBe(0);
    });

    it('handles multiple consecutive blocks with IDs', () => {
      const md = [
        '<!-- id:aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee -->',
        '# First heading',
        '',
        '<!-- id:11111111-2222-3333-4444-555555555555 -->',
        '## Second heading',
        '',
        '<!-- id:99999999-8888-7777-6666-555544443333 -->',
        'A paragraph.',
      ].join('\n');

      const { cleaned, nodeIds } = stripNodeIdComments(md);
      expect(nodeIds.size).toBe(3);
      expect(cleaned).not.toContain('<!-- id:');
      expect(cleaned).toContain('# First heading');
      expect(cleaned).toContain('## Second heading');
      expect(cleaned).toContain('A paragraph.');
    });

    it('does not match malformed UUIDs', () => {
      const md = [
        '<!-- id:not-a-uuid -->',
        '# Hello',
      ].join('\n');

      const { cleaned, nodeIds } = stripNodeIdComments(md);
      expect(cleaned).toBe(md);
      expect(nodeIds.size).toBe(0);
    });
  });

  describe('injectNodeIdComments', () => {
    it('injects id comments before blocks with IDs', () => {
      // Create a mock editor with state.doc that has block nodes with IDs
      const mockEditor = createMockEditorWithIds([
        { id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' },
        { id: '11111111-2222-3333-4444-555555555555' },
      ]);

      const md = '# First heading\n\nSecond paragraph.';
      const result = injectNodeIdComments(md, mockEditor);

      expect(result).toContain('<!-- id:aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee -->');
      expect(result).toContain('<!-- id:11111111-2222-3333-4444-555555555555 -->');
    });

    it('skips blocks without IDs', () => {
      const mockEditor = createMockEditorWithIds([
        { id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' },
        { id: '' },
      ]);

      const md = '# First heading\n\nSecond paragraph.';
      const result = injectNodeIdComments(md, mockEditor);

      expect(result).toContain('<!-- id:aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee -->');
      // Second block should NOT have an ID comment
      const lines = result.split('\n');
      const secondIdLine = lines.findIndex((l) => l.includes('Second paragraph'));
      expect(lines[secondIdLine - 1]).not.toContain('<!-- id:');
    });

    it('returns unchanged markdown when no blocks have IDs', () => {
      const mockEditor = createMockEditorWithIds([
        { id: '' },
        { id: '' },
      ]);

      const md = '# Hello\n\nWorld.';
      const result = injectNodeIdComments(md, mockEditor);
      expect(result).toBe(md);
    });
  });

  describe('round-trip', () => {
    it('strip then inject preserves IDs', () => {
      const original = [
        '<!-- id:aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee -->',
        '# First heading',
        '',
        '<!-- id:11111111-2222-3333-4444-555555555555 -->',
        'Second paragraph.',
      ].join('\n');

      const { cleaned, nodeIds: _ids } = stripNodeIdComments(original);
      expect(cleaned).toBe('# First heading\n\nSecond paragraph.');
      expect(_ids.size).toBe(2);

      // Simulate inject with the stored IDs
      const mockEditor = createMockEditorWithIds([
        { id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' },
        { id: '11111111-2222-3333-4444-555555555555' },
      ]);

      const result = injectNodeIdComments(cleaned, mockEditor);

      // Both ID comments should be present
      expect(result).toContain('<!-- id:aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee -->');
      expect(result).toContain('<!-- id:11111111-2222-3333-4444-555555555555 -->');
      // Content should be preserved
      expect(result).toContain('# First heading');
      expect(result).toContain('Second paragraph.');
      // Verify IDs appear before their blocks
      const lines = result.split('\n');
      const idLine1 = lines.indexOf('<!-- id:aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee -->');
      const headingLine = lines.indexOf('# First heading');
      expect(idLine1).toBe(headingLine - 1);
    });
  });
});

// Helper to create a minimal mock editor for injectNodeIdComments
function createMockEditorWithIds(blocks: Array<{ id: string }>) {
  const nodes = blocks.map((b) => ({ attrs: { id: b.id || null } }));
  return {
    state: {
      doc: {
        forEach: (callback: (node: { attrs: { id: string | null } }, offset: number) => void) => {
          let offset = 0;
          for (const node of nodes) {
            callback(node, offset);
            offset += 10; // arbitrary offset increment
          }
        },
      },
    },
  } as unknown as import('@tiptap/core').Editor;
}
