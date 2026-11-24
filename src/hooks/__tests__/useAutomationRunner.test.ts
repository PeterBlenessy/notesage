// @vitest-environment jsdom
/**
 * useAutomationRunner — the wiring between unattended runs and the protections
 * around them: the arm gate, the durable daily cap (SEC-5), write-path
 * resolution (SEC-1), the agent cwd binding (SEC-3), the loop guard and
 * cooperative cancellation.
 *
 * Each protection is unit-tested on its own under `lib/automations/__tests__`;
 * these tests exist because nothing else fails when the HOOK stops calling one
 * of them. The executor, the run queue, the arm check and every store are real
 * — only the IPC surface (`tauriApi`), the agent task hook and notifications
 * are mocked.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import '@/test/tauri-mock';
import { renderHook, act } from '@testing-library/react';
import { emitMockEvent, setMockInvokeHandler } from '@/test/tauri-mock';

interface TaskCallbacks {
  onComplete?: (output: string) => void;
  onError?: (error: string) => void;
}
interface TaskMeta {
  type?: string;
  label?: string;
  projectRoot?: string;
  trackInActivityStore?: boolean;
}

const mocks = vi.hoisted(() => ({
  startTask: vi.fn<(prompt: string, callbacks?: TaskCallbacks, meta?: TaskMeta) => Promise<string>>(),
  resolveAutomationWritePath: vi.fn<(base: string, relPath: string) => Promise<string>>(),
  markSelfWrite: vi.fn<(path: string) => Promise<void>>(),
  pathExists: vi.fn<(path: string) => Promise<boolean>>(),
  readFile: vi.fn<(path: string) => Promise<string>>(),
  writeFile: vi.fn<(path: string, content: string) => Promise<void>>(),
  notify: vi.fn<(...args: unknown[]) => Promise<void>>(),
  notifyAutomation: vi.fn<(title: string, body: string) => Promise<void>>(),
}));

vi.mock('@/hooks/useAgentTaskOperations', () => ({
  useAgentTaskOperations: () => ({ startTask: mocks.startTask }),
}));

vi.mock('@/lib/tauri', () => ({
  tauriApi: {
    resolveAutomationWritePath: mocks.resolveAutomationWritePath,
    markSelfWrite: mocks.markSelfWrite,
    pathExists: mocks.pathExists,
    readFile: mocks.readFile,
    writeFile: mocks.writeFile,
    // The real stores hydrate through tauri-storage; an empty store is fine.
    storeReadBatch: async (): Promise<Record<string, string>> => ({}),
  },
}));

vi.mock('@/lib/notifications', () => ({
  notify: mocks.notify,
  notifyAutomation: mocks.notifyAutomation,
}));

import { useAutomationRunner } from '@/hooks/useAutomationRunner';
import { useAutomationStore } from '@/stores/automation-store';
import { useActivityStore } from '@/stores/activity-store';
import { usePermissionStore } from '@/stores/permission-store';
import { useSettingsStore } from '@/stores/settings-store';
import { runAutomationNow } from '@/lib/automations/run-bridge';
import { armAutomation } from '@/lib/automations/arm';
import { wasAutomationWrite } from '@/lib/automations/loop-guard';
import type { Automation, AutomationRun, AutomationStep } from '@/lib/automations/types';

const HOME = '/Users/tester';
const PROJECT = '/Users/tester/Projects/alpha';
const RESOLVED = '/resolved-by-rust/out.md';

let seq = 0;

function makeAutomation(overrides: Partial<Automation> = {}): Automation {
  seq += 1;
  return {
    id: `auto-${seq}`,
    name: `Automation ${seq}`,
    enabled: true,
    armed: false,
    scope: PROJECT,
    mode: 'single',
    // A schedule trigger so the event-debounce window does not apply.
    trigger: { type: 'schedule', cron: '0 8 * * *' },
    guardrails: { maxRunsPerDay: 24, debounceMs: 0, maxStepsPerRun: 25 },
    steps: [],
    sourcePath: `${PROJECT}/.notesage/automations/auto-${seq}.yaml`,
    ...overrides,
  };
}

const writeStep = (
  op: 'create' | 'append' = 'create',
  path = 'notes/out.md',
): AutomationStep => ({
  type: 'document',
  id: 'write',
  op,
  path,
  content: 'NEW',
});

const agentStep = (id: string, prompt: string): AutomationStep => ({ type: 'agent', id, prompt });

function install(...automations: Automation[]) {
  useAutomationStore.setState({ automations });
}

function runs(automation: Automation): AutomationRun[] {
  return useAutomationStore.getState().getRuns(automation.sourcePath);
}

/** Seed `count` finished runs dated today, as the persisted history would hold. */
function seedRunsToday(automation: Automation, count: number, status: AutomationRun['status']) {
  const now = Date.now();
  for (let i = 0; i < count; i++) {
    useAutomationStore.getState().recordRun({
      runId: `${automation.sourcePath}#seed-${status}-${i}`,
      automationId: automation.id,
      sourcePath: automation.sourcePath,
      startedAt: now - i,
      completedAt: now - i,
      status,
      trigger: { type: 'schedule' },
      steps: [],
    });
  }
}

/** Let the fire-and-forget request (arm hash, queue, executor) run to rest. */
async function settle() {
  await act(async () => {
    for (let i = 0; i < 5; i++) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  });
}

async function runNow(automation: Automation) {
  runAutomationNow(automation.sourcePath);
  await settle();
}

function activityTasks(automation: Automation) {
  return useActivityStore.getState().tasks.filter((t) => t.sourceFile === automation.sourcePath);
}

function activityStatuses(automation: Automation) {
  return activityTasks(automation).map((t) => t.status);
}

describe('useAutomationRunner', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    setMockInvokeHandler('store_write', () => undefined);
    setMockInvokeHandler('store_delete', () => undefined);
    mocks.resolveAutomationWritePath.mockResolvedValue(RESOLVED);
    mocks.markSelfWrite.mockResolvedValue(undefined);
    mocks.pathExists.mockResolvedValue(false);
    mocks.readFile.mockResolvedValue('');
    mocks.writeFile.mockResolvedValue(undefined);
    mocks.notify.mockResolvedValue(undefined);
    mocks.notifyAutomation.mockResolvedValue(undefined);
    mocks.startTask.mockImplementation(async (_prompt, callbacks) => {
      callbacks?.onComplete?.('agent output');
      return 'task-id';
    });

    useAutomationStore.setState({ automations: [], runsByAutomation: {} });
    useActivityStore.setState({ tasks: [] });
    usePermissionStore.setState({ automationArm: {} });
    useSettingsStore.setState({ homeDir: HOME });

    renderHook(() => useAutomationRunner());
    await settle(); // listeners register asynchronously
  });

  describe('arm gate', () => {
    it('skips an unarmed write automation as "not armed" and never writes', async () => {
      const automation = makeAutomation({ steps: [writeStep()] });
      install(automation);

      await runNow(automation);

      const recorded = runs(automation);
      expect(recorded).toHaveLength(1);
      expect(recorded[0].status).toBe('skipped');
      expect(recorded[0].steps[0].result?.output).toBe('not armed');
      expect(mocks.writeFile).not.toHaveBeenCalled();
      expect(mocks.resolveAutomationWritePath).not.toHaveBeenCalled();
      expect(activityStatuses(automation)).toEqual([]);
    });

    it('runs the same automation once it is armed', async () => {
      const automation = makeAutomation({ steps: [writeStep()] });
      install(automation);
      await armAutomation(automation);

      await runNow(automation);

      expect(runs(automation).map((r) => r.status)).toEqual(['done']);
      expect(mocks.writeFile).toHaveBeenCalledTimes(1);
    });

    it('treats an automation edited after arming as not armed', async () => {
      const armed = makeAutomation({ steps: [writeStep()] });
      await armAutomation(armed);
      const edited: Automation = {
        ...armed,
        steps: [writeStep('create', 'somewhere/else.md')],
      };
      install(edited);

      await runNow(edited);

      expect(runs(edited)[0].status).toBe('skipped');
      expect(runs(edited)[0].steps[0].result?.output).toBe('not armed');
      expect(mocks.writeFile).not.toHaveBeenCalled();
    });

    it('does not run a disabled automation at all', async () => {
      const automation = makeAutomation({ enabled: false, steps: [agentStep('a', 'go')] });
      install(automation);

      await runNow(automation);

      expect(runs(automation)).toEqual([]);
      expect(mocks.startTask).not.toHaveBeenCalled();
    });
  });

  describe('durable daily cap (SEC-5)', () => {
    it('skips the run past the default cap of 24, counted from persisted history', async () => {
      const automation = makeAutomation({ steps: [agentStep('a', 'go')] });
      install(automation);
      seedRunsToday(automation, 24, 'done');

      await runNow(automation);

      expect(mocks.startTask).not.toHaveBeenCalled();
      const recorded = runs(automation);
      expect(recorded).toHaveLength(25);
      const skipped = recorded.filter((r) => r.status === 'skipped');
      expect(skipped).toHaveLength(1);
      expect(skipped[0].steps[0].result?.output).toBe('daily limit reached (24/day)');
    });

    it('still runs the 24th run of the day', async () => {
      const automation = makeAutomation({ steps: [agentStep('a', 'go')] });
      install(automation);
      seedRunsToday(automation, 23, 'done');

      await runNow(automation);

      expect(mocks.startTask).toHaveBeenCalledTimes(1);
      expect(runs(automation).filter((r) => r.status === 'skipped')).toEqual([]);
    });

    it("honours the automation's own maxRunsPerDay", async () => {
      const automation = makeAutomation({
        steps: [agentStep('a', 'go')],
        guardrails: { maxRunsPerDay: 2, debounceMs: 0, maxStepsPerRun: 25 },
      });
      install(automation);
      seedRunsToday(automation, 2, 'done');

      await runNow(automation);

      expect(mocks.startTask).not.toHaveBeenCalled();
      const skipped = runs(automation).filter((r) => r.status === 'skipped');
      expect(skipped).toHaveLength(1);
      expect(skipped[0].steps[0].result?.output).toBe('daily limit reached (2/day)');
    });

    it('does not count skipped runs towards the cap', async () => {
      const automation = makeAutomation({
        steps: [agentStep('a', 'go')],
        guardrails: { maxRunsPerDay: 2, debounceMs: 0, maxStepsPerRun: 25 },
      });
      install(automation);
      seedRunsToday(automation, 5, 'skipped');

      await runNow(automation);

      expect(mocks.startTask).toHaveBeenCalledTimes(1);
    });
  });

  describe('guardrails at admission', () => {
    /** Park another automation inside its agent step so the single queue is busy. */
    async function occupyQueue() {
      const parked: TaskCallbacks[] = [];
      mocks.startTask.mockImplementation(async (_prompt, callbacks) => {
        if (callbacks) parked.push(callbacks);
        return 'task-id';
      });
      const blocker = makeAutomation({ steps: [agentStep('block', 'blocker')] });
      return { blocker, parked };
    }

    it('debounces a burst of file events that arrives while the run is still queued', async () => {
      const { blocker, parked } = await occupyQueue();
      const watcher = makeAutomation({
        mode: 'queued',
        trigger: { type: 'file', event: 'file-modified' },
        steps: [agentStep('a', 'react to change')],
      });
      install(blocker, watcher);
      await runNow(blocker);
      expect(mocks.startTask).toHaveBeenCalledTimes(1);

      for (let i = 0; i < 3; i++) {
        emitMockEvent('file-changed-batch', [{ path: `${PROJECT}/notes/burst.md`, kind: 'modify' }]);
        await settle();
      }

      const skipped = runs(watcher).filter((r) => r.status === 'skipped');
      expect(skipped.map((r) => r.steps[0].result?.output)).toEqual(['debounced (60s)', 'debounced (60s)']);

      // Free the queue: exactly one run of the watcher follows.
      parked[0].onComplete?.('blocker done');
      await settle();
      expect(mocks.startTask.mock.calls.map((c) => c[0])).toEqual(['blocker', 'react to change']);
    });

    it('counts queued runs towards the daily cap', async () => {
      const { blocker, parked } = await occupyQueue();
      const automation = makeAutomation({
        mode: 'queued',
        steps: [agentStep('a', 'capped')],
        guardrails: { maxRunsPerDay: 2, debounceMs: 0, maxStepsPerRun: 25 },
      });
      install(blocker, automation);
      seedRunsToday(automation, 1, 'done');
      await runNow(blocker);

      await runNow(automation); // queued: 1 persisted + 1 queued = cap
      await runNow(automation); // must be refused, nothing has been persisted yet

      const skipped = runs(automation).filter((r) => r.status === 'skipped');
      expect(skipped).toHaveLength(1);
      expect(skipped[0].steps[0].result?.output).toBe('daily limit reached (2/day)');

      parked[0].onComplete?.('blocker done');
      await settle();
      expect(mocks.startTask.mock.calls.map((c) => c[0])).toEqual(['blocker', 'capped']);
    });
  });

  describe('write-path resolution (SEC-1)', () => {
    it('writes only to the path resolveAutomationWritePath returned', async () => {
      const automation = makeAutomation({ steps: [writeStep()] });
      install(automation);
      await armAutomation(automation);

      await runNow(automation);

      expect(mocks.resolveAutomationWritePath).toHaveBeenCalledTimes(1);
      expect(mocks.resolveAutomationWritePath).toHaveBeenCalledWith(PROJECT, 'notes/out.md');
      expect(mocks.writeFile.mock.calls).toEqual([[RESOLVED, 'NEW']]);
    });

    it('resolves a global automation against ~/Notesage', async () => {
      const automation = makeAutomation({ scope: 'global', steps: [writeStep()] });
      install(automation);
      await armAutomation(automation);

      await runNow(automation);

      expect(mocks.resolveAutomationWritePath).toHaveBeenCalledWith(
        `${HOME}/Notesage`,
        'notes/out.md',
      );
      expect(mocks.writeFile.mock.calls).toEqual([[RESOLVED, 'NEW']]);
    });

    it('writes nothing and fails the run when the path is rejected', async () => {
      mocks.resolveAutomationWritePath.mockRejectedValue(new Error('path escapes scope'));
      const automation = makeAutomation({
        steps: [writeStep('create', '../../etc/passwd')],
      });
      install(automation);
      await armAutomation(automation);

      await runNow(automation);

      expect(mocks.writeFile).not.toHaveBeenCalled();
      expect(mocks.markSelfWrite).not.toHaveBeenCalled();
      expect(runs(automation)[0].status).toBe('error');
      expect(runs(automation)[0].steps[0].result?.error).toBe('path escapes scope');
      expect(activityStatuses(automation)).toEqual(['error']);
      expect(mocks.notify).toHaveBeenCalledWith(
        'automation_failure',
        `Automation failed: ${automation.name}`,
        'path escapes scope',
      );
    });

    it('marks the resolved path as a self-write before writing it', async () => {
      const automation = makeAutomation({ steps: [writeStep()] });
      install(automation);
      await armAutomation(automation);

      await runNow(automation);

      expect(mocks.markSelfWrite.mock.calls).toEqual([[RESOLVED]]);
      expect(mocks.markSelfWrite.mock.invocationCallOrder[0]).toBeLessThan(
        mocks.writeFile.mock.invocationCallOrder[0],
      );
    });
  });

  describe('append', () => {
    it('reads the existing content first and writes it back with the addition', async () => {
      mocks.pathExists.mockResolvedValue(true);
      mocks.readFile.mockResolvedValue('OLD\n');
      const automation = makeAutomation({ steps: [writeStep('append')] });
      install(automation);
      await armAutomation(automation);

      await runNow(automation);

      expect(mocks.readFile.mock.calls).toEqual([[RESOLVED]]);
      expect(mocks.readFile.mock.invocationCallOrder[0]).toBeLessThan(
        mocks.writeFile.mock.invocationCallOrder[0],
      );
      expect(mocks.writeFile.mock.calls).toEqual([[RESOLVED, 'OLD\nNEW']]);
    });

    it('starts a fresh file when the target does not exist', async () => {
      mocks.pathExists.mockResolvedValue(false);
      const automation = makeAutomation({ steps: [writeStep('append')] });
      install(automation);
      await armAutomation(automation);

      await runNow(automation);

      expect(mocks.readFile).not.toHaveBeenCalled();
      expect(mocks.writeFile.mock.calls).toEqual([[RESOLVED, 'NEW']]);
    });

    it('create does not read, and replaces whatever is there', async () => {
      mocks.pathExists.mockResolvedValue(true);
      mocks.readFile.mockResolvedValue('OLD\n');
      const automation = makeAutomation({ steps: [writeStep('create')] });
      install(automation);
      await armAutomation(automation);

      await runNow(automation);

      expect(mocks.readFile).not.toHaveBeenCalled();
      expect(mocks.writeFile.mock.calls).toEqual([[RESOLVED, 'NEW']]);
    });
  });

  describe('agent cwd binding (SEC-3)', () => {
    it("starts the agent with projectRoot set to the automation's project", async () => {
      const automation = makeAutomation({ scope: PROJECT, steps: [agentStep('a', 'summarise')] });
      install(automation);

      await runNow(automation);

      expect(mocks.startTask).toHaveBeenCalledTimes(1);
      const [prompt, , meta] = mocks.startTask.mock.calls[0];
      expect(prompt).toBe('summarise');
      expect(meta?.projectRoot).toBe(PROJECT);
      expect(runs(automation)[0].status).toBe('done');
      expect(activityStatuses(automation)).toEqual(['done']);
    });

    it('starts a global automation in ~/Notesage, never without a root', async () => {
      const automation = makeAutomation({ scope: 'global', steps: [agentStep('a', 'summarise')] });
      install(automation);

      await runNow(automation);

      expect(mocks.startTask.mock.calls[0][2]?.projectRoot).toBe(`${HOME}/Notesage`);
    });
  });

  describe('cancellation', () => {
    it('an aborted run stops at the next step and is reported as cancelled', async () => {
      const pending: TaskCallbacks[] = [];
      mocks.startTask.mockImplementation(async (_prompt, callbacks) => {
        if (callbacks) pending.push(callbacks);
        return 'task-id';
      });
      const automation = makeAutomation({
        mode: 'restart',
        steps: [agentStep('first', 'step one'), agentStep('second', 'step two')],
      });
      install(automation);

      await runNow(automation); // run 1 is now parked inside its first step
      expect(mocks.startTask).toHaveBeenCalledTimes(1);
      expect(activityStatuses(automation)).toEqual(['running']);
      const firstRunId = runs(automation)[0].runId;
      const firstActivityId = activityTasks(automation)[0].id;

      await runNow(automation); // restart: aborts run 1's signal, queues run 2
      expect(mocks.startTask).toHaveBeenCalledTimes(1);

      // Guarantee run 2 gets its own runId (ids are keyed on the start ms).
      await new Promise((resolve) => setTimeout(resolve, 5));
      pending[0].onComplete?.('one done');
      await settle();

      const first = runs(automation).find((r) => r.runId === firstRunId);
      expect(first?.status).toBe('skipped');
      expect(first?.steps.map((s) => s.id)).toEqual(['first']);
      // Run 1 never reached "step two"; the second startTask is run 2's step one.
      expect(mocks.startTask.mock.calls.map((c) => c[0])).toEqual(['step one', 'step one']);
      const activity = activityTasks(automation);
      expect(activity).toHaveLength(2);
      expect(activity.find((t) => t.id === firstActivityId)?.status).toBe('cancelled');
      expect(activity.find((t) => t.id !== firstActivityId)?.status).toBe('running');
    });
  });

  describe('loop guard', () => {
    it("records the resolved path so the automation's own write cannot re-trigger it", async () => {
      const automation = makeAutomation({ steps: [writeStep()] });
      install(automation);
      await armAutomation(automation);

      await runNow(automation);

      expect(wasAutomationWrite(RESOLVED)).toBe(true);
    });

    it('ignores a watcher event for a file an automation just wrote', async () => {
      const written = `${PROJECT}/notes/loop.md`;
      mocks.resolveAutomationWritePath.mockResolvedValue(written);
      const writer = makeAutomation({ steps: [writeStep('create', 'notes/loop.md')] });
      const watcher = makeAutomation({
        trigger: { type: 'file', event: 'file-modified' },
        steps: [agentStep('a', 'react to change')],
      });
      install(writer, watcher);
      await armAutomation(writer);
      await runNow(writer);
      expect(mocks.writeFile).toHaveBeenCalledTimes(1);

      emitMockEvent('file-changed-batch', [{ path: written, kind: 'modify' }]);
      await settle();
      expect(mocks.startTask).not.toHaveBeenCalled();

      // Control: the same event for a file no automation wrote does fire it.
      emitMockEvent('file-changed-batch', [{ path: `${PROJECT}/notes/other.md`, kind: 'modify' }]);
      await settle();
      expect(mocks.startTask).toHaveBeenCalledTimes(1);
      expect(mocks.startTask.mock.calls[0][0]).toBe('react to change');
    });
  });
});
