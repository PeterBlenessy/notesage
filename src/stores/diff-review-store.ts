import { create } from "zustand";
import { tauriApi } from "@/lib/tauri";
import type { DiffHunk } from "@/lib/tauri";

export interface FileDiff {
  /** Relative path from repo root (as returned by git diff) */
  filePath: string;
  /** Structured diff hunks from git */
  hunks: DiffHunk[];
  /** Resolution status per hunk index: null = unresolved */
  resolved: (null | "accept" | "reject")[];
}

interface DiffReviewStore {
  /** Branch being compared (the "incoming" branch) */
  compareBranch: string | null;
  /** Base branch name */
  baseBranch: string | null;
  /** All files with diffs */
  changedFiles: FileDiff[];
  /** Whether a review session is active */
  reviewActive: boolean;
  /** Loading state while fetching diffs */
  isLoading: boolean;
  /** Error message from last operation */
  error: string | null;

  /** Start a review: fetch changed files and their hunks */
  startReview: (repoPath: string, baseBranch: string, compareBranch: string) => Promise<void>;
  /** End the review and clear all state */
  endReview: () => void;
  /** Mark a hunk as accepted or rejected */
  resolveHunk: (filePath: string, hunkIndex: number, action: "accept" | "reject") => void;
  /** Get the FileDiff for a specific file path, or null */
  getFileDiff: (filePath: string) => FileDiff | null;
  /** Check if a file has unresolved hunks */
  hasUnresolvedHunks: (filePath: string) => boolean;
}

export const useDiffReviewStore = create<DiffReviewStore>()((set, get) => ({
  compareBranch: null,
  baseBranch: null,
  changedFiles: [],
  reviewActive: false,
  isLoading: false,
  error: null,

  startReview: async (repoPath, baseBranch, compareBranch) => {
    set({ isLoading: true, error: null });

    try {
      // Get list of changed files between branches
      const fileNames = await tauriApi.gitDiffFiles(repoPath, baseBranch, compareBranch);

      // Fetch hunks for each changed file
      const fileDiffs: FileDiff[] = await Promise.all(
        fileNames.map(async (filePath) => {
          const hunks = await tauriApi.gitDiffFile(repoPath, baseBranch, compareBranch, filePath);
          return {
            filePath,
            hunks,
            resolved: hunks.map(() => null),
          };
        })
      );

      set({
        compareBranch,
        baseBranch,
        changedFiles: fileDiffs,
        reviewActive: true,
        isLoading: false,
      });
    } catch (err) {
      set({
        error: String(err),
        isLoading: false,
      });
    }
  },

  endReview: () => {
    set({
      compareBranch: null,
      baseBranch: null,
      changedFiles: [],
      reviewActive: false,
      isLoading: false,
      error: null,
    });
  },

  resolveHunk: (filePath, hunkIndex, action) => {
    set((state) => ({
      changedFiles: state.changedFiles.map((fd) => {
        if (fd.filePath !== filePath) return fd;
        const resolved = [...fd.resolved];
        if (hunkIndex >= 0 && hunkIndex < resolved.length) {
          resolved[hunkIndex] = action;
        }
        return { ...fd, resolved };
      }),
    }));
  },

  getFileDiff: (filePath) => {
    return get().changedFiles.find((fd) => fd.filePath === filePath) ?? null;
  },

  hasUnresolvedHunks: (filePath) => {
    const fd = get().changedFiles.find((fd) => fd.filePath === filePath);
    if (!fd) return false;
    return fd.resolved.some((r) => r === null);
  },
}));
