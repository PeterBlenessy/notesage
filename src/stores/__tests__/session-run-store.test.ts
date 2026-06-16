import { describe, it, expect, beforeEach } from 'vitest';
import {
  useSessionRunStore,
  markInterruptedRuns,
  selectRun,
  selectRunningSessions,
  selectUnwatchedRunning,
  selectLiveCount,
  type SessionRun,
} from '../session-run-store';

function reset() {
  useSessionRunStore.setState({ runs: {}, foregroundConversationId: null });
}

describe('session-run-store', () => {
  beforeEach(reset);

  it('setRun creates an entry (defaulting status to idle) and merges patches', () => {
    const s = useSessionRunStore.getState();
    s.setRun('c1', { path: 'acp' });
    expect(useSessionRunStore.getState().runs.c1).toEqual({
      conversationId: 'c1',
      status: 'idle',
      path: 'acp',
    });

    s.setRun('c1', { status: 'running', instanceId: 'inst-1', startedAt: 5 });
    expect(useSessionRunStore.getState().runs.c1).toMatchObject({
      conversationId: 'c1',
      status: 'running',
      path: 'acp',
      instanceId: 'inst-1',
      startedAt: 5,
    });
  });

  it('setStatus transitions an existing run and creates one if absent', () => {
    const s = useSessionRunStore.getState();
    s.setStatus('c2', 'queued');
    expect(useSessionRunStore.getState().runs.c2.status).toBe('queued');
    s.setStatus('c2', 'running');
    expect(useSessionRunStore.getState().runs.c2.status).toBe('running');
  });

  it('clearRun removes the entry', () => {
    const s = useSessionRunStore.getState();
    s.setStatus('c3', 'running');
    s.clearRun('c3');
    expect(useSessionRunStore.getState().runs.c3).toBeUndefined();
  });

  it('selectRunningSessions counts running + awaiting_permission, not queued/idle/error', () => {
    const s = useSessionRunStore.getState();
    s.setStatus('a', 'running');
    s.setStatus('b', 'awaiting_permission');
    s.setStatus('c', 'queued');
    s.setStatus('d', 'idle');
    s.setStatus('e', 'error');
    const ids = selectRunningSessions(useSessionRunStore.getState()).map((r) => r.conversationId).sort();
    expect(ids).toEqual(['a', 'b']);
    expect(selectLiveCount(useSessionRunStore.getState())).toBe(2);
  });

  it('selectUnwatchedRunning excludes the foregrounded conversation', () => {
    const s = useSessionRunStore.getState();
    s.setStatus('a', 'running');
    s.setStatus('b', 'running');
    s.setForeground('a');
    const ids = selectUnwatchedRunning(useSessionRunStore.getState()).map((r) => r.conversationId);
    expect(ids).toEqual(['b']);
  });

  it('selectRun returns the entry or undefined', () => {
    useSessionRunStore.getState().setStatus('z', 'running');
    expect(selectRun(useSessionRunStore.getState(), 'z')?.status).toBe('running');
    expect(selectRun(useSessionRunStore.getState(), 'missing')).toBeUndefined();
  });
});

describe('markInterruptedRuns (rehydrate)', () => {
  it('flips in-flight runs (queued/running/awaiting_permission) to error and drops transient handles', () => {
    const runs: Record<string, SessionRun> = {
      a: { conversationId: 'a', status: 'running', instanceId: 'inst', streamId: 'sid', startedAt: 9 },
      b: { conversationId: 'b', status: 'queued' },
      c: { conversationId: 'c', status: 'awaiting_permission', pendingPermissionId: 'p1' },
      d: { conversationId: 'd', status: 'idle' },
      e: { conversationId: 'e', status: 'error' },
    };
    const next = markInterruptedRuns(runs);
    expect(next.a).toEqual({ conversationId: 'a', status: 'error' });
    expect(next.b).toEqual({ conversationId: 'b', status: 'error' });
    expect(next.c).toEqual({ conversationId: 'c', status: 'error' });
    // Terminal/idle states are preserved, transient handles stripped.
    expect(next.d).toEqual({ conversationId: 'd', status: 'idle' });
    expect(next.e).toEqual({ conversationId: 'e', status: 'error' });
  });
});
