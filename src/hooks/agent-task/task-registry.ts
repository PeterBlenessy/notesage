// ---------------------------------------------------------------------------
// Agent-task runtime registry.
//
// Owns the non-serializable runtime handles for in-flight background agent
// tasks: the mutable task records (streamed output is appended in place) and
// the per-task listener-teardown closures. These used to live as bare
// module-scope Maps inside `useAgentTaskOperations` — hidden globals that only
// worked because the hook mounts once, broke under StrictMode double-invoke /
// any future multi-window, and defeated isolated testing.
//
// This is deliberately NOT a Zustand store: nothing renders from these values
// (the UI-visible mirror lives in `activity-store`), the task records are
// mutated in place on every stream chunk (Zustand `set()` semantics don't
// apply), and cleanup closures cannot be persisted. The repo convention for
// non-persisted runtime state offers either a plain non-persisted store or a
// module singleton with a documented owner — this is the latter: a single
// registry instance per window, owned by `useAgentTaskOperations`, resettable
// for tests via {@link resetAgentTaskRegistry}.
// ---------------------------------------------------------------------------

export type TaskStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface InternalTask {
  id: string;
  prompt: string;
  status: TaskStatus;
  instanceId: string | null;
  sessionId: string | null;
  output: string;
  error?: string;
  createdAt: number;
}

/**
 * How many FINISHED task records (completed / failed / cancelled) the registry
 * keeps. Each record holds the task's full prompt and full streamed output, and
 * automations create tasks continuously in a tray-resident app, so finished
 * records must not accumulate for the app's lifetime. A short tail is kept so
 * `getTask` still answers for a task that just ended; the durable, UI-visible
 * mirror lives in `activity-store`.
 */
export const MAX_FINISHED_TASKS = 20;

function isFinished(task: InternalTask): boolean {
  return task.status === 'completed' || task.status === 'failed' || task.status === 'cancelled';
}

export class AgentTaskRegistry {
  private tasks = new Map<string, InternalTask>();
  private cleanups = new Map<string, () => void>();

  getTask(taskId: string): InternalTask | undefined {
    return this.tasks.get(taskId);
  }

  setTask(task: InternalTask): void {
    this.tasks.set(task.id, task);
    this.pruneFinished();
  }

  /**
   * Drop the oldest finished records beyond {@link MAX_FINISHED_TASKS}. Runs
   * when a task is added, so it needs no timer and covers every terminal
   * transition (complete, fail, cancel) without each having to deregister.
   * Pending and running tasks are never dropped.
   */
  private pruneFinished(): void {
    let finished = 0;
    for (const task of this.tasks.values()) {
      if (isFinished(task)) finished++;
    }
    if (finished <= MAX_FINISHED_TASKS) return;
    // Map iteration is insertion-ordered, so this evicts oldest first.
    for (const [id, task] of this.tasks) {
      if (finished <= MAX_FINISHED_TASKS) break;
      if (!isFinished(task)) continue;
      // Only the record goes. A cleanup still registered for it stays callable
      // by id (a late `runCleanup` from a settling promise must still unlisten).
      this.tasks.delete(id);
      finished--;
    }
  }

  /**
   * Register the listener-teardown closure for a task. At most one cleanup is
   * held per task — a re-register replaces the previous closure (matching the
   * previous Map semantics).
   */
  registerCleanup(taskId: string, cleanup: () => void): void {
    this.cleanups.set(taskId, cleanup);
  }

  /**
   * Invoke and clear the registered cleanup for a task. Idempotent — a second
   * call (or a call for an unknown task) is a no-op.
   */
  runCleanup(taskId: string): void {
    const cleanup = this.cleanups.get(taskId);
    if (cleanup) {
      cleanup();
      this.cleanups.delete(taskId);
    }
  }

  /**
   * Test helper: tear down every pending cleanup (so no Tauri event listeners
   * leak across tests) and drop all task records.
   */
  reset(): void {
    for (const cleanup of this.cleanups.values()) {
      try {
        cleanup();
      } catch {
        // Best-effort teardown — a throwing unlisten must not mask the reset.
      }
    }
    this.cleanups.clear();
    this.tasks.clear();
  }
}

/** The single per-window registry instance, owned by `useAgentTaskOperations`. */
export const agentTaskRegistry = new AgentTaskRegistry();

/** Reset the shared registry — for tests only. */
export function resetAgentTaskRegistry(): void {
  agentTaskRegistry.reset();
}
