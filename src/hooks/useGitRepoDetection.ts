import { useEffect } from "react";
import { tauriApi } from "@/lib/tauri";
import { useGitStore } from "@/stores/git-store";
import { useSettingsStore } from "@/stores/settings-store";
import { useWorkspaceStore } from "@/stores/workspace-store";

/**
 * Git repo detection for sidebar roots (branch-diff-review re-wire).
 *
 * `git-store` repo state (`isGitRepo`, `currentBranch`, `fileStatuses`) is
 * only ever *refreshed* by `refreshGitForPath` (useFileOperations) — and that
 * function requires the repo to ALREADY be registered in the store. Since the
 * Classic Layout removal nothing registers workspace roots at startup, so the
 * sidebar's git glyphs and the new repo indicator would stay dark forever.
 *
 * This hook closes the gap: once per root (projects + explorer folders) it
 * runs a single `git_is_repo` probe and, for repos, one status + branch
 * fetch. Results land in `git-store`, after which the existing debounced
 * refresh paths (file ops, watcher events) keep them fresh. The module-level
 * `attempted` set guarantees the probe never repeats per app session — rows
 * derive purely from store state, zero IPC per row render.
 */

const attempted = new Set<string>();

/** Test-only: reset the once-per-session detection guard. */
export function __resetGitRepoDetectionForTests(): void {
  attempted.clear();
}

/**
 * Probe each root once: is it a git repo? If yes, seed status + current
 * branch so `useFileTreeItemState` / `SidebarRowIndicators` have data.
 * Failed probes are removed from the guard so a later change retries.
 */
export async function detectGitRepoRoots(roots: string[]): Promise<void> {
  const { setIsGitRepo, setFileStatuses, setCurrentBranch } =
    useGitStore.getState();

  await Promise.all(
    roots.map(async (root) => {
      if (!root || attempted.has(root)) return;
      attempted.add(root);
      try {
        const isRepo = await tauriApi.gitIsRepo(root);
        setIsGitRepo(root, isRepo);
        if (!isRepo) return;

        const [statuses, branch] = await Promise.all([
          tauriApi.gitStatus(root),
          tauriApi.gitBranchCurrent(root),
        ]);
        setFileStatuses(root, statuses);
        setCurrentBranch(root, branch);
      } catch (error) {
        // Allow a retry on the next roots/settings change — transient
        // failures (e.g. slow cloud paths) shouldn't blank the badge for
        // the whole session.
        attempted.delete(root);
        console.warn("Git repo detection failed for", root, error);
      }
    }),
  );
}

/**
 * Mounted from `QuietSidebar` — watches the workspace roots (projects +
 * explorer folders) and `settings.gitEnabled`, and populates git-store repo
 * detection once per root. No-op while git integration is disabled.
 */
export function useGitRepoDetection(): void {
  const gitEnabled = useSettingsStore((s) => s.gitEnabled);
  const projects = useWorkspaceStore((s) => s.projects);
  const explorerFolders = useWorkspaceStore((s) => s.explorerFolders);

  useEffect(() => {
    if (!gitEnabled) return;
    const roots = [
      ...projects.map((p) => p.path),
      ...explorerFolders.map((f) => f.path),
    ];
    if (roots.length === 0) return;
    void detectGitRepoRoots(roots);
  }, [gitEnabled, projects, explorerFolders]);
}
