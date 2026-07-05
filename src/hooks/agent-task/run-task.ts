// ---------------------------------------------------------------------------
// Shared run lifecycle for background agent tasks.
//
// `runAgentTask` owns the scaffolding common to all three task backends (ACP,
// Copilot LSP, direct API): task-record creation, activity-store registration,
// cleanup registration/invocation, and the terminal-state transitions
// (complete / fail) with their callback + activity-store side effects. The
// per-backend strategy wires its own event listeners and kicks off its own
// run, using the {@link TaskRunHandle} for everything shared.
//
// What stays in the strategies on purpose (the flows genuinely differ):
// - ACP pre-setup (ensure agent + session restore) happens BEFORE the task is
//   registered — a failure there must propagate without creating a task entry,
//   so it runs before `runAgentTask` is called.
// - When cleanup fires: ACP cleans up on turn-complete AND when the prompt
//   promise settles; Copilot cleans up in its done/error handlers; direct API
//   only when the stream invoke settles.
// - Fail side effects vary per backend (desktop notification, `task.error`
//   recording, completing running activities) — expressed via `FailOptions`.
// ---------------------------------------------------------------------------

import { useActivityStore, type AgentTaskType } from '@/stores/activity-store';
import type { Connection } from '@/lib/ai/connections';
import { agentTaskRegistry, type InternalTask } from './task-registry';

export interface TaskActivityEvent {
  kind: string;
  label: string;
  detail?: string;
  event: 'tool_call' | 'tool_result' | 'agent_responding' | 'agent_complete' | 'permission_auto_approved' | 'tool_denied';
}

export interface TaskCallbacks {
  onComplete?: (output: string) => void;
  onActivity?: (activity: TaskActivityEvent) => void;
  onError?: (error: string) => void;
  onChunk?: (chunk: string) => void;
}

export interface TaskMeta {
  type: AgentTaskType;
  label: string;
  sourceFile?: string;
  commentId?: string;
  documentId?: string;
  /** Project root for sandbox scope — overrides selectedProjectPaths when set. */
  projectRoot?: string;
  /** If provided, reuse this existing activity store task instead of creating a new one. */
  existingTaskId?: string;
  /** When false, skips activity-store tracking (chat mode stays invisible to the agent panel). Default: true. */
  trackInActivityStore?: boolean;
}

export interface TaskRunContext {
  prompt: string;
  callbacks?: TaskCallbacks;
  taskMeta?: TaskMeta;
  connection: Connection;
}

export interface CompleteOptions {
  /** Fire the `agent_completion` desktop notification (ACP path only). */
  notify?: boolean;
}

export interface FailOptions {
  /** Fire the `agent_error` desktop notification (ACP path only). */
  notify?: boolean;
  /** Mark still-running activity-log entries done (ACP + direct API paths). */
  completeActivities?: boolean;
  /** Record the message on `task.error` (ACP + direct API paths). */
  recordError?: boolean;
}

/**
 * Per-task handle given to a backend strategy. Terminal transitions and
 * cleanup registration go through here so the bookkeeping (task record,
 * activity store, cleanup registry) stays in one place.
 */
export interface TaskRunHandle {
  taskId: string;
  /** The live task record — strategies append streamed output in place. */
  task: InternalTask;
  /** Whether this task is mirrored into the activity store. */
  track: boolean;
  /** Caller callbacks (never undefined — defaults to an empty object). */
  callbacks: TaskCallbacks;
  /** Register the listener-teardown closure for this task. */
  registerCleanup(fn: () => void): void;
  /** Invoke + clear the registered cleanup. Idempotent. */
  runCleanup(): void;
  /**
   * Terminal success transition: marks the task completed, fires the
   * `agent_complete` activity + `onComplete`, and mirrors the done state into
   * the activity store. Fires at most once per task — returns `true` when this
   * call performed the transition, `false` when completion had already fired
   * (callers gate their completion-only side effects on the return value).
   */
  complete(options?: CompleteOptions): boolean;
  /**
   * Terminal failure transition: marks the task failed and fires `onError`.
   * Deliberately NOT gated on the completion latch — mirrors the previous
   * behavior where a late prompt rejection still marked the task failed.
   */
  fail(error: unknown, options?: FailOptions): void;
}

/**
 * Strategy object for one task backend. `run` is called after the task record
 * and activity-store entry exist; it wires event listeners, registers their
 * cleanup on the handle, and kicks off the backend run.
 */
export interface AgentTaskStrategy {
  name: 'acp' | 'copilot-lsp' | 'direct-api';
  run(handle: TaskRunHandle): Promise<void>;
}

/** Preview of the response for completion activities and notifications. */
function responsePreview(output: string): string {
  return output.length > 100 ? output.slice(0, 100) + '…' : output || '(empty response)';
}

/**
 * Create the task record in the registry and (unless opted out) register /
 * reset the mirrored activity-store task.
 */
function setupTask(
  prompt: string,
  taskMeta: TaskMeta | undefined,
  connection: Connection,
): { taskId: string; task: InternalTask; track: boolean } {
  const track = taskMeta?.trackInActivityStore !== false;
  const existingId = taskMeta?.existingTaskId;
  const existingActivityTask = track && existingId
    ? useActivityStore.getState().tasks.find((t) => t.id === existingId)
    : undefined;
  const taskId = existingActivityTask ? existingId! : `task-${Date.now()}`;

  const task: InternalTask = {
    id: taskId,
    prompt,
    status: 'running',
    instanceId: null,
    sessionId: null,
    output: '',
    createdAt: Date.now(),
  };
  agentTaskRegistry.setTask(task);

  if (track) {
    if (existingActivityTask) {
      useActivityStore.getState().resetTaskForContinuation(taskId);
    } else {
      useActivityStore.getState().addTask({
        id: taskId,
        type: taskMeta?.type ?? 'chat',
        label: taskMeta?.label ?? prompt.slice(0, 50),
        status: 'running',
        sourceFile: taskMeta?.sourceFile,
        commentId: taskMeta?.commentId,
        documentId: taskMeta?.documentId,
        connectionProvider: connection.provider,
      });
    }
  }

  return { taskId, task, track };
}

/**
 * Run a background agent task through the shared lifecycle. Returns the task
 * ID once the strategy's `run` has wired its listeners and dispatched the run.
 */
export async function runAgentTask(ctx: TaskRunContext, strategy: AgentTaskStrategy): Promise<string> {
  const { taskId, task, track } = setupTask(ctx.prompt, ctx.taskMeta, ctx.connection);
  const callbacks = ctx.callbacks ?? {};

  // Completion latch shared by every completion site of this task (e.g. the
  // ACP turn-complete event AND the prompt promise resolving).
  let completionFired = false;

  const handle: TaskRunHandle = {
    taskId,
    task,
    track,
    callbacks,

    registerCleanup: (fn) => agentTaskRegistry.registerCleanup(taskId, fn),
    runCleanup: () => agentTaskRegistry.runCleanup(taskId),

    complete: (options) => {
      if (completionFired) return false;
      completionFired = true;
      task.status = 'completed';
      const preview = responsePreview(task.output);
      callbacks.onActivity?.({ kind: 'agent_complete', label: 'Agent finished', detail: preview, event: 'agent_complete' });
      callbacks.onComplete?.(task.output);
      if (track) {
        const store = useActivityStore.getState();
        store.completeAllActivities(taskId);
        store.updateTaskStatus(taskId, 'done');
        store.setFinalOutput(taskId, task.output);
      }
      if (options?.notify) {
        // Send desktop notification for agent completion
        import('@/lib/notifications').then(({ notify }) => {
          notify('agent_completion', 'Agent completed', preview);
        }).catch(() => {});
      }
      return true;
    },

    fail: (error, options) => {
      const message = error instanceof Error ? error.message : String(error);
      task.status = 'failed';
      if (options?.recordError) task.error = message;
      callbacks.onError?.(message);
      if (options?.notify) {
        // Send desktop notification for agent error
        import('@/lib/notifications').then(({ notify }) => {
          notify('agent_error', 'Agent failed', message);
        }).catch(() => {});
      }
      if (track) {
        const store = useActivityStore.getState();
        if (options?.completeActivities) store.completeAllActivities(taskId);
        store.updateTaskStatus(taskId, 'error');
      }
    },
  };

  await strategy.run(handle);
  return taskId;
}
