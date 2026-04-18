// @vitest-environment jsdom

// Cross-cutting integration tests for Batch C session lifecycle:
// - restoration preference chain (resume → load → list → new)
// - branch-session routing via getSessionIdForLeaf
// Keeps tests mock-based (no real IPC); each asserts observable behavior
// across multiple modules the unit tests don't exercise together.

import '@/test/tauri-mock';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { restoreOrCreateAcpSession } from '../acp-session-restore';
import { getSessionIdForLeaf, useChatStore } from '@/stores/chat-store';
import type { AcpAgentCapabilities, AcpSessionResult } from '../acp-utils';
import { setMockInvokeHandler, clearMockInvokeHandlers } from '@/test/tauri-mock';

const makeSession = (id: string): AcpSessionResult => ({
  session_id: id,
  current_model: null,
  available_models: [],
  modes: null,
  config_options: null,
});

const allCaps: AcpAgentCapabilities = {
  loadSession: true,
  sessionCapabilities: { list: {}, fork: {}, resume: {}, close: {} },
};

describe('end-to-end restoration preferences', () => {
  beforeEach(() => {
    clearMockInvokeHandlers();
  });

  it('prefers resume over load when both succeed', async () => {
    const resumeSpy = vi.fn(() => makeSession('RESUME-ID'));
    const loadSpy = vi.fn(() => makeSession('LOAD-ID'));
    setMockInvokeHandler('acp_session_resume', resumeSpy);
    setMockInvokeHandler('acp_session_load', loadSpy);
    setMockInvokeHandler('acp_session_new', () => makeSession('NEW-ID'));

    const result = await restoreOrCreateAcpSession({
      instanceId: 'I',
      cwd: '/tmp',
      storedSessionId: 'S',
      capabilities: allCaps,
    });

    expect(result.session_id).toBe('RESUME-ID');
    expect(loadSpy).not.toHaveBeenCalled();
  });

  it('falls through the full chain when everything goes wrong', async () => {
    setMockInvokeHandler('acp_session_resume', () => { throw new Error('r'); });
    setMockInvokeHandler('acp_session_load', () => { throw new Error('l'); });
    setMockInvokeHandler('acp_session_list', () => ({ sessions: [], next_cursor: null }));
    const newSpy = vi.fn(() => makeSession('SAFETY-NET'));
    setMockInvokeHandler('acp_session_new', newSpy);

    const result = await restoreOrCreateAcpSession({
      instanceId: 'I',
      cwd: '/tmp',
      storedSessionId: 'S',
      capabilities: allCaps,
    });

    expect(result.session_id).toBe('SAFETY-NET');
    expect(newSpy).toHaveBeenCalledOnce();
  });

  it('ignores list when list itself errors and still falls back to new', async () => {
    setMockInvokeHandler('acp_session_resume', () => { throw new Error('r'); });
    setMockInvokeHandler('acp_session_load', () => { throw new Error('l'); });
    setMockInvokeHandler('acp_session_list', () => { throw new Error('list crashed'); });
    const newSpy = vi.fn(() => makeSession('POST-LIST-FAIL'));
    setMockInvokeHandler('acp_session_new', newSpy);

    const result = await restoreOrCreateAcpSession({
      instanceId: 'I',
      cwd: '/tmp',
      storedSessionId: 'S',
      capabilities: allCaps,
    });

    expect(result.session_id).toBe('POST-LIST-FAIL');
    expect(newSpy).toHaveBeenCalledOnce();
  });
});

describe('branch session routing (getSessionIdForLeaf across scenarios)', () => {
  beforeEach(() => {
    useChatStore.setState({
      conversations: [],
      activeConversationId: null,
      isLoading: false,
      error: null,
      activeTool: null,
    });
  });

  it('a forked branch uses its own session while the main branch keeps the base session', () => {
    // Timeline: m1 (user) → m2 (assistant), then branch from m2 with fork.
    // New message m3 attaches to m2. Another message m4 also attaches to m2 but without fork.
    const store = useChatStore.getState();
    const convId = store.createConversation();
    store.addMessage({ role: 'user', content: 'hi', timestamp: 1 });
    store.addMessage({ role: 'assistant', content: 'hey', timestamp: 2 });
    const firstLeaf = useChatStore.getState().conversations.find((c) => c.id === convId)!.activeLeafId!;

    // Attach base session at conv level (simulates a restored session).
    useChatStore.setState((s) => ({
      conversations: s.conversations.map((c) =>
        c.id === convId ? { ...c, acpSessionId: 'base-session' } : c,
      ),
    }));

    // Branch from the assistant (current leaf) WITH a fork.
    store.branchFromMessage(2, 'forked-session');
    store.addMessage({ role: 'user', content: 'forked path', timestamp: 3 });
    const forkedLeaf = useChatStore.getState().conversations.find((c) => c.id === convId)!.activeLeafId!;

    // Switch back to the main branch (manually — simulating branch switcher).
    store.switchBranch(firstLeaf);
    // Add another child of m2 that DOES NOT carry a fork.
    store.branchFromMessage(2); // no fork param, clears any pending
    store.addMessage({ role: 'user', content: 'main continuation', timestamp: 4 });
    const mainLeaf = useChatStore.getState().conversations.find((c) => c.id === convId)!.activeLeafId!;

    const conv = useChatStore.getState().conversations.find((c) => c.id === convId)!;
    // Forked branch resolves to its own session.
    expect(getSessionIdForLeaf(conv, forkedLeaf)).toBe('forked-session');
    // Main branch resolves to the base.
    expect(getSessionIdForLeaf(conv, mainLeaf)).toBe('base-session');
  });

  it('historical branches share the conversation-level session (no fork)', () => {
    const store = useChatStore.getState();
    const convId = store.createConversation();
    store.addMessage({ role: 'user', content: 'u1', timestamp: 1 });
    store.addMessage({ role: 'assistant', content: 'a1', timestamp: 2 });
    store.addMessage({ role: 'user', content: 'u2', timestamp: 3 });
    store.addMessage({ role: 'assistant', content: 'a2', timestamp: 4 });

    useChatStore.setState((s) => ({
      conversations: s.conversations.map((c) =>
        c.id === convId ? { ...c, acpSessionId: 'shared-session' } : c,
      ),
    }));

    // Branch from a HISTORICAL message (u1 at timestamp 1). No fork (ACP can't rewind state).
    store.branchFromMessage(1);
    store.addMessage({ role: 'user', content: 'alternate history', timestamp: 5 });

    const conv = useChatStore.getState().conversations.find((c) => c.id === convId)!;
    const newLeaf = conv.activeLeafId!;
    expect(getSessionIdForLeaf(conv, newLeaf)).toBe('shared-session');
    expect(conv.branchSessions ?? {}).toEqual({});
  });
});
