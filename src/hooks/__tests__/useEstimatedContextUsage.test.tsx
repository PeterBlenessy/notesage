// @vitest-environment jsdom
//
// Tests for useEstimatedContextUsage (provider-usage-display #7).
//
// The load-bearing behaviors: the no-denominator rule (unknown size → no
// estimate), message-boundary memoization (stream chunks / keystrokes never
// re-run the token walk), and the estimate write-through to the usage-store.

import "@/test/local-storage";
import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useEstimatedContextUsage } from '../useEstimatedContextUsage';
import { useLocalAIStore } from '@/stores/local-ai-store';
import { useUsageStore } from '@/stores/usage-store';
import type { Connection } from '@/lib/ai/connections';
import type { Conversation } from '@/stores/chat-store';
import type { ChatMessage } from '@/lib/ai/types';

function makeConnection(overrides: Partial<Connection> = {}): Connection {
  return {
    id: 'conn-est',
    provider: 'anthropic',
    authMethod: 'api_key',
    status: 'connected',
    label: 'Test',
    credentials: { type: 'api_key', credentialStored: true },
    capabilities: ['interactive'],
    createdAt: Date.now(),
    ...overrides,
  };
}

function makeConversation(messages: ChatMessage[]): Conversation {
  return {
    id: 'conv-est',
    title: 'Estimate test',
    messages,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    projectPaths: [],
    segments: [{ projectPaths: [], sessionId: null, startMessageIndex: 0, historyIncluded: false }],
    activeSegmentIndex: 0,
    activeLeafId: messages[messages.length - 1]?.id ?? null,
  } as Conversation;
}

function makeMessages(count: number, contentLength = 400): ChatMessage[] {
  const messages: ChatMessage[] = [];
  for (let i = 0; i < count; i++) {
    messages.push({
      id: `msg-${i}`,
      role: i % 2 === 0 ? 'user' : 'assistant',
      content: 'x'.repeat(contentLength),
      timestamp: 1_000 + i,
      parentId: i === 0 ? null : `msg-${i - 1}`,
    });
  }
  return messages;
}

describe('useEstimatedContextUsage', () => {
  beforeEach(() => {
    useUsageStore.setState({ snapshots: {} });
    useLocalAIStore.setState({ contextLength: 4096 });
  });

  it('returns an estimate for a mapped direct-API connection', () => {
    const conversation = makeConversation(makeMessages(4));
    const { result } = renderHook(() =>
      useEstimatedContextUsage(conversation, makeConnection(), 'system prompt text'),
    );
    expect(result.current).toBeDefined();
    expect(result.current!.contextSize).toBe(200_000);
    // 4 × (100 tokens content + 4 overhead) + ceil(18/4) system prompt
    expect(result.current!.contextUsed).toBeGreaterThan(400);
  });

  it('returns undefined when the context size is unknown (no-denominator rule)', () => {
    const conversation = makeConversation(makeMessages(2));
    const conn = makeConnection({ provider: 'openai_compatible', config: { model: 'gpt-4o' } });
    const { result } = renderHook(() => useEstimatedContextUsage(conversation, conn));
    expect(result.current).toBeUndefined();
  });

  it('returns undefined without a connection', () => {
    const conversation = makeConversation(makeMessages(2));
    const { result } = renderHook(() => useEstimatedContextUsage(conversation, null));
    expect(result.current).toBeUndefined();
  });

  it('uses the local_bundled context length as the denominator', () => {
    useLocalAIStore.setState({ contextLength: 8192 });
    const conn = makeConnection({
      provider: 'local_ai',
      authMethod: 'local_bundled',
      credentials: { type: 'local_bundled' },
    });
    const { result } = renderHook(() =>
      useEstimatedContextUsage(makeConversation(makeMessages(2)), conn),
    );
    expect(result.current?.contextSize).toBe(8192);
  });

  it('does NOT recompute when message content mutates (stream chunks)', () => {
    const conversation = makeConversation(makeMessages(4));
    const { result, rerender } = renderHook(
      ({ conv }: { conv: Conversation }) => useEstimatedContextUsage(conv, makeConnection()),
      { initialProps: { conv: conversation } },
    );
    const first = result.current;
    expect(first).toBeDefined();

    // Simulate a stream chunk: same count, same leaf, mutated content.
    const streamed: Conversation = {
      ...conversation,
      messages: conversation.messages.map((m, i) =>
        i === conversation.messages.length - 1 ? { ...m, content: m.content + 'y'.repeat(5000) } : m,
      ),
    };
    rerender({ conv: streamed });

    // Same memo output — reference equality proves the token walk didn't re-run.
    expect(result.current).toBe(first);
  });

  it('recomputes at message boundaries (count change)', () => {
    const conversation = makeConversation(makeMessages(2));
    const { result, rerender } = renderHook(
      ({ conv }: { conv: Conversation }) => useEstimatedContextUsage(conv, makeConnection()),
      { initialProps: { conv: conversation } },
    );
    const first = result.current;
    expect(first).toBeDefined();

    rerender({ conv: makeConversation(makeMessages(4)) });

    expect(result.current).not.toBe(first);
    expect(result.current!.contextUsed).toBeGreaterThan(first!.contextUsed);
  });

  it('writes the estimate through to the usage-store with estimate provenance', () => {
    const conversation = makeConversation(makeMessages(2));
    renderHook(() => useEstimatedContextUsage(conversation, makeConnection()));

    const snap = useUsageStore.getState().getSnapshot('conn-est');
    expect(snap).toBeDefined();
    expect(snap?.source).toBe('estimate');
    expect(snap?.confidence).toBe('estimated');
    expect(snap?.contextSize).toBe(200_000);
    expect(snap?.contextUsed).toBeGreaterThan(0);
  });

  it('does not write to the usage-store when there is no estimate', () => {
    const conversation = makeConversation(makeMessages(2));
    const conn = makeConnection({ provider: 'openai_compatible' });
    renderHook(() => useEstimatedContextUsage(conversation, conn));

    expect(Object.keys(useUsageStore.getState().snapshots)).toHaveLength(0);
  });
});
