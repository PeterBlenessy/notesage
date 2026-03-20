import { create } from "zustand";
import type { GitFileStatus } from "@/lib/tauri";

interface RepoState {
  isGitRepo: boolean;
  currentBranch: string;
  fileStatuses: GitFileStatus[];
  /** Pre-computed Map<path, statuses[]> for O(1) lookups in FileTreeItem */
  fileStatusMap: Map<string, GitFileStatus[]>;
  isLoading: boolean;
}

function buildStatusMap(statuses: GitFileStatus[]): Map<string, GitFileStatus[]> {
  const map = new Map<string, GitFileStatus[]>();
  for (const s of statuses) {
    const existing = map.get(s.path);
    if (existing) {
      existing.push(s);
    } else {
      map.set(s.path, [s]);
    }
  }
  return map;
}

const EMPTY_STATUS_MAP = new Map<string, GitFileStatus[]>();

const DEFAULT_REPO_STATE: RepoState = {
  isGitRepo: false,
  currentBranch: "",
  fileStatuses: [],
  fileStatusMap: EMPTY_STATUS_MAP,
  isLoading: false,
};

interface GitStore {
  repos: Record<string, RepoState>;

  getRepo: (path: string) => RepoState;
  setIsGitRepo: (path: string, value: boolean) => void;
  setCurrentBranch: (path: string, branch: string) => void;
  setFileStatuses: (path: string, statuses: GitFileStatus[]) => void;
  setIsLoading: (path: string, loading: boolean) => void;
  resetRepo: (path: string) => void;
}

export const useGitStore = create<GitStore>()((set, get) => ({
  repos: {},

  getRepo: (path) => get().repos[path] ?? DEFAULT_REPO_STATE,

  setIsGitRepo: (path, value) =>
    set((state) => ({
      repos: {
        ...state.repos,
        [path]: { ...(state.repos[path] ?? DEFAULT_REPO_STATE), isGitRepo: value },
      },
    })),

  setCurrentBranch: (path, branch) =>
    set((state) => ({
      repos: {
        ...state.repos,
        [path]: { ...(state.repos[path] ?? DEFAULT_REPO_STATE), currentBranch: branch },
      },
    })),

  setFileStatuses: (path, statuses) =>
    set((state) => ({
      repos: {
        ...state.repos,
        [path]: {
          ...(state.repos[path] ?? DEFAULT_REPO_STATE),
          fileStatuses: statuses,
          fileStatusMap: buildStatusMap(statuses),
        },
      },
    })),

  setIsLoading: (path, loading) =>
    set((state) => ({
      repos: {
        ...state.repos,
        [path]: { ...(state.repos[path] ?? DEFAULT_REPO_STATE), isLoading: loading },
      },
    })),

  resetRepo: (path) =>
    set((state) => {
      const { [path]: _, ...rest } = state.repos;
      return { repos: rest };
    }),
}));
