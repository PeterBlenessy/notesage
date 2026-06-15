// @vitest-environment jsdom

import { describe, it, expect, beforeEach } from 'vitest';
import '@/test/tauri-mock';
import { renderHook, act } from '@testing-library/react';
import { useChatStore } from '@/stores/chat-store';
import { useSessionRunStore } from '@/stores/session-run-store';
import { useSessionManager, useForegroundLoading } from '@/hooks/useSessionManager';

beforeEach(() => {
  useChatStore.setState({ conversations: [], activeConversationId: null });
  useSessionRunStore.setState({ runs: {}, foregroundConversationId: null });
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
