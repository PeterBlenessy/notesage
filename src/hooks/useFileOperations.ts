import { useCallback } from "react";
import { tauriApi, type FileEntry } from "@/lib/tauri";
import { useEditorStore, type ScrollToTag } from "@/stores/editor-store";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { useSettingsStore } from "@/stores/settings-store";
import { useGitStore } from "@/stores/git-store";
import { parseFrontmatter, serializeFrontmatter } from "@/lib/frontmatter";
import { refreshNotesTree } from "@/lib/refresh-notes-tree";
import { useActionStore } from "@/stores/action-store";
import { migrateProjectPath } from "@/lib/migrate-project-path";
import { getFileType, isBinaryFileType } from "@/lib/file-utils";
import { setBinaryData } from "@/lib/binary-cache";
import { toast } from "sonner";

/** Recursively count files in a FileEntry tree. */
function countFiles(entries: FileEntry[]): number {
  let count = 0;
  for (const entry of entries) {
    if (entry.is_directory) {
      if (entry.children) count += countFiles(entry.children);
    } else {
      count += 1;
    }
  }
  return count;
}

/** Debounced git status refresh per repo. Each repo gets its own timer. */
const repoRefreshTimers = new Map<string, ReturnType<typeof setTimeout>>();

export function refreshGitForPath(filePath: string) {
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
          console.warn("Git status refresh failed for", repoPath, error);
          useGitStore.getState().setStatusError(repoPath, true);
        }
      }, 300)
    );
  }
}

/**
 * Detect if a project was renamed by scanning the parent directory for a
 * sibling folder with .notesage metadata that isn't already open as a project.
 * Returns the new path if found, null otherwise.
 */
async function detectRenamedProject(
  parentDir: string,
): Promise<string | null> {
  try {
    const parentExists = await tauriApi.pathExists(parentDir);
    if (!parentExists) return null;

    const entries = await tauriApi.listDirectory(parentDir, useSettingsStore.getState().showHiddenFiles);
    const ws = useWorkspaceStore.getState();
    const openPaths = new Set(ws.projects.map((p) => p.path));

    for (const entry of entries) {
      if (!entry.is_directory) continue;
      if (openPaths.has(entry.path)) continue;
      // Check if this folder has .notesage metadata (i.e., is a Notesage project)
      const metaPath = `${entry.path}/.notesage/project.json`;
      try {
        const exists = await tauriApi.pathExists(metaPath);
        if (exists) return entry.path;
      } catch {
        // Expected: pathExists may fail for inaccessible directories — skip this candidate
      }
    }
  } catch {
    // Expected: parent directory may not exist or be inaccessible after rename
  }
  return null;
}

export function useFileOperations() {
  const { openTab, markTabClean } = useEditorStore();

  const refreshFileTree = useCallback(async (targetPath?: string) => {
    const refreshStart = performance.now();
    const ws = useWorkspaceStore.getState();
    const settings = useSettingsStore.getState();
    let sections = 0;
    let totalFiles = 0;

    // If a specific path is given, determine which section to refresh
    if (targetPath) {
      // Check explorer folders
      for (const folder of ws.explorerFolders) {
        if (targetPath.startsWith(folder.path)) {
          try {
            const t0 = performance.now();
            const tree = await tauriApi.listDirectory(folder.path, settings.showHiddenFiles);
            const ms = Math.round(performance.now() - t0);
            const fileCount = countFiles(tree);
            const path = folder.path.split('/').pop() ?? folder.path;
            console.log('[perf:tree] list', { path, fileCount, ms });
            totalFiles += fileCount;
            sections += 1;
            ws.updateExplorerTree(folder.path, tree);
          } catch (error) {
            console.error("Failed to refresh explorer tree:", error);
          }
        }
      }

      // Check projects
      for (const project of ws.projects) {
        if (targetPath.startsWith(project.path)) {
          try {
            const t0 = performance.now();
            const tree = await tauriApi.listDirectory(project.path, settings.showHiddenFiles);
            const ms = Math.round(performance.now() - t0);
            const fileCount = countFiles(tree);
            const path = project.path.split('/').pop() ?? project.path;
            console.log('[perf:tree] list', { path, fileCount, ms });
            totalFiles += fileCount;
            sections += 1;
            ws.updateProjectTree(project.path, tree);
          } catch (error) {
            console.error("Failed to refresh project tree:", error);
          }
        }
      }

      // Check notes root (and iCloud notes path)
      const notesRoot = settings.notesRootPath;
      const icloudPath = settings.icloudNotesagePath;
      if (
        (notesRoot && targetPath.startsWith(notesRoot)) ||
        (icloudPath && targetPath.startsWith(icloudPath))
      ) {
        await refreshNotesTree();
        sections += 1;
      }

      const ms = Math.round(performance.now() - refreshStart);
      console.log('[perf:tree] refresh', { sections, totalFiles, ms });
      return;
    }

    // No target path: refresh everything that's open
    for (const folder of ws.explorerFolders) {
      try {
        const t0 = performance.now();
        const tree = await tauriApi.listDirectory(folder.path, settings.showHiddenFiles);
        const ms = Math.round(performance.now() - t0);
        const fileCount = countFiles(tree);
        const path = folder.path.split('/').pop() ?? folder.path;
        console.log('[perf:tree] list', { path, fileCount, ms });
        totalFiles += fileCount;
        sections += 1;
        ws.updateExplorerTree(folder.path, tree);
      } catch (error) {
        console.error("Failed to refresh explorer tree:", error);
      }
    }

    for (const project of ws.projects) {
      try {
        const t0 = performance.now();
        const tree = await tauriApi.listDirectory(project.path, settings.showHiddenFiles);
        const ms = Math.round(performance.now() - t0);
        const fileCount = countFiles(tree);
        const path = project.path.split('/').pop() ?? project.path;
        console.log('[perf:tree] list', { path, fileCount, ms });
        totalFiles += fileCount;
        sections += 1;
        ws.updateProjectTree(project.path, tree);
      } catch {
        // Expected: project path no longer exists — check if it was renamed
        // by scanning the parent directory for a folder with matching .notesage metadata
        const parentDir = project.path.substring(0, project.path.lastIndexOf('/'));
        const renamed = await detectRenamedProject(parentDir);
        if (renamed) {
          await migrateProjectPath(project.path, renamed);
        } else {
          const projectName = project.path.split('/').pop() || project.path;
          ws.removeProject(project.path);
          toast.warning(`Project "${projectName}" was removed — directory no longer exists`);
        }
      }
    }

    await refreshNotesTree();
    sections += 1;

    const ms = Math.round(performance.now() - refreshStart);
    console.log('[perf:tree] refresh', { sections, totalFiles, ms });
  }, []);

  const openFile = useCallback(
    async (filePath: string, fileName: string, scrollToTag?: ScrollToTag, scrollToText?: string) => {
      try {
        const fileType = getFileType(fileName);

        if (fileType === "image") {
          openTab(filePath, fileName, "", null, fileType, scrollToTag, scrollToText);
          return;
        }

        if (isBinaryFileType(fileType)) {
          const bytes = await tauriApi.readBinaryFile(filePath);
          setBinaryData(filePath, new Uint8Array(bytes));
          openTab(filePath, fileName, "", null, fileType, scrollToTag, scrollToText);
          return;
        }

        // Text files (markdown, other): read as UTF-8
        const raw = await tauriApi.readFile(filePath);
        if (fileType === "markdown") {
          const { frontmatter, content } = parseFrontmatter(raw);
          openTab(filePath, fileName, content, frontmatter, fileType, scrollToTag, scrollToText);
        } else {
          openTab(filePath, fileName, raw, null, fileType, scrollToTag, scrollToText);
        }
      } catch (error) {
        console.error("Failed to read file:", error);
        throw error;
      }
    },
    [openTab]
  );

  const openFileAtTag = useCallback(
    async (filePath: string, fileName: string, symbol: string, occurrenceInFile: number = 0) => {
      // `symbol` includes the prefix (e.g. "#climate" or "@alice").
      // Encode the occurrence index so findTextPositionInDoc can find the Nth match.
      // Format: "symbol\0N" where N is the 0-based occurrence index.
      const searchText = occurrenceInFile > 0 ? `${symbol}\0${occurrenceInFile}` : symbol;
      await openFile(filePath, fileName, undefined, searchText);
    },
    [openFile]
  );

  const openFileAtText = useCallback(
    async (filePath: string, fileName: string, searchText: string) => {
      // Pass scrollToText through openFile atomically.
      await openFile(filePath, fileName, undefined, searchText);
    },
    [openFile]
  );

  const saveFile = useCallback(
    async (filePath: string, content: string, tabId: string) => {
      try {
        const saveStart = performance.now();
        const tab = useEditorStore.getState().tabs.find((t) => t.id === tabId);
        const frontmatter = tab?.frontmatter ?? null;
        const serializeStart = performance.now();
        const raw = serializeFrontmatter(frontmatter, content);
        const serializeMs = Math.round(performance.now() - serializeStart);
        await tauriApi.markSelfWrite(filePath);
        const writeStart = performance.now();
        await tauriApi.writeFile(filePath, raw);
        const writeMs = Math.round(performance.now() - writeStart);
        const totalMs = Math.round(performance.now() - saveStart);
        const file = filePath.split('/').pop() ?? filePath;
        const sizeKB = Math.round(raw.length / 1024 * 10) / 10;
        console.log('[perf:save]', { file, sizeKB, serializeMs, writeMs, totalMs });
        markTabClean(tabId, content);
        useEditorStore.getState().clearExternalChange(filePath);
        refreshGitForPath(filePath);
        // Refresh the actions dashboard for this file.
        // Note: SQLite reindexing is handled by the Rust watcher callback
        // (queue_reindex + process_reindex_queue) — do NOT call tauriApi.indexFile()
        // here as it creates lock contention with the watcher's reindex.
        useActionStore.getState().incrementalUpdate(filePath);
        return true;
      } catch (error) {
        await tauriApi.clearSelfWrite(filePath).catch(() => {}); // Expected: best-effort cleanup, write already failed
        // Defensive: ensure the tab stays dirty so the user knows data is unsaved.
        // markTabClean is only called after a successful write, but re-assert dirty
        // here to guard against future refactors that might change the order.
        const tab = useEditorStore.getState().tabs.find((t) => t.id === tabId);
        if (tab) {
          useEditorStore.getState().updateTabContent(tabId, tab.content, true);
        }
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
        // Update open tab if this file is open in the editor
        useEditorStore.getState().renameTab(oldPath, newPath);
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
      } catch (error) {
        console.error("Failed to delete:", error);
        // Still refresh the tree — the file may already be gone externally,
        // and we need to remove the stale entry from the sidebar.
        await refreshFileTree(path);
        refreshGitForPath(path);
        throw error;
      }
      useEditorStore.getState().markTabDeleted(path);
      await refreshFileTree(path);
      refreshGitForPath(path);
      return true;
    },
    [refreshFileTree]
  );

  return {
    openFile,
    openFileAtTag,
    openFileAtText,
    saveFile,
    createFile,
    createFolder,
    renamePath,
    deletePath,
    refreshFileTree,
  };
}
