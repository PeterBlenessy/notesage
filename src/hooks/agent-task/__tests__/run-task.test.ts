// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useActivityStore } from '@/stores/activity-store';
import type { Connection } from '@/lib/ai/connections';
import {
  runAgentTask,
  type AgentTaskStrategy,
  type TaskRunContext,
  type TaskRunHandle,
} from '@/hooks/agent-task/run-task';
import { agentTaskRegistry, resetAgentTaskRegistry } from '@/hooks/agent-task/task-registry';

// ---------------------------------------------------------------------------
// `runAgentTask` owns the shared lifecycle for all three task backends: task
// creation, activity-store mirroring, the complete/fail terminal transitions,
// and cleanup registration. The composed hook tests drive this through the real
// ACP / direct-API strategies, so they never isolate the branches that vary by
// FailOptions/CompleteOptions or the completion latch. Here we inject a fake
// strategy that captures the handle and drives complete()/fail()/cleanup()
// directly.
// ---------------------------------------------------------------------------

vi.mock('@/lib/notifications', () => ({
  notify: vi.fn().mockResolvedValue(undefined),
}));

import { notify } from '@/lib/notifications';

function makeConnection(overrides: Partial<Connection> = {}): Connection {
  return {
    id: 'conn-api',
    provider: 'anthropic',
    authMethod: 'api_key',
    status: 'connected',
    label: 'Test Anthropic',
    credentials: { type: 'api_key', credentialStored: true },
    capabilities: ['interactive', 'agent_tasks'],
    createdAt: Date.now(),
    ...overrides,
  } as Connection;
}

/**
 * Fake strategy that captures the handle so the test body can drive the shared
 * terminal transitions after `runAgentTask` resolves.
 */
function captureStrategy(): { strategy: AgentTaskStrategy; getHandle: () => TaskRunHandle } {
  let captured: TaskRunHandle | null = null;
  const strategy: AgentTaskStrategy = {
    name: 'direct-api',
    run: async (handle) => {
      captured = handle;
    },
  };
  return {
    strategy,
    getHandle: () => {
      if (!captured) throw new Error('strategy.run was not called');
      return captured;
    },
  };
}

function baseCtx(overrides: Partial<TaskRunContext> = {}): TaskRunContext {
  return {
    prompt: 'do the thing',
    connection: makeConnection(),
    ...overrides,
  };
}

/** Flush the queue so the dynamic `import('@/lib/notifications')` inside
 *  complete()/fail() resolves before we assert on the mock. */
async function flush(): Promise<void> {
  await new Promise((r) => setTimeout(r, 0));
  await Promise.resolve();
}

describe('runAgentTask setup', () => {
  beforeEach(() => {
    resetAgentTaskRegistry();
    useActivityStore.setState({ tasks: [] });
    vi.clearAllMocks();
  });

  it('creates a running task record and mirrors it into the activity store by default', async () => {
    const taskId = await runAgentTask(
      baseCtx({ taskMeta: { type: 'comment', label: 'Review code' } }),
      captureStrategy().strategy,
    );

    const record = agentTaskRegistry.getTask(taskId);
    expect(record?.status).toBe('running');
    expect(record?.prompt).toBe('do the thing');

    const tasks = useActivityStore.getState().tasks;
    expect(tasks).toHaveLength(1);
    expect(tasks[0].id).toBe(taskId);
    expect(tasks[0].label).toBe('Review code');
    expect(tasks[0].connectionProvider).toBe('anthropic');
  });

  it('skips activity-store mirroring when trackInActivityStore is false', async () => {
    const taskId = await runAgentTask(
      baseCtx({ taskMeta: { type: 'chat', label: 'x', trackInActivityStore: false } }),
      captureStrategy().strategy,
    );

    // Registry record still exists (backend needs it), but no visible task.
    expect(agentTaskRegistry.getTask(taskId)).toBeDefined();
    expect(useActivityStore.getState().tasks).toHaveLength(0);
  });

  it('reuses an existing activity-store task via existingTaskId (continuation)', async () => {
    useActivityStore.getState().addTask({
      id: 'existing-1',
      type: 'comment',
      label: 'Existing',
      status: 'done',
      connectionProvider: 'anthropic',
    });

    const taskId = await runAgentTask(
      baseCtx({ taskMeta: { type: 'comment', label: 'Continue', existingTaskId: 'existing-1' } }),
      captureStrategy().strategy,
    );

    expect(taskId).toBe('existing-1');
    const tasks = useActivityStore.getState().tasks;
    expect(tasks).toHaveLength(1);
    // resetTaskForContinuation flips the reused task back to running.
    expect(tasks[0].status).toBe('running');
  });
});

describe('runAgentTask complete() latch', () => {
  beforeEach(() => {
    resetAgentTaskRegistry();
    useActivityStore.setState({ tasks: [] });
    vi.clearAllMocks();
  });

  it('returns true on the first complete and false on subsequent calls', async () => {
    const cap = captureStrategy();
    const onComplete = vi.fn();
    const taskId = await runAgentTask(baseCtx({ callbacks: { onComplete } }), cap.strategy);
    const handle = cap.getHandle();
    handle.task.output = 'final answer';

    expect(handle.complete()).toBe(true);
    expect(handle.complete()).toBe(false);
    expect(handle.complete()).toBe(false);

    // onComplete fired exactly once with the accumulated output.
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(onComplete).toHaveBeenCalledWith('final answer');

    expect(agentTaskRegistry.getTask(taskId)?.status).toBe('completed');
    const task = useActivityStore.getState().tasks.find((t) => t.id === taskId);
    expect(task?.status).toBe('done');
    expect(task?.finalOutput).toBe('final answer');
  });

  it('emits an agent_complete activity with a truncated preview', async () => {
    const cap = captureStrategy();
    const onActivity = vi.fn();
    await runAgentTask(baseCtx({ callbacks: { onActivity } }), cap.strategy);
    const handle = cap.getHandle();
    handle.task.output = 'x'.repeat(150);

    handle.complete();

    expect(onActivity).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'agent_complete', kind: 'agent_complete' }),
    );
    const detail = onActivity.mock.calls[0][0].detail as string;
    expect(detail.endsWith('…')).toBe(true);
    expect(detail.length).toBe(101); // 100 chars + ellipsis
  });

  it('fires the completion desktop notification only when notify is set', async () => {
    const cap = captureStrategy();
    await runAgentTask(baseCtx(), cap.strategy);
    const handle = cap.getHandle();
    handle.task.output = 'result';

    handle.complete();
    await flush();
    expect(notify).not.toHaveBeenCalled();

    // A fresh task so the latch does not swallow the second complete.
    const cap2 = captureStrategy();
    await runAgentTask(baseCtx(), cap2.strategy);
    const handle2 = cap2.getHandle();
    handle2.task.output = 'notified result';
    handle2.complete({ notify: true });
    await flush();
    expect(notify).toHaveBeenCalledWith('agent_completion', 'Agent completed', 'notified result');
  });

  it('does not touch the activity store when untracked', async () => {
    const cap = captureStrategy();
    await runAgentTask(
      baseCtx({ taskMeta: { type: 'chat', label: 'x', trackInActivityStore: false } }),
      cap.strategy,
    );
    const handle = cap.getHandle();
    handle.task.output = 'invisible';

    expect(handle.complete()).toBe(true);
    expect(useActivityStore.getState().tasks).toHaveLength(0);
  });
});

describe('runAgentTask fail()', () => {
  beforeEach(() => {
    resetAgentTaskRegistry();
    useActivityStore.setState({ tasks: [] });
    vi.clearAllMocks();
  });

  it('marks the task failed, calls onError, and records the error message when requested', async () => {
    const cap = captureStrategy();
    const onError = vi.fn();
    const taskId = await runAgentTask(baseCtx({ callbacks: { onError } }), cap.strategy);
    const handle = cap.getHandle();

    handle.fail(new Error('agent crashed'), { recordError: true });

    expect(onError).toHaveBeenCalledWith('agent crashed');
    const record = agentTaskRegistry.getTask(taskId);
    expect(record?.status).toBe('failed');
    expect(record?.error).toBe('agent crashed');
    expect(useActivityStore.getState().tasks.find((t) => t.id === taskId)?.status).toBe('error');
  });

  it('does not record error on the task when recordError is omitted', async () => {
    const cap = captureStrategy();
    const taskId = await runAgentTask(baseCtx({ callbacks: { onError: vi.fn() } }), cap.strategy);
    cap.getHandle().fail('plain string error');

    const record = agentTaskRegistry.getTask(taskId);
    expect(record?.status).toBe('failed');
    expect(record?.error).toBeUndefined();
  });

  it('stringifies a non-Error failure value for onError', async () => {
    const cap = captureStrategy();
    const onError = vi.fn();
    await runAgentTask(baseCtx({ callbacks: { onError } }), cap.strategy);
    cap.getHandle().fail({ code: 42 });

    expect(onError).toHaveBeenCalledWith('[object Object]');
  });

  it('completeActivities marks still-running activity-log entries done', async () => {
    const cap = captureStrategy();
    const taskId = await runAgentTask(baseCtx(), cap.strategy);
    // Seed a running activity entry to prove completeActivities drains it.
    useActivityStore.getState().appendActivity(taskId, {
      label: 'doing work',
      status: 'running',
      timestamp: Date.now(),
    });

    cap.getHandle().fail(new Error('boom'), { completeActivities: true });

    const task = useActivityStore.getState().tasks.find((t) => t.id === taskId);
    expect(task?.status).toBe('error');
    expect(task?.activities.every((a) => a.status !== 'running')).toBe(true);
  });

  it('fires the error desktop notification only when notify is set', async () => {
    const cap = captureStrategy();
    await runAgentTask(baseCtx(), cap.strategy);
    cap.getHandle().fail(new Error('silent'));
    await flush();
    expect(notify).not.toHaveBeenCalled();

    const cap2 = captureStrategy();
    await runAgentTask(baseCtx(), cap2.strategy);
    cap2.getHandle().fail(new Error('loud'), { notify: true });
    await flush();
    expect(notify).toHaveBeenCalledWith('agent_error', 'Agent failed', 'loud');
  });

  it('is NOT gated on the completion latch — a late fail after complete still marks failed', async () => {
    const cap = captureStrategy();
    const taskId = await runAgentTask(baseCtx({ callbacks: { onError: vi.fn() } }), cap.strategy);
    const handle = cap.getHandle();

    expect(handle.complete()).toBe(true);
    expect(agentTaskRegistry.getTask(taskId)?.status).toBe('completed');

    // A late prompt rejection still transitions the record to failed.
    handle.fail(new Error('late rejection'), { recordError: true });
    expect(agentTaskRegistry.getTask(taskId)?.status).toBe('failed');
    expect(agentTaskRegistry.getTask(taskId)?.error).toBe('late rejection');
  });

  it('leaves the activity store untouched on fail when untracked', async () => {
    const cap = captureStrategy();
    await runAgentTask(
      baseCtx({ taskMeta: { type: 'chat', label: 'x', trackInActivityStore: false } }),
      cap.strategy,
    );
    cap.getHandle().fail(new Error('boom'), { completeActivities: true, recordError: true });
    expect(useActivityStore.getState().tasks).toHaveLength(0);
  });
});

describe('runAgentTask cleanup registration', () => {
  beforeEach(() => {
    resetAgentTaskRegistry();
    useActivityStore.setState({ tasks: [] });
    vi.clearAllMocks();
  });

  it('registers and runs a cleanup through the handle, idempotently', async () => {
    const cap = captureStrategy();
    const cleanup = vi.fn();
    await runAgentTask(baseCtx(), cap.strategy);
    const handle = cap.getHandle();

    handle.registerCleanup(cleanup);
    handle.runCleanup();
    handle.runCleanup();

    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it('routes cleanup to the same registry entry as the task id (jobId scoping)', async () => {
    const cap = captureStrategy();
    const cleanup = vi.fn();
    const taskId = await runAgentTask(baseCtx(), cap.strategy);
    cap.getHandle().registerCleanup(cleanup);

    // Running cleanup by taskId on the shared registry hits the same closure.
    agentTaskRegistry.runCleanup(taskId);
    expect(cleanup).toHaveBeenCalledTimes(1);
  });
});
