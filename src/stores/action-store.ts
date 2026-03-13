import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { createTauriStorage } from '@/lib/tauri-storage';
import { toast } from 'sonner';
import { tauriApi, type ActionItem } from '@/lib/tauri';
import { useWorkspaceStore } from '@/stores/workspace-store';
import { useSettingsStore } from '@/stores/settings-store';
import { useEditorStore } from '@/stores/editor-store';
import { useActivityStore, type AgentTask } from '@/stores/activity-store';
import { log } from '@/lib/logger';

export type { ActionItem } from '@/lib/tauri';

export type ActionSourceType = 'task' | 'comment' | 'agent' | 'goal';
export type ActionStatus = 'open' | 'done' | 'delegated' | 'pending' | 'running' | 'completed' | 'error';

export interface ActionFilter {
  status: ActionStatus[];
  sourceType: ActionSourceType[];
  project: string | null;
  search: string;
}

const DEFAULT_FILTER: ActionFilter = {
  status: ['open', 'delegated', 'pending', 'running'],
  sourceType: ['task', 'comment', 'agent', 'goal'],
  project: null,
  search: '',
};

interface ActionStore {
  // Persisted
  actionCache: Record<string, { items: ActionItem[]; scannedAt: number }>;
  filter: ActionFilter;

  // Non-persisted (rebuilt)
  actions: ActionItem[];
  isScanning: boolean;
  lastFullScan: number;

  // Actions
  fullScan(): Promise<void>;
  incrementalUpdate(filePath: string): Promise<void>;
  toggleTaskDone(action: ActionItem): Promise<void>;
  setFilter(filter: Partial<ActionFilter>): void;
  resetFilter(): void;

  // Computed helpers (call as functions, not selectors — they read from `actions`)
  getActionsByProject(): Map<string, ActionItem[]>;
  getOpenCount(): number;
  getFilteredActions(): ActionItem[];
}

function getAllScanPaths(): string[] {
  const ws = useWorkspaceStore.getState();
  const settings = useSettingsStore.getState();
  const paths: string[] = [];
  for (const p of ws.projects) {
    paths.push(p.path);
  }
  for (const f of ws.explorerFolders) {
    paths.push(f.path);
  }
  if (settings.notesRootPath) {
    paths.push(settings.notesRootPath);
  }
  // Deduplicate
  return [...new Set(paths)];
}

/** Convert activity-store agent tasks to ActionItems */
function agentTasksToActions(): ActionItem[] {
  const tasks = useActivityStore.getState().tasks;
  return tasks
    .filter((t: AgentTask) => t.status !== 'cancelled')
    .map((t: AgentTask) => ({
      id: `agent:${t.id}`,
      source_type: 'agent',
      status: t.status === 'done' ? 'completed' : t.status,
      text: t.label,
      file_path: t.sourceFile ?? '',
      line_number: undefined,
      project_name: undefined,
      project_root: undefined,
      created_at: new Date(t.startedAt).toISOString(),
      updated_at: t.completedAt ? new Date(t.completedAt).toISOString() : undefined,
      metadata: {
        taskId: t.id,
        agentName: t.connectionProvider,
      },
    }));
}

function rebuildActions(cache: Record<string, { items: ActionItem[] }>): ActionItem[] {
  const items: ActionItem[] = [];
  for (const entry of Object.values(cache)) {
    items.push(...entry.items);
  }
  // Add agent tasks from activity store
  items.push(...agentTasksToActions());
  return items;
}

function toggleCheckbox(line: string): string {
  if (/\[[ ]\]/.test(line)) {
    return line.replace('[ ]', '[x]');
  }
  if (/\[[xX]\]/.test(line)) {
    return line.replace(/\[[xX]\]/, '[ ]');
  }
  return line;
}

export const useActionStore = create<ActionStore>()(
  persist(
    (set, get) => ({
      actionCache: {},
      filter: DEFAULT_FILTER,
      actions: [],
      isScanning: false,
      lastFullScan: 0,

      async fullScan() {
        set({ isScanning: true });
        try {
          const paths = getAllScanPaths();
          if (paths.length === 0) {
            set({ actions: agentTasksToActions(), isScanning: false, lastFullScan: Date.now() });
            return;
          }
          const items = await tauriApi.scanActions(paths);

          // Build cache keyed by file path
          const cache: Record<string, { items: ActionItem[]; scannedAt: number }> = {};
          const now = Date.now();
          for (const item of items) {
            const key = item.file_path;
            if (!cache[key]) {
              cache[key] = { items: [], scannedAt: now };
            }
            cache[key].items.push(item);
          }

          const allActions = rebuildActions(cache);
          set({ actionCache: cache, actions: allActions, isScanning: false, lastFullScan: now });
        } catch (error) {
          log.error('actions', 'Full scan failed', error);
          set({ isScanning: false });
        }
      },

      async incrementalUpdate(filePath: string) {
        try {
          // Find which project root this file belongs to
          const ws = useWorkspaceStore.getState();
          const settings = useSettingsStore.getState();
          let scanRoot: string | null = null;

          for (const p of ws.projects) {
            if (filePath.startsWith(p.path + '/')) {
              scanRoot = p.path;
              break;
            }
          }
          if (!scanRoot) {
            for (const f of ws.explorerFolders) {
              if (filePath.startsWith(f.path + '/')) {
                scanRoot = f.path;
                break;
              }
            }
          }
          if (!scanRoot && settings.notesRootPath && filePath.startsWith(settings.notesRootPath)) {
            scanRoot = settings.notesRootPath;
          }

          if (!scanRoot) return;

          // Only rescan the specific file's parent directory (quick single-file update)
          // We rescan the root to get proper project_name etc.
          const items = await tauriApi.scanActions([scanRoot]);

          const cache = { ...get().actionCache };
          const now = Date.now();

          // Remove old entries from this root
          for (const key of Object.keys(cache)) {
            if (key.startsWith(scanRoot)) {
              delete cache[key];
            }
          }

          // Add new entries
          for (const item of items) {
            const key = item.file_path;
            if (!cache[key]) {
              cache[key] = { items: [], scannedAt: now };
            }
            cache[key].items.push(item);
          }

          set({ actionCache: cache, actions: rebuildActions(cache) });
        } catch (error) {
          log.error('actions', 'Incremental update failed', error);
        }
      },

      async toggleTaskDone(action: ActionItem) {
        if (action.source_type !== 'task' && action.source_type !== 'goal') return;
        if (!action.line_number || !action.file_path) return;

        try {
          const content = await tauriApi.readFile(action.file_path);
          const lines = content.split('\n');
          const lineIdx = action.line_number - 1;

          if (lineIdx < 0 || lineIdx >= lines.length) {
            toast.error('Line number out of range — file may have changed');
            return;
          }

          let line = lines[lineIdx];
          const taskRe = /^(\s*)([-*]|\d+\.)\s+\[([ xX])\]\s+/;

          // Check if the line still matches
          if (!taskRe.test(line)) {
            // Fallback: search for the action text nearby
            const searchText = action.text.slice(0, 40);
            let found = false;
            for (let offset = -3; offset <= 3; offset++) {
              const idx = lineIdx + offset;
              if (idx >= 0 && idx < lines.length && lines[idx].includes(searchText) && taskRe.test(lines[idx])) {
                line = lines[idx];
                lines[idx] = toggleCheckbox(line);
                found = true;
                break;
              }
            }
            if (!found) {
              toast.error('Task not found at expected location — file may have changed');
              return;
            }
          } else {
            lines[lineIdx] = toggleCheckbox(line);
          }

          const newContent = lines.join('\n');
          await tauriApi.markSelfWrite(action.file_path);
          await tauriApi.writeFile(action.file_path, newContent);

          // Optimistic UI update
          const isDone = action.status === 'done';
          set((state) => ({
            actions: state.actions.map((a) =>
              a.id === action.id ? { ...a, status: isDone ? 'open' : 'done' } : a
            ),
          }));

          toast.success(isDone ? 'Task reopened' : 'Task completed');

          // Refresh open editor tab if this file is open
          const editorStore = useEditorStore.getState();
          const openTab = editorStore.tabs.find((t) => t.filePath === action.file_path);
          if (openTab) {
            editorStore.updateTabContent(openTab.id, newContent, false);
            // Trigger editor refresh by dispatching a custom event
            window.dispatchEvent(new CustomEvent('notesage:refresh-editor-content', {
              detail: { filePath: action.file_path, content: newContent },
            }));
          }
        } catch (error) {
          log.error('actions', 'Toggle task failed', error);
          toast.error(`Failed to toggle task: ${error}`);
        }
      },

      setFilter(partial) {
        set((state) => ({
          filter: { ...state.filter, ...partial },
        }));
      },

      resetFilter() {
        set({ filter: DEFAULT_FILTER });
      },

      getActionsByProject() {
        const filtered = get().getFilteredActions();
        const map = new Map<string, ActionItem[]>();
        for (const item of filtered) {
          const key = item.project_root ?? 'ungrouped';
          const list = map.get(key) ?? [];
          list.push(item);
          map.set(key, list);
        }
        return map;
      },

      getOpenCount() {
        const { actions } = get();
        return actions.filter(
          (a) => a.status !== 'done' && a.status !== 'completed' && a.status !== 'error'
        ).length;
      },

      getFilteredActions() {
        const { actions, filter } = get();
        return actions.filter((a) => {
          // Status filter
          if (filter.status.length > 0 && !filter.status.includes(a.status as ActionStatus)) {
            return false;
          }
          // Source type filter
          if (filter.sourceType.length > 0 && !filter.sourceType.includes(a.source_type as ActionSourceType)) {
            return false;
          }
          // Project filter
          if (filter.project && a.project_root !== filter.project) {
            return false;
          }
          // Text search
          if (filter.search) {
            const q = filter.search.toLowerCase();
            if (!a.text.toLowerCase().includes(q) && !a.file_path.toLowerCase().includes(q)) {
              return false;
            }
          }
          return true;
        });
      },
    }),
    {
      name: 'notesage-action-store',
      storage: createTauriStorage(),
      version: 1,
      partialize: (state) => ({
        actionCache: state.actionCache,
        filter: state.filter,
      }),
      onRehydrateStorage: () => (state) => {
        if (!state) return;
        // Rebuild actions from persisted cache
        state.actions = rebuildActions(state.actionCache);
        state.isScanning = false;
      },
    },
  ),
);
