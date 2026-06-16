import { describe, it, expect, beforeEach } from 'vitest';
import '@/test/tauri-mock';
import { useSessionRunStore } from '@/stores/session-run-store';
import {
  runStarted,
  runIdle,
  runError,
  runAwaitingPermission,
  runRunning,
  hasSessionCapacity,
  enqueueSend,
  dropQueuedSend,
  isSendQueued,
  processSendQueue,
  __resetSendQueue,
} from '@/lib/ai/session-run';

beforeEach(() => {
  useSessionRunStore.setState({ runs: {}, foregroundConversationId: null });
  __resetSendQueue();
});

const status = (id: string) => useSessionRunStore.getState().runs[id]?.status;

describe('run-state transitions', () => {
  it('runStarted → running with path/handles; runIdle clears; runError marks error', () => {
    runStarted('A', 'direct', { streamId: 's1' });
    expect(useSessionRunStore.getState().runs.A).toMatchObject({ status: 'running', path: 'direct', streamId: 's1' });
    runIdle('A');
    expect(status('A')).toBeUndefined();

    runStarted('A', 'acp');
    runError('A');
    expect(status('A')).toBe('error');
  });

  it('runAwaitingPermission / runRunning toggle only on the right transition', () => {
    runStarted('A', 'direct');
    runRunning('A'); // no-op (already running, not awaiting)
    expect(status('A')).toBe('running');
    runAwaitingPermission('A', 'req-1');
    expect(status('A')).toBe('awaiting_permission');
    runRunning('A'); // applies — back to running
    expect(status('A')).toBe('running');
  });

  it('helpers are no-ops on a null conversation', () => {
    runStarted(null, 'direct');
    runError(undefined);
    expect(Object.keys(useSessionRunStore.getState().runs)).toHaveLength(0);
  });
});

describe('concurrency cap + FIFO queue (task #5)', () => {
  const setRunning = (id: string) => useSessionRunStore.getState().setRun(id, { status: 'running' });

  it('hasSessionCapacity reflects live count vs the cap', () => {
    setRunning('A');
    setRunning('B');
    expect(hasSessionCapacity(4)).toBe(true);
    setRunning('C');
    setRunning('D');
    expect(hasSessionCapacity(4)).toBe(false);
    // queued does NOT count against capacity
    useSessionRunStore.getState().setStatus('E', 'queued');
    expect(hasSessionCapacity(4)).toBe(false); // still 4 running
  });

  it('queues beyond the cap and starts FIFO as slots free', () => {
    // cap 2, two already running.
    setRunning('A');
    setRunning('B');
    const started: string[] = [];
    const mk = (id: string) => () => { started.push(id); useSessionRunStore.getState().setStatus(id, 'running'); };

    enqueueSend('C', mk('C'));
    enqueueSend('D', mk('D'));
    expect(status('C')).toBe('queued');
    expect(status('D')).toBe('queued');
    expect(isSendQueued('D')).toBe(true);

    // No free slot — nothing starts.
    processSendQueue(2);
    expect(started).toEqual([]);

    // One completes → exactly one queued send starts (FIFO: C).
    useSessionRunStore.getState().clearRun('A');
    processSendQueue(2);
    expect(started).toEqual(['C']);
    expect(status('C')).toBe('running');
    expect(status('D')).toBe('queued');

    // Another completes → D starts.
    useSessionRunStore.getState().clearRun('B');
    processSendQueue(2);
    expect(started).toEqual(['C', 'D']);
  });

  it('a re-send supersedes the existing queued thunk for the same conversation', () => {
    setRunning('A');
    setRunning('B');
    const started: string[] = [];
    enqueueSend('C', () => { started.push('first'); useSessionRunStore.getState().setStatus('C', 'running'); });
    enqueueSend('C', () => { started.push('second'); useSessionRunStore.getState().setStatus('C', 'running'); });

    useSessionRunStore.getState().clearRun('A');
    processSendQueue(2);
    expect(started).toEqual(['second']); // only the latest thunk runs
  });

  it('dropQueuedSend removes a parked send without starting it', () => {
    setRunning('A');
    setRunning('B');
    const started: string[] = [];
    enqueueSend('C', () => started.push('C'));
    expect(dropQueuedSend('C')).toBe(true);
    expect(isSendQueued('C')).toBe(false);

    useSessionRunStore.getState().clearRun('A');
    processSendQueue(2);
    expect(started).toEqual([]);
  });

  it('processSendQueue never exceeds the cap even with many queued', () => {
    const started: string[] = [];
    for (const id of ['A', 'B', 'C', 'D', 'E']) {
      enqueueSend(id, () => { started.push(id); useSessionRunStore.getState().setStatus(id, 'running'); });
    }
    processSendQueue(3);
    expect(started).toEqual(['A', 'B', 'C']); // exactly the cap
    expect(useSessionRunStore.getState().runs.D.status).toBe('queued');
  });
});
