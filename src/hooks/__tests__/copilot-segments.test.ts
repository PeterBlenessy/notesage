/**
 * Unit tests for Copilot LSP event-to-segment mapping.
 *
 * Tests the mapping logic used in useCopilotChat where Tauri events
 * (copilot-chat-chunk, copilot-chat-thinking, copilot-chat-done) are
 * translated into chat store segment actions (appendTextSegment,
 * pushSegment/updateSegment for thinking, finalizeSegments).
 *
 * Since the actual hook wires Tauri event listeners, these tests verify
 * the segment mapping logic in isolation by exercising the store actions
 * directly with the same patterns used by the hook.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// ---------------------------------------------------------------------------
// vi.hoisted — localStorage polyfill before store code loads
// ---------------------------------------------------------------------------

const { storageBacking, localStorageMock } = vi.hoisted(() => {
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

import { useChatStore } from '@/stores/chat-store';
import type { Conversation } from '@/stores/chat-store';
import type { TextSegment, ThinkingSegment, ToolCallSegment, ToolResultSegment } from '@/lib/ai/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function reset() {
  storageBacking.clear();
  useChatStore.setState({ conversations: [], activeConversationId: null });
}

/** Set up a conversation with a user message and an empty assistant message. */
function setupConversation(): { convId: string; assistantTimestamp: number } {
  const convId = 'conv-copilot-test';
  const assistantTimestamp = Date.now() + 1;

  const conv: Conversation = {
    id: convId,
    title: 'Test Copilot Chat',
    messages: [
      { role: 'user', content: 'Hello', timestamp: Date.now() },
      { role: 'assistant', content: '', timestamp: assistantTimestamp },
    ],
    createdAt: Date.now(),
    updatedAt: Date.now(),
    projectPaths: [],
    segments: [{ projectPaths: [], sessionId: null, startMessageIndex: 0, historyIncluded: false }],
    activeSegmentIndex: 0,
    pendingProjectSwitch: null,
    activeLeafId: null,
  };

  useChatStore.setState({
    conversations: [conv],
    activeConversationId: convId,
  });

  return { convId, assistantTimestamp };
}

function getAssistantMessage(convId: string, timestamp: number) {
  const conv = useChatStore.getState().conversations.find((c) => c.id === convId);
  return conv?.messages.find((m) => m.timestamp === timestamp);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Copilot LSP event-to-segment mapping', () => {
  beforeEach(reset);

  // ---- copilot-chat-chunk → appendTextSegment ----

  describe('text chunk events', () => {
    it('appends text to a text segment via appendTextSegment', () => {
      const { convId, assistantTimestamp } = setupConversation();

      // Simulate copilot-chat-chunk events
      useChatStore.getState().appendTextSegment(assistantTimestamp, 'Hello ');
      useChatStore.getState().appendTextSegment(assistantTimestamp, 'world');

      const msg = getAssistantMessage(convId, assistantTimestamp);
      expect(msg?.segments).toHaveLength(1);

      const seg = msg!.segments![0] as TextSegment;
      expect(seg.type).toBe('text');
      expect(seg.content).toBe('Hello world');
    });

    it('creates a new text segment after a thinking segment', () => {
      const { convId, assistantTimestamp } = setupConversation();

      // First: text chunk
      useChatStore.getState().appendTextSegment(assistantTimestamp, 'Before ');

      // Then: thinking segment
      useChatStore.getState().pushSegment(assistantTimestamp, {
        type: 'thinking',
        content: 'reasoning...',
        collapsed: false,
        timestamp: Date.now(),
      });

      // Then: more text (should create a new text segment)
      useChatStore.getState().appendTextSegment(assistantTimestamp, 'After');

      const msg = getAssistantMessage(convId, assistantTimestamp);
      expect(msg?.segments).toHaveLength(3);
      expect(msg!.segments![0].type).toBe('text');
      expect(msg!.segments![1].type).toBe('thinking');
      expect(msg!.segments![2].type).toBe('text');
      expect((msg!.segments![0] as TextSegment).content).toBe('Before ');
      expect((msg!.segments![2] as TextSegment).content).toBe('After');
    });
  });

  // ---- copilot-chat-thinking → pushSegment + updateSegment ----

  describe('thinking events', () => {
    it('creates a thinking segment via pushSegment', () => {
      const { convId, assistantTimestamp } = setupConversation();

      useChatStore.getState().pushSegment(assistantTimestamp, {
        type: 'thinking',
        content: 'Let me think...',
        collapsed: false,
        timestamp: Date.now(),
      });

      const msg = getAssistantMessage(convId, assistantTimestamp);
      expect(msg?.segments).toHaveLength(1);

      const seg = msg!.segments![0] as ThinkingSegment;
      expect(seg.type).toBe('thinking');
      expect(seg.content).toBe('Let me think...');
      expect(seg.collapsed).toBe(false);
    });

    it('updates thinking segment content via updateSegment', () => {
      const { convId, assistantTimestamp } = setupConversation();

      // Push initial thinking segment
      useChatStore.getState().pushSegment(assistantTimestamp, {
        type: 'thinking',
        content: 'First chunk',
        collapsed: false,
        timestamp: Date.now(),
      });

      // Update with accumulated content (as the hook does)
      useChatStore.getState().updateSegment(assistantTimestamp, 0, {
        content: 'First chunk plus more',
      });

      const msg = getAssistantMessage(convId, assistantTimestamp);
      expect(msg?.segments).toHaveLength(1);
      expect((msg!.segments![0] as ThinkingSegment).content).toBe('First chunk plus more');
    });
  });

  // ---- copilot-chat-done → finalizeSegments ----

  describe('done event', () => {
    it('collapses thinking segments via finalizeSegments', () => {
      const { convId, assistantTimestamp } = setupConversation();

      // Simulate a full stream: thinking → text → done
      useChatStore.getState().pushSegment(assistantTimestamp, {
        type: 'thinking',
        content: 'internal reasoning',
        collapsed: false,
        timestamp: Date.now(),
      });

      useChatStore.getState().appendTextSegment(assistantTimestamp, 'Final answer');

      // Finalize — should collapse thinking
      useChatStore.getState().finalizeSegments(assistantTimestamp);

      const msg = getAssistantMessage(convId, assistantTimestamp);
      expect(msg?.segments).toHaveLength(2);

      const thinkingSeg = msg!.segments![0] as ThinkingSegment;
      expect(thinkingSeg.type).toBe('thinking');
      expect(thinkingSeg.collapsed).toBe(true);

      const textSeg = msg!.segments![1] as TextSegment;
      expect(textSeg.type).toBe('text');
      expect(textSeg.content).toBe('Final answer');
    });

    it('finalizeSegments is idempotent', () => {
      const { convId, assistantTimestamp } = setupConversation();

      useChatStore.getState().appendTextSegment(assistantTimestamp, 'Response');
      useChatStore.getState().finalizeSegments(assistantTimestamp);
      useChatStore.getState().finalizeSegments(assistantTimestamp);

      const msg = getAssistantMessage(convId, assistantTimestamp);
      expect(msg?.segments).toHaveLength(1);
      expect((msg!.segments![0] as TextSegment).content).toBe('Response');
    });
  });

  // ---- tool call segments ----

  describe('tool call segments', () => {
    it('pushes tool_call and tool_result segments', () => {
      const { convId, assistantTimestamp } = setupConversation();

      // Push tool call segment (as copilot-tool-call handler does)
      useChatStore.getState().pushSegment(assistantTimestamp, {
        type: 'tool_call',
        kind: 'read_file',
        label: 'Reading config.ts',
        detail: '{"path": "config.ts"}',
        status: 'running',
        timestamp: Date.now(),
      } as ToolCallSegment);

      // Update status to done
      useChatStore.getState().updateSegment(assistantTimestamp, 0, {
        status: 'done',
      });

      // Push tool result segment
      useChatStore.getState().pushSegment(assistantTimestamp, {
        type: 'tool_result',
        toolCallId: 'tc-1',
        result: 'file contents here',
        collapsed: true,
        timestamp: Date.now(),
      } as ToolResultSegment);

      const msg = getAssistantMessage(convId, assistantTimestamp);
      expect(msg?.segments).toHaveLength(2);

      const toolCall = msg!.segments![0] as ToolCallSegment;
      expect(toolCall.type).toBe('tool_call');
      expect(toolCall.kind).toBe('read_file');
      expect(toolCall.status).toBe('done');

      const toolResult = msg!.segments![1] as ToolResultSegment;
      expect(toolResult.type).toBe('tool_result');
      expect(toolResult.result).toBe('file contents here');
      expect(toolResult.collapsed).toBe(true);
    });

    it('marks tool call as error when denied', () => {
      const { convId, assistantTimestamp } = setupConversation();

      useChatStore.getState().pushSegment(assistantTimestamp, {
        type: 'tool_call',
        kind: 'write_file',
        label: 'Writing output.txt',
        detail: 'Permission denied',
        status: 'error',
        timestamp: Date.now(),
      } as ToolCallSegment);

      const msg = getAssistantMessage(convId, assistantTimestamp);
      const seg = msg!.segments![0] as ToolCallSegment;
      expect(seg.status).toBe('error');
      expect(seg.detail).toBe('Permission denied');
    });
  });

  // ---- full streaming sequence ----

  describe('full streaming sequence', () => {
    it('produces correct segment sequence for thinking → text → tool → result → text → done', () => {
      const { convId, assistantTimestamp } = setupConversation();

      // 1. Thinking
      useChatStore.getState().pushSegment(assistantTimestamp, {
        type: 'thinking',
        content: 'I need to read the file first.',
        collapsed: false,
        timestamp: Date.now(),
      });

      // 2. Text before tool call
      useChatStore.getState().appendTextSegment(assistantTimestamp, 'Let me check that file. ');

      // 3. Tool call
      useChatStore.getState().pushSegment(assistantTimestamp, {
        type: 'tool_call',
        kind: 'read_file',
        label: 'Reading README.md',
        status: 'running',
        timestamp: Date.now(),
      } as ToolCallSegment);

      // 4. Tool result
      useChatStore.getState().updateSegment(assistantTimestamp, 2, { status: 'done' });
      useChatStore.getState().pushSegment(assistantTimestamp, {
        type: 'tool_result',
        toolCallId: 'tc-1',
        result: '# README',
        collapsed: true,
        timestamp: Date.now(),
      } as ToolResultSegment);

      // 5. More text after tool
      useChatStore.getState().appendTextSegment(assistantTimestamp, 'The README contains...');

      // 6. Done
      useChatStore.getState().finalizeSegments(assistantTimestamp);

      const msg = getAssistantMessage(convId, assistantTimestamp);
      expect(msg?.segments).toHaveLength(5);

      expect(msg!.segments![0].type).toBe('thinking');
      expect((msg!.segments![0] as ThinkingSegment).collapsed).toBe(true); // collapsed after finalize
      expect(msg!.segments![1].type).toBe('text');
      expect(msg!.segments![2].type).toBe('tool_call');
      expect((msg!.segments![2] as ToolCallSegment).status).toBe('done');
      expect(msg!.segments![3].type).toBe('tool_result');
      expect(msg!.segments![4].type).toBe('text');
      expect((msg!.segments![4] as TextSegment).content).toBe('The README contains...');
    });
  });
});
