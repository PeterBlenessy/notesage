import { describe, it, expect } from 'vitest';
import { autoTitle, pruneConversations, pruneStaleProjectPaths } from '../conversationOps';
import type { Conversation } from '@/stores/chat-store';

function makeConv(overrides: Partial<Conversation> & { id: string }): Conversation {
  return {
    title: '',
    messages: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
    projectPaths: [],
    segments: [{ projectPaths: [], sessionId: null, startMessageIndex: 0, historyIncluded: false }],
    activeSegmentIndex: 0,
    pendingProjectSwitch: null,
    activeLeafId: null,
    ...overrides,
  };
}

describe('autoTitle', () => {
  it('returns the first line if under 50 chars', () => {
    expect(autoTitle('Hello world')).toBe('Hello world');
  });

  it('truncates long first lines to 50 chars with ellipsis', () => {
    const long = 'A'.repeat(60);
    const result = autoTitle(long);
    expect(result).toHaveLength(51); // 50 chars + ellipsis
    expect(result.endsWith('\u2026')).toBe(true);
  });

  it('uses only the first line of multi-line content', () => {
    expect(autoTitle('First line\nSecond line\nThird line')).toBe('First line');
  });

  it('handles empty string', () => {
    expect(autoTitle('')).toBe('');
  });

  it('handles exactly 50 characters', () => {
    const exact = 'B'.repeat(50);
    expect(autoTitle(exact)).toBe(exact);
  });

  it('handles 51 characters (just over limit)', () => {
    const over = 'C'.repeat(51);
    const result = autoTitle(over);
    expect(result).toHaveLength(51);
    expect(result).toBe('C'.repeat(50) + '\u2026');
  });
});

describe('pruneConversations', () => {
  it('returns unchanged array when under the limit', () => {
    const convs = [makeConv({ id: 'a' }), makeConv({ id: 'b' })];
    const result = pruneConversations(convs, 'a', 5);
    expect(result).toBe(convs); // same reference
  });

  it('removes oldest inactive conversations when over limit', () => {
    const convs = [
      makeConv({ id: 'new', updatedAt: 300 }),
      makeConv({ id: 'mid', updatedAt: 200 }),
      makeConv({ id: 'old', updatedAt: 100 }),
    ];
    const result = pruneConversations(convs, 'new', 2);
    expect(result).toHaveLength(2);
    expect(result.map((c) => c.id)).toContain('new');
    expect(result.map((c) => c.id)).not.toContain('old');
  });

  it('never prunes the active conversation', () => {
    const convs = [
      makeConv({ id: 'active', updatedAt: 1 }), // oldest but active
      makeConv({ id: 'b', updatedAt: 200 }),
      makeConv({ id: 'c', updatedAt: 300 }),
    ];
    const result = pruneConversations(convs, 'active', 2);
    expect(result.map((c) => c.id)).toContain('active');
  });

  it('handles null activeId', () => {
    const convs = [
      makeConv({ id: 'a', updatedAt: 100 }),
      makeConv({ id: 'b', updatedAt: 200 }),
      makeConv({ id: 'c', updatedAt: 300 }),
    ];
    const result = pruneConversations(convs, null, 2);
    expect(result).toHaveLength(2);
  });

  it('handles exactly at limit', () => {
    const convs = [makeConv({ id: 'a' }), makeConv({ id: 'b' })];
    const result = pruneConversations(convs, 'a', 2);
    expect(result).toBe(convs);
  });
});

describe('pruneStaleProjectPaths', () => {
  it('returns unchanged when all paths are valid', () => {
    const convs = [
      makeConv({ id: 'a', projectPaths: ['/valid/path'] }),
    ];
    const result = pruneStaleProjectPaths(convs, new Set(['/valid/path']));
    expect(result.changed).toBe(false);
    expect(result.conversations[0]).toBe(convs[0]); // same reference
  });

  it('removes invalid paths', () => {
    const convs = [
      makeConv({ id: 'a', projectPaths: ['/valid', '/stale'] }),
    ];
    const result = pruneStaleProjectPaths(convs, new Set(['/valid']));
    expect(result.changed).toBe(true);
    expect(result.conversations[0].projectPaths).toEqual(['/valid']);
  });

  it('handles empty validPaths set', () => {
    const convs = [
      makeConv({ id: 'a', projectPaths: ['/a', '/b'] }),
    ];
    const result = pruneStaleProjectPaths(convs, new Set());
    expect(result.changed).toBe(true);
    expect(result.conversations[0].projectPaths).toEqual([]);
  });

  it('handles conversations with no project paths', () => {
    const convs = [makeConv({ id: 'a', projectPaths: [] })];
    const result = pruneStaleProjectPaths(convs, new Set(['/valid']));
    expect(result.changed).toBe(false);
  });

  it('handles multiple conversations with mixed changes', () => {
    const convs = [
      makeConv({ id: 'a', projectPaths: ['/valid'] }),
      makeConv({ id: 'b', projectPaths: ['/stale'] }),
    ];
    const result = pruneStaleProjectPaths(convs, new Set(['/valid']));
    expect(result.changed).toBe(true);
    expect(result.conversations[0].projectPaths).toEqual(['/valid']);
    expect(result.conversations[1].projectPaths).toEqual([]);
    // First conversation unchanged, same reference
    expect(result.conversations[0]).toBe(convs[0]);
  });
});
