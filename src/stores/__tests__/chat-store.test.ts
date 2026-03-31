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
} from '../chat-store';
import type { Conversation } from '../chat-store';
import type { AgentActivity, ToolCall, ToolCallActivity } from '@/lib/ai/types';

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
