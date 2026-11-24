import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { createTauriStorage } from '@/lib/tauri-storage';
import { toast } from 'sonner';
import { tauriApi, type ActionItem, type ActionSourceType, type ActionStatus, type IndexedTask, type IndexedGoal } from '@/lib/tauri';
import { useWorkspaceStore } from '@/stores/workspace-store';
import { useSettingsStore } from '@/stores/settings-store';
import { useEditorStore } from '@/stores/editor-store';
import { useActivityStore, type AgentTask } from '@/stores/activity-store';
import { parseFrontmatter } from '@/lib/frontmatter';
import { log } from '@/lib/logger';
import { reportRehydrateError } from "@/lib/persist-rehydrate";
import { whenDocumentIndexIdle } from '@/lib/document-index';

export type { ActionItem, ActionSourceType, ActionStatus } from '@/lib/tauri';

export interface ActionFilter {
  status: ActionStatus[];
  sourceType: ActionSourceType[];
  project: string | null;
  search: string;
}

const DEFAULT_FILTER: ActionFilter = {
  status: ['open', 'done', 'delegated', 'pending', 'running'],
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
  _consecutiveFailures: number;
  _scanDisabled: boolean;

  // Actions
  fullScan(): Promise<void>;
  resetScanCircuitBreaker(): void;
  /**
   * Note that `filePath` changed. Coalesced: the owning root is rescanned
   * once per debounce window however many paths under it are reported.
   */
  incrementalUpdate(filePath: string): Promise<void>;
  /**
   * Rescan one whole root (a project, an explorer folder or the notes root)
   * because its index was just (re)built. Coalesced like `incrementalUpdate`.
   */
  refreshRoot(root: string): Promise<void>;
  /** Run a window's worth of dirty roots. Internal. */
  _scanRoots(roots: string[]): Promise<void>;
  /** Rescan one root now. Internal: callers go through `incrementalUpdate`. */
  _scanRoot(scanRoot: string): Promise<void>;
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
      status: (t.status === 'done' ? 'completed' : t.status) as ActionStatus,
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

/** Find the project or explorer folder root that a file path belongs to */
function findProjectRoot(filePath: string): string | undefined {
  const ws = useWorkspaceStore.getState();
  // Check projects first (more specific)
  for (const p of ws.projects) {
    if (filePath.startsWith(p.path + '/') || filePath === p.path) {
      return p.path;
    }
  }
  // Then explorer folders
  for (const f of ws.explorerFolders) {
    if (filePath.startsWith(f.path + '/') || filePath === f.path) {
      return f.path;
    }
  }
  // Then notes root
  const settings = useSettingsStore.getState();
  if (settings.notesRootPath && (filePath.startsWith(settings.notesRootPath + '/') || filePath === settings.notesRootPath)) {
    return settings.notesRootPath;
  }
  return undefined;
}

/** Convert an IndexedTask (from SQLite index, AST-parsed) to an ActionItem */
function indexedTaskToAction(task: IndexedTask): ActionItem {
  return {
    id: `task:${task.path}:${task.position}`,
    source_type: 'task',
    status: task.done ? 'done' : 'open',
    text: task.text,
    file_path: task.path,
    line_number: undefined,
    project_name: task.project_name,
    project_root: findProjectRoot(task.path),
    created_at: undefined,
    updated_at: undefined,
    metadata: {
      context_before: task.context_before,
      context_after: task.context_after,
    },
  };
}

/** Convert an IndexedGoal (from SQLite index) to an ActionItem */
function indexedGoalToAction(goal: IndexedGoal): ActionItem {
  return {
    id: `goal:${goal.path}`,
    source_type: 'goal',
    status: goal.completed_tasks >= goal.total_tasks && goal.total_tasks > 0 ? 'done' : 'open',
    text: goal.title,
    file_path: goal.path,
    line_number: undefined,
    project_name: goal.project_name,
    project_root: findProjectRoot(goal.path),
    created_at: undefined,
    updated_at: undefined,
    metadata: {
      template: goal.template,
      total_tasks: goal.total_tasks,
      completed_tasks: goal.completed_tasks,
    },
  };
}

/**
 * Can a change to this path change what the Actions view shows? Tasks and
 * goals come from markdown (through the index), comments from the JSON
 * sidecars in `.notesage/comments/`. Nothing else can: not the Inbox's saved
 * pages, not images, not `project.json` or `reading-progress.json`.
 */
export function canHoldActions(filePath: string): boolean {
  if (filePath.endsWith('.md')) return true;
  return filePath.endsWith('.json') && filePath.includes('/.notesage/comments/');
}

/** The project, explorer folder or notes root whose scan covers `filePath`. */
function findScanRoot(filePath: string): string | null {
  const ws = useWorkspaceStore.getState();
  const settings = useSettingsStore.getState();
  for (const p of ws.projects) {
    if (filePath.startsWith(p.path + '/')) return p.path;
  }
  for (const f of ws.explorerFolders) {
    if (filePath.startsWith(f.path + '/')) return f.path;
  }
  if (settings.notesRootPath && filePath.startsWith(settings.notesRootPath)) {
    return settings.notesRootPath;
  }
  return null;
}

/**
 * True while the startup index pass is still running. A scan made then would
 * read project DBs that are not open yet and replace the cached actions with
 * a partial answer; `useActionScanner` runs the full scan when the pass ends.
 * Only an explicit `false` counts, so a store without the flag scans as before.
 */
function indexStillBuilding(): boolean {
  return useSettingsStore.getState().indexReady === false;
}

/**
 * One scan per root per window: a burst of saves or watcher events for the
 * same project collapses into a single scan, run at the end of the window
 * that the first of them opened.
 *
 * The length is set by the save path. A save asks for a scan at once, but the
 * backend only reindexes the file after its own 500 ms watcher debounce, and
 * announces it with `links-reindexed` (which `useActionScanner` also reports
 * here). A window that outlasts that lets both requests end in ONE scan that
 * reads the updated index; a shorter one scans twice, the first time stale.
 */
export const ACTION_SCAN_DEBOUNCE_MS = 750;
/** Past this many dirty roots, one scan of everything is the cheaper answer. */
const FULL_SCAN_ROOT_THRESHOLD = 3;
/** How long a scan waits for a document-index build that is under way. */
const DOC_INDEX_WAIT_MS = 10_000;

let pendingScan: { roots: Set<string>; done: Promise<void> } | null = null;
/** Serialises flushes, so a slow scan is never overlapped by the next one. */
let scanChain: Promise<void> = Promise.resolve();

function scheduleRootScan(root: string, run: (roots: string[]) => Promise<void>): Promise<void> {
  if (!pendingScan) {
    const roots = new Set<string>();
    const done = new Promise<void>((resolve) => setTimeout(resolve, ACTION_SCAN_DEBOUNCE_MS)).then(() => {
      pendingScan = null;
      scanChain = scanChain.then(() => run([...roots])).catch(() => {});
      return scanChain;
    });
    pendingScan = { roots, done };
  }
  pendingScan.roots.add(root);
  return pendingScan.done;
}

function rebuildActions(cache: Record<string, { items: ActionItem[] }>): ActionItem[] {
  const seen = new Set<string>();
  const items: ActionItem[] = [];
  for (const entry of Object.values(cache)) {
    for (const item of entry.items) {
      if (!seen.has(item.id)) {
        seen.add(item.id);
        items.push(item);
      }
    }
  }
  // Add agent tasks from activity store
  for (const item of agentTasksToActions()) {
    if (!seen.has(item.id)) {
      seen.add(item.id);
      items.push(item);
    }
  }
  return items;
}

export const useActionStore = create<ActionStore>()(
  persist(
    (set, get) => ({
      actionCache: {},
      filter: DEFAULT_FILTER,
      actions: [],
      isScanning: false,
      lastFullScan: 0,
      _consecutiveFailures: 0,
      _scanDisabled: false,

      async fullScan() {
        // Circuit breaker: stop retrying after consecutive failures
        const state = get();
        if (state._scanDisabled) {
          return;
        }
        // Keep the cached actions until the index can answer in full.
        if (indexStillBuilding()) {
          return;
        }
        set({ isScanning: true });
        try {
          // `scan_actions` resolves comment sidecars through doc-index.json.
          await whenDocumentIndexIdle(DOC_INDEX_WAIT_MS);
          const paths = getAllScanPaths();
          if (paths.length === 0) {
            set({ actions: agentTasksToActions(), isScanning: false, lastFullScan: Date.now() });
            return;
          }

          // Fetch tasks and goals from SQLite index (AST-parsed, clean text)
          // and comments from scan_actions (JSON sidecar files)
          const [indexedTasks, indexedGoals, scanItems] = await Promise.all([
            tauriApi.indexTasks(paths),
            tauriApi.indexGoals(paths),
            tauriApi.scanActions(paths),
          ]);

          // Convert indexed items to ActionItems
          const taskActions = indexedTasks.map(indexedTaskToAction);
          const goalActions = indexedGoals.map(indexedGoalToAction);
          const commentActions = scanItems.filter((item) => item.source_type === 'comment');

          // Deduplicate by action ID — with_dbs queries both project and global
          // DBs, so the same item can appear multiple times
          const seen = new Set<string>();
          const dedupedItems: ActionItem[] = [];
          for (const item of [...taskActions, ...goalActions, ...commentActions]) {
            if (!seen.has(item.id)) {
              seen.add(item.id);
              dedupedItems.push(item);
            }
          }

          // Build cache keyed by file path
          const cache: Record<string, { items: ActionItem[]; scannedAt: number }> = {};
          const now = Date.now();
          for (const item of dedupedItems) {
            const key = item.file_path;
            if (!cache[key]) {
              cache[key] = { items: [], scannedAt: now };
            }
            cache[key].items.push(item);
          }

          const allActions = rebuildActions(cache);
          set({ actionCache: cache, actions: allActions, isScanning: false, lastFullScan: now, _consecutiveFailures: 0, _scanDisabled: false });
        } catch (error) {
          const failures = get()._consecutiveFailures + 1;
          if (failures >= 3) {
            log.error('actions', `Full scan disabled after ${failures} consecutive failures`, error);
            set({ isScanning: false, _consecutiveFailures: failures, _scanDisabled: true });
          } else {
            log.error('actions', 'Full scan failed', error);
            set({ isScanning: false, _consecutiveFailures: failures });
          }
        }
      },

      resetScanCircuitBreaker() {
        set({ _consecutiveFailures: 0, _scanDisabled: false });
      },

      async incrementalUpdate(filePath: string) {
        // Skipped without IPC: paths that cannot hold actions, paths outside
        // every scanned root, and anything arriving while the index builds.
        if (!canHoldActions(filePath)) return;
        if (indexStillBuilding()) return;
        const scanRoot = findScanRoot(filePath);
        if (!scanRoot) return;

        return scheduleRootScan(scanRoot, get()._scanRoots);
      },

      async refreshRoot(root: string) {
        if (indexStillBuilding()) return;
        // Only what a full scan would cover: a project that was removed while
        // its index was being built must not come back into the list.
        if (!getAllScanPaths().includes(root)) return;
        return scheduleRootScan(root, get()._scanRoots);
      },

      async _scanRoots(roots: string[]) {
        if (roots.length > FULL_SCAN_ROOT_THRESHOLD) {
          await get().fullScan();
          return;
        }
        await whenDocumentIndexIdle(DOC_INDEX_WAIT_MS);
        for (const root of roots) {
          await get()._scanRoot(root);
        }
      },

      async _scanRoot(scanRoot: string) {
        try {
          // Fetch tasks/goals from index, comments from scan_actions
          const [indexedTasks, indexedGoals, scanItems] = await Promise.all([
            tauriApi.indexTasks([scanRoot]),
            tauriApi.indexGoals([scanRoot]),
            tauriApi.scanActions([scanRoot]),
          ]);

          const taskActions = indexedTasks.map(indexedTaskToAction);
          const goalActions = indexedGoals.map(indexedGoalToAction);
          const commentActions = scanItems.filter((item) => item.source_type === 'comment');

          // Deduplicate by action ID
          const seen = new Set<string>();
          const dedupedItems: ActionItem[] = [];
          for (const item of [...taskActions, ...goalActions, ...commentActions]) {
            if (!seen.has(item.id)) {
              seen.add(item.id);
              dedupedItems.push(item);
            }
          }

          const cache = { ...get().actionCache };
          const now = Date.now();

          // Remove old entries from this root
          for (const key of Object.keys(cache)) {
            if (key.startsWith(scanRoot)) {
              delete cache[key];
            }
          }

          // Add new entries
          for (const item of dedupedItems) {
            const key = item.file_path;
            if (!cache[key]) {
              cache[key] = { items: [], scannedAt: now };
            }
            cache[key].items.push(item);
          }

          set({ actionCache: cache, actions: rebuildActions(cache) });
        } catch (error) {
          log.error('actions', 'Incremental update failed', error);
          toast.warning('Actions dashboard may be stale', {
            description: 'Failed to update after file save. Open Actions to refresh.',
            duration: 4000,
          });
        }
      },

      async toggleTaskDone(action: ActionItem) {
        if (action.source_type !== 'task' && action.source_type !== 'goal') return;
        if (!action.file_path) return;

        const isDone = action.status === 'done';
        const newDone = !isDone;

        try {
          // Use context-based matching via SQLite index — no fragile line numbers
          const contextBefore = action.metadata?.context_before as string ?? '';
          const contextAfter = action.metadata?.context_after as string ?? '';
          await tauriApi.indexToggleTask(
            action.file_path,
            contextBefore,
            contextAfter,
            action.text,
            newDone,
          );

          // Optimistic UI update
          set((state) => ({
            actions: state.actions.map((a) =>
              a.id === action.id ? { ...a, status: newDone ? 'done' : 'open' } : a
            ),
          }));

          toast.success(newDone ? 'Task completed' : 'Task reopened');

          // Refresh open editor tab if this file is open
          const editorStore = useEditorStore.getState();
          const openTab = editorStore.openDocuments.find((t) => t.filePath === action.file_path);
          if (openTab) {
            try {
              const raw = await tauriApi.readFile(action.file_path);
              // Strip frontmatter — tab.content must be body only (frontmatter stored separately).
              // Passing raw content would cause duplicate frontmatter on next save.
              const { content: body } = parseFrontmatter(raw);
              editorStore.updateTabContent(openTab.id, body, false);
              window.dispatchEvent(new CustomEvent('notesage:refresh-editor-content', {
                detail: { filePath: action.file_path, content: body },
              }));
            } catch {
              // File read failed — editor will catch up via watcher
            }
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
          if (filter.status.length > 0 && !filter.status.includes(a.status)) {
            return false;
          }
          // Source type filter
          if (filter.sourceType.length > 0 && !filter.sourceType.includes(a.source_type)) {
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
      onRehydrateStorage: () => (state, error) => {
        if (error) reportRehydrateError("notesage-action-store", error);
        if (!state) return;
        // Rebuild actions from persisted cache
        state.actions = rebuildActions(state.actionCache);
        state.isScanning = false;
      },
    },
  ),
);
