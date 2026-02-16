import { useCallback } from "react";
import { tauriApi } from "@/lib/tauri";
import { useEditorStore } from "@/stores/editor-store";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { useSettingsStore } from "@/stores/settings-store";

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
        const content = await tauriApi.readFile(filePath);
        openTab(filePath, fileName, content);
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
        await tauriApi.writeFile(filePath, content);
        markTabClean(tabId);
        return true;
      } catch (error) {
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
