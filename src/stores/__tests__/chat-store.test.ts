/**
 * Unit tests for chat-store.ts — Zustand store managing conversations, messages,
 * segments, project paths, and web search state.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// ---------------------------------------------------------------------------
// vi.hoisted — runs before vi.mock factories and module-level store code.
// ---------------------------------------------------------------------------

const { localStorageMock, storageBacking } = vi.hoisted(() => {
  const storageBacking = new Map<string, string>();
  const localStorageMock: Storage = {
    getItem: (key: string) => storageBacking.get(key) ?? null,
    setItem: (key: string, value: string) => { storageBacking.set(key, value); },
    removeItem: (key: string) => { storageBacking.delete(key); },
    clear: () => { storageBacking.clear(); },
    get length() { return storageBacking.size; },
    key: (index: number) => [...storageBacking.keys()][index] ?? null,
  };

  Object.defineProperty(globalThis, 'localStorage', {
    value: localStorageMock,
    writable: true,
    configurable: true,
  });

  if (typeof globalThis.window === 'undefined') {
    (globalThis as Record<string, unknown>).window = globalThis;
  }

  return { localStorageMock, storageBacking };
});

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn().mockResolvedValue(null),
}));

vi.mock('@/lib/logger', () => ({
  log: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('@/lib/tauri-storage', () => {
  const { createJSONStorage } = require('zustand/middleware');
  return {
    createTauriStorage: () => createJSONStorage(() => localStorageMock),
  };
});

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

import {
  useChatStore,
  selectMessages,
  selectAllMessages,
  selectActiveLeafId,
  selectProjectPaths,
  selectPendingProjectSwitch,
  selectPendingAgentSwitch,
  selectSegments,
  selectActiveSegmentIndex,
  sliceThreadBySegment,
} from '../chat-store';
import type { Conversation, ConversationSegment } from '../chat-store';
import type { AgentActivity, ChatMessage, ToolCall, ToolCallActivity } from '@/lib/ai/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const DEFAULTS = {
  conversations: [] as Conversation[],
  activeConversationId: null as string | null,
  isLoading: false,
  error: null as string | null,
  activeTool: null as string | null,
  webSearchEnabled: false,
};

function reset() {
  storageBacking.clear();
  useChatStore.setState(DEFAULTS);
}

function getConv(id: string): Conversation | undefined {
  return useChatStore.getState().conversations.find((c) => c.id === id);
}

function activeConv(): Conversation | undefined {
  const s = useChatStore.getState();
  return s.conversations.find((c) => c.id === s.activeConversationId);
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  reset();
});

// ===========================================================================
// Conversation CRUD
// ===========================================================================

describe('Conversation CRUD', () => {
  it('createConversation returns an ID and sets it active', () => {
    const id = useChatStore.getState().createConversation();
    expect(id).toBeTruthy();
    expect(useChatStore.getState().activeConversationId).toBe(id);
  });

  it('createConversation accepts options (title, projectPaths, sourceCommentId, sourceDocumentId)', () => {
    const id = useChatStore.getState().createConversation({
      title: 'My Chat',
      projectPaths: ['/proj/a'],
      sourceCommentId: 'cmt-1',
      sourceDocumentId: 'doc-1',
    });
    const conv = getConv(id)!;
    expect(conv.title).toBe('My Chat');
    expect(conv.projectPaths).toEqual(['/proj/a']);
    expect(conv.sourceCommentId).toBe('cmt-1');
    expect(conv.sourceDocumentId).toBe('doc-1');
  });

  it('createConversation initializes a segment with matching projectPaths', () => {
    const id = useChatStore.getState().createConversation({ projectPaths: ['/proj/x'] });
    const conv = getConv(id)!;
    expect(conv.segments).toHaveLength(1);
    expect(conv.segments[0].projectPaths).toEqual(['/proj/x']);
    expect(conv.segments[0].sessionId).toBeNull();
    expect(conv.segments[0].startMessageIndex).toBe(0);
    expect(conv.segments[0].historyIncluded).toBe(false);
    expect(conv.activeSegmentIndex).toBe(0);
  });

  it('deleteConversation removes conversation and switches active to remaining', () => {
    const id1 = useChatStore.getState().createConversation({ title: 'First' });
    const id2 = useChatStore.getState().createConversation({ title: 'Second' });
    // id2 is active (most recent createConversation sets active)
    expect(useChatStore.getState().activeConversationId).toBe(id2);

    useChatStore.getState().deleteConversation(id2);
    expect(getConv(id2)).toBeUndefined();
    expect(useChatStore.getState().activeConversationId).toBe(id1);
  });

  it('deleteConversation sets activeConversationId to null when last conversation removed', () => {
    const id = useChatStore.getState().createConversation();
    useChatStore.getState().deleteConversation(id);
    expect(useChatStore.getState().conversations).toHaveLength(0);
    expect(useChatStore.getState().activeConversationId).toBeNull();
  });

  it('setActiveConversation updates activeConversationId', () => {
    const id1 = useChatStore.getState().createConversation();
    useChatStore.getState().createConversation();
    useChatStore.getState().setActiveConversation(id1);
    expect(useChatStore.getState().activeConversationId).toBe(id1);
    useChatStore.getState().setActiveConversation(null);
    expect(useChatStore.getState().activeConversationId).toBeNull();
  });

  it('renameConversation updates the title', () => {
    const id = useChatStore.getState().createConversation({ title: 'Old' });
    useChatStore.getState().renameConversation(id, 'New Title');
    expect(getConv(id)!.title).toBe('New Title');
  });
});

// ===========================================================================
// Messages
// ===========================================================================

describe('Messages', () => {
  it('addMessage appends to the active conversation and assigns a timestamp', () => {
    const id = useChatStore.getState().createConversation();
    useChatStore.getState().addMessage({ role: 'user', content: 'Hello' });
    const conv = getConv(id)!;
    expect(conv.messages).toHaveLength(1);
    expect(conv.messages[0].content).toBe('Hello');
    expect(conv.messages[0].timestamp).toBeGreaterThan(0);
  });

  it('addMessage preserves an existing timestamp', () => {
    useChatStore.getState().createConversation();
    useChatStore.getState().addMessage({ role: 'user', content: 'Hi', timestamp: 42 });
    expect(activeConv()!.messages[0].timestamp).toBe(42);
  });

  it('addMessage auto-titles with first user message, truncated at 50 chars', () => {
    useChatStore.getState().createConversation();
    const longMsg = 'A'.repeat(60);
    useChatStore.getState().addMessage({ role: 'user', content: longMsg });
    const conv = activeConv()!;
    expect(conv.title).toBe('A'.repeat(50) + '\u2026');
  });

  it('addMessage does not auto-title with assistant messages', () => {
    useChatStore.getState().createConversation();
    useChatStore.getState().addMessage({ role: 'assistant', content: 'I am AI' });
    expect(activeConv()!.title).toBe('');
  });

  it('addMessage does not overwrite an existing title', () => {
    useChatStore.getState().createConversation({ title: 'Existing' });
    useChatStore.getState().addMessage({ role: 'user', content: 'New content' });
    expect(activeConv()!.title).toBe('Existing');
  });

  it('addMessage auto-creates a conversation if none active', () => {
    expect(useChatStore.getState().activeConversationId).toBeNull();
    useChatStore.getState().addMessage({ role: 'user', content: 'Orphan message' });
    expect(useChatStore.getState().activeConversationId).toBeTruthy();
    expect(activeConv()!.messages).toHaveLength(1);
  });

  it('addMessage auto-title uses first line for multiline content', () => {
    useChatStore.getState().createConversation();
    useChatStore.getState().addMessage({ role: 'user', content: 'First line\nSecond line\nThird' });
    expect(activeConv()!.title).toBe('First line');
  });

  it('updateMessage changes content and optionally citations', () => {
    useChatStore.getState().createConversation();
    useChatStore.getState().addMessage({ role: 'assistant', content: 'old', timestamp: 100 });
    useChatStore.getState().updateMessage(100, 'new', [{ url: 'https://x.com', title: 'X', citedText: 'txt' }]);
    const msg = activeConv()!.messages[0];
    expect(msg.content).toBe('new');
    expect(msg.citations).toHaveLength(1);
  });

  it('deleteMessage removes by timestamp', () => {
    useChatStore.getState().createConversation();
    useChatStore.getState().addMessage({ role: 'user', content: 'A', timestamp: 1 });
    useChatStore.getState().addMessage({ role: 'user', content: 'B', timestamp: 2 });
    useChatStore.getState().deleteMessage(1);
    expect(activeConv()!.messages).toHaveLength(1);
    expect(activeConv()!.messages[0].content).toBe('B');
  });

  it('clearMessages deletes the active conversation and resets transient state', () => {
    const id = useChatStore.getState().createConversation();
    useChatStore.getState().addMessage({ role: 'user', content: 'Hi' });
    useChatStore.setState({ isLoading: true, error: 'oops', activeTool: 'search' });
    useChatStore.getState().clearMessages();
    expect(getConv(id)).toBeUndefined();
    expect(useChatStore.getState().isLoading).toBe(false);
    expect(useChatStore.getState().error).toBeNull();
    expect(useChatStore.getState().activeTool).toBeNull();
  });
});

// ===========================================================================
// Project paths & web search
// ===========================================================================

describe('Project paths & web search', () => {
  it('setSelectedProjectPaths updates active conversation projectPaths', () => {
    useChatStore.getState().createConversation();
    useChatStore.getState().setSelectedProjectPaths(['/a', '/b']);
    expect(activeConv()!.projectPaths).toEqual(['/a', '/b']);
  });

  it('toggleProjectPath adds and removes paths', () => {
    useChatStore.getState().createConversation();
    useChatStore.getState().toggleProjectPath('/x');
    expect(activeConv()!.projectPaths).toContain('/x');
    useChatStore.getState().toggleProjectPath('/x');
    expect(activeConv()!.projectPaths).not.toContain('/x');
  });

  it('setWebSearchEnabled toggles the flag', () => {
    expect(useChatStore.getState().webSearchEnabled).toBe(false);
    useChatStore.getState().setWebSearchEnabled(true);
    expect(useChatStore.getState().webSearchEnabled).toBe(true);
  });

  it('setSelectedProjectPaths is a no-op when no active conversation', () => {
    useChatStore.getState().setSelectedProjectPaths(['/a']);
    // Should not throw, conversations remain empty
    expect(useChatStore.getState().conversations).toHaveLength(0);
  });
});

// ===========================================================================
// Message metadata
// ===========================================================================

describe('Message metadata', () => {
  beforeEach(() => {
    useChatStore.getState().createConversation();
  });

  it('setLoading / setError / setActiveTool update transient state', () => {
    useChatStore.getState().setLoading(true);
    expect(useChatStore.getState().isLoading).toBe(true);
    useChatStore.getState().setError('fail');
    expect(useChatStore.getState().error).toBe('fail');
    useChatStore.getState().setActiveTool('web_search');
    expect(useChatStore.getState().activeTool).toBe('web_search');
  });

  it('setMessageError marks message as error with new content', () => {
    useChatStore.getState().addMessage({ role: 'assistant', content: 'ok', timestamp: 10 });
    useChatStore.getState().setMessageError(10, 'Something broke');
    const msg = activeConv()!.messages[0];
    expect(msg.content).toBe('Something broke');
    expect(msg.isError).toBe(true);
  });

  it('updateMessageThinking sets thinking on the message', () => {
    useChatStore.getState().addMessage({ role: 'assistant', content: 'resp', timestamp: 20 });
    useChatStore.getState().updateMessageThinking(20, 'Let me think...');
    expect(activeConv()!.messages[0].thinking).toBe('Let me think...');
  });

  it('addActivity appends an activity to the message', () => {
    useChatStore.getState().addMessage({ role: 'assistant', content: 'resp', timestamp: 30 });
    const activity: AgentActivity = {
      kind: 'tool_call',
      label: 'read_file',
      status: 'running',
      timestamp: Date.now(),
    };
    useChatStore.getState().addActivity(30, activity);
    expect(activeConv()!.messages[0].activities).toHaveLength(1);
    expect(activeConv()!.messages[0].activities![0].label).toBe('read_file');
  });

  it('completeLastActivity marks the last running activity as done', () => {
    useChatStore.getState().addMessage({ role: 'assistant', content: 'resp', timestamp: 40 });
    useChatStore.getState().addActivity(40, { kind: 'tool', label: 'a', status: 'running', timestamp: 1 });
    useChatStore.getState().addActivity(40, { kind: 'tool', label: 'b', status: 'running', timestamp: 2 });
    useChatStore.getState().completeLastActivity(40);
    const acts = activeConv()!.messages[0].activities!;
    expect(acts[0].status).toBe('running');
    expect(acts[1].status).toBe('done');
  });

  it('completeAllActivities marks all running activities as done', () => {
    useChatStore.getState().addMessage({ role: 'assistant', content: 'resp', timestamp: 50 });
    useChatStore.getState().addActivity(50, { kind: 'tool', label: 'a', status: 'running', timestamp: 1 });
    useChatStore.getState().addActivity(50, { kind: 'tool', label: 'b', status: 'running', timestamp: 2 });
    useChatStore.getState().completeAllActivities(50);
    const acts = activeConv()!.messages[0].activities!;
    expect(acts.every((a) => a.status === 'done')).toBe(true);
  });

  it('completeLastActivity is a no-op when no running activities', () => {
    useChatStore.getState().addMessage({ role: 'assistant', content: 'resp', timestamp: 60 });
    useChatStore.getState().addActivity(60, { kind: 'tool', label: 'a', status: 'done', timestamp: 1 });
    useChatStore.getState().completeLastActivity(60);
    expect(activeConv()!.messages[0].activities![0].status).toBe('done');
  });
});

// ===========================================================================
// Segments
// ===========================================================================

describe('Segments', () => {
  it('getActiveSegment returns the segment at activeSegmentIndex', () => {
    useChatStore.getState().createConversation({ projectPaths: ['/p'] });
    const seg = useChatStore.getState().getActiveSegment();
    expect(seg).toBeDefined();
    expect(seg!.projectPaths).toEqual(['/p']);
  });

  it('getActiveSegment returns undefined when no active conversation', () => {
    expect(useChatStore.getState().getActiveSegment()).toBeUndefined();
  });

  it('setSegmentSessionId updates sessionId on the active segment', () => {
    useChatStore.getState().createConversation();
    useChatStore.getState().setSegmentSessionId('sess-abc');
    expect(useChatStore.getState().getActiveSegment()!.sessionId).toBe('sess-abc');
  });

  it('setPendingProjectSwitch / resolveProjectSwitch creates a new segment', () => {
    const id = useChatStore.getState().createConversation({ projectPaths: ['/old'] });
    useChatStore.getState().addMessage({ role: 'user', content: 'msg1', timestamp: 1 });

    useChatStore.getState().setPendingProjectSwitch(['/new'], ['/old']);
    expect(activeConv()!.pendingProjectSwitch).toEqual({ newPaths: ['/new'], previousPaths: ['/old'] });

    useChatStore.getState().resolveProjectSwitch(true);
    const conv = getConv(id)!;
    expect(conv.pendingProjectSwitch).toBeNull();
    expect(conv.segments).toHaveLength(2);
    expect(conv.segments[1].projectPaths).toEqual(['/new']);
    expect(conv.segments[1].startMessageIndex).toBe(1);
    expect(conv.segments[1].historyIncluded).toBe(true);
    expect(conv.activeSegmentIndex).toBe(1);
    expect(conv.projectPaths).toEqual(['/new']);
  });

  it('setPendingAgentSwitch / resolveAgentSwitch creates a new segment', () => {
    const id = useChatStore.getState().createConversation({ projectPaths: ['/proj'] });
    useChatStore.getState().addMessage({ role: 'user', content: 'msg1', timestamp: 1 });

    useChatStore.getState().setPendingAgentSwitch('claude', 'codex');
    expect(activeConv()!.pendingAgentSwitch).toEqual({ newAgent: 'claude', previousAgent: 'codex' });

    useChatStore.getState().resolveAgentSwitch(false);
    const conv = getConv(id)!;
    expect(conv.pendingAgentSwitch).toBeNull();
    expect(conv.segments).toHaveLength(2);
    expect(conv.segments[1].historyIncluded).toBe(false);
    expect(conv.segments[1].projectPaths).toEqual(['/proj']);
    expect(conv.activeSegmentIndex).toBe(1);
  });

  it('resolveProjectSwitch is a no-op when no pending switch', () => {
    useChatStore.getState().createConversation();
    useChatStore.getState().resolveProjectSwitch(true);
    expect(activeConv()!.segments).toHaveLength(1);
  });

  it('resolveAgentSwitch is a no-op when no pending switch', () => {
    useChatStore.getState().createConversation();
    useChatStore.getState().resolveAgentSwitch(false);
    expect(activeConv()!.segments).toHaveLength(1);
  });
});

// ===========================================================================
// Pruning
// ===========================================================================

describe('Pruning', () => {
  it('caps conversations at MAX_CONVERSATIONS (50), keeping active and newest', () => {
    // Create 51 conversations — the first created should be pruned
    const ids: string[] = [];
    for (let i = 0; i < 51; i++) {
      ids.push(useChatStore.getState().createConversation({ title: `Conv ${i}` }));
    }
    const state = useChatStore.getState();
    expect(state.conversations.length).toBeLessThanOrEqual(50);
    // The active (last created) must survive
    expect(state.conversations.some((c) => c.id === ids[50])).toBe(true);
  });

  it('caps messages at MAX_MESSAGES_PER_CONVERSATION (500)', () => {
    useChatStore.getState().createConversation();
    for (let i = 0; i < 510; i++) {
      useChatStore.getState().addMessage({ role: 'user', content: `msg-${i}`, timestamp: i + 1 });
    }
    expect(activeConv()!.messages.length).toBeLessThanOrEqual(500);
    // Last message should be the most recent
    expect(activeConv()!.messages[activeConv()!.messages.length - 1].content).toBe('msg-509');
  });

  it('pruneStaleProjectPaths removes invalid paths from all conversations', () => {
    const id1 = useChatStore.getState().createConversation({ projectPaths: ['/valid', '/stale'] });
    const id2 = useChatStore.getState().createConversation({ projectPaths: ['/valid'] });

    useChatStore.getState().pruneStaleProjectPaths(new Set(['/valid']));

    expect(getConv(id1)!.projectPaths).toEqual(['/valid']);
    expect(getConv(id2)!.projectPaths).toEqual(['/valid']);
  });

  it('pruneStaleProjectPaths does not mutate when all paths are valid', () => {
    useChatStore.getState().createConversation({ projectPaths: ['/ok'] });
    const before = useChatStore.getState().conversations;
    useChatStore.getState().pruneStaleProjectPaths(new Set(['/ok']));
    // Same reference — no mutation
    expect(useChatStore.getState().conversations).toBe(before);
  });
});

// ===========================================================================
// Selectors
// ===========================================================================

describe('Selectors', () => {
  it('selectMessages returns messages from active conversation', () => {
    useChatStore.getState().createConversation();
    useChatStore.getState().addMessage({ role: 'user', content: 'Hi', timestamp: 1 });
    const msgs = selectMessages(useChatStore.getState());
    expect(msgs).toHaveLength(1);
    expect(msgs[0].content).toBe('Hi');
  });

  it('selectProjectPaths returns paths from active conversation', () => {
    useChatStore.getState().createConversation({ projectPaths: ['/p'] });
    expect(selectProjectPaths(useChatStore.getState())).toEqual(['/p']);
  });

  it('selectPendingProjectSwitch returns pending switch from active conversation', () => {
    useChatStore.getState().createConversation();
    useChatStore.getState().setPendingProjectSwitch(['/new'], ['/old']);
    expect(selectPendingProjectSwitch(useChatStore.getState())).toEqual({
      newPaths: ['/new'],
      previousPaths: ['/old'],
    });
  });

  it('selectPendingAgentSwitch returns pending switch from active conversation', () => {
    useChatStore.getState().createConversation();
    useChatStore.getState().setPendingAgentSwitch('claude', 'codex');
    expect(selectPendingAgentSwitch(useChatStore.getState())).toEqual({
      newAgent: 'claude',
      previousAgent: 'codex',
    });
  });

  it('selectSegments returns segments from active conversation', () => {
    useChatStore.getState().createConversation({ projectPaths: ['/p'] });
    const segs = selectSegments(useChatStore.getState());
    expect(segs).toHaveLength(1);
  });

  it('selectActiveSegmentIndex returns index from active conversation', () => {
    useChatStore.getState().createConversation();
    expect(selectActiveSegmentIndex(useChatStore.getState())).toBe(0);
  });

  describe('stable empty refs when no active conversation', () => {
    it('selectMessages returns stable empty array', () => {
      const a = selectMessages(useChatStore.getState());
      const b = selectMessages(useChatStore.getState());
      expect(a).toBe(b);
      expect(a).toHaveLength(0);
    });

    it('selectProjectPaths returns stable empty array', () => {
      const a = selectProjectPaths(useChatStore.getState());
      const b = selectProjectPaths(useChatStore.getState());
      expect(a).toBe(b);
      expect(a).toHaveLength(0);
    });

    it('selectSegments returns stable empty array', () => {
      const a = selectSegments(useChatStore.getState());
      const b = selectSegments(useChatStore.getState());
      expect(a).toBe(b);
      expect(a).toHaveLength(0);
    });

    it('selectPendingProjectSwitch returns null', () => {
      expect(selectPendingProjectSwitch(useChatStore.getState())).toBeNull();
    });

    it('selectPendingAgentSwitch returns null', () => {
      expect(selectPendingAgentSwitch(useChatStore.getState())).toBeNull();
    });

    it('selectActiveSegmentIndex returns 0', () => {
      expect(selectActiveSegmentIndex(useChatStore.getState())).toBe(0);
    });
  });
});

// ===========================================================================
// Tool calls
// ===========================================================================

describe('Tool calls', () => {
  beforeEach(() => {
    useChatStore.getState().createConversation();
  });

  it('addToolCallsToMessage attaches toolCalls to the correct message', () => {
    useChatStore.getState().addMessage({ role: 'assistant', content: 'thinking...', timestamp: 100 });
    useChatStore.getState().addMessage({ role: 'assistant', content: 'other', timestamp: 200 });

    const toolCalls: ToolCall[] = [
      { id: 'tc-1', name: 'read_file', arguments: { path: '/foo.md' } },
      { id: 'tc-2', name: 'write_file', arguments: { path: '/bar.md', content: 'hi' } },
    ];
    useChatStore.getState().addToolCallsToMessage(100, toolCalls);

    const msgs = activeConv()!.messages;
    expect(msgs[0].toolCalls).toHaveLength(2);
    expect(msgs[0].toolCalls![0].id).toBe('tc-1');
    expect(msgs[0].toolCalls![1].name).toBe('write_file');
    // Other message untouched
    expect(msgs[1].toolCalls).toBeUndefined();
  });

  it('addToolCallsToMessage appends to existing toolCalls', () => {
    useChatStore.getState().addMessage({ role: 'assistant', content: 'resp', timestamp: 100 });
    useChatStore.getState().addToolCallsToMessage(100, [{ id: 'tc-1', name: 'a', arguments: {} }]);
    useChatStore.getState().addToolCallsToMessage(100, [{ id: 'tc-2', name: 'b', arguments: {} }]);

    expect(activeConv()!.messages[0].toolCalls).toHaveLength(2);
    expect(activeConv()!.messages[0].toolCalls![1].id).toBe('tc-2');
  });

  it('addToolCallActivity adds activity to the correct message', () => {
    useChatStore.getState().addMessage({ role: 'assistant', content: 'resp', timestamp: 100 });

    const activity: ToolCallActivity = {
      id: 'tc-1',
      name: 'read_file',
      arguments: { path: '/foo.md' },
      status: 'running',
      startedAt: Date.now(),
    };
    useChatStore.getState().addToolCallActivity(100, activity);

    const msg = activeConv()!.messages[0];
    expect(msg.toolCallActivities).toHaveLength(1);
    expect(msg.toolCallActivities![0].id).toBe('tc-1');
    expect(msg.toolCallActivities![0].status).toBe('running');
  });

  it('addToolCallActivity appends to existing activities', () => {
    useChatStore.getState().addMessage({ role: 'assistant', content: 'resp', timestamp: 100 });
    useChatStore.getState().addToolCallActivity(100, {
      id: 'tc-1', name: 'a', arguments: {}, status: 'complete', startedAt: 1,
    });
    useChatStore.getState().addToolCallActivity(100, {
      id: 'tc-2', name: 'b', arguments: {}, status: 'running', startedAt: 2,
    });

    expect(activeConv()!.messages[0].toolCallActivities).toHaveLength(2);
  });

  it('updateToolCallActivity updates the right activity by toolCallId', () => {
    useChatStore.getState().addMessage({ role: 'assistant', content: 'resp', timestamp: 100 });
    useChatStore.getState().addToolCallActivity(100, {
      id: 'tc-1', name: 'read_file', arguments: {}, status: 'running', startedAt: 1,
    });
    useChatStore.getState().addToolCallActivity(100, {
      id: 'tc-2', name: 'write_file', arguments: {}, status: 'running', startedAt: 2,
    });

    useChatStore.getState().updateToolCallActivity(100, 'tc-1', {
      status: 'complete',
      result: 'file contents here',
    });

    const acts = activeConv()!.messages[0].toolCallActivities!;
    expect(acts[0].status).toBe('complete');
    expect(acts[0].result).toBe('file contents here');
    // tc-2 unchanged
    expect(acts[1].status).toBe('running');
  });

  it('updateToolCallActivity can set error status', () => {
    useChatStore.getState().addMessage({ role: 'assistant', content: 'resp', timestamp: 100 });
    useChatStore.getState().addToolCallActivity(100, {
      id: 'tc-1', name: 'read_file', arguments: {}, status: 'running', startedAt: 1,
    });

    useChatStore.getState().updateToolCallActivity(100, 'tc-1', {
      status: 'error',
      error: 'File not found',
    });

    const act = activeConv()!.messages[0].toolCallActivities![0];
    expect(act.status).toBe('error');
    expect(act.error).toBe('File not found');
  });

  it('messages with role "tool" are stored correctly', () => {
    useChatStore.getState().addMessage({
      role: 'tool',
      content: '{"result": "success"}',
      toolCallId: 'tc-1',
      timestamp: 300,
    });

    const msgs = activeConv()!.messages;
    expect(msgs).toHaveLength(1);
    expect(msgs[0].role).toBe('tool');
    expect(msgs[0].toolCallId).toBe('tc-1');
    expect(msgs[0].content).toBe('{"result": "success"}');
  });

  it('tool messages do not auto-title the conversation', () => {
    useChatStore.getState().addMessage({
      role: 'tool',
      content: 'some result',
      toolCallId: 'tc-1',
      timestamp: 300,
    });

    expect(activeConv()!.title).toBe('');
  });

  it('tool call methods are no-ops when no active conversation', () => {
    reset();
    expect(() => useChatStore.getState().addToolCallsToMessage(100, [{ id: 'tc-1', name: 'a', arguments: {} }])).not.toThrow();
    expect(() => useChatStore.getState().addToolCallActivity(100, { id: 'tc-1', name: 'a', arguments: {}, status: 'running', startedAt: 1 })).not.toThrow();
    expect(() => useChatStore.getState().updateToolCallActivity(100, 'tc-1', { status: 'complete' })).not.toThrow();
  });

  it('updateToolCallActivity on message without toolCallActivities is a no-op', () => {
    useChatStore.getState().addMessage({ role: 'assistant', content: 'resp', timestamp: 100 });
    expect(() => useChatStore.getState().updateToolCallActivity(100, 'tc-1', { status: 'complete' })).not.toThrow();
    expect(activeConv()!.messages[0].toolCallActivities).toBeUndefined();
  });
});

// ===========================================================================
// Edge cases
// ===========================================================================

describe('Edge cases', () => {
  it('operations on non-existent conversation IDs are safe no-ops', () => {
    useChatStore.getState().deleteConversation('does-not-exist');
    expect(useChatStore.getState().conversations).toHaveLength(0);

    useChatStore.getState().renameConversation('does-not-exist', 'New Name');
    expect(useChatStore.getState().conversations).toHaveLength(0);
  });

  it('message operations with no active conversation do not throw (except addMessage which auto-creates)', () => {
    // These should be no-ops (updateActiveConv returns {} when no active id)
    expect(() => useChatStore.getState().updateMessage(999, 'x')).not.toThrow();
    expect(() => useChatStore.getState().deleteMessage(999)).not.toThrow();
    expect(() => useChatStore.getState().setMessageError(999, 'err')).not.toThrow();
    expect(() => useChatStore.getState().updateMessageThinking(999, 'think')).not.toThrow();
    expect(() => useChatStore.getState().setSelectedProjectPaths(['/a'])).not.toThrow();
    expect(() => useChatStore.getState().toggleProjectPath('/a')).not.toThrow();
  });

  it('clearMessages with no active conversation resets transient state only', () => {
    useChatStore.setState({ isLoading: true, error: 'bad', activeTool: 'tool' });
    useChatStore.getState().clearMessages();
    expect(useChatStore.getState().isLoading).toBe(false);
    expect(useChatStore.getState().error).toBeNull();
    expect(useChatStore.getState().activeTool).toBeNull();
  });

  it('updateMessage with non-existent timestamp does not corrupt messages', () => {
    useChatStore.getState().createConversation();
    useChatStore.getState().addMessage({ role: 'user', content: 'original', timestamp: 1 });
    useChatStore.getState().updateMessage(999, 'ghost');
    expect(activeConv()!.messages).toHaveLength(1);
    expect(activeConv()!.messages[0].content).toBe('original');
  });

  it('addActivity on non-existent message timestamp does not throw', () => {
    useChatStore.getState().createConversation();
    expect(() => {
      useChatStore.getState().addActivity(999, { kind: 'tool', label: 'x', status: 'running', timestamp: 1 });
    }).not.toThrow();
  });

  it('setSegmentSessionId with no active conversation does not throw', () => {
    expect(() => useChatStore.getState().setSegmentSessionId('sess-1')).not.toThrow();
  });

  it('completeLastActivity on message without activities does not throw', () => {
    useChatStore.getState().createConversation();
    useChatStore.getState().addMessage({ role: 'assistant', content: 'x', timestamp: 70 });
    expect(() => useChatStore.getState().completeLastActivity(70)).not.toThrow();
  });

  it('completeAllActivities on message without activities does not throw', () => {
    useChatStore.getState().createConversation();
    useChatStore.getState().addMessage({ role: 'assistant', content: 'x', timestamp: 80 });
    expect(() => useChatStore.getState().completeAllActivities(80)).not.toThrow();
  });

  it('deleting the non-active conversation does not change activeConversationId', () => {
    const id1 = useChatStore.getState().createConversation({ title: 'First' });
    const id2 = useChatStore.getState().createConversation({ title: 'Second' });
    // id2 is active
    useChatStore.getState().deleteConversation(id1);
    expect(useChatStore.getState().activeConversationId).toBe(id2);
    expect(useChatStore.getState().conversations).toHaveLength(1);
  });
});

// ===========================================================================
// Branching
// ===========================================================================

describe('Branching', () => {
  beforeEach(() => reset());

  it('addMessage assigns id and parentId automatically', () => {
    useChatStore.getState().createConversation();
    useChatStore.getState().addMessage({ role: 'user', content: 'first', timestamp: 1 });
    useChatStore.getState().addMessage({ role: 'assistant', content: 'reply', timestamp: 2 });

    const msgs = activeConv()!.messages;
    expect(msgs[0].id).toBeDefined();
    expect(msgs[0].parentId).toBeNull(); // first message has no parent
    expect(msgs[1].id).toBeDefined();
    expect(msgs[1].parentId).toBe(msgs[0].id); // chains to previous
  });

  it('activeLeafId tracks the most recent message', () => {
    useChatStore.getState().createConversation();
    useChatStore.getState().addMessage({ role: 'user', content: 'a', timestamp: 1 });
    useChatStore.getState().addMessage({ role: 'assistant', content: 'b', timestamp: 2 });

    const conv = activeConv()!;
    expect(conv.activeLeafId).toBe(conv.messages[1].id);
  });

  it('branchFromMessage sets activeLeafId to the branch point', () => {
    useChatStore.getState().createConversation();
    useChatStore.getState().addMessage({ role: 'user', content: 'a', timestamp: 1 });
    useChatStore.getState().addMessage({ role: 'assistant', content: 'b', timestamp: 2 });
    useChatStore.getState().addMessage({ role: 'user', content: 'c', timestamp: 3 });

    const branchPointId = activeConv()!.messages[1].id; // "b"
    useChatStore.getState().branchFromMessage(2); // branch from message at ts=2

    expect(activeConv()!.activeLeafId).toBe(branchPointId);
  });

  it('addMessage after branchFromMessage creates a new branch', () => {
    useChatStore.getState().createConversation();
    useChatStore.getState().addMessage({ role: 'user', content: 'a', timestamp: 1 });
    useChatStore.getState().addMessage({ role: 'assistant', content: 'b', timestamp: 2 });
    useChatStore.getState().addMessage({ role: 'user', content: 'c-original', timestamp: 3 });

    const branchPointId = activeConv()!.messages[1].id;
    useChatStore.getState().branchFromMessage(2);
    useChatStore.getState().addMessage({ role: 'user', content: 'c-branch', timestamp: 4 });

    const msgs = activeConv()!.messages;
    expect(msgs).toHaveLength(4);
    // The branched message should have the same parent as the original
    const branchMsg = msgs.find((m) => m.content === 'c-branch')!;
    expect(branchMsg.parentId).toBe(branchPointId);
  });

  it('selectMessages returns only the active thread', () => {
    useChatStore.getState().createConversation();
    useChatStore.getState().addMessage({ role: 'user', content: 'a', timestamp: 1 });
    useChatStore.getState().addMessage({ role: 'assistant', content: 'b', timestamp: 2 });
    useChatStore.getState().addMessage({ role: 'user', content: 'c-original', timestamp: 3 });

    // Branch from "b" and add a different follow-up
    useChatStore.getState().branchFromMessage(2);
    useChatStore.getState().addMessage({ role: 'user', content: 'c-branch', timestamp: 4 });

    const thread = selectMessages(useChatStore.getState());
    expect(thread.map((m) => m.content)).toEqual(['a', 'b', 'c-branch']);
  });

  it('selectMessages truncates after branchFromMessage (before new message)', () => {
    useChatStore.getState().createConversation();
    useChatStore.getState().addMessage({ role: 'user', content: 'a', timestamp: 1 });
    useChatStore.getState().addMessage({ role: 'assistant', content: 'b', timestamp: 2 });
    useChatStore.getState().addMessage({ role: 'user', content: 'c', timestamp: 3 });
    useChatStore.getState().addMessage({ role: 'assistant', content: 'd', timestamp: 4 });
    useChatStore.getState().addMessage({ role: 'user', content: 'e', timestamp: 5 });

    // Branch from "b" — should truncate to [a, b]
    useChatStore.getState().branchFromMessage(2);

    const thread = selectMessages(useChatStore.getState());
    expect(thread.map((m) => m.content)).toEqual(['a', 'b']);
  });

  it('selectAllMessages returns all messages including both branches', () => {
    useChatStore.getState().createConversation();
    useChatStore.getState().addMessage({ role: 'user', content: 'a', timestamp: 1 });
    useChatStore.getState().addMessage({ role: 'assistant', content: 'b', timestamp: 2 });
    useChatStore.getState().addMessage({ role: 'user', content: 'c-original', timestamp: 3 });

    useChatStore.getState().branchFromMessage(2);
    useChatStore.getState().addMessage({ role: 'user', content: 'c-branch', timestamp: 4 });

    const all = selectAllMessages(useChatStore.getState());
    expect(all).toHaveLength(4);
  });

  it('switchBranch changes the active thread', () => {
    useChatStore.getState().createConversation();
    useChatStore.getState().addMessage({ role: 'user', content: 'a', timestamp: 1 });
    useChatStore.getState().addMessage({ role: 'assistant', content: 'b', timestamp: 2 });
    useChatStore.getState().addMessage({ role: 'user', content: 'c-original', timestamp: 3 });

    const originalLeaf = activeConv()!.messages[2].id!;

    useChatStore.getState().branchFromMessage(2);
    useChatStore.getState().addMessage({ role: 'user', content: 'c-branch', timestamp: 4 });

    // Switch back to original branch
    useChatStore.getState().switchBranch(originalLeaf);
    const thread = selectMessages(useChatStore.getState());
    expect(thread.map((m) => m.content)).toEqual(['a', 'b', 'c-original']);
  });

  it('switchBranch to nonexistent leaf is a no-op', () => {
    useChatStore.getState().createConversation();
    useChatStore.getState().addMessage({ role: 'user', content: 'a', timestamp: 1 });
    const leafBefore = activeConv()!.activeLeafId;
    useChatStore.getState().switchBranch('nonexistent');
    expect(activeConv()!.activeLeafId).toBe(leafBefore);
  });

  it('selectActiveLeafId returns the active leaf', () => {
    useChatStore.getState().createConversation();
    useChatStore.getState().addMessage({ role: 'user', content: 'a', timestamp: 1 });
    const leafId = selectActiveLeafId(useChatStore.getState());
    expect(leafId).toBe(activeConv()!.messages[0].id);
  });

  it('deleteBranch removes the branch and switches to a sibling', () => {
    useChatStore.getState().createConversation();
    useChatStore.getState().addMessage({ role: 'user', content: 'a', timestamp: 1 });
    useChatStore.getState().addMessage({ role: 'assistant', content: 'b', timestamp: 2 });
    useChatStore.getState().addMessage({ role: 'user', content: 'c-original', timestamp: 3 });
    const originalLeaf = activeConv()!.activeLeafId!;

    // Create a branch from "b"
    useChatStore.getState().branchFromMessage(2);
    useChatStore.getState().addMessage({ role: 'user', content: 'c-branch', timestamp: 4 });
    const branchLeaf = activeConv()!.activeLeafId!;

    // Delete the branch
    useChatStore.getState().deleteBranch(branchLeaf);

    // Branch messages should be removed
    const conv = activeConv()!;
    expect(conv.messages.map((m) => m.content)).toEqual(['a', 'b', 'c-original']);
    // Should have switched to the remaining branch
    expect(conv.activeLeafId).toBe(originalLeaf);
  });

  it('deleteBranch is a no-op for a linear conversation', () => {
    useChatStore.getState().createConversation();
    useChatStore.getState().addMessage({ role: 'user', content: 'a', timestamp: 1 });
    useChatStore.getState().addMessage({ role: 'assistant', content: 'b', timestamp: 2 });
    const before = activeConv()!;

    useChatStore.getState().deleteBranch(before.activeLeafId!);

    // Nothing should change — can't delete the only path
    expect(activeConv()!.messages.length).toBe(before.messages.length);
  });

  it('deleteBranch on the inactive branch keeps the active thread', () => {
    useChatStore.getState().createConversation();
    useChatStore.getState().addMessage({ role: 'user', content: 'a', timestamp: 1 });
    useChatStore.getState().addMessage({ role: 'assistant', content: 'b', timestamp: 2 });
    useChatStore.getState().addMessage({ role: 'user', content: 'c-original', timestamp: 3 });
    const originalLeaf = activeConv()!.activeLeafId!;

    useChatStore.getState().branchFromMessage(2);
    useChatStore.getState().addMessage({ role: 'user', content: 'c-branch', timestamp: 4 });
    const branchLeaf = activeConv()!.activeLeafId!;

    // Switch back to original, then delete the branch
    useChatStore.getState().switchBranch(originalLeaf);
    useChatStore.getState().deleteBranch(branchLeaf);

    // Active thread should be unchanged
    const thread = selectMessages(useChatStore.getState());
    expect(thread.map((m) => m.content)).toEqual(['a', 'b', 'c-original']);
    expect(activeConv()!.activeLeafId).toBe(originalLeaf);
  });
});

// ===========================================================================
// Resend / Edit (explicit parentId branching)
// ===========================================================================

describe('Resend / Edit branching', () => {
  beforeEach(() => reset());

  it('addMessage with explicit parentId creates a sibling (resend)', () => {
    useChatStore.getState().createConversation();
    useChatStore.getState().addMessage({ role: 'user', content: 'q1', timestamp: 1 });
    useChatStore.getState().addMessage({ role: 'assistant', content: 'a1', timestamp: 2 });

    const parentId = activeConv()!.messages[0].parentId; // null (root)
    const originalUserId = activeConv()!.messages[0].id;

    // Resend: same content, explicit parentId to create sibling
    useChatStore.getState().addMessage({ role: 'user', content: 'q1', timestamp: 3, parentId });

    const msgs = activeConv()!.messages;
    expect(msgs).toHaveLength(3);
    const resent = msgs.find((m) => m.timestamp === 3)!;
    expect(resent.parentId).toBe(parentId); // same parent as original
    expect(resent.id).not.toBe(originalUserId); // different message
    expect(resent.content).toBe('q1');
    expect(activeConv()!.activeLeafId).toBe(resent.id);
  });

  it('addMessage with explicit parentId creates a sibling (edit with modified content)', () => {
    useChatStore.getState().createConversation();
    useChatStore.getState().addMessage({ role: 'user', content: 'original question', timestamp: 1 });
    useChatStore.getState().addMessage({ role: 'assistant', content: 'answer', timestamp: 2 });

    const parentId = activeConv()!.messages[0].parentId; // null (root)

    // Edit: different content, same parentId
    useChatStore.getState().addMessage({ role: 'user', content: 'edited question', timestamp: 3, parentId });

    const msgs = activeConv()!.messages;
    expect(msgs).toHaveLength(3);
    const edited = msgs.find((m) => m.content === 'edited question')!;
    expect(edited.parentId).toBe(parentId);
  });

  it('getThread returns new branch after resend, not old branch', () => {
    useChatStore.getState().createConversation();
    useChatStore.getState().addMessage({ role: 'user', content: 'q1', timestamp: 1 });
    useChatStore.getState().addMessage({ role: 'assistant', content: 'a1', timestamp: 2 });
    useChatStore.getState().addMessage({ role: 'user', content: 'q2', timestamp: 3 });
    useChatStore.getState().addMessage({ role: 'assistant', content: 'a2', timestamp: 4 });

    // Resend q1 — branch from root (parentId = null)
    const q1ParentId = activeConv()!.messages[0].parentId; // null
    useChatStore.getState().addMessage({ role: 'user', content: 'q1-resent', timestamp: 5, parentId: q1ParentId });

    const thread = selectMessages(useChatStore.getState());
    expect(thread.map((m) => m.content)).toEqual(['q1-resent']);
    // Old branch should still be accessible via switchBranch
    const allMsgs = selectAllMessages(useChatStore.getState());
    expect(allMsgs).toHaveLength(5);
  });

  it('branch count increments at fork point after resend', () => {
    useChatStore.getState().createConversation();
    useChatStore.getState().addMessage({ role: 'user', content: 'q1', timestamp: 1 });
    useChatStore.getState().addMessage({ role: 'assistant', content: 'a1', timestamp: 2 });
    useChatStore.getState().addMessage({ role: 'user', content: 'q2-original', timestamp: 3 });

    const a1Id = activeConv()!.messages[1].id!;

    // Resend q2 — creates a sibling of q2-original under a1
    useChatStore.getState().addMessage({ role: 'user', content: 'q2-resent', timestamp: 4, parentId: a1Id });

    // a1 should now have 2 children (q2-original and q2-resent)
    const allMsgs = selectAllMessages(useChatStore.getState());
    const childrenOfA1 = allMsgs.filter((m) => m.parentId === a1Id);
    expect(childrenOfA1).toHaveLength(2);
  });

  it('resend mid-conversation creates branch at correct point', () => {
    useChatStore.getState().createConversation();
    useChatStore.getState().addMessage({ role: 'user', content: 'q1', timestamp: 1 });
    useChatStore.getState().addMessage({ role: 'assistant', content: 'a1', timestamp: 2 });
    useChatStore.getState().addMessage({ role: 'user', content: 'q2', timestamp: 3 });
    useChatStore.getState().addMessage({ role: 'assistant', content: 'a2', timestamp: 4 });

    // Resend q2 — parentId should be a1's id (q2's parent)
    const a1Id = activeConv()!.messages[1].id!;
    useChatStore.getState().addMessage({ role: 'user', content: 'q2', timestamp: 5, parentId: a1Id });

    // Active thread: q1, a1, q2-resent
    const thread = selectMessages(useChatStore.getState());
    expect(thread.map((m) => m.content)).toEqual(['q1', 'a1', 'q2']);
    expect(thread[2].timestamp).toBe(5); // the new one, not the original

    // a1 should now have 2 children (original q2 and resent q2)
    const allMsgs = selectAllMessages(useChatStore.getState());
    const childrenOfA1 = allMsgs.filter((m) => m.parentId === a1Id);
    expect(childrenOfA1).toHaveLength(2);
  });

  it('follow-up messages continue on the new branch', () => {
    useChatStore.getState().createConversation();
    useChatStore.getState().addMessage({ role: 'user', content: 'q1', timestamp: 1 });
    useChatStore.getState().addMessage({ role: 'assistant', content: 'a1', timestamp: 2 });

    const a1Id = activeConv()!.messages[1].id!;

    // Resend (branch from a1)
    useChatStore.getState().addMessage({ role: 'user', content: 'q1-resent', timestamp: 3, parentId: a1Id });
    // AI replies on the new branch
    useChatStore.getState().addMessage({ role: 'assistant', content: 'a1-new', timestamp: 4 });
    // User follows up
    useChatStore.getState().addMessage({ role: 'user', content: 'q2-new', timestamp: 5 });

    const thread = selectMessages(useChatStore.getState());
    expect(thread.map((m) => m.content)).toEqual(['q1', 'a1', 'q1-resent', 'a1-new', 'q2-new']);
  });
});

// ===========================================================================
// Migration v3 → v4
// ===========================================================================

describe('Migration v3 → v4', () => {
  it('assigns id and parentId to existing linear messages', () => {
    // Simulate a v3 persisted state
    const v3State = {
      conversations: [{
        id: 'conv-1',
        title: 'Test',
        messages: [
          { role: 'user', content: 'first', timestamp: 1 },
          { role: 'assistant', content: 'second', timestamp: 2 },
          { role: 'user', content: 'third', timestamp: 3 },
        ],
        createdAt: 1,
        updatedAt: 3,
        projectPaths: [],
        segments: [{ projectPaths: [], sessionId: null, startMessageIndex: 0, historyIncluded: false }],
        activeSegmentIndex: 0,
        pendingProjectSwitch: null,
      }],
      activeConversationId: 'conv-1',
      webSearchEnabled: false,
    };

    // Access the migrate function via the persist config
    const storeConfig = (useChatStore as unknown as { persist: { getOptions: () => { migrate: (s: unknown, v: number) => unknown } } }).persist.getOptions();
    const migrated = storeConfig.migrate(v3State, 3) as { conversations: Conversation[] };

    const conv = migrated.conversations[0];
    expect(conv.activeLeafId).toBeDefined();

    // All messages should have ids
    for (const msg of conv.messages) {
      expect(msg.id).toBeDefined();
    }

    // First message has null parentId
    expect(conv.messages[0].parentId).toBeNull();
    // Second chains to first
    expect(conv.messages[1].parentId).toBe(conv.messages[0].id);
    // Third chains to second
    expect(conv.messages[2].parentId).toBe(conv.messages[1].id);
    // activeLeafId is the last message
    expect(conv.activeLeafId).toBe(conv.messages[2].id);
  });

  it('handles empty conversations gracefully', () => {
    const v3State = {
      conversations: [{
        id: 'conv-1',
        title: '',
        messages: [],
        createdAt: 1,
        updatedAt: 1,
        projectPaths: [],
        segments: [{ projectPaths: [], sessionId: null, startMessageIndex: 0, historyIncluded: false }],
        activeSegmentIndex: 0,
        pendingProjectSwitch: null,
      }],
      activeConversationId: 'conv-1',
      webSearchEnabled: false,
    };

    const storeConfig = (useChatStore as unknown as { persist: { getOptions: () => { migrate: (s: unknown, v: number) => unknown } } }).persist.getOptions();
    const migrated = storeConfig.migrate(v3State, 3) as { conversations: Conversation[] };

    expect(migrated.conversations[0].activeLeafId).toBeNull();
    expect(migrated.conversations[0].messages).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// System-status messages (reconnection flow)
// ---------------------------------------------------------------------------

describe('system-status messages', () => {
  beforeEach(reset);

  it('addSystemStatus inserts a reconnecting message', () => {
    const { createConversation, addSystemStatus } = useChatStore.getState();
    const convId = createConversation();
    const msgId = addSystemStatus('reconnecting', 'Claude Code', 1, 3);

    const conv = getConv(convId)!;
    const msg = conv.messages.find((m) => m.id === msgId);
    expect(msg).toBeDefined();
    expect(msg!.role).toBe('system-status');
    expect(msg!.statusType).toBe('reconnecting');
    expect(msg!.agentName).toBe('Claude Code');
    expect(msg!.attempt).toBe(1);
    expect(msg!.maxAttempts).toBe(3);
  });

  it('reconnecting messages are replaced in-place when attempt changes', () => {
    const { createConversation, addSystemStatus } = useChatStore.getState();
    createConversation();
    const id1 = addSystemStatus('reconnecting', 'Claude Code', 1, 3);
    const id2 = addSystemStatus('reconnecting', 'Claude Code', 2, 3);

    // Same message ID — replaced in-place
    expect(id1).toBe(id2);

    const conv = useChatStore.getState().conversations[0];
    const statusMsgs = conv.messages.filter((m) => m.role === 'system-status');
    expect(statusMsgs).toHaveLength(1);
    expect(statusMsgs[0].attempt).toBe(2);
  });

  it('reconnected messages have a dismissAt timestamp', () => {
    const { createConversation, addSystemStatus } = useChatStore.getState();
    createConversation();
    const before = Date.now();
    addSystemStatus('reconnected', 'Claude Code');

    const conv = useChatStore.getState().conversations[0];
    const msg = conv.messages.find((m) => m.statusType === 'reconnected')!;
    expect(msg.dismissAt).toBeDefined();
    expect(msg.dismissAt!).toBeGreaterThanOrEqual(before + 3000);
  });

  it('system-status messages are excluded from selectMessages thread', () => {
    const { createConversation, addMessage, addSystemStatus } = useChatStore.getState();
    createConversation();
    addMessage({ role: 'user', content: 'hello' });
    addSystemStatus('reconnecting', 'Agent', 1, 3);
    addMessage({ role: 'assistant', content: 'hi' });

    const thread = selectMessages(useChatStore.getState());
    // system-status message IS in the thread (it's a tree node) but should
    // be filtered when sending to AI providers (tested via direct filter)
    const nonStatusMessages = thread.filter((m) => m.role !== 'system-status');
    expect(nonStatusMessages).toHaveLength(2);
    expect(nonStatusMessages[0].role).toBe('user');
    expect(nonStatusMessages[1].role).toBe('assistant');
  });

  it('removeSystemStatus deletes a system-status message by ID', () => {
    const { createConversation, addSystemStatus, removeSystemStatus } = useChatStore.getState();
    const convId = createConversation();
    const msgId = addSystemStatus('reconnected', 'Agent');

    removeSystemStatus(msgId);

    const conv = getConv(convId)!;
    expect(conv.messages.find((m) => m.id === msgId)).toBeUndefined();
  });

  it('addSystemStatus transitions from reconnecting to failed', () => {
    const { createConversation, addSystemStatus } = useChatStore.getState();
    createConversation();
    const id1 = addSystemStatus('reconnecting', 'Claude Code', 3, 3);
    const id2 = addSystemStatus('failed', 'Claude Code');

    // Same message replaced in-place
    expect(id1).toBe(id2);

    const conv = useChatStore.getState().conversations[0];
    const statusMsgs = conv.messages.filter((m) => m.role === 'system-status');
    expect(statusMsgs).toHaveLength(1);
    expect(statusMsgs[0].statusType).toBe('failed');
  });
});

// ---------------------------------------------------------------------------
// Image attachments on messages
// ---------------------------------------------------------------------------

describe('image attachments', () => {
  beforeEach(() => {
    storageBacking.clear();
    useChatStore.setState({
      conversations: [],
      activeConversationId: null,
    } as Partial<ReturnType<typeof useChatStore.getState>> as ReturnType<typeof useChatStore.getState>);
    useChatStore.getState().createConversation();
  });

  it('persists message with attachments', () => {
    useChatStore.getState().addMessage({
      role: 'user',
      content: 'Check this image',
      attachments: [
        {
          id: 'img-test-1',
          data: 'base64data',
          mimeType: 'image/jpeg',
          width: 800,
          height: 600,
          size: 1234,
        },
      ],
    });

    const conv = useChatStore.getState().conversations[0];
    const lastMsg = conv.messages[conv.messages.length - 1];
    expect(lastMsg.attachments).toHaveLength(1);
    expect(lastMsg.attachments![0].id).toBe('img-test-1');
    expect(lastMsg.attachments![0].mimeType).toBe('image/jpeg');
    expect(lastMsg.attachments![0].width).toBe(800);
  });

  it('handles messages without attachments (backward compat)', () => {
    useChatStore.getState().addMessage({ role: 'user', content: 'No images here' });

    const conv = useChatStore.getState().conversations[0];
    const lastMsg = conv.messages[conv.messages.length - 1];
    expect(lastMsg.attachments).toBeUndefined();
  });

  it('preserves multiple attachments on a single message', () => {
    useChatStore.getState().addMessage({
      role: 'user',
      content: 'Two images',
      attachments: [
        { id: 'img-1', data: 'a', mimeType: 'image/png', width: 100, height: 100, size: 500 },
        { id: 'img-2', data: 'b', mimeType: 'image/jpeg', width: 200, height: 150, size: 1000 },
      ],
    });

    const conv = useChatStore.getState().conversations[0];
    const lastMsg = conv.messages[conv.messages.length - 1];
    expect(lastMsg.attachments).toHaveLength(2);
    expect(lastMsg.attachments![0].id).toBe('img-1');
    expect(lastMsg.attachments![1].id).toBe('img-2');
  });
});

// ---------------------------------------------------------------------------
// Task #28 — Segment boundary as message id (slicing under branching)
// ---------------------------------------------------------------------------

describe('sliceThreadBySegment (task #28)', () => {
  beforeEach(reset);

  // Convenience: build a thread-like array with explicit ids/parents.
  function makeThread(specs: Array<{ id: string; parent: string | null; content?: string; ts?: number }>): ChatMessage[] {
    return specs.map((s, i) => ({
      role: 'user',
      content: s.content ?? s.id,
      id: s.id,
      parentId: s.parent,
      timestamp: s.ts ?? i + 1,
    }));
  }

  it('returns thread unchanged when segment is undefined', () => {
    const thread = makeThread([
      { id: 'a', parent: null },
      { id: 'b', parent: 'a' },
    ]);
    expect(sliceThreadBySegment(thread, undefined, thread)).toBe(thread);
  });

  it('returns thread unchanged when historyIncluded is true', () => {
    const thread = makeThread([
      { id: 'a', parent: null },
      { id: 'b', parent: 'a' },
    ]);
    const seg: ConversationSegment = {
      projectPaths: [],
      sessionId: null,
      startMessageIndex: 1,
      startMessageId: 'b',
      historyIncluded: true,
    };
    expect(sliceThreadBySegment(thread, seg, thread)).toBe(thread);
  });

  it('returns thread unchanged when startMessageId is undefined', () => {
    const thread = makeThread([
      { id: 'a', parent: null },
      { id: 'b', parent: 'a' },
    ]);
    const seg: ConversationSegment = {
      projectPaths: [],
      sessionId: null,
      startMessageIndex: 1,
      historyIncluded: false,
    };
    expect(sliceThreadBySegment(thread, seg, thread)).toBe(thread);
  });

  it('slices linear thread from the boundary message id onward (boundary included)', () => {
    const thread = makeThread([
      { id: 'a', parent: null },
      { id: 'b', parent: 'a' },
      { id: 'c', parent: 'b' },
      { id: 'd', parent: 'c' },
    ]);
    const seg: ConversationSegment = {
      projectPaths: [],
      sessionId: null,
      startMessageIndex: 2,
      startMessageId: 'c',
      historyIncluded: false,
    };
    const out = sliceThreadBySegment(thread, seg, thread);
    expect(out.map((m) => m.id)).toEqual(['c', 'd']);
  });

  // Attack / red-team: branching correctness — proves message-id slicing fixes
  // a case where numeric-index slicing would be wrong.
  it('RED-TEAM: branching — boundary in sibling subtree drops thread down to LCA', () => {
    // Original linear: A -> B -> C -> D, boundary set at C (startMessageIndex: 2).
    // Then user branched from B to create a sibling thread: A -> B -> X -> Y.
    // Active thread is A-B-X-Y. C is in conv.messages but not in this thread.
    const allMessages = makeThread([
      { id: 'a', parent: null },
      { id: 'b', parent: 'a' },
      { id: 'c', parent: 'b' },
      { id: 'd', parent: 'c' },
      { id: 'x', parent: 'b' }, // sibling of c
      { id: 'y', parent: 'x' },
    ]);
    const thread = allMessages.filter((m) => ['a', 'b', 'x', 'y'].includes(m.id!));
    const seg: ConversationSegment = {
      projectPaths: [],
      sessionId: null,
      startMessageIndex: 2, // used to point at c in the old linear thread
      startMessageId: 'c',
      historyIncluded: false,
    };

    // The legacy (numeric-index) behaviour would slice thread at index 2 and
    // leak pre-boundary 'a','b' in-or-out depending on clamp. Message-id slicing
    // locates the LCA (b — boundary's parent in thread) and drops up to+incl.
    // LCA, keeping only post-fork messages (x, y).
    const out = sliceThreadBySegment(thread, seg, allMessages);
    expect(out.map((m) => m.id)).toEqual(['x', 'y']);
  });

  it('branching: fork happens before boundary — keeps only post-fork messages', () => {
    // Linear A -> B -> C -> D (boundary at D)
    // Branch from A creates A -> P -> Q. Active thread: A, P, Q.
    // Boundary D is in sibling subtree; LCA is A. Drop A, keep P, Q.
    const allMessages = makeThread([
      { id: 'a', parent: null },
      { id: 'b', parent: 'a' },
      { id: 'c', parent: 'b' },
      { id: 'd', parent: 'c' },
      { id: 'p', parent: 'a' },
      { id: 'q', parent: 'p' },
    ]);
    const thread = allMessages.filter((m) => ['a', 'p', 'q'].includes(m.id!));
    const seg: ConversationSegment = {
      projectPaths: [],
      sessionId: null,
      startMessageIndex: 3,
      startMessageId: 'd',
      historyIncluded: false,
    };
    const out = sliceThreadBySegment(thread, seg, allMessages);
    expect(out.map((m) => m.id)).toEqual(['p', 'q']);
  });

  it('returns thread unchanged when boundary id cannot be resolved at all', () => {
    const thread = makeThread([
      { id: 'a', parent: null },
      { id: 'b', parent: 'a' },
    ]);
    const seg: ConversationSegment = {
      projectPaths: [],
      sessionId: null,
      startMessageIndex: 5,
      startMessageId: 'deleted-id',
      historyIncluded: false,
    };
    expect(sliceThreadBySegment(thread, seg, thread)).toBe(thread);
  });

  it('returns thread unchanged when boundary and thread have no common ancestor', () => {
    // Two completely disjoint trees in `allMessages` — pathological, but defensive.
    const allMessages = makeThread([
      { id: 'a', parent: null },
      { id: 'b', parent: 'a' },
      { id: 'p', parent: null },
      { id: 'q', parent: 'p' },
    ]);
    const thread = allMessages.filter((m) => ['a', 'b'].includes(m.id!));
    const seg: ConversationSegment = {
      projectPaths: [],
      sessionId: null,
      startMessageIndex: 3,
      startMessageId: 'q',
      historyIncluded: false,
    };
    // No common ancestor: conservative — return thread unchanged.
    const out = sliceThreadBySegment(thread, seg, allMessages);
    expect(out).toEqual(thread);
  });
});

// ---------------------------------------------------------------------------
// Task #28 — Store assigns startMessageId when first post-switch message lands
// ---------------------------------------------------------------------------

describe('Segment startMessageId assignment on addMessage (task #28)', () => {
  beforeEach(reset);

  it('resolveProjectSwitch creates segment with undefined startMessageId; addMessage fills it', () => {
    const { createConversation, addMessage, setPendingProjectSwitch, resolveProjectSwitch } =
      useChatStore.getState();
    const id = createConversation({ projectPaths: ['/old'] });
    addMessage({ role: 'user', content: 'm1', timestamp: 1 });
    addMessage({ role: 'assistant', content: 'm2', timestamp: 2 });

    setPendingProjectSwitch(['/new'], ['/old']);
    resolveProjectSwitch(false); // no history carried

    // New segment exists but has no startMessageId yet — no post-switch msg.
    const conv1 = getConv(id)!;
    expect(conv1.segments).toHaveLength(2);
    expect(conv1.segments[1].startMessageIndex).toBe(2);
    expect(conv1.segments[1].startMessageId).toBeUndefined();

    // Add the first post-switch message — it should populate startMessageId.
    addMessage({ role: 'user', content: 'post-switch', timestamp: 3 });
    const conv2 = getConv(id)!;
    const newMsg = conv2.messages.find((m) => m.content === 'post-switch')!;
    expect(conv2.segments[1].startMessageId).toBe(newMsg.id);
  });

  it('does not stomp startMessageId on subsequent messages', () => {
    const { createConversation, addMessage, setPendingProjectSwitch, resolveProjectSwitch } =
      useChatStore.getState();
    const id = createConversation({ projectPaths: ['/old'] });
    addMessage({ role: 'user', content: 'm1', timestamp: 1 });
    setPendingProjectSwitch(['/new'], ['/old']);
    resolveProjectSwitch(false);

    addMessage({ role: 'user', content: 'first-post', timestamp: 2 });
    const firstPostId = getConv(id)!.segments[1].startMessageId;
    expect(firstPostId).toBeTruthy();

    addMessage({ role: 'assistant', content: 'second-post', timestamp: 3 });
    expect(getConv(id)!.segments[1].startMessageId).toBe(firstPostId);
  });

  it('resolveAgentSwitch also leaves startMessageId to be filled by next addMessage', () => {
    const { createConversation, addMessage, setPendingAgentSwitch, resolveAgentSwitch } =
      useChatStore.getState();
    const id = createConversation({ projectPaths: ['/p'] });
    addMessage({ role: 'user', content: 'm1', timestamp: 1 });
    setPendingAgentSwitch('claude', 'codex');
    resolveAgentSwitch(false);

    expect(getConv(id)!.segments[1].startMessageId).toBeUndefined();

    addMessage({ role: 'user', content: 'with-claude', timestamp: 2 });
    const anchor = getConv(id)!.segments[1].startMessageId;
    const msg = getConv(id)!.messages.find((m) => m.content === 'with-claude');
    expect(anchor).toBe(msg!.id);
  });

  it('first segment (index 0) never adopts a message as startMessageId', () => {
    // The initial segment represents the conversation's starting context;
    // there is no boundary to anchor, so startMessageId should stay undefined.
    const { createConversation, addMessage } = useChatStore.getState();
    const id = createConversation({ projectPaths: ['/p'] });
    addMessage({ role: 'user', content: 'first', timestamp: 1 });
    expect(getConv(id)!.segments[0].startMessageId).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Task #28 — Persist migration v4 → v5 derives startMessageId from index lookup
// ---------------------------------------------------------------------------

describe('Migration v4 → v5 (task #28)', () => {
  type MigrateFn = (state: unknown, version: number) => unknown;
  const migrate: MigrateFn =
    (useChatStore as unknown as { persist: { getOptions: () => { migrate: MigrateFn } } })
      .persist.getOptions().migrate;

  it('derives startMessageId from startMessageIndex lookup in conv.messages', () => {
    const v4State = {
      conversations: [{
        id: 'conv-1',
        title: 'Test',
        messages: [
          { role: 'user', content: 'm1', timestamp: 1, id: 'id-1', parentId: null },
          { role: 'assistant', content: 'm2', timestamp: 2, id: 'id-2', parentId: 'id-1' },
          { role: 'user', content: 'm3', timestamp: 3, id: 'id-3', parentId: 'id-2' },
          { role: 'assistant', content: 'm4', timestamp: 4, id: 'id-4', parentId: 'id-3' },
        ],
        createdAt: 1,
        updatedAt: 4,
        projectPaths: [],
        segments: [
          { projectPaths: [], sessionId: null, startMessageIndex: 0, historyIncluded: false },
          { projectPaths: ['/new'], sessionId: null, startMessageIndex: 2, historyIncluded: false },
        ],
        activeSegmentIndex: 1,
        pendingProjectSwitch: null,
        activeLeafId: 'id-4',
      }],
      activeConversationId: 'conv-1',
      webSearchEnabled: false,
    };

    const migrated = migrate(v4State, 4) as { conversations: Conversation[] };
    const conv = migrated.conversations[0];
    // First segment: startMessageIndex is 0 → points to 'id-1'.
    expect(conv.segments[0].startMessageId).toBe('id-1');
    // Second segment: startMessageIndex is 2 → points to 'id-3'.
    expect(conv.segments[1].startMessageId).toBe('id-3');
    // startMessageIndex preserved for backward compat.
    expect(conv.segments[0].startMessageIndex).toBe(0);
    expect(conv.segments[1].startMessageIndex).toBe(2);
  });

  it('leaves startMessageId undefined when startMessageIndex is out-of-range', () => {
    const v4State = {
      conversations: [{
        id: 'conv-1',
        title: 'Test',
        messages: [
          { role: 'user', content: 'm1', timestamp: 1, id: 'id-1', parentId: null },
        ],
        createdAt: 1,
        updatedAt: 1,
        projectPaths: [],
        segments: [
          // Future index — the post-switch message hasn't been written yet.
          { projectPaths: ['/new'], sessionId: null, startMessageIndex: 5, historyIncluded: false },
        ],
        activeSegmentIndex: 0,
        pendingProjectSwitch: null,
        activeLeafId: 'id-1',
      }],
      activeConversationId: 'conv-1',
      webSearchEnabled: false,
    };

    const migrated = migrate(v4State, 4) as { conversations: Conversation[] };
    expect(migrated.conversations[0].segments[0].startMessageId).toBeUndefined();
  });

  it('does not overwrite existing startMessageId', () => {
    // A v5-shaped state being fed through migration again should be idempotent.
    const v5State = {
      conversations: [{
        id: 'conv-1',
        title: 'Test',
        messages: [
          { role: 'user', content: 'm1', timestamp: 1, id: 'id-1', parentId: null },
          { role: 'user', content: 'm2', timestamp: 2, id: 'id-2', parentId: 'id-1' },
        ],
        createdAt: 1,
        updatedAt: 2,
        projectPaths: [],
        segments: [
          {
            projectPaths: [],
            sessionId: null,
            startMessageIndex: 0,
            startMessageId: 'preserved',
            historyIncluded: false,
          },
        ],
        activeSegmentIndex: 0,
        pendingProjectSwitch: null,
        activeLeafId: 'id-2',
      }],
      activeConversationId: 'conv-1',
      webSearchEnabled: false,
    };

    const migrated = migrate(v5State, 4) as { conversations: Conversation[] };
    expect(migrated.conversations[0].segments[0].startMessageId).toBe('preserved');
  });

  it('handles conversations with no segments gracefully', () => {
    const v4State = {
      conversations: [{
        id: 'conv-1',
        title: 'Test',
        messages: [],
        createdAt: 1,
        updatedAt: 1,
        projectPaths: [],
        segments: [],
        activeSegmentIndex: 0,
        pendingProjectSwitch: null,
        activeLeafId: null,
      }],
      activeConversationId: 'conv-1',
      webSearchEnabled: false,
    };
    expect(() => migrate(v4State, 4)).not.toThrow();
  });
});

// ===========================================================================
// addMessage — targetConversationId routing (issue #468)
// ===========================================================================

describe('addMessage — targetConversationId routing', () => {
  it('routes to the specified conversation, not the active one', () => {
    const idA = useChatStore.getState().createConversation({ title: 'Conv A' });
    const idB = useChatStore.getState().createConversation({ title: 'Conv B' });
    useChatStore.getState().setActiveConversation(idA);

    // Add a message targeting B while A is active
    useChatStore.getState().addMessage({ role: 'user', content: 'For B', timestamp: 9001 }, idB);

    expect(getConv(idB)!.messages.some((m) => m.content === 'For B')).toBe(true);
    expect(getConv(idA)!.messages.some((m) => m.content === 'For B')).toBe(false);
  });

  it('does not navigate (active conversation stays the same) when routing to a different conv', () => {
    const idA = useChatStore.getState().createConversation({ title: 'Conv A' });
    const idB = useChatStore.getState().createConversation({ title: 'Conv B' });
    useChatStore.getState().setActiveConversation(idA);

    useChatStore.getState().addMessage({ role: 'user', content: 'Silent B', timestamp: 9002 }, idB);

    expect(useChatStore.getState().activeConversationId).toBe(idA);
  });

  it('routes to active conversation when targetConversationId is omitted (no regression)', () => {
    const idA = useChatStore.getState().createConversation({ title: 'Conv A' });
    useChatStore.getState().addMessage({ role: 'user', content: 'Default routing', timestamp: 9003 });
    expect(getConv(idA)!.messages.some((m) => m.content === 'Default routing')).toBe(true);
  });

  it('updateMessage routes to the conversation that owns the message timestamp, not the active one', () => {
    const idA = useChatStore.getState().createConversation({ title: 'Conv A' });
    const idB = useChatStore.getState().createConversation({ title: 'Conv B' });
    useChatStore.getState().setActiveConversation(idA);

    // Add an assistant message to B via targetConversationId
    useChatStore.getState().addMessage(
      { role: 'assistant', content: 'initial', timestamp: 9010 },
      idB,
    );

    // updateMessage with that timestamp — must update the message in B, not look in A
    useChatStore.getState().updateMessage(9010, 'streamed content');

    expect(getConv(idB)!.messages.find((m) => m.timestamp === 9010)?.content).toBe('streamed content');
    expect(getConv(idA)!.messages.find((m) => m.timestamp === 9010)).toBeUndefined();
  });

  it('appendTextSegment routes to the conversation that owns the message timestamp', () => {
    const idA = useChatStore.getState().createConversation({ title: 'Conv A' });
    const idB = useChatStore.getState().createConversation({ title: 'Conv B' });
    useChatStore.getState().setActiveConversation(idA);

    useChatStore.getState().addMessage(
      { role: 'assistant', content: '', timestamp: 9020 },
      idB,
    );

    useChatStore.getState().appendTextSegment(9020, 'hello from B');
    useChatStore.getState().finalizeSegments(9020);

    const msgInB = getConv(idB)!.messages.find((m) => m.timestamp === 9020);
    expect(msgInB?.segments?.some((s) => s.type === 'text' && s.content === 'hello from B')).toBe(true);
  });
});

// ===========================================================================
// getNextSegmentIndex — segment-slot helper for queued sends (issue #468)
//
// The hooks (useDirectApiChat, useCopilotChat, useAcpLifecycle) compute a
// segment index BEFORE pushing a new segment, then later call updateSegment
// on that index. If they read activeConversationId instead of the target
// conversation, the lookup finds the wrong conv → wrong msg → falls back to
// index 0 → updateSegment overwrites the TEXT segment instead of the TOOL
// segment.  getNextSegmentIndex(ts, targetConvId) always reads the target.
// ===========================================================================

describe('getNextSegmentIndex (issue #468 — segment index for queued sends)', () => {
  it('returns 0 when the target message has no segments yet', () => {
    const idA = useChatStore.getState().createConversation({ title: 'A' });
    useChatStore.getState().addMessage(
      { role: 'assistant', content: '', timestamp: 9100 },
      idA,
    );
    expect(useChatStore.getState().getNextSegmentIndex(9100, idA)).toBe(0);
  });

  it('returns 1 after one segment has been pushed', () => {
    const idA = useChatStore.getState().createConversation({ title: 'A' });
    useChatStore.getState().addMessage(
      { role: 'assistant', content: '', timestamp: 9101 },
      idA,
    );
    useChatStore.getState().pushSegment(9101, {
      type: 'text',
      content: 'first',
      timestamp: 9101,
    });
    expect(useChatStore.getState().getNextSegmentIndex(9101, idA)).toBe(1);
  });

  it('reads from the TARGET conversation, not the active one', () => {
    // Simulates queued send: user navigated to conv A while conv B is
    // being drained in the background.
    const idA = useChatStore.getState().createConversation({ title: 'A (active)' });
    const idB = useChatStore.getState().createConversation({ title: 'B (target)' });
    useChatStore.getState().setActiveConversation(idA);

    useChatStore.getState().addMessage(
      { role: 'assistant', content: '', timestamp: 9102 },
      idB,
    );
    // B now has 1 segment; A has none.
    useChatStore.getState().pushSegment(9102, {
      type: 'text',
      content: 'streamed',
      timestamp: 9102,
    });

    // Correct: reading from B gives index 1 (next slot for tool_call segment)
    expect(useChatStore.getState().getNextSegmentIndex(9102, idB)).toBe(1);

    // Stale read (what the old code did): reading from A gives 0 (wrong slot)
    expect(useChatStore.getState().getNextSegmentIndex(9102, idA)).toBe(0);
  });

  it('falls back to the active conversation when targetConvId is undefined', () => {
    const idA = useChatStore.getState().createConversation({ title: 'A' });
    useChatStore.getState().setActiveConversation(idA);
    useChatStore.getState().addMessage(
      { role: 'assistant', content: '', timestamp: 9103 },
      idA,
    );
    useChatStore.getState().pushSegment(9103, {
      type: 'text',
      content: 'hi',
      timestamp: 9103,
    });
    expect(useChatStore.getState().getNextSegmentIndex(9103, undefined)).toBe(1);
  });

  it('returns 0 when targetConvId is unknown (defensive)', () => {
    expect(useChatStore.getState().getNextSegmentIndex(9999, 'no-such-conv')).toBe(0);
  });
});
