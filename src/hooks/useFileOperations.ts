import { useCallback } from "react";
import { tauriApi } from "@/lib/tauri";
import { useEditorStore } from "@/stores/editor-store";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { useSettingsStore } from "@/stores/settings-store";
import { useGitStore } from "@/stores/git-store";
import { parseFrontmatter, serializeFrontmatter } from "@/lib/frontmatter";

/** Debounced git status refresh per repo. Each repo gets its own timer. */
const repoRefreshTimers = new Map<string, ReturnType<typeof setTimeout>>();

function refreshGitForPath(filePath: string) {
  if (!useSettingsStore.getState().gitEnabled) return;

  const repos = useGitStore.getState().repos;
  const { setFileStatuses, setCurrentBranch } = useGitStore.getState();

  // Find repos whose path is a prefix of the affected file
  const affectedRepoPaths = Object.keys(repos).filter(
    (repoPath) => repos[repoPath].isGitRepo && filePath.startsWith(repoPath)
  );

  if (affectedRepoPaths.length === 0) return;

  for (const repoPath of affectedRepoPaths) {
    const existing = repoRefreshTimers.get(repoPath);
    if (existing) clearTimeout(existing);

    repoRefreshTimers.set(
      repoPath,
      setTimeout(async () => {
        repoRefreshTimers.delete(repoPath);
        try {
          const [statuses, branch] = await Promise.all([
            tauriApi.gitStatus(repoPath),
            tauriApi.gitBranchCurrent(repoPath),
          ]);
          setFileStatuses(repoPath, statuses);
          setCurrentBranch(repoPath, branch);
        } catch (error) {
          console.error("Failed to refresh git status:", error);
        }
      }, 300)
    );
  }
}

export function useFileOperations() {
  const { openTab, markTabClean } = useEditorStore();

  const refreshFileTree = useCallback(async (targetPath?: string) => {
    const ws = useWorkspaceStore.getState();
    const settings = useSettingsStore.getState();

    // If a specific path is given, determine which section to refresh
    if (targetPath) {
      // Check explorer
      if (ws.explorerPath && targetPath.startsWith(ws.explorerPath)) {
        try {
          const tree = await tauriApi.listDirectory(ws.explorerPath);
          ws.setExplorerTree(tree);
        } catch (error) {
          console.error("Failed to refresh explorer tree:", error);
        }
      }

      // Check projects
      for (const project of ws.projects) {
        if (targetPath.startsWith(project.path)) {
          try {
            const tree = await tauriApi.listDirectory(project.path);
            ws.updateProjectTree(project.path, tree);
          } catch (error) {
            console.error("Failed to refresh project tree:", error);
          }
        }
      }

      // Check notes root
      const notesRoot = settings.notesRootPath;
      if (notesRoot && targetPath.startsWith(notesRoot)) {
        try {
          const exists = await tauriApi.pathExists(notesRoot);
          if (exists) {
            const tree = await tauriApi.listDirectory(notesRoot);
            ws.setNotesTree(tree);
          }
        } catch (error) {
          console.error("Failed to refresh notes tree:", error);
        }
      }

      return;
    }

    // No target path: refresh everything that's open
    if (ws.explorerPath) {
      try {
        const tree = await tauriApi.listDirectory(ws.explorerPath);
        ws.setExplorerTree(tree);
      } catch (error) {
        console.error("Failed to refresh explorer tree:", error);
      }
    }

    for (const project of ws.projects) {
      try {
        const tree = await tauriApi.listDirectory(project.path);
        ws.updateProjectTree(project.path, tree);
      } catch (error) {
        console.error("Failed to refresh project tree:", error);
      }
    }

    const notesRoot = settings.notesRootPath;
    if (notesRoot) {
      try {
        const exists = await tauriApi.pathExists(notesRoot);
        if (exists) {
          const tree = await tauriApi.listDirectory(notesRoot);
          ws.setNotesTree(tree);
        }
      } catch (error) {
        console.error("Failed to refresh notes tree:", error);
      }
    }
  }, []);

  const openFile = useCallback(
    async (filePath: string, fileName: string) => {
      try {
        const raw = await tauriApi.readFile(filePath);
        const { frontmatter, content } = parseFrontmatter(raw);
        openTab(filePath, fileName, content, frontmatter);
      } catch (error) {
        console.error("Failed to read file:", error);
        throw error;
      }
    },
    [openTab]
  );

  const saveFile = useCallback(
    async (filePath: string, content: string, tabId: string) => {
      try {
        const tab = useEditorStore.getState().tabs.find((t) => t.id === tabId);
        const frontmatter = tab?.frontmatter ?? null;
        const raw = serializeFrontmatter(frontmatter, content);
        await tauriApi.markSelfWrite(filePath);
        await tauriApi.writeFile(filePath, raw);
        markTabClean(tabId);
        useEditorStore.getState().clearExternalChange(filePath);
        refreshGitForPath(filePath);
        return true;
      } catch (error) {
        await tauriApi.clearSelfWrite(filePath).catch(() => {});
        console.error("Failed to save file:", error);
        throw error;
      }
    },
    [markTabClean]
  );

  const createFile = useCallback(
    async (parentPath: string, fileName: string) => {
      const filePath = `${parentPath}/${fileName}`;
      try {
        await tauriApi.createFile(filePath);
        await refreshFileTree(parentPath);
        refreshGitForPath(filePath);
        return filePath;
      } catch (error) {
        console.error("Failed to create file:", error);
        throw error;
      }
    },
    [refreshFileTree]
  );

  const createFolder = useCallback(
    async (parentPath: string, folderName: string) => {
      const folderPath = `${parentPath}/${folderName}`;
      try {
        await tauriApi.createDirectory(folderPath);
        await refreshFileTree(parentPath);
        refreshGitForPath(folderPath);
        return folderPath;
      } catch (error) {
        console.error("Failed to create folder:", error);
        throw error;
      }
    },
    [refreshFileTree]
  );

  const renamePath = useCallback(
    async (oldPath: string, newPath: string) => {
      try {
        await tauriApi.renamePath(oldPath, newPath);
        await refreshFileTree(oldPath);
        await refreshFileTree(newPath);
        refreshGitForPath(oldPath);
        refreshGitForPath(newPath);
        return true;
      } catch (error) {
        console.error("Failed to rename:", error);
        throw error;
      }
    },
    [refreshFileTree]
  );

  const deletePath = useCallback(
    async (path: string) => {
      try {
        await tauriApi.deletePath(path);
        await refreshFileTree(path);
        refreshGitForPath(path);
        return true;
      } catch (error) {
        console.error("Failed to delete:", error);
        throw error;
      }
    },
    [refreshFileTree]
  );

  return {
    openFile,
    saveFile,
    createFile,
    createFolder,
    renamePath,
    deletePath,
    refreshFileTree,
  };
}
