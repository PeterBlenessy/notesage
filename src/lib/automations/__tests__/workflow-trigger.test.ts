import { describe, it, expect, beforeEach } from 'vitest';
import { workflowEventMatches } from '../file-match';
import { onWorkflowEvent, type WorkflowEvent } from '../event-bus';
import { useActivityStore } from '@/stores/activity-store';
import type { Automation, WorkflowEventName } from '../types';

function wfAuto(event: WorkflowEventName, over: Partial<Automation> = {}): Automation {
  return {
    id: 'a',
    name: 'A',
    enabled: true,
    armed: true,
    scope: '/proj',
    mode: 'single',
    trigger: { type: 'workflow', event },
    guardrails: { maxRunsPerDay: 50, debounceMs: 0, maxStepsPerRun: 15 },
    steps: [{ id: 's', type: 'notify', title: 't', body: 'b' }],
    sourcePath: '/proj/.notesage/automations/a.yaml',
    ...over,
  };
}

describe('workflowEventMatches', () => {
  it('matches trigger type + event', () => {
    expect(workflowEventMatches(wfAuto('document-saved'), 'document-saved')).toBe(true);
    expect(workflowEventMatches(wfAuto('document-saved'), 'agent-task-complete')).toBe(false);
  });
  it('rejects non-workflow triggers', () => {
    const sched = wfAuto('document-saved', { trigger: { type: 'schedule', cron: '0 8 * * *' } });
    expect(workflowEventMatches(sched, 'document-saved')).toBe(false);
  });
});

describe('agent-task-complete emission guard', () => {
  beforeEach(() => useActivityStore.setState({ tasks: [] }));

  it('emits for a kind:agent task — NEVER for a kind:automation run', () => {
    const seen: WorkflowEvent[] = [];
    const off = onWorkflowEvent((e) => seen.push(e));

    const store = useActivityStore.getState();
    store.addTask({ id: 't1', kind: 'agent', type: 'chat', label: 'A', status: 'running' });
    store.addTask({ id: 't2', kind: 'automation', type: 'workflow', label: 'B', status: 'running' });
    store.updateTaskStatus('t1', 'done');
    store.updateTaskStatus('t2', 'done'); // automation run — must not emit
    off();

    const agentDone = seen.filter((e) => e.event === 'agent-task-complete');
    expect(agentDone).toHaveLength(1);
    expect(agentDone[0]).toMatchObject({ taskId: 't1' });
  });
});
