import { create } from "zustand";
import {
  IDLE_SUMMARY,
  NO_SCOPES,
  applyProgress,
  beginScope,
  finishAllExcept,
  finishScope,
  removeScope,
  scopeKey,
  summarize,
  type IndexScopes,
  type IndexingSummary,
} from "@/lib/index-progress";

/**
 * Whether the library is being indexed, and how far along it is.
 *
 * One store, fed from two sides, read by every surface that shows indexing
 * (the sidebar footer bar, the status tray, the "still indexing" notes):
 *
 * - `index-progress` / `index-ready` from the backend, through
 *   `useIndexProgressListener` (mounted once, in App.tsx). These carry the
 *   numbers.
 * - `begin` / `settle` from `initIndexWithRecovery`, around the command
 *   itself. These are what make the state trustworthy: a pass that FAILS
 *   emits no `index-ready`, but its command always returns.
 *
 * `status` is what to show. It trails the raw state on both edges: a pass has
 * to last {@link SHOW_DELAY_MS} before anything appears (most launches reindex
 * nothing and are over sooner), and the indicator lingers
 * {@link HIDE_GRACE_MS} after the last pass, so a burst of passes reads as one.
 */

/** A pass shorter than this is never shown. */
export const SHOW_DELAY_MS = 400;
/** How long the indicator stays after indexing stopped. */
export const HIDE_GRACE_MS = 700;

export interface IndexProgressEvent {
  /** Absent in payloads from before the scope was added: read as the global pass. */
  project_path?: string | null;
  current: number;
  total: number;
}

interface IndexProgressState {
  /** What to show. `status.active` is the debounced "indexing" flag. */
  status: IndexingSummary;

  /** `index_init` is about to be invoked for this scope. */
  begin: (projectPath: string | null) => void;
  /** That `index_init` (recovery included) has returned, either way. */
  settle: (projectPath: string | null) => void;
  /** An `index-progress` event. */
  progress: (event: IndexProgressEvent) => void;
  /** An `index-ready` event. */
  ready: (projectPath: string | null) => void;
  /** `settings.indexReady` changed. */
  setStartupSettled: (settled: boolean) => void;
  /** The workspace's project paths changed. */
  setProjects: (paths: readonly string[]) => void;
}

/**
 * The raw state. Module-level on purpose: nothing renders from it, and
 * keeping it out of the store means a progress event that changes nothing
 * visible publishes nothing.
 */
let scopes: IndexScopes = NO_SCOPES;
/** Scope key → how many `index_init` calls are in flight for it. */
const running = new Map<string, number>();
/** Projects removed mid-pass: their remaining events are not theirs to show. */
const removed = new Set<string>();
let startupSettled = false;
let projects: readonly string[] = [];
let shown = false;
let showTimer: ReturnType<typeof setTimeout> | undefined;
let hideTimer: ReturnType<typeof setTimeout> | undefined;

function sameSummary(a: IndexingSummary, b: IndexingSummary): boolean {
  return (
    a.active === b.active &&
    a.filesDone === b.filesDone &&
    a.filesTotal === b.filesTotal &&
    a.fraction === b.fraction &&
    a.pendingScopes === b.pendingScopes &&
    a.currentScopes.length === b.currentScopes.length &&
    a.currentScopes.every((key, i) => key === b.currentScopes[i])
  );
}

function publish(summary: IndexingSummary): void {
  const next = shown ? { ...summary, active: true } : IDLE_SUMMARY;
  if (!sameSummary(useIndexProgressStore.getState().status, next)) {
    useIndexProgressStore.setState({ status: next });
  }
}

/** Bring the timers and the published status in line with the raw state. */
function reconcile(): void {
  const summary = summarize(scopes, { startupSettled, projects });
  if (summary.active) {
    clearTimeout(hideTimer);
    hideTimer = undefined;
    if (!shown && showTimer === undefined) {
      showTimer = setTimeout(() => {
        showTimer = undefined;
        shown = true;
        reconcile();
      }, SHOW_DELAY_MS);
    }
  } else {
    clearTimeout(showTimer);
    showTimer = undefined;
    if (!shown) {
      // The burst is over and was never shown: the next one starts from zero.
      scopes = NO_SCOPES;
    } else if (hideTimer === undefined) {
      hideTimer = setTimeout(() => {
        hideTimer = undefined;
        shown = false;
        scopes = NO_SCOPES;
        reconcile();
      }, HIDE_GRACE_MS);
    }
  }
  publish(summary);
}

export const useIndexProgressStore = create<IndexProgressState>(() => ({
  status: IDLE_SUMMARY,

  begin: (projectPath) => {
    const key = scopeKey(projectPath);
    running.set(key, (running.get(key) ?? 0) + 1);
    removed.delete(key);
    scopes = beginScope(scopes, key);
    reconcile();
  },

  settle: (projectPath) => {
    const key = scopeKey(projectPath);
    const left = (running.get(key) ?? 0) - 1;
    if (left > 0) {
      running.set(key, left);
      return;
    }
    running.delete(key);
    removed.delete(key);
    scopes = finishScope(scopes, key);
    reconcile();
  },

  progress: (event) => {
    const key = scopeKey(event.project_path);
    if (removed.has(key)) return;
    scopes = applyProgress(scopes, key, event.current, event.total);
    reconcile();
  },

  ready: (projectPath) => {
    const key = scopeKey(projectPath);
    if (!running.has(key)) removed.delete(key);
    scopes = finishScope(scopes, key);
    reconcile();
  },

  setStartupSettled: (settled) => {
    if (settled === startupSettled) return;
    startupSettled = settled;
    if (settled) {
      // Startup's commands have all returned. A scope that is still open and
      // has no command in flight lost its `index-ready`; do not wait for it.
      scopes = finishAllExcept(scopes, new Set(running.keys()));
    }
    reconcile();
  },

  setProjects: (paths) => {
    const present = new Set(paths);
    for (const key of Object.keys(scopes)) {
      if (key === scopeKey(null) || present.has(key)) continue;
      // Its pass may well still be running in the backend; whatever it goes
      // on to report is about a project the user no longer has.
      if (!scopes[key].done) removed.add(key);
      scopes = removeScope(scopes, key);
    }
    projects = [...paths];
    reconcile();
  },
}));

/** Test-only: back to a fresh launch, timers included. */
export function resetIndexProgressForTests(): void {
  clearTimeout(showTimer);
  clearTimeout(hideTimer);
  showTimer = undefined;
  hideTimer = undefined;
  scopes = NO_SCOPES;
  running.clear();
  removed.clear();
  startupSettled = false;
  projects = [];
  shown = false;
  useIndexProgressStore.setState({ status: IDLE_SUMMARY });
}

/**
 * Test and E2E seam: show `summary` as the indexing status right now, without
 * events or timers. Pass `null` to go back to idle.
 */
export function showIndexingForTests(summary: Partial<IndexingSummary> | null): void {
  resetIndexProgressForTests();
  if (summary === null) return;
  useIndexProgressStore.setState({
    status: { ...IDLE_SUMMARY, ...summary, active: true },
  });
}
