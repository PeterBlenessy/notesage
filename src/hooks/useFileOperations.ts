import { useCallback } from "react";
import { tauriApi } from "@/lib/tauri";
import { useEditorStore } from "@/stores/editor-store";
import { useProjectStore } from "@/stores/project-store";

export function useFileOperations() {
  const { openTab, markTabClean } = useEditorStore();
  const { rootPath, setFileTree } = useProjectStore();

  const refreshFileTree = useCallback(async () => {
    if (rootPath) {
      try {
        const tree = await tauriApi.listDirectory(rootPath);
        setFileTree(tree);
      } catch (error) {
        console.error("Failed to refresh file tree:", error);
      }
    }
  }, [rootPath, setFileTree]);

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
        await refreshFileTree();
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
        await refreshFileTree();
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
        await refreshFileTree();
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
        await refreshFileTree();
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
