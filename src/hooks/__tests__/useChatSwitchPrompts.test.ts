// @vitest-environment jsdom
//
// Regression test for the spurious "Project changed to…" prompt on conversation
// switch (fix/acp-conversation-state-integrity).
//
// Switching from conversation A (scope P_A) to B (scope P_B) must NOT be treated
// as an in-conversation project change — it's a silent restore of B's own scope.
// The prompt should fire ONLY when the scope mutates within a single conversation.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

vi.mock('@/lib/logger', () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// The provider/agent-switch effect is out of scope here — stub its stores so it
// never fires (interactive connection resolves to undefined, empty metadata).
vi.mock('@/stores/connections-store', () => ({
  useConnectionsStore: Object.assign(
    vi.fn((sel: (s: { connections: unknown[] }) => unknown) => sel({ connections: [] })),
    { getState: () => ({ connections: [] }) },
  ),
}));
vi.mock('@/stores/routing-store', () => ({
  useRoutingStore: Object.assign(
    vi.fn((sel: (s: { getConnectionForUseCase: () => undefined }) => unknown) =>
      sel({ getConnectionForUseCase: () => undefined }),
    ),
    { getState: () => ({ getConnectionForUseCase: () => undefined }) },
  ),
}));
vi.mock('@/stores/project-metadata-store', () => ({
  useProjectMetadataStore: Object.assign(
    vi.fn((sel: (s: { metadataMap: Record<string, unknown> }) => unknown) =>
      sel({ metadataMap: {} }),
    ),
    { getState: () => ({ metadataMap: {} }) },
  ),
}));

import { useChatSwitchPrompts } from '@/hooks/useChatSwitchPrompts';
import { useChatStore } from '@/stores/chat-store';

const store = useChatStore;
const pendingFor = (id: string) =>
  store.getState().conversations.find((c) => c.id === id)?.pendingProjectSwitch ?? null;

describe('useChatSwitchPrompts — conversation-scoped project switch', () => {
  beforeEach(() => {
    store.setState({ conversations: [], activeConversationId: null });
  });

  it('does NOT prompt when switching between conversations with different scopes', () => {
    renderHook(() => useChatSwitchPrompts());

    let aId = '';
    let bId = '';
    act(() => {
      aId = store.getState().createConversation({ projectPaths: ['/X'] });
      store.getState().addMessage({ role: 'user', content: 'hi', timestamp: 1 });
    });
    act(() => {
      bId = store.getState().createConversation({ projectPaths: ['/Y'] });
      store.getState().addMessage({ role: 'user', content: 'yo', timestamp: 2 });
    });

    // Switch A → B → A. Each is a restore of that conversation's own scope.
    act(() => store.getState().setActiveConversation(aId));
    act(() => store.getState().setActiveConversation(bId));
    act(() => store.getState().setActiveConversation(aId));

    expect(pendingFor(aId)).toBeNull();
    expect(pendingFor(bId)).toBeNull();
  });

  it('DOES prompt when the scope changes within a single conversation', () => {
    renderHook(() => useChatSwitchPrompts());

    let aId = '';
    act(() => {
      aId = store.getState().createConversation({ projectPaths: ['/X'] });
      store.getState().addMessage({ role: 'user', content: 'hi', timestamp: 1 });
    });

    // Same conversation, user adds a project → real change → prompt fires.
    act(() => store.getState().toggleProjectPath('/Y'));

    const pending = pendingFor(aId);
    expect(pending).not.toBeNull();
    expect(new Set(pending!.newPaths)).toEqual(new Set(['/X', '/Y']));
    expect(new Set(pending!.previousPaths)).toEqual(new Set(['/X']));
  });
});
