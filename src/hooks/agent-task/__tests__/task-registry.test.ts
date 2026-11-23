import { describe, it, expect, vi } from 'vitest';
import {
  AgentTaskRegistry,
  MAX_FINISHED_TASKS,
  agentTaskRegistry,
  resetAgentTaskRegistry,
  type InternalTask,
} from '@/hooks/agent-task/task-registry';

// ---------------------------------------------------------------------------
// AgentTaskRegistry owns the non-serializable runtime handles for background
// agent tasks (mutable task records + per-task cleanup closures). The composed
// `useAgentTaskOperations` integration tests only exercise the happy path; these
// unit tests lock the map semantics the integration tests never assert directly:
// cleanup idempotency, unknown-task no-ops, re-register replacement, and the
// throw-tolerant reset.
// ---------------------------------------------------------------------------

function makeTask(overrides: Partial<InternalTask> = {}): InternalTask {
  return {
    id: 'task-1',
    prompt: 'do the thing',
    status: 'running',
    instanceId: null,
    sessionId: null,
    output: '',
    createdAt: Date.now(),
    ...overrides,
  };
}

describe('AgentTaskRegistry task records', () => {
  it('stores and retrieves a task by id', () => {
    const reg = new AgentTaskRegistry();
    const task = makeTask();
    reg.setTask(task);
    expect(reg.getTask('task-1')).toBe(task);
  });

  it('returns undefined for an unknown task id', () => {
    const reg = new AgentTaskRegistry();
    expect(reg.getTask('nope')).toBeUndefined();
  });

  it('replaces a task record when setTask is called again with the same id', () => {
    const reg = new AgentTaskRegistry();
    const first = makeTask({ output: 'old' });
    const second = makeTask({ output: 'new' });
    reg.setTask(first);
    reg.setTask(second);
    expect(reg.getTask('task-1')).toBe(second);
    expect(reg.getTask('task-1')?.output).toBe('new');
  });

  it('exposes the live record so strategies can append output in place', () => {
    const reg = new AgentTaskRegistry();
    const task = makeTask({ output: '' });
    reg.setTask(task);
    // Simulate a stream chunk mutating the record in place.
    reg.getTask('task-1')!.output += 'chunk';
    expect(task.output).toBe('chunk');
  });
});

// Finished records hold the full prompt and output; before the cap, only the
// test-only `reset()` ever removed one, so they accumulated for the app's
// lifetime (audit 2026-11-22 §1).
describe('AgentTaskRegistry finished-task retention', () => {
  it('drops the oldest finished records beyond the cap', () => {
    const reg = new AgentTaskRegistry();
    const total = MAX_FINISHED_TASKS + 5;
    for (let i = 0; i < total; i++) {
      reg.setTask(makeTask({ id: `task-${i}`, status: 'completed', output: 'x'.repeat(10) }));
    }
    // The 5 oldest are gone, the newest MAX_FINISHED_TASKS remain.
    for (let i = 0; i < 5; i++) expect(reg.getTask(`task-${i}`)).toBeUndefined();
    for (let i = 5; i < total; i++) expect(reg.getTask(`task-${i}`)).toBeDefined();
  });

  it('counts failed and cancelled records as finished', () => {
    const reg = new AgentTaskRegistry();
    const statuses = ['completed', 'failed', 'cancelled'] as const;
    for (let i = 0; i < MAX_FINISHED_TASKS + 3; i++) {
      reg.setTask(makeTask({ id: `task-${i}`, status: statuses[i % 3] }));
    }
    expect(reg.getTask('task-0')).toBeUndefined();
    expect(reg.getTask('task-2')).toBeUndefined();
    expect(reg.getTask('task-3')).toBeDefined();
  });

  it('never drops a running or pending task, however old', () => {
    const reg = new AgentTaskRegistry();
    reg.setTask(makeTask({ id: 'old-running', status: 'running' }));
    reg.setTask(makeTask({ id: 'old-pending', status: 'pending' }));
    for (let i = 0; i < MAX_FINISHED_TASKS * 2; i++) {
      reg.setTask(makeTask({ id: `task-${i}`, status: 'completed' }));
    }
    expect(reg.getTask('old-running')).toBeDefined();
    expect(reg.getTask('old-pending')).toBeDefined();
  });

  it('evicts a task that finished after it was registered (status mutated in place)', () => {
    const reg = new AgentTaskRegistry();
    const first = makeTask({ id: 'first', status: 'running' });
    reg.setTask(first);
    first.status = 'completed';
    for (let i = 0; i < MAX_FINISHED_TASKS; i++) {
      reg.setTask(makeTask({ id: `task-${i}`, status: 'failed' }));
    }
    expect(reg.getTask('first')).toBeUndefined();
  });

  it('keeps a cleanup callable for an evicted record', () => {
    const reg = new AgentTaskRegistry();
    const cleanup = vi.fn();
    reg.setTask(makeTask({ id: 'first', status: 'cancelled' }));
    reg.registerCleanup('first', cleanup);
    for (let i = 0; i < MAX_FINISHED_TASKS; i++) {
      reg.setTask(makeTask({ id: `task-${i}`, status: 'completed' }));
    }
    expect(reg.getTask('first')).toBeUndefined();
    reg.runCleanup('first');
    expect(cleanup).toHaveBeenCalledOnce();
  });
});

describe('AgentTaskRegistry cleanup', () => {
  it('runs the registered cleanup exactly once', () => {
    const reg = new AgentTaskRegistry();
    const cleanup = vi.fn();
    reg.registerCleanup('task-1', cleanup);

    reg.runCleanup('task-1');
    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it('is idempotent — a second runCleanup for the same task is a no-op', () => {
    const reg = new AgentTaskRegistry();
    const cleanup = vi.fn();
    reg.registerCleanup('task-1', cleanup);

    reg.runCleanup('task-1');
    reg.runCleanup('task-1');
    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it('runCleanup for an unknown task is a no-op (does not throw)', () => {
    const reg = new AgentTaskRegistry();
    expect(() => reg.runCleanup('unknown')).not.toThrow();
  });

  it('re-registering replaces the previous closure — only the latest runs', () => {
    const reg = new AgentTaskRegistry();
    const stale = vi.fn();
    const fresh = vi.fn();
    reg.registerCleanup('task-1', stale);
    reg.registerCleanup('task-1', fresh);

    reg.runCleanup('task-1');
    expect(stale).not.toHaveBeenCalled();
    expect(fresh).toHaveBeenCalledTimes(1);
  });

  it('scopes cleanups per task id — running one leaves others intact', () => {
    const reg = new AgentTaskRegistry();
    const a = vi.fn();
    const b = vi.fn();
    reg.registerCleanup('task-a', a);
    reg.registerCleanup('task-b', b);

    reg.runCleanup('task-a');
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).not.toHaveBeenCalled();

    reg.runCleanup('task-b');
    expect(b).toHaveBeenCalledTimes(1);
  });
});

describe('AgentTaskRegistry reset', () => {
  it('runs every pending cleanup and drops all task records', () => {
    const reg = new AgentTaskRegistry();
    const a = vi.fn();
    const b = vi.fn();
    reg.setTask(makeTask({ id: 'task-a' }));
    reg.setTask(makeTask({ id: 'task-b' }));
    reg.registerCleanup('task-a', a);
    reg.registerCleanup('task-b', b);

    reg.reset();

    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
    expect(reg.getTask('task-a')).toBeUndefined();
    expect(reg.getTask('task-b')).toBeUndefined();
  });

  it('clears cleanups so a post-reset runCleanup does not re-invoke them', () => {
    const reg = new AgentTaskRegistry();
    const cleanup = vi.fn();
    reg.registerCleanup('task-1', cleanup);

    reg.reset();
    reg.runCleanup('task-1');
    expect(cleanup).toHaveBeenCalledTimes(1); // only the reset ran it
  });

  it('a throwing cleanup does not mask the reset — other cleanups still run and maps clear', () => {
    const reg = new AgentTaskRegistry();
    const boom = vi.fn(() => {
      throw new Error('unlisten blew up');
    });
    const ok = vi.fn();
    reg.setTask(makeTask({ id: 'task-boom' }));
    reg.registerCleanup('task-boom', boom);
    reg.registerCleanup('task-ok', ok);

    expect(() => reg.reset()).not.toThrow();
    expect(boom).toHaveBeenCalledTimes(1);
    expect(ok).toHaveBeenCalledTimes(1);
    expect(reg.getTask('task-boom')).toBeUndefined();
  });
});

describe('shared singleton + resetAgentTaskRegistry', () => {
  it('resetAgentTaskRegistry tears down the exported singleton', () => {
    const cleanup = vi.fn();
    agentTaskRegistry.setTask(makeTask({ id: 'singleton-task' }));
    agentTaskRegistry.registerCleanup('singleton-task', cleanup);

    resetAgentTaskRegistry();

    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(agentTaskRegistry.getTask('singleton-task')).toBeUndefined();
  });
});
