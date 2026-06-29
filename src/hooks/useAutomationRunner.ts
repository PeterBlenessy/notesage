import { useEffect, useRef } from 'react';
import { listen } from '@tauri-apps/api/event';
import { useAgentTaskOperations } from '@/hooks/useAgentTaskOperations';
import { useActivityStore } from '@/stores/activity-store';
import { useAutomationStore } from '@/stores/automation-store';
import { useSettingsStore } from '@/stores/settings-store';
import { useSkillStore } from '@/stores/skill-store';
import { tauriApi } from '@/lib/tauri';
import { notify, notifyAutomation } from '@/lib/notifications';
import { log } from '@/lib/logger';
import {
  runAutomation,
  RunManager,
  GuardrailTracker,
  effectiveDebounceMs,
  type ExecutorDeps,
} from '@/lib/automations/executor';
import { registerAutomationRunner } from '@/lib/automations/run-bridge';
import { needsArming, isArmed } from '@/lib/automations/arm';
import { formatToday } from '@/lib/automations/template';
import {
  fileTriggerMatches,
  workflowEventMatches,
  matchesCondition,
  WATCHER_KIND_TO_EVENT,
} from '@/lib/automations/file-match';
import { onWorkflowEvent, type WorkflowEvent } from '@/lib/automations/event-bus';
import { markAutomationWrite, wasAutomationWrite } from '@/lib/automations/loop-guard';
import { parseFrontmatter } from '@/lib/frontmatter';
import type {
  Automation,
  AutomationRun,
  AutomationDuePayload,
  FileEventName,
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
      // SEC-3: bind the agent's cwd to `base` (project root, or ~/Notesage for a
      // global automation) deterministically — never the transient command-bar
      // selection. A non-/tmp cwd also keeps the per-tool path filter ON.
      runAgent: (prompt) =>
        new Promise<string>((resolve, reject) => {
          startTaskRef
            .current(
              prompt,
              { onComplete: resolve, onError: (e) => reject(new Error(e)) },
              { type: 'workflow', label: automation.name, projectRoot: base, trackInActivityStore: false },
            )
            .catch(reject);
        }),
      writeDocument: async (path, content, op) => {
        // SEC-1: resolve via Rust, which rejects absolute paths and `..`
        // traversal so a template-rendered path can't escape the scope.
        const abs = await tauriApi.resolveAutomationWritePath(base, path);
        await tauriApi.markSelfWrite(abs);
        markAutomationWrite(abs); // loop guard: don't re-trigger a file automation
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
      // Skill step: run the content-pinned, Seatbelt-sandboxed script directly
      // (the automation's approve-to-arm — verified above — is the authorization,
      // so it must not re-prompt). Working dir = the automation scope.
      runSkill: async (skill, script, args) => {
        const entry = useSkillStore.getState().getSkillByName(skill);
        if (!entry) throw new Error(`Skill not found: ${skill}`);
        const expectedHash = await tauriApi.hashSkillScript(entry.path, script).catch(() => null);
        const result = await tauriApi.executeSkillScript({
          skillPath: entry.path,
          script,
          args,
          workingDir: base,
          env: null,
          timeoutMs: null,
          expectedHash: expectedHash ?? undefined,
        });
        if (result.timed_out) throw new Error('Skill script timed out');
        if (result.exit_code !== 0) {
          throw new Error(
            `Skill script failed (exit ${result.exit_code}): ${(result.stderr || result.stdout).slice(0, 400)}`,
          );
        }
        return result.stdout;
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
   // Called fire-and-forget by always-mounted listeners — never let it reject.
   try {
    if (!automation.enabled) return;

    // Arm gate: a write/script step requires a content-pinned arm record that
    // matches the current definition (editing the automation auto-disarms it).
    if (needsArming(automation) && !(await isArmed(automation))) {
      recordSkipped(automation, trigger, 'not armed');
      return;
    }

    // SEC-5: durable daily cap — count today's real (non-skipped) runs from the
    // persisted history so the limit survives restarts (the in-memory
    // GuardrailTracker below still enforces the fire-rate circuit breaker).
    const cap = automation.guardrails?.maxRunsPerDay ?? 24;
    const today = formatToday(new Date());
    const runsToday = useAutomationStore
      .getState()
      .getRuns(automation.sourcePath)
      .filter((r) => r.status !== 'skipped' && formatToday(new Date(r.startedAt)) === today).length;
    if (runsToday >= cap) {
      recordSkipped(automation, trigger, `daily limit reached (${cap}/day)`);
      return;
    }

    // Event triggers (file/workflow) debounce a burst of events into one run;
    // schedule triggers ignore debounce (cron, not a stream).
    const debounceMs = effectiveDebounceMs(automation.trigger.type, automation.guardrails?.debounceMs);
    const reason = guardrailsRef.current!.check(automation.sourcePath, cap, new Date(), debounceMs);
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
   } catch (e) {
      log.error('automations', `requestRun failed for ${automation.id}`, e);
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

    // File-event triggers (Task #3): match enabled file-trigger automations
    // against watcher events, honoring scope + condition + the loop guard.
    const readFrontmatter = async (p: string): Promise<Record<string, unknown> | null> => {
      try {
        return parseFrontmatter(await tauriApi.readFile(p)).frontmatter as Record<string, unknown>;
      } catch {
        return null;
      }
    };
    const handleFileEvent = async (file: string, event: FileEventName) => {
      try {
        if (wasAutomationWrite(file)) return; // an automation's own write — don't re-fire
        const autos = useAutomationStore
          .getState()
          .automations.filter((a) => a.enabled && fileTriggerMatches(a, event, file));
        for (const a of autos) {
          if (await matchesCondition(a, file, readFrontmatter)) {
            requestRunRef.current(a, { type: 'file', file, event });
          }
        }
      } catch (e) {
        log.error('automations', 'file-event handling failed', e);
      }
    };

    let unlistenBatch: (() => void) | undefined;
    let unlistenRename: (() => void) | undefined;
    void listen<{ path: string; kind: 'create' | 'modify' | 'delete' }[]>(
      'file-changed-batch',
      (event) => {
        for (const { path, kind } of event.payload) {
          const ev = WATCHER_KIND_TO_EVENT[kind];
          if (ev) void handleFileEvent(path, ev);
        }
      },
    ).then((u) => {
      unlistenBatch = u;
    });
    void listen<{ old_path: string; new_path: string; is_directory: boolean }>(
      'file-renamed',
      (event) => {
        if (!event.payload.is_directory) void handleFileEvent(event.payload.new_path, 'file-renamed');
      },
    ).then((u) => {
      unlistenRename = u;
    });

    // Workflow/app-event triggers (Task #2): document-saved / agent-task-complete
    // / transcription-done, delivered via the in-process event bus.
    const handleWorkflowEvent = async (e: WorkflowEvent) => {
      try {
        const autos = useAutomationStore
          .getState()
          .automations.filter((a) => a.enabled && workflowEventMatches(a, e.event));
        for (const a of autos) {
          const trigger: Record<string, unknown> = { type: 'workflow', event: e.event };
          if (e.event === 'document-saved') {
            // Honor a glob condition against the saved file.
            if (!(await matchesCondition(a, e.file, readFrontmatter))) continue;
            trigger.file = e.file;
          } else if (e.event === 'agent-task-complete') {
            trigger.taskId = e.taskId;
            trigger.output = e.output;
          } else if (e.event === 'transcription-done') {
            trigger.transcriptPath = e.transcriptPath;
          }
          requestRunRef.current(a, trigger);
        }
      } catch (err) {
        log.error('automations', 'workflow-event handling failed', err);
      }
    };
    const offWorkflow = onWorkflowEvent((e) => {
      void handleWorkflowEvent(e);
    });

    return () => {
      unlisten?.();
      unregister();
      unlistenBatch?.();
      unlistenRename?.();
      offWorkflow();
    };
  }, []);
}
