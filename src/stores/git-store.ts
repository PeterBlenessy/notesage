import { create } from "zustand";
import type { GitFileStatus } from "@/lib/tauri";

interface RepoState {
  isGitRepo: boolean;
  currentBranch: string;
  fileStatuses: GitFileStatus[];
  isLoading: boolean;
}

const DEFAULT_REPO_STATE: RepoState = {
  isGitRepo: false,
  currentBranch: "",
  fileStatuses: [],
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
        [path]: { ...(state.repos[path] ?? DEFAULT_REPO_STATE), fileStatuses: statuses },
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
