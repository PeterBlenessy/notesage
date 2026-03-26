import { useCallback, useEffect, useRef } from "react";
import { tauriApi } from "@/lib/tauri";
import { useGitStore } from "@/stores/git-store";
import { toast } from "sonner";

export function useGitOperations(repoPath: string) {
  const setIsGitRepo = useGitStore((s) => s.setIsGitRepo);
  const setCurrentBranch = useGitStore((s) => s.setCurrentBranch);
  const setFileStatuses = useGitStore((s) => s.setFileStatuses);
  const setIsLoading = useGitStore((s) => s.setIsLoading);
  const resetRepo = useGitStore((s) => s.resetRepo);

  const repo = useGitStore((s) => s.repos[repoPath]);
  const isGitRepo = repo?.isGitRepo ?? false;

  const setStatusError = useGitStore((s) => s.setStatusError);

  const fetchStatus = useCallback(async () => {
    if (!repoPath) return;

    try {
      const [statuses, branch] = await Promise.all([
        tauriApi.gitStatus(repoPath),
        tauriApi.gitBranchCurrent(repoPath),
      ]);
      setFileStatuses(repoPath, statuses);
      setCurrentBranch(repoPath, branch);
    } catch (error) {
      console.warn("Git status refresh failed for", repoPath, error);
      setStatusError(repoPath, true);
    }
  }, [repoPath, setFileStatuses, setCurrentBranch, setStatusError]);

  // Keep a ref so the focus handler always calls the latest fetchStatus.
  const fetchStatusRef = useRef(fetchStatus);
  fetchStatusRef.current = fetchStatus;

  const refreshStatus = useCallback(() => {
    fetchStatus();
  }, [fetchStatus]);

  const initGit = useCallback(async () => {
    setIsLoading(repoPath, true);

    try {
      const isRepo = await tauriApi.gitIsRepo(repoPath);
      setIsGitRepo(repoPath, isRepo);

      if (isRepo) {
        await fetchStatus();
      }
    } catch (error) {
      toast.error(`Git initialization failed: ${error}`);
      setIsGitRepo(repoPath, false);
    } finally {
      setIsLoading(repoPath, false);
    }
  }, [repoPath, setIsGitRepo, setIsLoading, fetchStatus]);

  const initRepo = useCallback(async () => {
    await tauriApi.gitInit(repoPath);
    await initGit();
  }, [repoPath, initGit]);

  const uninitGit = useCallback(() => {
    resetRepo(repoPath);
  }, [repoPath, resetRepo]);

  const stage = useCallback(
    async (files: string[]) => {
      if (!repoPath) return;
      await tauriApi.gitStage(repoPath, files);
      await fetchStatus();
    },
    [repoPath, fetchStatus]
  );

  const unstage = useCallback(
    async (files: string[]) => {
      if (!repoPath) return;
      await tauriApi.gitUnstage(repoPath, files);
      await fetchStatus();
    },
    [repoPath, fetchStatus]
  );

  const commit = useCallback(
    async (message: string): Promise<string> => {
      if (!repoPath) throw new Error("No git repository");
      const hash = await tauriApi.gitCommit(repoPath, message);
      await fetchStatus();
      return hash;
    },
    [repoPath, fetchStatus]
  );

  const switchBranch = useCallback(
    async (branch: string) => {
      if (!repoPath) return;
      await tauriApi.gitBranchSwitch(repoPath, branch);
      await fetchStatus();
    },
    [repoPath, fetchStatus]
  );

  const listBranches = useCallback(async (): Promise<string[]> => {
    if (!repoPath) return [];
    return await tauriApi.gitBranchList(repoPath);
  }, [repoPath]);

  // Refresh git status when the window regains focus (catches external changes).
  useEffect(() => {
    if (!isGitRepo || !repoPath) return;

    const handleFocus = () => {
      fetchStatusRef.current();
    };

    window.addEventListener("focus", handleFocus);
    return () => window.removeEventListener("focus", handleFocus);
  }, [isGitRepo, repoPath]);

  return {
    isGitRepo,
    initGit,
    initRepo,
    uninitGit,
    refreshStatus,
    stage,
    unstage,
    commit,
    switchBranch,
    listBranches,
  };
}
