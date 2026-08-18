// @vitest-environment jsdom
//
// Regression test for the crash-retry "agent can't continue" symptom
// (fix/acp-conversation-state-integrity).
//
// When a NEW ACP session starts mid-conversation (first message of a fresh
// session, or a crash-retry that fell back to a fresh session), the prior
// conversation must be replayed as a <conversation-history> preamble — otherwise
// the agent gets zero context and the conversation appears broken.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import '@/test/tauri-mock';

vi.mock('@/lib/logger', () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('@/lib/tauri', () => ({ tauriApi: { getHomeDir: vi.fn().mockResolvedValue('/Users/test') } }));
vi.mock('@/hooks/useAcpSessionListeners', () => ({
  setupAcpChatListeners: vi.fn(),
  buildAcpChatCleanup: vi.fn(),
}));

import { buildAcpHistoryBlock } from '@/hooks/useAcpLifecycle';
import { useChatStore } from '@/stores/chat-store';

const store = useChatStore;

describe('buildAcpHistoryBlock', () => {
  beforeEach(() => {
    store.setState({ conversations: [], activeConversationId: null });
  });

  function seedConversation() {
    store.getState().createConversation({ projectPaths: [] });
    store.getState().addMessage({ role: 'user', content: 'first question', timestamp: 100 });
    store.getState().addMessage({ role: 'assistant', content: 'first answer', timestamp: 101 });
    // The pair currently being (re)sent:
    store.getState().addMessage({ role: 'user', content: 'second question', timestamp: 200 });
    store.getState().addMessage({ role: 'assistant', content: '', timestamp: 201 });
  }

  it('replays prior messages and excludes the current pair', () => {
    seedConversation();

    const block = buildAcpHistoryBlock([201, 200]); // exclude current assistant + user

    expect(block).toContain('<conversation-history>');
    expect(block).toContain('User: first question');
    expect(block).toContain('Assistant: first answer');
    // The current pair must NOT appear in the replayed history.
    expect(block).not.toContain('second question');
  });

  it('returns an empty string when there is no prior history', () => {
    store.getState().createConversation({ projectPaths: [] });
    store.getState().addMessage({ role: 'user', content: 'only question', timestamp: 200 });
    store.getState().addMessage({ role: 'assistant', content: '', timestamp: 201 });

    expect(buildAcpHistoryBlock([201, 200])).toBe('');
  });

  it('marks interrupted messages in the replayed history', () => {
    store.getState().createConversation({ projectPaths: [] });
    store.getState().addMessage({ role: 'user', content: 'q', timestamp: 100 });
    store.getState().addMessage({ role: 'assistant', content: 'partial', timestamp: 101, interrupted: true });
    store.getState().addMessage({ role: 'user', content: 'retry q', timestamp: 200 });
    store.getState().addMessage({ role: 'assistant', content: '', timestamp: 201 });

    const block = buildAcpHistoryBlock([201, 200]);
    expect(block).toContain('Assistant [interrupted]: partial');
  });
});

/**
 * Cross-conversation leak guard (#468).
 *
 * When the concurrency cap defers a send, it runs later — by which time the
 * user may be reading a different chat. The old code sidestepped this by
 * activating the target conversation first; now the target is named
 * explicitly, and this is the test that the naming is actually honoured.
 *
 * Getting it wrong splices another conversation's messages into this one's
 * prompt, which is a content leak across chats and, when the two belong to
 * different projects, across projects.
 */
describe('buildAcpHistoryBlock — explicit conversation', () => {
  beforeEach(() => {
    store.setState({ conversations: [], activeConversationId: null });
  });

  function seedTwoConversations(): { deferred: string; watched: string } {
    const deferred = store.getState().createConversation({ projectPaths: [] });
    store.getState().addMessage({ role: 'user', content: 'about the deferred chat', timestamp: 100 });
    store.getState().addMessage({ role: 'assistant', content: 'deferred answer', timestamp: 101 });

    const watched = store.getState().createConversation({ projectPaths: [] });
    store.getState().addMessage({ role: 'user', content: 'about the watched chat', timestamp: 300 });
    store.getState().addMessage({ role: 'assistant', content: 'watched answer', timestamp: 301 });

    // createConversation activates it, so the user is now "looking at" watched.
    store.getState().setActiveConversation(watched);
    return { deferred, watched };
  }

  it('replays the named conversation, not the one being viewed', () => {
    const { deferred } = seedTwoConversations();

    const block = buildAcpHistoryBlock([], undefined, deferred);

    expect(block).toContain('about the deferred chat');
    expect(block).not.toContain('about the watched chat');
  });

  it('still follows the active conversation when no id is given', () => {
    seedTwoConversations();

    // The ordinary (non-deferred) path passes no id and must be unchanged.
    const block = buildAcpHistoryBlock([]);

    expect(block).toContain('about the watched chat');
    expect(block).not.toContain('about the deferred chat');
  });
});
