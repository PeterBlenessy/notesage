/**
 * Unit tests for activity-store.
 *
 * Covers: addTask, updateTaskStatus, appendActivity, completeLastActivity,
 * completeAllActivities, appendPartialOutput, appendThinkingOutput,
 * setFinalOutput, clearCompleted, persistence (partialize + rehydration).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

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

import { useActivityStore } from '../activity-store';
import type { AgentTask } from '../activity-store';
import type { DelegationActivity } from '../comment-store';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function waitForPersist(): Promise<void> {
  await new Promise((r) => setTimeout(r, 50));
}

async function simulateRestart(
  defaults: Record<string, unknown>,
): Promise<void> {
  const snapshot = localStorageMock.getItem('notesage-activity');
  useActivityStore.setState(defaults);
  await waitForPersist();
  if (snapshot) localStorageMock.setItem('notesage-activity', snapshot);
  await useActivityStore.persist.rehydrate();
  await waitForPersist();
}

const DEFAULTS = { tasks: [] };

function makeTask(overrides: Partial<Omit<AgentTask, 'activities' | 'startedAt'>> = {}): Omit<AgentTask, 'activities' | 'startedAt'> {
  return {
    id: overrides.id ?? `task-${Math.random().toString(36).slice(2, 8)}`,
    kind: overrides.kind ?? 'agent',
    type: overrides.type ?? 'comment',
    label: overrides.label ?? 'Test task',
    status: overrides.status ?? 'running',
    ...overrides,
  };
}

function makeActivity(overrides: Partial<DelegationActivity> = {}): DelegationActivity {
  return {
    label: 'Tool call',
    status: 'running',
    timestamp: Date.now(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Setup / Teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  storageBacking.clear();
  useActivityStore.setState(DEFAULTS);
  vi.useFakeTimers();
});

afterEach(() => {
  storageBacking.clear();
  vi.useRealTimers();
});

// ===========================================================================
// addTask
// ===========================================================================

describe('addTask', () => {
  it('creates a task with empty activities and startedAt', () => {
    vi.setSystemTime(new Date('2026-01-15T10:00:00Z'));
    useActivityStore.getState().addTask(makeTask({ id: 'task-1' }));

    const tasks = useActivityStore.getState().tasks;
    expect(tasks).toHaveLength(1);
    expect(tasks[0].id).toBe('task-1');
    expect(tasks[0].activities).toEqual([]);
    expect(tasks[0].startedAt).toBe(Date.now());
  });

  it('prepends newest task first', () => {
    useActivityStore.getState().addTask(makeTask({ id: 'first' }));
    useActivityStore.getState().addTask(makeTask({ id: 'second' }));

    const tasks = useActivityStore.getState().tasks;
    expect(tasks[0].id).toBe('second');
    expect(tasks[1].id).toBe('first');
  });

  it('prunes oldest completed tasks beyond 100 limit', () => {
    // Add 101 completed (non-running) tasks
    for (let i = 0; i < 101; i++) {
      useActivityStore.getState().addTask(makeTask({ id: `done-${i}`, status: 'done' }));
    }

    const tasks = useActivityStore.getState().tasks;
    // Should have been pruned to 100
    expect(tasks.length).toBe(100);
    // The oldest completed task (done-0) should have been pruned
    expect(tasks.find((t) => t.id === 'done-0')).toBeUndefined();
    // The newest should still exist
    expect(tasks.find((t) => t.id === 'done-100')).toBeDefined();
  });

  it('does not prune running tasks when over the limit', () => {
    // Add 5 running tasks
    for (let i = 0; i < 5; i++) {
      useActivityStore.getState().addTask(makeTask({ id: `running-${i}`, status: 'running' }));
    }
    // Add 101 completed tasks to exceed limit
    for (let i = 0; i < 101; i++) {
      useActivityStore.getState().addTask(makeTask({ id: `done-${i}`, status: 'done' }));
    }

    const tasks = useActivityStore.getState().tasks;
    const runningTasks = tasks.filter((t) => t.status === 'running');
    // All 5 running tasks must survive
    expect(runningTasks.length).toBe(5);
  });
});

// ===========================================================================
// updateTaskStatus
// ===========================================================================

describe('updateTaskStatus', () => {
  it('transitions running → done and sets completedAt', () => {
    vi.setSystemTime(new Date('2026-01-15T10:00:00Z'));
    useActivityStore.getState().addTask(makeTask({ id: 'task-1', status: 'running' }));

    vi.setSystemTime(new Date('2026-01-15T10:05:00Z'));
    useActivityStore.getState().updateTaskStatus('task-1', 'done');

    const task = useActivityStore.getState().tasks[0];
    expect(task.status).toBe('done');
    expect(task.completedAt).toBe(Date.now());
  });

  it('transitions running → error and sets completedAt', () => {
    useActivityStore.getState().addTask(makeTask({ id: 'task-1', status: 'running' }));
    useActivityStore.getState().updateTaskStatus('task-1', 'error');

    const task = useActivityStore.getState().tasks[0];
    expect(task.status).toBe('error');
    expect(task.completedAt).toBeDefined();
  });

  it('transitions running → cancelled and sets completedAt', () => {
    useActivityStore.getState().addTask(makeTask({ id: 'task-1', status: 'running' }));
    useActivityStore.getState().updateTaskStatus('task-1', 'cancelled');

    const task = useActivityStore.getState().tasks[0];
    expect(task.status).toBe('cancelled');
    expect(task.completedAt).toBeDefined();
  });

  it('does not overwrite completedAt when setting back to running', () => {
    vi.setSystemTime(new Date('2026-01-15T10:00:00Z'));
    useActivityStore.getState().addTask(makeTask({ id: 'task-1', status: 'running' }));

    vi.setSystemTime(new Date('2026-01-15T10:05:00Z'));
    useActivityStore.getState().updateTaskStatus('task-1', 'done');
    const doneAt = useActivityStore.getState().tasks[0].completedAt;

    vi.setSystemTime(new Date('2026-01-15T10:10:00Z'));
    useActivityStore.getState().updateTaskStatus('task-1', 'running');

    // completedAt preserved from when it was last set (running branch keeps existing)
    const task = useActivityStore.getState().tasks[0];
    expect(task.status).toBe('running');
    expect(task.completedAt).toBe(doneAt);
  });
});

// ===========================================================================
// appendActivity
// ===========================================================================

describe('appendActivity', () => {
  it('appends an activity to the correct task', () => {
    useActivityStore.getState().addTask(makeTask({ id: 'task-1' }));
    const activity = makeActivity({ label: 'ReadFile' });
    useActivityStore.getState().appendActivity('task-1', activity);

    const task = useActivityStore.getState().tasks[0];
    expect(task.activities).toHaveLength(1);
    expect(task.activities[0].label).toBe('ReadFile');
  });

  it('trims activities to 200 entries keeping the newest', () => {
    useActivityStore.getState().addTask(makeTask({ id: 'task-1' }));

    for (let i = 0; i < 210; i++) {
      useActivityStore.getState().appendActivity(
        'task-1',
        makeActivity({ label: `activity-${i}` }),
      );
    }

    const task = useActivityStore.getState().tasks[0];
    expect(task.activities.length).toBe(200);
    // The first 10 should have been trimmed
    expect(task.activities[0].label).toBe('activity-10');
    expect(task.activities[199].label).toBe('activity-209');
  });

  it('does nothing for a non-existent task id', () => {
    useActivityStore.getState().addTask(makeTask({ id: 'task-1' }));
    useActivityStore.getState().appendActivity('non-existent', makeActivity());

    expect(useActivityStore.getState().tasks[0].activities).toHaveLength(0);
  });
});

// ===========================================================================
// completeLastActivity
// ===========================================================================

describe('completeLastActivity', () => {
  it('marks the last running activity as done', () => {
    useActivityStore.getState().addTask(makeTask({ id: 'task-1' }));
    useActivityStore.getState().appendActivity('task-1', makeActivity({ label: 'a1', status: 'done' }));
    useActivityStore.getState().appendActivity('task-1', makeActivity({ label: 'a2', status: 'running' }));

    useActivityStore.getState().completeLastActivity('task-1');

    const activities = useActivityStore.getState().tasks[0].activities;
    expect(activities[0].status).toBe('done');
    expect(activities[1].status).toBe('done');
  });

  it('only completes the last running activity, not all', () => {
    useActivityStore.getState().addTask(makeTask({ id: 'task-1' }));
    useActivityStore.getState().appendActivity('task-1', makeActivity({ label: 'a1', status: 'running' }));
    useActivityStore.getState().appendActivity('task-1', makeActivity({ label: 'a2', status: 'running' }));

    useActivityStore.getState().completeLastActivity('task-1');

    const activities = useActivityStore.getState().tasks[0].activities;
    expect(activities[0].status).toBe('running');
    expect(activities[1].status).toBe('done');
  });
});

// ===========================================================================
// setLastActivityApprovalMode
// ===========================================================================

describe('setLastActivityApprovalMode', () => {
  it('patches approvalMode on the most recent running activity', () => {
    useActivityStore.getState().addTask(makeTask({ id: 'task-1' }));
    useActivityStore.getState().appendActivity('task-1', makeActivity({ label: 'a1', status: 'done' }));
    useActivityStore.getState().appendActivity('task-1', makeActivity({ label: 'a2', status: 'running' }));

    useActivityStore.getState().setLastActivityApprovalMode('task-1', 'user');

    const activities = useActivityStore.getState().tasks[0].activities;
    // Patched the running one, not the earlier completed one
    expect(activities[0].approvalMode).toBeUndefined();
    expect(activities[1].approvalMode).toBe('user');
  });

  it('falls back to the last activity when none are running', () => {
    useActivityStore.getState().addTask(makeTask({ id: 'task-1' }));
    useActivityStore.getState().appendActivity('task-1', makeActivity({ label: 'a1', status: 'done' }));
    useActivityStore.getState().appendActivity('task-1', makeActivity({ label: 'a2', status: 'done' }));

    useActivityStore.getState().setLastActivityApprovalMode('task-1', 'denied');

    const activities = useActivityStore.getState().tasks[0].activities;
    expect(activities[0].approvalMode).toBeUndefined();
    expect(activities[1].approvalMode).toBe('denied');
  });

  it('supports all three approval modes', () => {
    useActivityStore.getState().addTask(makeTask({ id: 't-auto' }));
    useActivityStore.getState().appendActivity('t-auto', makeActivity());
    useActivityStore.getState().setLastActivityApprovalMode('t-auto', 'auto');

    useActivityStore.getState().addTask(makeTask({ id: 't-user' }));
    useActivityStore.getState().appendActivity('t-user', makeActivity());
    useActivityStore.getState().setLastActivityApprovalMode('t-user', 'user');

    useActivityStore.getState().addTask(makeTask({ id: 't-den' }));
    useActivityStore.getState().appendActivity('t-den', makeActivity());
    useActivityStore.getState().setLastActivityApprovalMode('t-den', 'denied');

    const all = useActivityStore.getState().tasks;
    expect(all.find((t) => t.id === 't-auto')?.activities[0].approvalMode).toBe('auto');
    expect(all.find((t) => t.id === 't-user')?.activities[0].approvalMode).toBe('user');
    expect(all.find((t) => t.id === 't-den')?.activities[0].approvalMode).toBe('denied');
  });

  it('does nothing when the task has no activities', () => {
    useActivityStore.getState().addTask(makeTask({ id: 'empty' }));
    useActivityStore.getState().setLastActivityApprovalMode('empty', 'auto');
    expect(useActivityStore.getState().tasks[0].activities).toEqual([]);
  });

  it('does nothing for a non-existent task', () => {
    useActivityStore.getState().addTask(makeTask({ id: 'task-1' }));
    useActivityStore.getState().appendActivity('task-1', makeActivity());
    useActivityStore.getState().setLastActivityApprovalMode('nonexistent', 'auto');
    // Untouched
    expect(useActivityStore.getState().tasks[0].activities[0].approvalMode).toBeUndefined();
  });
});

// ===========================================================================
// approvalMode is preserved on appendActivity / persistence
// ===========================================================================

describe('approvalMode preservation', () => {
  it('appendActivity retains approvalMode passed in', () => {
    useActivityStore.getState().addTask(makeTask({ id: 'task-1' }));
    useActivityStore.getState().appendActivity('task-1', {
      ...makeActivity({ label: 'ReadFile' }),
      approvalMode: 'auto',
    });
    useActivityStore.getState().appendActivity('task-1', {
      ...makeActivity({ label: 'WriteFile' }),
      approvalMode: 'user',
    });
    useActivityStore.getState().appendActivity('task-1', {
      ...makeActivity({ label: 'Denied', status: 'error' }),
      approvalMode: 'denied',
    });

    const activities = useActivityStore.getState().tasks[0].activities;
    expect(activities[0].approvalMode).toBe('auto');
    expect(activities[1].approvalMode).toBe('user');
    expect(activities[2].approvalMode).toBe('denied');
  });
});

// ===========================================================================
// completeAllActivities
// ===========================================================================

describe('completeAllActivities', () => {
  it('marks all running activities as done', () => {
    useActivityStore.getState().addTask(makeTask({ id: 'task-1' }));
    useActivityStore.getState().appendActivity('task-1', makeActivity({ status: 'running' }));
    useActivityStore.getState().appendActivity('task-1', makeActivity({ status: 'running' }));
    useActivityStore.getState().appendActivity('task-1', makeActivity({ status: 'info' }));

    useActivityStore.getState().completeAllActivities('task-1');

    const activities = useActivityStore.getState().tasks[0].activities;
    expect(activities[0].status).toBe('done');
    expect(activities[1].status).toBe('done');
    expect(activities[2].status).toBe('info'); // non-running left unchanged
  });
});

// ===========================================================================
// appendPartialOutput / appendThinkingOutput / setFinalOutput
// ===========================================================================

describe('output operations', () => {
  it('appendPartialOutput accumulates chunks', () => {
    useActivityStore.getState().addTask(makeTask({ id: 'task-1' }));
    useActivityStore.getState().appendPartialOutput('task-1', 'Hello ');
    useActivityStore.getState().appendPartialOutput('task-1', 'world');

    expect(useActivityStore.getState().tasks[0].partialOutput).toBe('Hello world');
  });

  it('appendThinkingOutput accumulates chunks', () => {
    useActivityStore.getState().addTask(makeTask({ id: 'task-1' }));
    useActivityStore.getState().appendThinkingOutput('task-1', 'Let me ');
    useActivityStore.getState().appendThinkingOutput('task-1', 'think...');

    expect(useActivityStore.getState().tasks[0].thinkingOutput).toBe('Let me think...');
  });

  it('setFinalOutput sets output and clears partialOutput', () => {
    useActivityStore.getState().addTask(makeTask({ id: 'task-1' }));
    useActivityStore.getState().appendPartialOutput('task-1', 'partial stuff');
    useActivityStore.getState().setFinalOutput('task-1', 'Final answer');

    const task = useActivityStore.getState().tasks[0];
    expect(task.finalOutput).toBe('Final answer');
    expect(task.partialOutput).toBeUndefined();
  });
});

// ===========================================================================
// clearCompleted
// ===========================================================================

describe('clearCompleted', () => {
  it('removes all non-running tasks', () => {
    useActivityStore.getState().addTask(makeTask({ id: 'running-1', status: 'running' }));
    useActivityStore.getState().addTask(makeTask({ id: 'done-1', status: 'done' }));
    useActivityStore.getState().addTask(makeTask({ id: 'error-1', status: 'error' }));
    useActivityStore.getState().addTask(makeTask({ id: 'cancelled-1', status: 'cancelled' }));

    useActivityStore.getState().clearCompleted();

    const tasks = useActivityStore.getState().tasks;
    expect(tasks).toHaveLength(1);
    expect(tasks[0].id).toBe('running-1');
  });
});

// ===========================================================================
// removeTask
// ===========================================================================

describe('removeTask', () => {
  it('removes a task by id', () => {
    useActivityStore.getState().addTask(makeTask({ id: 'task-1' }));
    useActivityStore.getState().addTask(makeTask({ id: 'task-2' }));
    useActivityStore.getState().removeTask('task-1');

    const tasks = useActivityStore.getState().tasks;
    expect(tasks).toHaveLength(1);
    expect(tasks[0].id).toBe('task-2');
  });
});

// ===========================================================================
// resetTaskForContinuation
// ===========================================================================

describe('resetTaskForContinuation', () => {
  it('resets a task to running and clears outputs', () => {
    useActivityStore.getState().addTask(makeTask({ id: 'task-1', status: 'running' }));
    useActivityStore.getState().appendPartialOutput('task-1', 'partial');
    useActivityStore.getState().appendThinkingOutput('task-1', 'thinking');
    useActivityStore.getState().setFinalOutput('task-1', 'final');
    useActivityStore.getState().updateTaskStatus('task-1', 'done');

    useActivityStore.getState().resetTaskForContinuation('task-1');

    const task = useActivityStore.getState().tasks[0];
    expect(task.status).toBe('running');
    expect(task.partialOutput).toBeUndefined();
    expect(task.finalOutput).toBeUndefined();
    expect(task.thinkingOutput).toBeUndefined();
    expect(task.completedAt).toBeUndefined();
  });
});

// ===========================================================================
// Persistence: partialize
// ===========================================================================

describe('persistence — partialize', () => {
  it('clears partialOutput and thinkingOutput in persisted state', async () => {
    vi.useRealTimers();

    useActivityStore.getState().addTask(makeTask({ id: 'task-1', status: 'running' }));
    useActivityStore.getState().appendPartialOutput('task-1', 'streaming...');
    useActivityStore.getState().appendThinkingOutput('task-1', 'reasoning...');
    useActivityStore.getState().setFinalOutput('task-1', 'Final answer');

    // setFinalOutput clears partialOutput, so add more partial for a second task
    useActivityStore.getState().addTask(makeTask({ id: 'task-2', status: 'running' }));
    useActivityStore.getState().appendPartialOutput('task-2', 'in progress');
    useActivityStore.getState().appendThinkingOutput('task-2', 'pondering');

    await waitForPersist();

    const raw = localStorageMock.getItem('notesage-activity');
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(raw!);

    // partialOutput and thinkingOutput should be empty strings in persisted state
    for (const task of parsed.state.tasks) {
      expect(task.partialOutput).toBe('');
      expect(task.thinkingOutput).toBe('');
    }

    // finalOutput should be persisted
    const task1 = parsed.state.tasks.find((t: AgentTask) => t.id === 'task-1');
    expect(task1.finalOutput).toBe('Final answer');
  });

  it('excludes recording items from persisted state but keeps transcription + agent tasks', async () => {
    vi.useRealTimers();

    // Live recording capture — never resumable, must not survive a restart.
    useActivityStore.getState().addRecordingItem({ id: 'rec-1', label: 'Recording' });
    // Transcription job + agent task — must stay persisted.
    useActivityStore
      .getState()
      .addTranscriptionJob({ id: 'trx-1', label: 'Transcribing', audioPath: '/tmp/a.wav' });
    useActivityStore.getState().addTask(makeTask({ id: 'agent-1', status: 'running' }));

    await waitForPersist();

    const raw = localStorageMock.getItem('notesage-activity');
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(raw!);
    const ids = parsed.state.tasks.map((t: AgentTask) => t.id);

    expect(ids).not.toContain('rec-1');
    expect(ids).toContain('trx-1');
    expect(ids).toContain('agent-1');
    expect(parsed.state.tasks.some((t: AgentTask) => t.kind === 'recording')).toBe(false);
  });
});

// ===========================================================================
// Persistence: rehydration
// ===========================================================================

describe('persistence — rehydration', () => {
  it('marks running tasks as error on rehydration', async () => {
    vi.useRealTimers();

    useActivityStore.getState().addTask(makeTask({ id: 'running-task', status: 'running' }));
    useActivityStore.getState().addTask(makeTask({ id: 'done-task', status: 'done' }));
    useActivityStore.getState().updateTaskStatus('done-task', 'done');

    await waitForPersist();
    await simulateRestart(DEFAULTS);

    const tasks = useActivityStore.getState().tasks;
    const runningTask = tasks.find((t) => t.id === 'running-task');
    const doneTask = tasks.find((t) => t.id === 'done-task');

    expect(runningTask?.status).toBe('error');
    expect(runningTask?.completedAt).toBeDefined();
    expect(doneTask?.status).toBe('done');
  });

  it('marks running activities as error on rehydration of running tasks', async () => {
    vi.useRealTimers();

    useActivityStore.getState().addTask(makeTask({ id: 'task-1', status: 'running' }));
    useActivityStore.getState().appendActivity('task-1', makeActivity({ label: 'a1', status: 'running' }));
    useActivityStore.getState().appendActivity('task-1', makeActivity({ label: 'a2', status: 'done' }));

    await waitForPersist();
    await simulateRestart(DEFAULTS);

    const activities = useActivityStore.getState().tasks[0].activities;
    expect(activities[0].status).toBe('error');
    expect(activities[1].status).toBe('done');
  });

  it('prunes completed tasks older than 7 days', async () => {
    vi.useRealTimers();

    const now = Date.now();
    const eightDaysAgo = now - 8 * 24 * 60 * 60 * 1000;
    const twoDaysAgo = now - 2 * 24 * 60 * 60 * 1000;

    // Directly set tasks with old completedAt timestamps
    useActivityStore.setState({
      tasks: [
        {
          id: 'old-task',
          kind: 'agent' as const,
          type: 'comment' as const,
          label: 'Old',
          status: 'done' as const,
          activities: [],
          startedAt: eightDaysAgo,
          completedAt: eightDaysAgo,
        },
        {
          id: 'recent-task',
          kind: 'agent' as const,
          type: 'comment' as const,
          label: 'Recent',
          status: 'done' as const,
          activities: [],
          startedAt: twoDaysAgo,
          completedAt: twoDaysAgo,
        },
      ],
    });

    await waitForPersist();
    await simulateRestart(DEFAULTS);

    const tasks = useActivityStore.getState().tasks;
    expect(tasks.find((t) => t.id === 'old-task')).toBeUndefined();
    expect(tasks.find((t) => t.id === 'recent-task')).toBeDefined();
  });

  it('preserves partialOutput as finalOutput for interrupted running tasks', async () => {
    vi.useRealTimers();

    useActivityStore.getState().addTask(makeTask({ id: 'task-1', status: 'running' }));
    useActivityStore.getState().appendPartialOutput('task-1', 'partial content');

    // Manually set the storage to simulate what partialize does but with partialOutput
    // (partialize sets partialOutput to '' but the rehydration code checks for it)
    await waitForPersist();

    // Manually inject partialOutput into the persisted data to simulate
    // a scenario where partialOutput was saved (e.g., before partialize was added)
    const raw = localStorageMock.getItem('notesage-activity');
    const parsed = JSON.parse(raw!);
    const task = parsed.state.tasks.find((t: AgentTask) => t.id === 'task-1');
    task.partialOutput = 'partial content';
    localStorageMock.setItem('notesage-activity', JSON.stringify(parsed));

    useActivityStore.setState(DEFAULTS);
    await waitForPersist();
    localStorageMock.setItem('notesage-activity', JSON.stringify(parsed));
    await useActivityStore.persist.rehydrate();
    await waitForPersist();

    const rehydratedTask = useActivityStore.getState().tasks.find((t) => t.id === 'task-1');
    expect(rehydratedTask?.status).toBe('error');
    // partialOutput becomes finalOutput on rehydration for running tasks
    expect(rehydratedTask?.finalOutput).toBe('partial content');
    expect(rehydratedTask?.partialOutput).toBeUndefined();
  });
});

// ===========================================================================
// kind discriminator — defaulting + new lifecycle kinds
// ===========================================================================

describe('kind discriminator', () => {
  it("addTask defaults kind to 'agent' when omitted", () => {
    useActivityStore.getState().addTask(makeTask({ id: 'agent-1' }));
    expect(useActivityStore.getState().tasks[0].kind).toBe('agent');
  });

  it('addTask preserves an explicitly-passed kind', () => {
    useActivityStore.getState().addTask({ ...makeTask({ id: 'k-1' }), kind: 'transcription' });
    expect(useActivityStore.getState().tasks[0].kind).toBe('transcription');
  });

  it('keeps existing agent-task behavior byte-identical (activities, prepend, prune)', () => {
    useActivityStore.getState().addTask(makeTask({ id: 'a', status: 'running' }));
    useActivityStore.getState().addTask(makeTask({ id: 'b', status: 'running' }));
    const tasks = useActivityStore.getState().tasks;
    expect(tasks[0].id).toBe('b');
    expect(tasks[1].id).toBe('a');
    expect(tasks[0].activities).toEqual([]);
    expect(tasks[0].kind).toBe('agent');
    // agent tasks carry none of the transcription/recording optional fields
    expect(tasks[0].progress).toBeUndefined();
    expect(tasks[0].audioPath).toBeUndefined();
    expect(tasks[0].recordingStartedAt).toBeUndefined();
  });
});

// ===========================================================================
// transcription job lifecycle
// ===========================================================================

describe('transcription jobs', () => {
  it('addTranscriptionJob creates a running transcription with audioPath + progress 0', () => {
    vi.setSystemTime(new Date('2026-05-30T14:00:00Z'));
    useActivityStore.getState().addTranscriptionJob({
      id: 'tx-1',
      label: 'Meeting 2026-05-30',
      audioPath: '/Users/me/Notesage/Recordings/m1/audio.wav',
      documentId: 'doc-1',
    });

    const task = useActivityStore.getState().tasks[0];
    expect(task.kind).toBe('transcription');
    expect(task.status).toBe('running');
    expect(task.audioPath).toBe('/Users/me/Notesage/Recordings/m1/audio.wav');
    expect(task.documentId).toBe('doc-1');
    expect(task.progress).toBe(0);
    expect(task.activities).toEqual([]);
    expect(task.startedAt).toBe(Date.now());
    expect(task.transcriptPath).toBeUndefined();
  });

  it('setTranscriptionProgress updates progress and clamps to 0–100', () => {
    useActivityStore.getState().addTranscriptionJob({ id: 'tx-1', label: 'x', audioPath: '/a.wav' });

    useActivityStore.getState().setTranscriptionProgress('tx-1', 42);
    expect(useActivityStore.getState().tasks[0].progress).toBe(42);

    useActivityStore.getState().setTranscriptionProgress('tx-1', 150);
    expect(useActivityStore.getState().tasks[0].progress).toBe(100);

    useActivityStore.getState().setTranscriptionProgress('tx-1', -5);
    expect(useActivityStore.getState().tasks[0].progress).toBe(0);
  });

  it('setTranscriptionDone marks done, sets transcriptPath, progress 100, completedAt', () => {
    vi.setSystemTime(new Date('2026-05-30T14:05:00Z'));
    useActivityStore.getState().addTranscriptionJob({ id: 'tx-1', label: 'x', audioPath: '/a.wav' });
    useActivityStore.getState().setTranscriptionProgress('tx-1', 60);

    useActivityStore.getState().setTranscriptionDone('tx-1', '/Recordings/m1/transcript.md');

    const task = useActivityStore.getState().tasks[0];
    expect(task.status).toBe('done');
    expect(task.progress).toBe(100);
    expect(task.transcriptPath).toBe('/Recordings/m1/transcript.md');
    expect(task.completedAt).toBe(Date.now());
  });

  it('setTranscriptionDone stores the detected language when provided', () => {
    useActivityStore.getState().addTranscriptionJob({ id: 'tx-1', label: 'x', audioPath: '/a.wav' });
    useActivityStore.getState().setTranscriptionDone('tx-1', '/t.md', 'sv');

    expect(useActivityStore.getState().tasks[0].detectedLanguage).toBe('sv');
  });

  it('setTranscriptionDone leaves detectedLanguage undefined when not provided', () => {
    useActivityStore.getState().addTranscriptionJob({ id: 'tx-1', label: 'x', audioPath: '/a.wav' });
    useActivityStore.getState().setTranscriptionDone('tx-1', '/t.md');

    expect(useActivityStore.getState().tasks[0].detectedLanguage).toBeUndefined();
  });

  it('setTranscriptionError marks the job as error with completedAt', () => {
    useActivityStore.getState().addTranscriptionJob({ id: 'tx-1', label: 'x', audioPath: '/a.wav' });
    useActivityStore.getState().setTranscriptionError('tx-1');

    const task = useActivityStore.getState().tasks[0];
    expect(task.status).toBe('error');
    expect(task.completedAt).toBeDefined();
  });

  it('round-trips a transcription job through persist (partialize + rehydrate)', async () => {
    vi.useRealTimers();

    useActivityStore.getState().addTranscriptionJob({
      id: 'tx-1',
      label: 'Meeting',
      audioPath: '/a.wav',
    });
    useActivityStore.getState().setTranscriptionDone('tx-1', '/t.md');

    await waitForPersist();
    await simulateRestart(DEFAULTS);

    const task = useActivityStore.getState().tasks.find((t) => t.id === 'tx-1');
    expect(task?.kind).toBe('transcription');
    expect(task?.status).toBe('done');
    expect(task?.audioPath).toBe('/a.wav');
    expect(task?.transcriptPath).toBe('/t.md');
    expect(task?.progress).toBe(100);
  });
});

// ===========================================================================
// recording item lifecycle
// ===========================================================================

describe('recording items', () => {
  it('addRecordingItem creates a running recording with recordingStartedAt', () => {
    vi.setSystemTime(new Date('2026-05-30T14:00:00Z'));
    useActivityStore.getState().addRecordingItem({ id: 'rec-1', label: 'Recording' });

    const task = useActivityStore.getState().tasks[0];
    expect(task.kind).toBe('recording');
    expect(task.status).toBe('running');
    expect(task.recordingStartedAt).toBe(Date.now());
  });

  it('addRecordingItem honors an explicit recordingStartedAt', () => {
    useActivityStore.getState().addRecordingItem({ id: 'rec-1', label: 'r', recordingStartedAt: 12345 });
    expect(useActivityStore.getState().tasks[0].recordingStartedAt).toBe(12345);
  });

  it('removeRecordingItem removes only the matching recording item', () => {
    useActivityStore.getState().addTask(makeTask({ id: 'agent-1' }));
    useActivityStore.getState().addRecordingItem({ id: 'rec-1', label: 'r' });

    useActivityStore.getState().removeRecordingItem('rec-1');

    const tasks = useActivityStore.getState().tasks;
    expect(tasks.find((t) => t.id === 'rec-1')).toBeUndefined();
    expect(tasks.find((t) => t.id === 'agent-1')).toBeDefined();
  });

  it('removeRecordingItem does not remove an agent task with the same id', () => {
    useActivityStore.getState().addTask(makeTask({ id: 'shared' }));
    useActivityStore.getState().removeRecordingItem('shared');
    expect(useActivityStore.getState().tasks.find((t) => t.id === 'shared')).toBeDefined();
  });
});

// ===========================================================================
// v1 → v2 migration — backfill kind: 'agent'
// ===========================================================================

describe('v1 → v2 migration', () => {
  it("backfills kind: 'agent' on rehydrate for tasks missing it", async () => {
    vi.useRealTimers();

    // Hand-craft a v1 persisted blob (version 1, tasks without `kind`).
    const v1Blob = {
      state: {
        tasks: [
          {
            id: 'legacy-1',
            type: 'comment',
            label: 'Legacy task',
            status: 'done',
            activities: [],
            startedAt: Date.now() - 1000,
            completedAt: Date.now() - 500,
          },
          {
            id: 'legacy-2',
            type: 'chat',
            label: 'Another legacy',
            status: 'done',
            activities: [],
            startedAt: Date.now() - 1000,
            completedAt: Date.now() - 500,
          },
        ],
      },
      version: 1,
    };
    // Reset in-memory state first, THEN write the v1 blob — a setState after
    // this point would persist a fresh v2 envelope and clobber the blob.
    useActivityStore.setState(DEFAULTS);
    await waitForPersist();
    localStorageMock.setItem('notesage-activity', JSON.stringify(v1Blob));
    await useActivityStore.persist.rehydrate();
    await waitForPersist();

    const tasks = useActivityStore.getState().tasks;
    expect(tasks.find((t) => t.id === 'legacy-1')?.kind).toBe('agent');
    expect(tasks.find((t) => t.id === 'legacy-2')?.kind).toBe('agent');
  });

  it('leaves an explicit kind untouched during migration', async () => {
    vi.useRealTimers();

    const blob = {
      state: {
        tasks: [
          {
            id: 'tx-legacy',
            kind: 'transcription',
            type: 'workflow',
            label: 'Transcription',
            status: 'done',
            audioPath: '/a.wav',
            transcriptPath: '/t.md',
            progress: 100,
            activities: [],
            startedAt: Date.now() - 1000,
            completedAt: Date.now() - 500,
          },
        ],
      },
      version: 1,
    };
    useActivityStore.setState(DEFAULTS);
    await waitForPersist();
    localStorageMock.setItem('notesage-activity', JSON.stringify(blob));
    await useActivityStore.persist.rehydrate();
    await waitForPersist();

    const task = useActivityStore.getState().tasks.find((t) => t.id === 'tx-legacy');
    expect(task?.kind).toBe('transcription');
    expect(task?.transcriptPath).toBe('/t.md');
  });
});

// `setManuallyHidden` describe deleted with Classic Layout removal (#325).
// The flag was ActivityStrip's hide state; ActivityStrip is gone and the
// AgentOrb popover open/closed state lives in the agent-orb-events bus.
