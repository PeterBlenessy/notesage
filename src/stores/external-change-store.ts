import { create } from "zustand";
import { computeExternalDiff, type ExternalDiffHunk } from "@/lib/external-diff";

export interface ExternalChangeEntry {
  filePath: string;
  fileName: string;
  oldContent: string;
  newContent: string;
  hunks: ExternalDiffHunk[];
  timestamp: number;
  status: "pending" | "reviewing" | "deferred";
}

interface ExternalChangeStore {
  changes: Record<string, ExternalChangeEntry>;

  /** Compute diff and store a new external change. */
  addChange: (filePath: string, fileName: string, oldContent: string, newContent: string) => void;
  /** Accept all changes for a file (caller is responsible for applying content to editor). */
  acceptAll: (filePath: string) => void;
  /** Reject all changes for a file (caller is responsible for reverting editor). */
  rejectAll: (filePath: string) => void;
  /** Remove a resolved change entry. */
  resolveChange: (filePath: string) => void;
  /** Set status to reviewing or deferred. */
  setStatus: (filePath: string, status: "reviewing" | "deferred") => void;
  /** Replace hunks with PM-mapped hunks (single source of truth for display). */
  setHunks: (filePath: string, hunks: ExternalDiffHunk[]) => void;
  /** Get change for a specific file. */
  getChange: (filePath: string) => ExternalChangeEntry | undefined;
  /** Get total count of files with pending changes. */
  pendingCount: () => number;
  /** Get all entries as an array. */
  allChanges: () => ExternalChangeEntry[];
}

export const useExternalChangeStore = create<ExternalChangeStore>()((set, get) => ({
  changes: {},

  addChange: (filePath, fileName, oldContent, newContent) => {
    const hunks = computeExternalDiff(oldContent, newContent);
    // No actual diff — skip
    if (hunks.length === 0) return;

    set((state) => ({
      changes: {
        ...state.changes,
        [filePath]: {
          filePath,
          fileName,
          oldContent,
          newContent,
          hunks,
          timestamp: Date.now(),
          status: "pending",
        },
      },
    }));
  },

  acceptAll: (filePath) => {
    set((state) => {
      const { [filePath]: _, ...rest } = state.changes;
      return { changes: rest };
    });
  },

  rejectAll: (filePath) => {
    set((state) => {
      const { [filePath]: _, ...rest } = state.changes;
      return { changes: rest };
    });
  },

  resolveChange: (filePath) => {
    set((state) => {
      const { [filePath]: _, ...rest } = state.changes;
      return { changes: rest };
    });
  },

  setStatus: (filePath, status) => {
    set((state) => {
      const entry = state.changes[filePath];
      if (!entry) return state;
      return {
        changes: {
          ...state.changes,
          [filePath]: { ...entry, status },
        },
      };
    });
  },

  setHunks: (filePath, hunks) => {
    set((state) => {
      const entry = state.changes[filePath];
      if (!entry) return state;
      return {
        changes: {
          ...state.changes,
          [filePath]: { ...entry, hunks },
        },
      };
    });
  },

  getChange: (filePath) => {
    return get().changes[filePath];
  },

  pendingCount: () => {
    return Object.keys(get().changes).length;
  },

  allChanges: () => {
    return Object.values(get().changes);
  },
}));
