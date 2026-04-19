import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { DelegationActivity } from '@/stores/comment-store';
import type { ToolCallContentItem, ActivityApprovalMode } from '@/lib/ai/types';
import { createTauriStorage } from '@/lib/tauri-storage';

const MAX_COMPLETED_TASKS = 100;
const MAX_ACTIVITIES_PER_TASK = 200;
const TASK_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export type AgentTaskType = 'comment' | 'chat' | 'workflow';
export type AgentTaskStatus = 'running' | 'done' | 'error' | 'cancelled';

export interface AgentTask {
  id: string;
  type: AgentTaskType;
  label: string;
  status: AgentTaskStatus;
  sourceFile?: string;
  commentId?: string;
  documentId?: string;
  connectionProvider?: string;
  startedAt: number;
  completedAt?: number;
  activities: DelegationActivity[];
  partialOutput?: string;
  finalOutput?: string;
  thinkingOutput?: string;
}

interface ActivityStore {
  tasks: AgentTask[];
  isManuallyHidden: boolean;

  addTask(task: Omit<AgentTask, 'activities' | 'startedAt'>): void;
  removeTask(id: string): void;
  resetTaskForContinuation(id: string): void;
  updateTaskStatus(id: string, status: AgentTaskStatus): void;
  appendActivity(id: string, activity: DelegationActivity): void;
  /**
   * Replace the `content` array on the most recent running tool-call activity
   * (or the most recent activity overall if none are running). Per ACP spec,
   * `tool_call_update.content` is a full replacement — callers should not merge.
   */
  setLastActivityContent(id: string, content: ToolCallContentItem[]): void;
  /**
   * Patch the `approvalMode` on the most recent running tool-call activity
   * (or the most recent activity overall). Used when a permission decision
   * arrives after the `tool_call` event has already created the activity.
   */
  setLastActivityApprovalMode(id: string, mode: ActivityApprovalMode): void;
  completeLastActivity(id: string): void;
  completeAllActivities(id: string): void;
  appendPartialOutput(id: string, chunk: string): void;
  appendThinkingOutput(id: string, chunk: string): void;
  setFinalOutput(id: string, output: string): void;
  setManuallyHidden(hidden: boolean): void;
  clearCompleted(): void;
}

export const useActivityStore = create<ActivityStore>()(
  persist(
    (set) => ({
      tasks: [],
      isManuallyHidden: false,

      addTask: (partial) => {
        const task: AgentTask = {
          ...partial,
          activities: [],
          startedAt: Date.now(),
        };
        set((state) => {
          const updated = [task, ...state.tasks];
          // Prune oldest completed tasks if over the limit
          const completed = updated.filter((t) => t.status !== 'running');
          if (completed.length > MAX_COMPLETED_TASKS) {
            const toRemove = new Set(
              completed
                .slice(MAX_COMPLETED_TASKS)
                .map((t) => t.id)
            );
            return { tasks: updated.filter((t) => !toRemove.has(t.id)) };
          }
          return { tasks: updated };
        });
      },

      removeTask: (id) => {
        set((state) => ({
          tasks: state.tasks.filter((t) => t.id !== id),
        }));
      },

      resetTaskForContinuation: (id) => {
        set((state) => ({
          tasks: state.tasks.map((t) =>
            t.id === id
              ? {
                  ...t,
                  status: 'running' as const,
                  partialOutput: undefined,
                  finalOutput: undefined,
                  thinkingOutput: undefined,
                  completedAt: undefined,
                }
              : t
          ),
        }));
      },

      updateTaskStatus: (id, status) => {
        set((state) => ({
          tasks: state.tasks.map((t) =>
            t.id === id
              ? { ...t, status, completedAt: status !== 'running' ? Date.now() : t.completedAt }
              : t
          ),
        }));
      },

      appendActivity: (id, activity) => {
        set((state) => ({
          tasks: state.tasks.map((t) => {
            if (t.id !== id) return t;
            let activities = [...t.activities, activity];
            // Trim oldest activities if over the limit
            if (activities.length > MAX_ACTIVITIES_PER_TASK) {
              activities = activities.slice(activities.length - MAX_ACTIVITIES_PER_TASK);
            }
            return { ...t, activities };
          }),
        }));
      },

      completeLastActivity: (id) => {
        set((state) => ({
          tasks: state.tasks.map((t) => {
            if (t.id !== id) return t;
            const updated = [...t.activities];
            for (let i = updated.length - 1; i >= 0; i--) {
              if (updated[i].status === 'running') {
                updated[i] = { ...updated[i], status: 'done' };
                break;
              }
            }
            return { ...t, activities: updated };
          }),
        }));
      },

      setLastActivityContent: (id, content) => {
        set((state) => ({
          tasks: state.tasks.map((t) => {
            if (t.id !== id || t.activities.length === 0) return t;
            const updated = [...t.activities];
            let targetIdx = -1;
            for (let i = updated.length - 1; i >= 0; i--) {
              if (updated[i].status === 'running') { targetIdx = i; break; }
            }
            if (targetIdx === -1) targetIdx = updated.length - 1;
            updated[targetIdx] = { ...updated[targetIdx], content };
            return { ...t, activities: updated };
          }),
        }));
      },

      setLastActivityApprovalMode: (id, mode) => {
        set((state) => ({
          tasks: state.tasks.map((t) => {
            if (t.id !== id || t.activities.length === 0) return t;
            const updated = [...t.activities];
            let targetIdx = -1;
            for (let i = updated.length - 1; i >= 0; i--) {
              if (updated[i].status === 'running') { targetIdx = i; break; }
            }
            if (targetIdx === -1) targetIdx = updated.length - 1;
            updated[targetIdx] = { ...updated[targetIdx], approvalMode: mode };
            return { ...t, activities: updated };
          }),
        }));
      },

      completeAllActivities: (id) => {
        set((state) => ({
          tasks: state.tasks.map((t) => {
            if (t.id !== id) return t;
            const updated = t.activities.map((a) =>
              a.status === 'running' ? { ...a, status: 'done' as const } : a
            );
            return { ...t, activities: updated };
          }),
        }));
      },

      appendPartialOutput: (id, chunk) => {
        set((state) => ({
          tasks: state.tasks.map((t) =>
            t.id === id ? { ...t, partialOutput: (t.partialOutput ?? '') + chunk } : t
          ),
        }));
      },

      appendThinkingOutput: (id, chunk) => {
        set((state) => ({
          tasks: state.tasks.map((t) =>
            t.id === id ? { ...t, thinkingOutput: (t.thinkingOutput ?? '') + chunk } : t
          ),
        }));
      },

      setFinalOutput: (id, output) => {
        set((state) => ({
          tasks: state.tasks.map((t) =>
            t.id === id ? { ...t, finalOutput: output, partialOutput: undefined } : t
          ),
        }));
      },

      setManuallyHidden: (hidden) => {
        set({ isManuallyHidden: hidden });
      },

      clearCompleted: () => {
        set((state) => ({
          tasks: state.tasks.filter((t) => t.status === 'running'),
        }));
      },
    }),
    {
      name: 'notesage-activity',
      storage: createTauriStorage(),
      version: 1,
      // Exclude transient streaming fields from persistence to avoid
      // excessive writes during token-by-token streaming updates.
      partialize: (state) => ({
        ...state,
        tasks: state.tasks.map((t) => ({
          ...t,
          partialOutput: '',
          thinkingOutput: '',
        })),
      }),
      // On rehydration, mark any previously-running tasks as interrupted
      // and clear transient streaming state
      onRehydrateStorage: () => (state) => {
        if (!state) return;
        const now = Date.now();
        state.tasks = state.tasks
          .map((t) => {
            if (t.status === 'running') {
              return {
                ...t,
                status: 'error' as const,
                completedAt: now,
                partialOutput: undefined,
                finalOutput: t.partialOutput || t.finalOutput || undefined,
                activities: t.activities.map((a) =>
                  a.status === 'running' ? { ...a, status: 'error' as const } : a
                ),
              };
            }
            // Clear any leftover partialOutput on completed tasks
            if (t.partialOutput) {
              return { ...t, partialOutput: undefined };
            }
            return t;
          })
          // Remove completed tasks older than 7 days
          .filter((t) => {
            if (t.status === 'running') return true;
            if (t.completedAt && now - t.completedAt > TASK_TTL_MS) return false;
            return true;
          });
      },
    },
  ),
);
