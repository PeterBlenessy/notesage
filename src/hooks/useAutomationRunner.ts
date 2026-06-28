import { useEffect, useRef } from 'react';
import { listen } from '@tauri-apps/api/event';
import { useAgentTaskOperations } from '@/hooks/useAgentTaskOperations';
import { useActivityStore } from '@/stores/activity-store';
import { useAutomationStore } from '@/stores/automation-store';
import { useSettingsStore } from '@/stores/settings-store';
import { tauriApi } from '@/lib/tauri';
import { notify, notifyAutomation } from '@/lib/notifications';
import { log } from '@/lib/logger';
import {
  runAutomation,
  RunManager,
  GuardrailTracker,
  type ExecutorDeps,
} from '@/lib/automations/executor';
import { registerAutomationRunner } from '@/lib/automations/run-bridge';
import { needsArming, isArmed } from '@/lib/automations/arm';
import type {
  Automation,
  AutomationRun,
  AutomationDuePayload,
  TriggerType,
} from '@/lib/automations/types';

/**
 * The automations runtime. Mounted ONCE at the App root (the listeners must
 * outlive any panel — see MEMORY "always-mounted listeners"). Listens for
 * `automation-due` from the Rust scheduler and for `runAutomationNow` requests
 * (Run-now button / missed-runs chooser), then runs the pipeline through a
 * serialized queue with overlap `mode` + guardrails. The backend never runs
 * steps — this hook is the executor.
 */
export function useAutomationRunner() {
  const { startTask } = useAgentTaskOperations();
  const startTaskRef = useRef(startTask);
  startTaskRef.current = startTask;

  const managerRef = useRef<RunManager | null>(null);
  const guardrailsRef = useRef<GuardrailTracker | null>(null);
  if (!managerRef.current) managerRef.current = new RunManager();
  if (!guardrailsRef.current) guardrailsRef.current = new GuardrailTracker();

  // Reassigned every render so the (once-mounted) listeners always call the
  // latest closure via the ref.
  const requestRunRef = useRef<(a: Automation, trigger: Record<string, unknown>) => void>(
    () => {},
  );

  const recordSkipped = (
    automation: Automation,
    trigger: Record<string, unknown>,
    reason: string,
  ) => {
    const at = Date.now();
    useAutomationStore.getState().recordRun({
      runId: `${automation.sourcePath}#${at}`,
      automationId: automation.id,
      sourcePath: automation.sourcePath,
      startedAt: at,
      completedAt: at,
      status: 'skipped',
      trigger: {
        type: (trigger.type as TriggerType) ?? automation.trigger.type,
        file: typeof trigger.file === 'string' ? trigger.file : undefined,
      },
      steps: [{ id: 'skipped', type: 'notify', result: { output: reason } }],
    });
  };

  const executeRun = async (
    automation: Automation,
    trigger: Record<string, unknown>,
    signal: AbortSignal,
  ) => {
    const activityId = `automation-${automation.id}-${Date.now()}`;
    useActivityStore.getState().addTask({
      id: activityId,
      kind: 'automation',
      type: 'workflow',
      label: automation.name,
      status: 'running',
      sourceFile: automation.sourcePath,
    });

    const homeDir = useSettingsStore.getState().homeDir ?? '';
    const base =
      automation.scope && automation.scope !== 'global' ? automation.scope : `${homeDir}/Notesage`;

    const deps: ExecutorDeps = {
      runAgent: (prompt, projectRoot) =>
        new Promise<string>((resolve, reject) => {
          startTaskRef
            .current(
              prompt,
              { onComplete: resolve, onError: (e) => reject(new Error(e)) },
              { type: 'workflow', label: automation.name, projectRoot, trackInActivityStore: false },
            )
            .catch(reject);
        }),
      writeDocument: async (path, content, op) => {
        const abs = path.startsWith('/') ? path : `${base}/${path}`;
        await tauriApi.markSelfWrite(abs);
        if (op === 'append') {
          let existing = '';
          try {
            if (await tauriApi.pathExists(abs)) existing = await tauriApi.readFile(abs);
          } catch {
            /* treat as a fresh file */
          }
          await tauriApi.writeFile(abs, existing + content);
        } else {
          await tauriApi.writeFile(abs, content);
        }
      },
      notify: (title, body) => {
        void notifyAutomation(title, body);
      },
      persistRun: (run) => useAutomationStore.getState().recordRun(run),
      now: () => new Date(),
      isAborted: () => signal.aborted,
    };

    let run: AutomationRun | undefined;
    try {
      run = await runAutomation(automation, trigger, deps);
    } catch (e) {
      log.error('automations', `run crashed for ${automation.id}`, e);
    }

    const status =
      run?.status === 'done' ? 'done' : run?.status === 'skipped' ? 'cancelled' : 'error';
    useActivityStore.getState().updateTaskStatus(activityId, status);

    if (run?.status === 'error') {
      const failing = run.steps.find((s) => s.result?.error);
      void notify(
        'automation_failure',
        `Automation failed: ${automation.name}`,
        failing?.result?.error ?? 'A step failed.',
      );
    }
  };

  requestRunRef.current = async (automation, trigger) => {
    if (!automation.enabled) return;

    // Arm gate: a write/script step requires a content-pinned arm record that
    // matches the current definition (editing the automation auto-disarms it).
    if (needsArming(automation) && !(await isArmed(automation))) {
      recordSkipped(automation, trigger, 'not armed');
      return;
    }

    const reason = guardrailsRef.current!.check(
      automation.sourcePath,
      automation.guardrails?.maxRunsPerDay ?? 24,
      new Date(),
    );
    if (reason) {
      log.info('automations', `skipped ${automation.id}: ${reason}`);
      recordSkipped(automation, trigger, reason);
      return;
    }

    const outcome = managerRef.current!.request(
      automation.sourcePath,
      automation.mode ?? 'single',
      async (signal) => {
        guardrailsRef.current!.record(automation.sourcePath, new Date());
        await executeRun(automation, trigger, signal);
      },
    );
    if (outcome === 'dropped') {
      log.info('automations', `mode=single dropped overlapping fire for ${automation.id}`);
    }
  };

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    void listen<AutomationDuePayload>('automation-due', (event) => {
      const automation = useAutomationStore.getState().getAutomationByPath(event.payload.sourcePath);
      if (!automation) {
        log.warn('automations', `automation-due for unknown path ${event.payload.sourcePath}`);
        return;
      }
      requestRunRef.current(automation, {
        type: 'schedule',
        scheduledFor: event.payload.scheduledFor,
      });
    }).then((u) => {
      unlisten = u;
    });

    // Run-now / missed-chooser entry point.
    const unregister = registerAutomationRunner((sourcePath) => {
      const automation = useAutomationStore.getState().getAutomationByPath(sourcePath);
      if (automation) {
        requestRunRef.current(automation, { type: automation.trigger.type, manual: true });
      }
    });

    return () => {
      unlisten?.();
      unregister();
    };
  }, []);
}
