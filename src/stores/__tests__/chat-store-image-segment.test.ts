/**
 * Unit tests for ImageSegment support in chat-store — push, retrieve, and
 * export of image segments within assistant messages.
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
import type { ImageSegment, TextSegment } from '@/lib/ai/types';

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
// ImageSegment in chat store
// ===========================================================================

describe('ImageSegment in chat store', () => {
  it('pushes an image segment to an assistant message', () => {
    const { assistantTs } = setupConversationWithAssistant();
    useChatStore.getState().pushSegment(assistantTs, {
      type: 'image',
      data: 'iVBORw0KGgoAAAANS',
      mimeType: 'image/png',
      timestamp: Date.now(),
    });
    const msg = getAssistantMessage(assistantTs);
    expect(msg?.segments).toHaveLength(1);
    expect(msg?.segments?.[0].type).toBe('image');
    const imgSeg = msg?.segments?.[0] as ImageSegment;
    expect(imgSeg.data).toBe('iVBORw0KGgoAAAANS');
    expect(imgSeg.mimeType).toBe('image/png');
  });

  it('image segment appears in correct position among other segments', () => {
    const { assistantTs } = setupConversationWithAssistant();
    const store = useChatStore.getState();
    store.appendTextSegment(assistantTs, 'Here is a screenshot:');
    store.pushSegment(assistantTs, {
      type: 'image',
      data: 'base64data',
      mimeType: 'image/jpeg',
      timestamp: Date.now(),
    });
    store.appendTextSegment(assistantTs, 'As you can see...');

    const msg = getAssistantMessage(assistantTs);
    expect(msg?.segments).toHaveLength(3);
    expect(msg?.segments?.[0].type).toBe('text');
    expect(msg?.segments?.[1].type).toBe('image');
    expect(msg?.segments?.[2].type).toBe('text');
    expect((msg?.segments?.[0] as TextSegment).content).toBe('Here is a screenshot:');
    expect((msg?.segments?.[1] as ImageSegment).data).toBe('base64data');
    expect((msg?.segments?.[2] as TextSegment).content).toBe('As you can see...');
  });

  it('preserves image segment through finalizeSegments', () => {
    const { assistantTs } = setupConversationWithAssistant();
    useChatStore.getState().pushSegment(assistantTs, {
      type: 'image',
      data: 'base64data',
      mimeType: 'image/png',
      timestamp: Date.now(),
    });
    useChatStore.getState().finalizeSegments(assistantTs);
    const msg = getAssistantMessage(assistantTs);
    expect(msg?.segments).toHaveLength(1);
    expect(msg?.segments?.[0].type).toBe('image');
    expect((msg?.segments?.[0] as ImageSegment).data).toBe('base64data');
  });

  it('supports optional alt text on image segment', () => {
    const { assistantTs } = setupConversationWithAssistant();
    useChatStore.getState().pushSegment(assistantTs, {
      type: 'image',
      data: 'base64data',
      mimeType: 'image/png',
      alt: 'A screenshot of the terminal',
      timestamp: Date.now(),
    });
    const msg = getAssistantMessage(assistantTs);
    const imgSeg = msg?.segments?.[0] as ImageSegment;
    expect(imgSeg.alt).toBe('A screenshot of the terminal');
  });
});
