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

export class AgentTaskRegistry {
  private tasks = new Map<string, InternalTask>();
  private cleanups = new Map<string, () => void>();

  getTask(taskId: string): InternalTask | undefined {
    return this.tasks.get(taskId);
  }

  setTask(task: InternalTask): void {
    this.tasks.set(task.id, task);
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
