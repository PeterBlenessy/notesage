import { describe, it, expect, beforeEach } from 'vitest';
import { getSessionIdForLeaf, useChatStore } from '../chat-store';
import type { Conversation } from '../chat-store';
import type { ChatMessage } from '@/lib/ai/types';

// Build a tiny conversation with known IDs for resolver tests.
function makeConversation(overrides: Partial<Conversation> = {}): Conversation {
  const messages: ChatMessage[] = [
    { role: 'user', content: 'a', id: 'm1', parentId: null, timestamp: 1 },
    { role: 'assistant', content: 'b', id: 'm2', parentId: 'm1', timestamp: 2 },
    // branch 1 continues
    { role: 'user', content: 'c', id: 'm3', parentId: 'm2', timestamp: 3 },
    // branch 2 forks from m2
    { role: 'user', content: 'd', id: 'm4', parentId: 'm2', timestamp: 4 },
  ];
  return {
    id: 'conv-1',
    title: 'Test',
    messages,
    projectPaths: [],
    segments: [],
    activeSegmentIndex: 0,
    activeLeafId: 'm3',
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

describe('getSessionIdForLeaf', () => {
  it('returns undefined when no session IDs are set', () => {
    const conv = makeConversation();
    expect(getSessionIdForLeaf(conv, 'm3')).toBeUndefined();
  });

  it('falls back to the conversation-level acpSessionId when no branchSessions exist', () => {
    const conv = makeConversation({ acpSessionId: 'conv-session' });
    expect(getSessionIdForLeaf(conv, 'm3')).toBe('conv-session');
    expect(getSessionIdForLeaf(conv, null)).toBe('conv-session');
  });

  it('returns the direct branch session when the leaf ID matches', () => {
    const conv = makeConversation({
      acpSessionId: 'conv-session',
      branchSessions: { m3: 'branch-3-session', m4: 'branch-4-session' },
    });
    expect(getSessionIdForLeaf(conv, 'm3')).toBe('branch-3-session');
    expect(getSessionIdForLeaf(conv, 'm4')).toBe('branch-4-session');
  });

  it('walks the ancestor chain to find a branch session', () => {
    // Branch session is attached to m2 (an ancestor of m3).
    const conv = makeConversation({
      acpSessionId: 'conv-session',
      branchSessions: { m2: 'ancestor-session' },
    });
    expect(getSessionIdForLeaf(conv, 'm3')).toBe('ancestor-session');
  });

  it('prefers the closest ancestor when multiple are tagged', () => {
    // Both m2 and m3 have branch sessions; resolving from m3 should return m3's session.
    const conv = makeConversation({
      acpSessionId: 'conv-session',
      branchSessions: { m2: 'far-session', m3: 'near-session' },
    });
    expect(getSessionIdForLeaf(conv, 'm3')).toBe('near-session');
  });

  it('falls back to conv.acpSessionId when no ancestor has a branch session', () => {
    const conv = makeConversation({
      acpSessionId: 'conv-session',
      // Branch session only on an unrelated leaf (m4)
      branchSessions: { m4: 'other-branch-session' },
    });
    expect(getSessionIdForLeaf(conv, 'm3')).toBe('conv-session');
  });

  it('returns undefined when leafId is null and branchSessions has entries but no conv-level session', () => {
    const conv = makeConversation({
      branchSessions: { m3: 'branch-3-session' },
    });
    expect(getSessionIdForLeaf(conv, null)).toBeUndefined();
  });

  it('returns the conv session when leafId points to a missing message', () => {
    const conv = makeConversation({
      acpSessionId: 'conv-session',
      branchSessions: { m3: 'branch-3-session' },
    });
    expect(getSessionIdForLeaf(conv, 'nonexistent')).toBe('conv-session');
  });

  it('treats an empty branchSessions object as no branch data', () => {
    const conv = makeConversation({
      acpSessionId: 'conv-session',
      branchSessions: {},
    });
    expect(getSessionIdForLeaf(conv, 'm3')).toBe('conv-session');
  });
});

describe('branchFromMessage + pendingBranchSession consumption', () => {
  beforeEach(() => {
    // Fresh state per test — partial set (keeps actions intact).
    useChatStore.setState({
      conversations: [],
      activeConversationId: null,
      isLoading: false,
      error: null,
      activeTool: null,
    });
  });

  it('stages a pendingBranchSession when forkedSessionId is provided', () => {
    const store = useChatStore.getState();
    const convId = store.createConversation();
    store.addMessage({ role: 'user', content: 'hello', timestamp: 1 });
    store.addMessage({ role: 'assistant', content: 'hi', timestamp: 2 });

    const state = useChatStore.getState();
    const conv = state.conversations.find((c) => c.id === convId)!;
    const leafId = conv.activeLeafId!;

    store.branchFromMessage(2, 'forked-session-1');

    const after = useChatStore.getState().conversations.find((c) => c.id === convId)!;
    expect(after.pendingBranchSession).toEqual({ parentId: leafId, sessionId: 'forked-session-1' });
    expect(after.branchSessions ?? {}).toEqual({});
  });

  it('clears pendingBranchSession when forkedSessionId is omitted', () => {
    const store = useChatStore.getState();
    store.createConversation();
    store.addMessage({ role: 'user', content: 'hello', timestamp: 1 });
    store.branchFromMessage(1, 'initial-fork');
    // Now a follow-up non-fork branch should wipe the stale pending fork
    store.branchFromMessage(1);
    const after = useChatStore.getState().conversations[0];
    expect(after.pendingBranchSession).toBeNull();
  });

  it('consumes pendingBranchSession on the next addMessage with matching parent', () => {
    const store = useChatStore.getState();
    const convId = store.createConversation();
    store.addMessage({ role: 'user', content: 'hi', timestamp: 1 });
    store.addMessage({ role: 'assistant', content: 'hello', timestamp: 2 });

    const leafId = useChatStore.getState().conversations.find((c) => c.id === convId)!.activeLeafId!;
    store.branchFromMessage(2, 'forked-session-1');

    // New message chains from the leaf → should receive the fork session
    store.addMessage({ role: 'user', content: 'continuing', timestamp: 3 });

    const conv = useChatStore.getState().conversations.find((c) => c.id === convId)!;
    const newMsgId = conv.activeLeafId!;
    expect(newMsgId).not.toBe(leafId);
    expect(conv.branchSessions?.[newMsgId]).toBe('forked-session-1');
    expect(conv.pendingBranchSession).toBeNull();
  });

  it('does not attach fork to a message whose parent does not match', () => {
    const store = useChatStore.getState();
    const convId = store.createConversation();
    store.addMessage({ role: 'user', content: 'u1', timestamp: 1 });
    const m1Id = useChatStore.getState().conversations.find((c) => c.id === convId)!.activeLeafId!;
    store.addMessage({ role: 'assistant', content: 'a1', timestamp: 2 });

    // Stage a fork under m1, but the next addMessage chains from the assistant (a1) instead.
    // This happens if the user manually sets a different parent ID on the next message.
    store.branchFromMessage(1, 'fork-under-m1');
    store.addMessage({
      role: 'user',
      content: 'chained-elsewhere',
      parentId: m1Id,
      timestamp: 3,
    });

    // The new message DID chain from m1, so it should have picked up the fork.
    const conv = useChatStore.getState().conversations.find((c) => c.id === convId)!;
    const newMsgId = conv.activeLeafId!;
    expect(conv.branchSessions?.[newMsgId]).toBe('fork-under-m1');
  });

  it('ignores a stale pendingBranchSession whose parent is not the new message parent', () => {
    const store = useChatStore.getState();
    const convId = store.createConversation();
    store.addMessage({ role: 'user', content: 'u1', timestamp: 1 });
    store.addMessage({ role: 'assistant', content: 'a1', timestamp: 2 });
    const leafBeforeBranch = useChatStore.getState().conversations.find((c) => c.id === convId)!.activeLeafId!;

    // Stage a fork whose parent doesn't match an upcoming message with explicit parentId
    store.branchFromMessage(2, 'fork-should-not-apply');
    // Manually override parentId on the next message — doesn't match pending's parentId.
    store.addMessage({
      role: 'user',
      content: 'with-overridden-parent',
      parentId: null,
      timestamp: 3,
    });

    const conv = useChatStore.getState().conversations.find((c) => c.id === convId)!;
    const newMsgId = conv.activeLeafId!;
    expect(conv.branchSessions?.[newMsgId]).toBeUndefined();
    // Pending stays (it didn't match); caller should clear it.
    expect(conv.pendingBranchSession?.parentId).toBe(leafBeforeBranch);
  });
});
