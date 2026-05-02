import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { useEditorStore } from "@/stores/editor-store";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { useFileOperations } from "@/hooks/useFileOperations";

interface FileRenamedPayload {
  old_path: string;
  new_path: string;
  is_directory: boolean;
}

/**
 * Listens for `file-renamed` Tauri events emitted by watcher.rs when
 * notify fires a `Modify(Name(Both))` event. Rewrites open-document paths,
 * recent files, workspace project roots, and pinned files to stay in sync
 * with external renames made via Finder, git mv, or terminal.
 *
 * Mounted from App.tsx alongside useFileWatcher.
 */
export function useFileRenameSync(): void {
  const { refreshFileTree } = useFileOperations();

  useEffect(() => {
    const unlistenPromise = listen<FileRenamedPayload>(
      "file-renamed",
      (event) => {
        const { old_path, new_path, is_directory } = event.payload;

        // Rewrite open tabs, recents, scroll positions
        useEditorStore.getState().renameOpenDocument(old_path, new_path);

        // Workspace project root rename
        const projects = useWorkspaceStore.getState().projects;
        const matchingProject = projects.find((p) => p.path === old_path);
        if (matchingProject) {
          useWorkspaceStore
            .getState()
            .updateProjectPath(old_path, new_path, matchingProject.fileTree);
        }

        // Pinned file paths
        useWorkspaceStore.getState().updateFilePaths(old_path, new_path);

        // Refresh tree so sidebar reflects the rename
        if (is_directory) {
          refreshFileTree();
        }
      }
    );

    return () => {
      unlistenPromise.then((unlisten) => unlisten()).catch(() => {});
    };
  }, [refreshFileTree]);
}
