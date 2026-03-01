import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { DelegationActivity } from '@/stores/comment-store';

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
  updateTaskStatus(id: string, status: AgentTaskStatus): void;
  appendActivity(id: string, activity: DelegationActivity): void;
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
        set((state) => ({
          tasks: [task, ...state.tasks],
          isManuallyHidden: false,
        }));
      },

      removeTask: (id) => {
        set((state) => ({
          tasks: state.tasks.filter((t) => t.id !== id),
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
          tasks: state.tasks.map((t) =>
            t.id === id ? { ...t, activities: [...t.activities, activity] } : t
          ),
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
      version: 1,
      // On rehydration, mark any previously-running tasks as interrupted
      // and clear transient streaming state
      onRehydrateStorage: () => (state) => {
        if (!state) return;
        state.tasks = state.tasks.map((t) => {
          if (t.status === 'running') {
            return {
              ...t,
              status: 'error' as const,
              completedAt: Date.now(),
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
        });
      },
    },
  ),
);
