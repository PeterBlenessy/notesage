import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/**
 * Session run-state store (PRD `2026-06-14-command-bar-session-multitasking`,
 * task #1) — the data spine for "a session is the data; the command bar, the
 * history list, and the orb are all views of it."
 *
 * Holds, per chat-store conversation, the live run state of its AI session
 * INDEPENDENTLY of any React view, so collapsing/closing the command bar can't
 * orphan a run (task #4 mounts the owning session manager at the App root).
 *
 * Only the durable `status` is persisted; the transient runtime handles
 * (`streamId` / `instanceId` / `pendingPermissionId` / `startedAt`) are
 * meaningless across a restart and are stripped. A run that was in flight when
 * the app closed is marked `error` on rehydrate (mirrors `activity-store`).
 */

export type SessionRunStatus =
  | 'idle'
  | 'queued'
  | 'running'
  | 'awaiting_permission'
  | 'error';

export type SessionRunPath = 'direct' | 'acp' | 'copilot_lsp';

export interface SessionRun {
  conversationId: string;
  status: SessionRunStatus;
  /** Which send path drives this run; set when it starts. */
  path?: SessionRunPath;
  /** Direct-API in-flight stream id (transient — never persisted). */
  streamId?: string;
  /** ACP agent process instance id (transient — never persisted). */
  instanceId?: string;
  /** When the current run started (transient). */
  startedAt?: number;
  /** Id of the pending permission request blocking this run, if any (transient). */
  pendingPermissionId?: string;
}

/** Statuses that occupy an agent slot / are actively doing work. Drives the
 *  orb's "running" set (task #12) and the concurrency cap count (task #5).
 *  `queued` is deliberately excluded — it is waiting FOR a slot, not in one. */
export const ACTIVE_STATUSES: readonly SessionRunStatus[] = [
  'running',
  'awaiting_permission',
];

/** Statuses that represent a run that was in flight (including queued, which
 *  was an intent that never got its slot). Flipped to `error` on rehydrate. */
const INFLIGHT_STATUSES: readonly SessionRunStatus[] = [
  'queued',
  'running',
  'awaiting_permission',
];

/**
 * Mark any in-flight run as `error` (interrupted) and drop transient handles.
 * Pure + exported so the rehydrate behaviour is unit-testable without driving
 * the persist middleware. Returns a new map.
 */
export function markInterruptedRuns(
  runs: Record<string, SessionRun>,
): Record<string, SessionRun> {
  const next: Record<string, SessionRun> = {};
  for (const [id, run] of Object.entries(runs)) {
    next[id] = INFLIGHT_STATUSES.includes(run.status)
      ? { conversationId: id, status: 'error' }
      : { conversationId: id, status: run.status };
  }
  return next;
}

interface SessionRunStore {
  /** Run state keyed by conversation id. */
  runs: Record<string, SessionRun>;
  /** The conversation currently shown ("watched") in the command bar; `null`
   *  when the bar shows no session. Transient — resets each launch. */
  foregroundConversationId: string | null;

  /** Merge a partial run patch (creates the entry if absent). */
  setRun: (
    conversationId: string,
    patch: Partial<Omit<SessionRun, 'conversationId'>>,
  ) => void;
  /** Shorthand for a status-only transition. */
  setStatus: (conversationId: string, status: SessionRunStatus) => void;
  /** Remove a run entry entirely (e.g. its conversation was deleted). */
  clearRun: (conversationId: string) => void;
  /** Set the watched conversation (`null` when the bar shows none). */
  setForeground: (conversationId: string | null) => void;
}

export const useSessionRunStore = create<SessionRunStore>()(
  persist(
    (set) => ({
      runs: {},
      foregroundConversationId: null,

      setRun: (conversationId, patch) =>
        set((s) => {
          const prev = s.runs[conversationId];
          const next: SessionRun = {
            ...prev,
            ...patch,
            conversationId,
            status: patch.status ?? prev?.status ?? 'idle',
          };
          return { runs: { ...s.runs, [conversationId]: next } };
        }),

      setStatus: (conversationId, status) =>
        set((s) => ({
          runs: {
            ...s.runs,
            [conversationId]: { ...s.runs[conversationId], conversationId, status },
          },
        })),

      clearRun: (conversationId) =>
        set((s) => {
          if (!s.runs[conversationId]) return s;
          const rest = { ...s.runs };
          delete rest[conversationId];
          return { runs: rest };
        }),

      setForeground: (conversationId) =>
        set({ foregroundConversationId: conversationId }),
    }),
    {
      name: 'notesage-session-runs',
      // Persist only the durable status per conversation — never transient
      // runtime handles. `foregroundConversationId` is transient too.
      partialize: (s) => ({
        runs: Object.fromEntries(
          Object.entries(s.runs).map(([id, r]) => [
            id,
            { conversationId: id, status: r.status },
          ]),
        ),
        foregroundConversationId: null,
      }),
      onRehydrateStorage: () => (state) => {
        if (!state) return;
        state.runs = markInterruptedRuns(state.runs);
        state.foregroundConversationId = null;
      },
    },
  ),
);

// ---------------------------------------------------------------------------
// Pure selectors — usable with the live store or a plain state object in tests.
// ---------------------------------------------------------------------------

export function selectRun(
  state: Pick<SessionRunStore, 'runs'>,
  conversationId: string,
): SessionRun | undefined {
  return state.runs[conversationId];
}

/** Conversations actively doing work (running or awaiting permission). */
export function selectRunningSessions(
  state: Pick<SessionRunStore, 'runs'>,
): SessionRun[] {
  return Object.values(state.runs).filter((r) => ACTIVE_STATUSES.includes(r.status));
}

/** Running sessions the user is NOT currently watching — the orb's set (#12). */
export function selectUnwatchedRunning(
  state: Pick<SessionRunStore, 'runs' | 'foregroundConversationId'>,
): SessionRun[] {
  return selectRunningSessions(state).filter(
    (r) => r.conversationId !== state.foregroundConversationId,
  );
}

/** Count of slot-occupying runs — the concurrency cap counts against this (#5). */
export function selectLiveCount(state: Pick<SessionRunStore, 'runs'>): number {
  return selectRunningSessions(state).length;
}
