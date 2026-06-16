// @vitest-environment jsdom

import { describe, it, expect, beforeEach, vi } from 'vitest';
import '@/test/tauri-mock';
import { renderHook, act } from '@testing-library/react';
import { useChatStore } from '@/stores/chat-store';
import { useSessionRunStore, selectUnwatchedRunning } from '@/stores/session-run-store';
import { useSettingsStore } from '@/stores/settings-store';
import { enqueueSend, isSendQueued, __resetSendQueue } from '@/lib/ai/session-run';
import { useSessionManager, useForegroundLoading } from '@/hooks/useSessionManager';

const notifyBackgroundSession = vi.fn();
vi.mock('@/lib/notifications', () => ({
  notifyBackgroundSession: (...args: unknown[]) => notifyBackgroundSession(...args),
}));

function seedConversations(ids: string[], active: string | null = null) {
  useChatStore.setState({
    conversations: ids.map((id) => ({ id, title: `Chat ${id}`, messages: [], createdAt: 0, updatedAt: 0, projectPaths: [], segments: [], activeSegmentIndex: 0, activeLeafId: null })) as never,
    activeConversationId: active,
  });
}

beforeEach(() => {
  useChatStore.setState({ conversations: [], activeConversationId: null });
  useSessionRunStore.setState({ runs: {}, foregroundConversationId: null });
  __resetSendQueue();
  notifyBackgroundSession.mockClear();
});

describe('useSessionManager — foreground tracking', () => {
  it('mirrors activeConversationId into session-run-store.foregroundConversationId', () => {
    renderHook(() => useSessionManager());
    // Initial sync (active is null).
    expect(useSessionRunStore.getState().foregroundConversationId).toBeNull();

    act(() => { useChatStore.setState({ activeConversationId: 'conv-A' }); });
    expect(useSessionRunStore.getState().foregroundConversationId).toBe('conv-A');

    act(() => { useChatStore.setState({ activeConversationId: 'conv-B' }); });
    expect(useSessionRunStore.getState().foregroundConversationId).toBe('conv-B');

    act(() => { useChatStore.setState({ activeConversationId: null }); });
    expect(useSessionRunStore.getState().foregroundConversationId).toBeNull();
  });
});

describe('useSessionManager — orphan pruning', () => {
  it('clears runs whose conversation no longer exists', () => {
    // Two conversations, each with a run.
    useChatStore.setState({
      conversations: [
        { id: 'conv-A', title: '', messages: [], createdAt: 0, updatedAt: 0, projectPaths: [], segments: [], activeSegmentIndex: 0, activeLeafId: null },
        { id: 'conv-B', title: '', messages: [], createdAt: 0, updatedAt: 0, projectPaths: [], segments: [], activeSegmentIndex: 0, activeLeafId: null },
      ] as never,
    });
    useSessionRunStore.getState().setRun('conv-A', { status: 'running' });
    useSessionRunStore.getState().setRun('conv-B', { status: 'error' });

    renderHook(() => useSessionManager());
    // Both still present after mount (both conversations exist).
    expect(Object.keys(useSessionRunStore.getState().runs).sort()).toEqual(['conv-A', 'conv-B']);

    // Delete conv-B — its run must be pruned.
    act(() => {
      useChatStore.setState({
        conversations: [
          { id: 'conv-A', title: '', messages: [], createdAt: 0, updatedAt: 0, projectPaths: [], segments: [], activeSegmentIndex: 0, activeLeafId: null },
        ] as never,
      });
    });
    expect(Object.keys(useSessionRunStore.getState().runs)).toEqual(['conv-A']);
  });
});

describe('useSessionManager — concurrency queue drain (task #5)', () => {
  it('auto-starts a parked send when a run-state change frees a slot', () => {
    useSettingsStore.setState({ maxConcurrentSessions: 2 });
    useSessionRunStore.setState({ runs: {}, foregroundConversationId: null });
    // Seed conversations for every run id so the orphan-prune effect doesn't
    // clear these runs at mount (in production a run always has a conversation).
    const ids = ['R1', 'R2', 'R3', 'R4', 'R5', 'Q'];
    useChatStore.setState({
      conversations: ids.map((id) => ({ id, title: '', messages: [], createdAt: 0, updatedAt: 0, projectPaths: [], segments: [], activeSegmentIndex: 0, activeLeafId: null })) as never,
      activeConversationId: null,
    });
    // Fill clearly OVER any plausible cap (the persisted setting can race in
    // tests) so the parked send stays queued at mount regardless of the exact
    // cap value; then free down clearly UNDER it.
    for (const id of ['R1', 'R2', 'R3', 'R4', 'R5']) {
      useSessionRunStore.getState().setRun(id, { status: 'running' });
    }

    let started = false;
    enqueueSend('Q', () => { started = true; useSessionRunStore.getState().setStatus('Q', 'running'); });

    renderHook(() => useSessionManager());
    // Still over capacity on mount — nothing starts.
    expect(started).toBe(false);
    expect(isSendQueued('Q')).toBe(true);

    // Free every running slot → the store subscription drains the queue.
    act(() => {
      for (const id of ['R1', 'R2', 'R3', 'R4', 'R5']) {
        useSessionRunStore.getState().clearRun(id);
      }
    });
    expect(started).toBe(true);
    expect(isSendQueued('Q')).toBe(false);
    expect(useSessionRunStore.getState().runs.Q?.status).toBe('running');
  });
});

describe('history switcher (task #11) — foregrounding follows the active conversation', () => {
  it('switching active conversation moves the prior running session into the orb (unwatched) set', () => {
    // Two running sessions (with backing conversations so the orphan-prune
    // doesn't clear them); A is foreground.
    useChatStore.setState({
      conversations: ['A', 'B'].map((id) => ({ id, title: '', messages: [], createdAt: 0, updatedAt: 0, projectPaths: [], segments: [], activeSegmentIndex: 0, activeLeafId: null })) as never,
      activeConversationId: 'A',
    });
    useSessionRunStore.getState().setRun('A', { status: 'running' });
    useSessionRunStore.getState().setRun('B', { status: 'running' });
    renderHook(() => useSessionManager());

    expect(useSessionRunStore.getState().foregroundConversationId).toBe('A');
    expect(selectUnwatchedRunning(useSessionRunStore.getState()).map((r) => r.conversationId)).toEqual(['B']);

    // Click B in history → it becomes active → foreground follows → A moves to the orb set.
    act(() => { useChatStore.setState({ activeConversationId: 'B' }); });
    expect(useSessionRunStore.getState().foregroundConversationId).toBe('B');
    expect(selectUnwatchedRunning(useSessionRunStore.getState()).map((r) => r.conversationId)).toEqual(['A']);
  });
});

describe('useSessionManager — backgrounded notifications (task #15)', () => {
  it('notifies when a BACKGROUND session becomes awaiting-permission', () => {
    seedConversations(['A', 'B'], 'A'); // A is foreground
    renderHook(() => useSessionManager());

    act(() => { useSessionRunStore.getState().setRun('B', { status: 'awaiting_permission' }); });

    expect(notifyBackgroundSession).toHaveBeenCalledTimes(1);
    expect(notifyBackgroundSession.mock.calls[0][0]).toBe('permission');
    expect(notifyBackgroundSession.mock.calls[0][3]).toBe('B');
  });

  it('does NOT notify when the FOREGROUND session needs permission', () => {
    seedConversations(['A'], 'A');
    renderHook(() => useSessionManager());

    act(() => { useSessionRunStore.getState().setRun('A', { status: 'awaiting_permission' }); });
    expect(notifyBackgroundSession).not.toHaveBeenCalled();
  });

  it('notifies on background completion (active → cleared)', () => {
    seedConversations(['A', 'B'], 'A');
    useSessionRunStore.getState().setRun('B', { status: 'running' });
    renderHook(() => useSessionManager());
    notifyBackgroundSession.mockClear();

    act(() => { useSessionRunStore.getState().clearRun('B'); });

    expect(notifyBackgroundSession).toHaveBeenCalledTimes(1);
    expect(notifyBackgroundSession.mock.calls[0][0]).toBe('completion');
    expect(notifyBackgroundSession.mock.calls[0][3]).toBe('B');
  });

  it('does not notify on queued → running (not a completion or permission event)', () => {
    seedConversations(['A', 'B'], 'A');
    useSessionRunStore.getState().setStatus('B', 'queued');
    renderHook(() => useSessionManager());
    notifyBackgroundSession.mockClear();

    act(() => { useSessionRunStore.getState().setStatus('B', 'running'); });
    expect(notifyBackgroundSession).not.toHaveBeenCalled();
  });
});

describe('useForegroundLoading', () => {
  it('is true only when the active conversation is running or awaiting permission', () => {
    useChatStore.setState({ activeConversationId: 'conv-A' });
    const { result } = renderHook(() => useForegroundLoading());
    expect(result.current).toBe(false);

    act(() => { useSessionRunStore.getState().setRun('conv-A', { status: 'running' }); });
    expect(result.current).toBe(true);

    act(() => { useSessionRunStore.getState().setStatus('conv-A', 'awaiting_permission'); });
    expect(result.current).toBe(true);

    act(() => { useSessionRunStore.getState().setStatus('conv-A', 'error'); });
    expect(result.current).toBe(false);
  });

  it('ignores a background conversation that is running', () => {
    useChatStore.setState({ activeConversationId: 'conv-A' });
    const { result } = renderHook(() => useForegroundLoading());

    // conv-B (not active) streams — the foreground must stay not-loading.
    act(() => { useSessionRunStore.getState().setRun('conv-B', { status: 'running' }); });
    expect(result.current).toBe(false);

    // Switching to conv-B reflects its run.
    act(() => { useChatStore.setState({ activeConversationId: 'conv-B' }); });
    expect(result.current).toBe(true);
  });
});
