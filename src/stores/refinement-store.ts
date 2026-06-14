import { create } from 'zustand';
import type { RefinementEntry, RefinementEntryStatus } from '@/lib/ai/refinement';

/**
 * Refinement store — holds the queue of refinement suggestions for the open
 * document. Intentionally NOT persisted: the queue is rebuilt from the
 * document's `ns-refine` comments on open, so there is no `persist` middleware.
 *
 * See `docs/prds/2026-06-13-ambient-action-refinement.md`.
 */
interface RefinementStore {
  /** All refinement entries across docs (in practice the shell is single-document). */
  entries: RefinementEntry[];
  /** Content hashes the engine looked at and had nothing to refine. */
  seen: Set<string>;

  /** Replace an existing entry by `id`, else append. */
  upsertEntry: (entry: RefinementEntry) => void;
  /** Set the status of an entry by `id`. */
  setStatus: (id: string, status: RefinementEntryStatus) => void;
  /** Remove an entry from the queue. */
  dismiss: (id: string) => void;
  /** Mark a content hash as seen. */
  markSeen: (hash: string) => void;
  /** Has a content hash already been seen? */
  hasSeen: (hash: string) => boolean;
  /** Replace ALL entries for `docPath` with the provided list; leave others intact. */
  rebuildForDoc: (docPath: string, entries: RefinementEntry[]) => void;
  /** Remove all entries for `docPath`. */
  clearDoc: (docPath: string) => void;
}

export const useRefinementStore = create<RefinementStore>()((set, get) => ({
  entries: [],
  seen: new Set<string>(),

  upsertEntry: (entry) => {
    set((state) => {
      const idx = state.entries.findIndex((e) => e.id === entry.id);
      if (idx === -1) {
        return { entries: [...state.entries, entry] };
      }
      const next = state.entries.slice();
      next[idx] = entry;
      return { entries: next };
    });
  },

  setStatus: (id, status) => {
    set((state) => {
      const idx = state.entries.findIndex((e) => e.id === id);
      if (idx === -1) return state;
      const next = state.entries.slice();
      next[idx] = { ...next[idx], status };
      return { entries: next };
    });
  },

  dismiss: (id) => {
    set((state) => {
      const next = state.entries.filter((e) => e.id !== id);
      if (next.length === state.entries.length) return state;
      return { entries: next };
    });
  },

  markSeen: (hash) => {
    set((state) => {
      if (state.seen.has(hash)) return state;
      const next = new Set(state.seen);
      next.add(hash);
      return { seen: next };
    });
  },

  hasSeen: (hash) => {
    return get().seen.has(hash);
  },

  rebuildForDoc: (docPath, entries) => {
    set((state) => ({
      entries: [...state.entries.filter((e) => e.docPath !== docPath), ...entries],
    }));
  },

  clearDoc: (docPath) => {
    set((state) => {
      const next = state.entries.filter((e) => e.docPath !== docPath);
      if (next.length === state.entries.length) return state;
      return { entries: next };
    });
  },
}));

/** True if any entry is pending AND its verdict is not `keep`. */
export function selectHasPending(state: Pick<RefinementStore, 'entries'>): boolean {
  return state.entries.some(
    (e) => e.status === 'pending' && e.result.verdict !== 'keep',
  );
}

/** Count of pending entries whose verdict is not `keep` — drives the orb badge. */
export function selectPendingCount(state: Pick<RefinementStore, 'entries'>): number {
  return state.entries.reduce(
    (n, e) => (e.status === 'pending' && e.result.verdict !== 'keep' ? n + 1 : n),
    0,
  );
}

/** Pending entries for a specific doc. */
export function selectPendingForDoc(
  state: Pick<RefinementStore, 'entries'>,
  docPath: string,
): RefinementEntry[] {
  return state.entries.filter((e) => e.docPath === docPath && e.status === 'pending');
}
