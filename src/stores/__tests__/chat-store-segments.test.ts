/**
 * Unit tests for chat-store segment actions — appendTextSegment, pushSegment,
 * updateSegment, finalizeSegments, streaming sequence simulation, dual-write
 * verification, and backward compatibility.
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

import { useChatStore } from '../chat-store';
import type { Conversation } from '../chat-store';
import type {
  Segment,
  TextSegment,
  ThinkingSegment,
  ToolCallSegment,
  ToolResultSegment,
} from '@/lib/ai/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function reset() {
  storageBacking.clear();
  useChatStore.setState({
    conversations: [] as Conversation[],
    activeConversationId: null,
    isLoading: false,
    error: null,
    activeTool: null,
    webSearchEnabled: false,
  });
}

function setupConversationWithAssistant(): { convId: string; assistantTs: number } {
  const store = useChatStore.getState();
  const convId = store.createConversation({ title: 'Test' });
  store.addMessage({ role: 'user', content: 'Hello', timestamp: 1000 });
  const assistantTs = 1001;
  store.addMessage({ role: 'assistant', content: '', timestamp: assistantTs });
  return { convId, assistantTs };
}

function getAssistantMessage(ts: number) {
  const state = useChatStore.getState();
  const conv = state.conversations.find(
    (c) => c.id === state.activeConversationId
  );
  return conv?.messages.find((m) => m.timestamp === ts);
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  reset();
});

// ===========================================================================
// appendTextSegment
// ===========================================================================

describe('appendTextSegment', () => {
  it('creates a new text segment when segments array is empty', () => {
    const { assistantTs } = setupConversationWithAssistant();
    useChatStore.getState().appendTextSegment(assistantTs, 'Hello');
    const msg = getAssistantMessage(assistantTs);
    expect(msg?.segments).toHaveLength(1);
    expect(msg?.segments?.[0].type).toBe('text');
    expect((msg?.segments?.[0] as TextSegment).content).toBe('Hello');
  });

  it('concatenates to existing text segment', () => {
    const { assistantTs } = setupConversationWithAssistant();
    useChatStore.getState().appendTextSegment(assistantTs, 'Hello');
    useChatStore.getState().appendTextSegment(assistantTs, ' world');
    const msg = getAssistantMessage(assistantTs);
    expect(msg?.segments).toHaveLength(1);
    expect((msg?.segments?.[0] as TextSegment).content).toBe('Hello world');
  });

  it('creates new text segment after non-text segment', () => {
    const { assistantTs } = setupConversationWithAssistant();
    useChatStore.getState().appendTextSegment(assistantTs, 'Before');
    useChatStore.getState().pushSegment(assistantTs, {
      type: 'tool_call',
      kind: 'read',
      label: 'Reading file',
      status: 'running',
      timestamp: Date.now(),
    } as ToolCallSegment);
    useChatStore.getState().appendTextSegment(assistantTs, 'After');
    const msg = getAssistantMessage(assistantTs);
    expect(msg?.segments).toHaveLength(3);
    expect(msg?.segments?.[0].type).toBe('text');
    expect(msg?.segments?.[1].type).toBe('tool_call');
    expect(msg?.segments?.[2].type).toBe('text');
    expect((msg?.segments?.[0] as TextSegment).content).toBe('Before');
    expect((msg?.segments?.[2] as TextSegment).content).toBe('After');
  });

  it('produces new array reference for Zustand reactivity', () => {
    const { assistantTs } = setupConversationWithAssistant();
    useChatStore.getState().appendTextSegment(assistantTs, 'a');
    const segments1 = getAssistantMessage(assistantTs)?.segments;
    useChatStore.getState().appendTextSegment(assistantTs, 'b');
    const segments2 = getAssistantMessage(assistantTs)?.segments;
    expect(segments1).not.toBe(segments2);
  });
});

// ===========================================================================
// pushSegment
// ===========================================================================

describe('pushSegment', () => {
  it('initializes segments array on first push', () => {
    const { assistantTs } = setupConversationWithAssistant();
    useChatStore.getState().pushSegment(assistantTs, {
      type: 'thinking',
      content: 'hmm',
      collapsed: false,
      timestamp: Date.now(),
    } as ThinkingSegment);
    const msg = getAssistantMessage(assistantTs);
    expect(msg?.segments).toHaveLength(1);
    expect(msg?.segments?.[0].type).toBe('thinking');
  });

  it('appends to existing segments', () => {
    const { assistantTs } = setupConversationWithAssistant();
    useChatStore.getState().pushSegment(assistantTs, {
      type: 'tool_call',
      kind: 'read',
      label: 'Reading',
      status: 'running',
      timestamp: Date.now(),
    } as ToolCallSegment);
    useChatStore.getState().pushSegment(assistantTs, {
      type: 'tool_result',
      result: 'done',
      collapsed: true,
      timestamp: Date.now(),
    } as ToolResultSegment);
    const msg = getAssistantMessage(assistantTs);
    expect(msg?.segments).toHaveLength(2);
  });

  it('handles all segment types', () => {
    const { assistantTs } = setupConversationWithAssistant();
    const segments: Segment[] = [
      { type: 'text', content: 'hi', timestamp: 1 },
      { type: 'thinking', content: 'hmm', collapsed: false, timestamp: 2 },
      { type: 'tool_call', kind: 'bash', label: 'Running', status: 'running', timestamp: 3 },
      { type: 'tool_result', result: 'ok', collapsed: true, timestamp: 4 },
    ];
    for (const seg of segments) {
      useChatStore.getState().pushSegment(assistantTs, seg);
    }
    const msg = getAssistantMessage(assistantTs);
    expect(msg?.segments).toHaveLength(4);
    expect(msg?.segments?.map((s) => s.type)).toEqual([
      'text',
      'thinking',
      'tool_call',
      'tool_result',
    ]);
  });
});

// ===========================================================================
// updateSegment
// ===========================================================================

describe('updateSegment', () => {
  it('partially updates a segment at given index', () => {
    const { assistantTs } = setupConversationWithAssistant();
    useChatStore.getState().pushSegment(assistantTs, {
      type: 'tool_call',
      kind: 'read',
      label: 'Reading',
      status: 'running',
      timestamp: Date.now(),
    } as ToolCallSegment);
    useChatStore.getState().updateSegment(assistantTs, 0, { status: 'done' });
    const msg = getAssistantMessage(assistantTs);
    expect((msg?.segments?.[0] as ToolCallSegment).status).toBe('done');
    expect((msg?.segments?.[0] as ToolCallSegment).label).toBe('Reading');
  });

  it('ignores out-of-bounds index', () => {
    const { assistantTs } = setupConversationWithAssistant();
    useChatStore.getState().pushSegment(assistantTs, {
      type: 'text',
      content: 'hi',
      timestamp: Date.now(),
    } as TextSegment);
    useChatStore.getState().updateSegment(assistantTs, 5, { content: 'nope' });
    const msg = getAssistantMessage(assistantTs);
    expect((msg?.segments?.[0] as TextSegment).content).toBe('hi');
  });

  it('ignores negative index', () => {
    const { assistantTs } = setupConversationWithAssistant();
    useChatStore.getState().pushSegment(assistantTs, {
      type: 'text',
      content: 'hi',
      timestamp: Date.now(),
    } as TextSegment);
    useChatStore.getState().updateSegment(assistantTs, -1, { content: 'nope' });
    const msg = getAssistantMessage(assistantTs);
    expect((msg?.segments?.[0] as TextSegment).content).toBe('hi');
  });

  it('handles message with no segments', () => {
    const { assistantTs } = setupConversationWithAssistant();
    // Should not throw
    useChatStore.getState().updateSegment(assistantTs, 0, { content: 'nope' });
    const msg = getAssistantMessage(assistantTs);
    expect(msg?.segments).toBeUndefined();
  });
});

// ===========================================================================
// finalizeSegments
// ===========================================================================

describe('finalizeSegments', () => {
  it('collapses thinking segments', () => {
    const { assistantTs } = setupConversationWithAssistant();
    useChatStore.getState().pushSegment(assistantTs, {
      type: 'thinking',
      content: 'reasoning',
      collapsed: false,
      timestamp: Date.now(),
    } as ThinkingSegment);
    useChatStore.getState().finalizeSegments(assistantTs);
    const msg = getAssistantMessage(assistantTs);
    expect((msg?.segments?.[0] as ThinkingSegment).collapsed).toBe(true);
  });

  it('marks running tool_calls as done', () => {
    const { assistantTs } = setupConversationWithAssistant();
    useChatStore.getState().pushSegment(assistantTs, {
      type: 'tool_call',
      kind: 'bash',
      label: 'Running',
      status: 'running',
      timestamp: Date.now(),
    } as ToolCallSegment);
    useChatStore.getState().finalizeSegments(assistantTs);
    const msg = getAssistantMessage(assistantTs);
    expect((msg?.segments?.[0] as ToolCallSegment).status).toBe('done');
  });

  it('does not change already-done tool_calls', () => {
    const { assistantTs } = setupConversationWithAssistant();
    useChatStore.getState().pushSegment(assistantTs, {
      type: 'tool_call',
      kind: 'read',
      label: 'Reading',
      status: 'done',
      timestamp: Date.now(),
    } as ToolCallSegment);
    useChatStore.getState().finalizeSegments(assistantTs);
    const msg = getAssistantMessage(assistantTs);
    expect((msg?.segments?.[0] as ToolCallSegment).status).toBe('done');
  });

  it('does not change error tool_calls', () => {
    const { assistantTs } = setupConversationWithAssistant();
    useChatStore.getState().pushSegment(assistantTs, {
      type: 'tool_call',
      kind: 'read',
      label: 'Reading',
      status: 'error',
      timestamp: Date.now(),
    } as ToolCallSegment);
    useChatStore.getState().finalizeSegments(assistantTs);
    const msg = getAssistantMessage(assistantTs);
    expect((msg?.segments?.[0] as ToolCallSegment).status).toBe('error');
  });

  it('leaves text and tool_result segments unchanged', () => {
    const { assistantTs } = setupConversationWithAssistant();
    useChatStore.getState().pushSegment(assistantTs, {
      type: 'text',
      content: 'hello',
      timestamp: Date.now(),
    } as TextSegment);
    useChatStore.getState().pushSegment(assistantTs, {
      type: 'tool_result',
      result: 'ok',
      collapsed: true,
      timestamp: Date.now(),
    } as ToolResultSegment);
    useChatStore.getState().finalizeSegments(assistantTs);
    const msg = getAssistantMessage(assistantTs);
    expect((msg?.segments?.[0] as TextSegment).content).toBe('hello');
    expect((msg?.segments?.[1] as ToolResultSegment).collapsed).toBe(true);
  });

  it('handles message with no segments gracefully', () => {
    const { assistantTs } = setupConversationWithAssistant();
    // Should not throw
    useChatStore.getState().finalizeSegments(assistantTs);
    const msg = getAssistantMessage(assistantTs);
    expect(msg?.segments).toBeUndefined();
  });
});

// ===========================================================================
// Streaming sequence simulation
// ===========================================================================

describe('segment accumulation — streaming sequence', () => {
  it('simulates text -> thinking -> tool_call -> tool_result -> text', () => {
    const { assistantTs } = setupConversationWithAssistant();
    const store = useChatStore.getState();

    // 1. Initial text
    store.appendTextSegment(assistantTs, 'Let me search');
    store.appendTextSegment(assistantTs, ' for that.');

    // 2. Thinking
    store.pushSegment(assistantTs, {
      type: 'thinking',
      content: 'I should use web search',
      collapsed: false,
      timestamp: Date.now(),
    } as ThinkingSegment);

    // 3. Tool call
    store.pushSegment(assistantTs, {
      type: 'tool_call',
      kind: 'web_search',
      label: 'Searching web: "React 19"',
      status: 'running',
      timestamp: Date.now(),
    } as ToolCallSegment);

    // 4. Tool result
    store.pushSegment(assistantTs, {
      type: 'tool_result',
      result: '3 results found',
      collapsed: true,
      timestamp: Date.now(),
    } as ToolResultSegment);
    store.updateSegment(assistantTs, 2, { status: 'done' }); // Mark tool_call done

    // 5. More text after tool
    store.appendTextSegment(assistantTs, 'Based on results, here is the answer.');

    // 6. Finalize
    store.finalizeSegments(assistantTs);

    const msg = getAssistantMessage(assistantTs);
    expect(msg?.segments).toHaveLength(5);
    expect(msg?.segments?.map((s) => s.type)).toEqual([
      'text',
      'thinking',
      'tool_call',
      'tool_result',
      'text',
    ]);

    // Text segments are separate (not concatenated across tool calls)
    expect((msg?.segments?.[0] as TextSegment).content).toBe(
      'Let me search for that.'
    );
    expect((msg?.segments?.[4] as TextSegment).content).toBe(
      'Based on results, here is the answer.'
    );

    // Thinking collapsed after finalize
    expect((msg?.segments?.[1] as ThinkingSegment).collapsed).toBe(true);

    // Tool call is done
    expect((msg?.segments?.[2] as ToolCallSegment).status).toBe('done');
  });
});

// ===========================================================================
// Dual-write — content updated alongside segments
// ===========================================================================

describe('dual-write — content updated alongside segments', () => {
  it('content field is independent of segments', () => {
    const { assistantTs } = setupConversationWithAssistant();
    const store = useChatStore.getState();

    // Write to both content and segments
    store.updateMessage(assistantTs, 'Full response text');
    store.appendTextSegment(assistantTs, 'Full response text');

    const msg = getAssistantMessage(assistantTs);
    expect(msg?.content).toBe('Full response text');
    expect(msg?.segments).toHaveLength(1);
    expect((msg?.segments?.[0] as TextSegment).content).toBe(
      'Full response text'
    );
  });
});

// ===========================================================================
// Backward compatibility
// ===========================================================================

describe('backward compatibility', () => {
  it('messages without segments have undefined segments field', () => {
    const { assistantTs } = setupConversationWithAssistant();
    useChatStore.getState().updateMessage(assistantTs, 'old message');
    const msg = getAssistantMessage(assistantTs);
    expect(msg?.content).toBe('old message');
    expect(msg?.segments).toBeUndefined();
  });
});
