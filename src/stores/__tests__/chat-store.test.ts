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
  selectProjectPaths,
  selectPendingProjectSwitch,
  selectPendingAgentSwitch,
  selectSegments,
  selectActiveSegmentIndex,
} from '../chat-store';
import type { Conversation } from '../chat-store';
import type { ChatMessage, AgentActivity, ToolCall, ToolCallActivity } from '@/lib/ai/types';

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
    const id2 = useChatStore.getState().createConversation();
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
      id: 'tc-1', name: 'a', status: 'complete', startedAt: 1,
    });
    useChatStore.getState().addToolCallActivity(100, {
      id: 'tc-2', name: 'b', status: 'running', startedAt: 2,
    });

    expect(activeConv()!.messages[0].toolCallActivities).toHaveLength(2);
  });

  it('updateToolCallActivity updates the right activity by toolCallId', () => {
    useChatStore.getState().addMessage({ role: 'assistant', content: 'resp', timestamp: 100 });
    useChatStore.getState().addToolCallActivity(100, {
      id: 'tc-1', name: 'read_file', status: 'running', startedAt: 1,
    });
    useChatStore.getState().addToolCallActivity(100, {
      id: 'tc-2', name: 'write_file', status: 'running', startedAt: 2,
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
      id: 'tc-1', name: 'read_file', status: 'running', startedAt: 1,
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
    expect(() => useChatStore.getState().addToolCallActivity(100, { id: 'tc-1', name: 'a', status: 'running', startedAt: 1 })).not.toThrow();
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
