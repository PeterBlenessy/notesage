import { describe, it, expect } from 'vitest';
import { getThread, getChildren, getBranches, getLeaves, getDescendants } from '@/lib/chat-tree';
import type { ChatMessage } from '@/lib/ai/types';

function msg(id: string, parentId: string | null, role: 'user' | 'assistant' = 'user', ts?: number): ChatMessage {
  return { id, parentId, role, content: `msg-${id}`, timestamp: ts ?? parseInt(id.replace(/\D/g, '') || '0') };
}

describe('chat-tree', () => {
  // -----------------------------------------------------------------------
  // Linear conversation (no branches) — degenerate tree
  // -----------------------------------------------------------------------
  describe('linear conversation', () => {
    const messages: ChatMessage[] = [
      msg('1', null, 'user', 1),
      msg('2', '1', 'assistant', 2),
      msg('3', '2', 'user', 3),
      msg('4', '3', 'assistant', 4),
    ];

    it('getThread returns all messages in order', () => {
      const thread = getThread(messages, '4');
      expect(thread.map((m) => m.id)).toEqual(['1', '2', '3', '4']);
    });

    it('getThread from middle returns partial path', () => {
      const thread = getThread(messages, '2');
      expect(thread.map((m) => m.id)).toEqual(['1', '2']);
    });

    it('getChildren of root returns first message', () => {
      const children = getChildren(messages, null);
      expect(children.map((m) => m.id)).toEqual(['1']);
    });

    it('getChildren of message returns its direct child', () => {
      const children = getChildren(messages, '2');
      expect(children.map((m) => m.id)).toEqual(['3']);
    });

    it('getLeaves returns last message only', () => {
      const leaves = getLeaves(messages);
      expect(leaves.map((m) => m.id)).toEqual(['4']);
    });

    it('getBranches at non-branch point returns single branch', () => {
      const branches = getBranches(messages, '2');
      expect(branches.length).toBe(1);
      expect(branches[0].map((m) => m.id)).toEqual(['3', '4']);
    });
  });

  // -----------------------------------------------------------------------
  // Single branch point
  // -----------------------------------------------------------------------
  describe('single branch point', () => {
    //       1 (user)
    //       2 (assistant)
    //      / \
    //     3a  3b  (user branches)
    //     4a  4b  (assistant replies)
    const messages: ChatMessage[] = [
      msg('1', null, 'user', 1),
      msg('2', '1', 'assistant', 2),
      msg('3a', '2', 'user', 3),
      msg('4a', '3a', 'assistant', 4),
      msg('3b', '2', 'user', 5),
      msg('4b', '3b', 'assistant', 6),
    ];

    it('getThread for branch A returns correct path', () => {
      const thread = getThread(messages, '4a');
      expect(thread.map((m) => m.id)).toEqual(['1', '2', '3a', '4a']);
    });

    it('getThread for branch B returns correct path', () => {
      const thread = getThread(messages, '4b');
      expect(thread.map((m) => m.id)).toEqual(['1', '2', '3b', '4b']);
    });

    it('getChildren at branch point returns both children', () => {
      const children = getChildren(messages, '2');
      expect(children.map((m) => m.id)).toEqual(['3a', '3b']);
    });

    it('getLeaves returns both leaf messages', () => {
      const leaves = getLeaves(messages);
      expect(leaves.map((m) => m.id).sort()).toEqual(['4a', '4b']);
    });

    it('getBranches at branch point returns two branches', () => {
      const branches = getBranches(messages, '2');
      expect(branches.length).toBe(2);
      expect(branches[0].map((m) => m.id)).toEqual(['3a', '4a']);
      expect(branches[1].map((m) => m.id)).toEqual(['3b', '4b']);
    });
  });

  // -----------------------------------------------------------------------
  // Nested branches
  // -----------------------------------------------------------------------
  describe('nested branches', () => {
    //       1
    //       2
    //      / \
    //     3a  3b
    //     4a  4b
    //    / \
    //   5a  5b
    const messages: ChatMessage[] = [
      msg('1', null, 'user', 1),
      msg('2', '1', 'assistant', 2),
      msg('3a', '2', 'user', 3),
      msg('4a', '3a', 'assistant', 4),
      msg('5a', '4a', 'user', 5),
      msg('5b', '4a', 'user', 6),
      msg('3b', '2', 'user', 7),
      msg('4b', '3b', 'assistant', 8),
    ];

    it('getThread for deeply nested leaf', () => {
      const thread = getThread(messages, '5a');
      expect(thread.map((m) => m.id)).toEqual(['1', '2', '3a', '4a', '5a']);
    });

    it('getThread for other nested leaf', () => {
      const thread = getThread(messages, '5b');
      expect(thread.map((m) => m.id)).toEqual(['1', '2', '3a', '4a', '5b']);
    });

    it('getLeaves returns all three leaves', () => {
      const leaves = getLeaves(messages);
      expect(leaves.map((m) => m.id).sort()).toEqual(['4b', '5a', '5b']);
    });

    it('getBranches at inner branch point', () => {
      const branches = getBranches(messages, '4a');
      expect(branches.length).toBe(2);
      expect(branches[0].map((m) => m.id)).toEqual(['5a']);
      expect(branches[1].map((m) => m.id)).toEqual(['5b']);
    });

    it('getBranches at outer branch point includes nested sub-trees', () => {
      const branches = getBranches(messages, '2');
      expect(branches.length).toBe(2);
      // Branch A includes all descendants: 3a, 4a, 5a, 5b
      expect(branches[0].map((m) => m.id).sort()).toEqual(['3a', '4a', '5a', '5b']);
      // Branch B: 3b, 4b
      expect(branches[1].map((m) => m.id).sort()).toEqual(['3b', '4b']);
    });
  });

  // -----------------------------------------------------------------------
  // Empty conversation
  // -----------------------------------------------------------------------
  describe('empty conversation', () => {
    it('getThread returns empty for null leafId', () => {
      expect(getThread([], null)).toEqual([]);
    });

    it('getThread returns empty for undefined leafId', () => {
      expect(getThread([], undefined)).toEqual([]);
    });

    it('getThread returns empty when leaf not found', () => {
      expect(getThread([msg('1', null)], 'nonexistent')).toEqual([]);
    });

    it('getChildren returns empty', () => {
      expect(getChildren([], null)).toEqual([]);
    });

    it('getLeaves returns empty', () => {
      expect(getLeaves([])).toEqual([]);
    });

    it('getBranches returns empty for nonexistent message', () => {
      expect(getBranches([], 'nonexistent')).toEqual([]);
    });

    it('getDescendants returns empty set for nonexistent id', () => {
      expect(getDescendants([], 'nonexistent').size).toBe(1); // just the root itself
    });
  });

  describe('getDescendants', () => {
    it('collects the entire subtree from a root', () => {
      const messages: ChatMessage[] = [
        { role: 'user', content: 'A', id: '1', parentId: null, timestamp: 1 },
        { role: 'assistant', content: 'B', id: '2', parentId: '1', timestamp: 2 },
        { role: 'user', content: 'C', id: '3', parentId: '2', timestamp: 3 },
        { role: 'assistant', content: 'D', id: '4', parentId: '2', timestamp: 4 },
      ];
      const desc = getDescendants(messages, '2');
      expect(desc).toEqual(new Set(['2', '3', '4']));
    });

    it('returns only the root when it has no children', () => {
      const messages: ChatMessage[] = [
        { role: 'user', content: 'A', id: '1', parentId: null, timestamp: 1 },
      ];
      expect(getDescendants(messages, '1')).toEqual(new Set(['1']));
    });

    it('collects deeply nested descendants', () => {
      const messages: ChatMessage[] = [
        { role: 'user', content: 'A', id: '1', parentId: null, timestamp: 1 },
        { role: 'assistant', content: 'B', id: '2', parentId: '1', timestamp: 2 },
        { role: 'user', content: 'C', id: '3', parentId: '2', timestamp: 3 },
        { role: 'assistant', content: 'D', id: '4', parentId: '3', timestamp: 4 },
        { role: 'user', content: 'E', id: '5', parentId: '4', timestamp: 5 },
      ];
      const desc = getDescendants(messages, '2');
      expect(desc).toEqual(new Set(['2', '3', '4', '5']));
    });
  });
});
