// @vitest-environment jsdom
//
// Cross-cutting integration pass (PRD `2026-06-14-command-bar-session-multitasking`,
// task #16). Drives a realistic multi-session sequence through the always-mounted
// `useSessionManager` + `session-run-store` + the queue primitives, asserting that
// the engine pieces compose: foreground tracking (#4), the orb's running-and-
// unwatched set (#12), the concurrency cap + FIFO queue (#5), and the backgrounded
// notifications (#15). Each piece also has its own focused unit test; this verifies
// they cooperate.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import '@/test/tauri-mock';
import { renderHook, act } from '@testing-library/react';
import { useChatStore } from '@/stores/chat-store';
import { useSettingsStore } from '@/stores/settings-store';
import {
  useSessionRunStore,
  selectUnwatchedRunning,
  selectLiveCount,
} from '@/stores/session-run-store';
import {
  runStarted,
  runIdle,
  enqueueSend,
  isSendQueued,
  __resetSendQueue,
} from '@/lib/ai/session-run';
import { useSessionManager } from '@/hooks/useSessionManager';

const notifyBackgroundSession = vi.fn();
vi.mock('@/lib/notifications', () => ({
  notifyBackgroundSession: (...args: unknown[]) => notifyBackgroundSession(...args),
}));

function seed(ids: string[], active: string | null) {
  useChatStore.setState({
    conversations: ids.map((id) => ({ id, title: `Chat ${id}`, messages: [], createdAt: 0, updatedAt: 0, projectPaths: [], segments: [], activeSegmentIndex: 0, activeLeafId: null })) as never,
    activeConversationId: active,
  });
}

const unwatchedIds = () =>
  selectUnwatchedRunning(useSessionRunStore.getState()).map((r) => r.conversationId).sort();

beforeEach(() => {
  useSessionRunStore.setState({ runs: {}, foregroundConversationId: null });
  __resetSendQueue();
  useSettingsStore.setState({ maxConcurrentSessions: 2 });
  notifyBackgroundSession.mockClear();
});

describe('session multitasking — engine integration (task #16)', () => {
  it('cap + queue + foreground + orb set + notifications compose across a session lifecycle', () => {
    seed(['A', 'B', 'C'], 'A');
    renderHook(() => useSessionManager());

    // Two sessions running; A is watched, B is in the background.
    act(() => {
      runStarted('A', 'direct');
      runStarted('B', 'direct');
    });
    expect(selectLiveCount(useSessionRunStore.getState())).toBe(2);
    // Orb shows only the unwatched one (#12).
    expect(unwatchedIds()).toEqual(['B']);

    // A third send arrives at the cap → it queues (#5), not started.
    let cStarted = false;
    act(() => {
      enqueueSend('C', () => {
        cStarted = true;
        runStarted('C', 'direct');
      });
    });
    expect(isSendQueued('C')).toBe(true);
    expect(useSessionRunStore.getState().runs.C?.status).toBe('queued');
    expect(cStarted).toBe(false);

    // Background B needs permission → notification fires (#15) and B enters the
    // orb's needs-you set.
    act(() => {
      useSessionRunStore.getState().setStatus('B', 'awaiting_permission');
    });
    expect(notifyBackgroundSession).toHaveBeenCalledTimes(1);
    expect(notifyBackgroundSession.mock.calls[0][0]).toBe('permission');
    expect(notifyBackgroundSession.mock.calls[0][3]).toBe('B');

    // A (foreground) completes → a slot frees → the queue auto-starts C (#5),
    // and A's completion does NOT notify (it was foreground).
    notifyBackgroundSession.mockClear();
    act(() => {
      runIdle('A');
    });
    expect(cStarted).toBe(true);
    expect(useSessionRunStore.getState().runs.C?.status).toBe('running');
    expect(notifyBackgroundSession).not.toHaveBeenCalled();

    // Now B (awaiting) and C (running) are the unwatched set; A is gone.
    expect(unwatchedIds()).toEqual(['B', 'C']);

    // User switches to watch B (the history switcher, #11) → B leaves the orb set.
    act(() => {
      useChatStore.setState({ activeConversationId: 'B' });
    });
    expect(useSessionRunStore.getState().foregroundConversationId).toBe('B');
    expect(unwatchedIds()).toEqual(['C']);

    // B's background completion later notifies; foreground (B now) won't — but
    // C completing in the background does notify (#15).
    act(() => {
      runIdle('C');
    });
    expect(notifyBackgroundSession).toHaveBeenCalledTimes(1);
    expect(notifyBackgroundSession.mock.calls[0][0]).toBe('completion');
    expect(notifyBackgroundSession.mock.calls[0][3]).toBe('C');
  });
});
