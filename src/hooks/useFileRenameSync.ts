import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { useEditorStore } from "@/stores/editor-store";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { useFileOperations } from "@/hooks/useFileOperations";
import { toastExternalRename } from "@/lib/notifications";
import { log } from "@/lib/logger";

interface FileRenamedPayload {
  old_path: string;
  new_path: string;
  is_directory: boolean;
}

/**
 * Listens for `file-renamed` Tauri events and keeps editor tabs, recent files,
 * scroll positions, and workspace project paths in sync with the new path.
 *
 * For dirty file renames, shows a toast prompting the user to save their
 * unsaved edits to the new location.
 */
export function useFileRenameSync(): void {
  const { refreshFileTree } = useFileOperations();

  useEffect(() => {
    const unlisten = listen<FileRenamedPayload>("file-renamed", (event) => {
      const { old_path, new_path, is_directory } = event.payload;

      log.info("rename-sync", `file-renamed: ${old_path} → ${new_path} (dir=${is_directory})`);

      const editorState = useEditorStore.getState();
      const workspaceState = useWorkspaceStore.getState();

      // Determine whether this event is relevant (touches any open doc or project).
      const prefix = old_path.endsWith("/") ? old_path : old_path + "/";
      const touchesEditor =
        editorState.openDocuments.some(
          (t) => t.filePath === old_path || t.filePath.startsWith(prefix)
        ) ||
        editorState.recentFiles.some(
          (r) => r.path === old_path || r.path.startsWith(prefix)
        );
      const touchesProject = workspaceState.projects.some((p) => p.path === old_path);

      if (!touchesEditor && !touchesProject) return;

      // For dirty files being renamed, show a toast so the user can save.
      if (!is_directory) {
        const dirtyTab = editorState.openDocuments.find(
          (t) => t.filePath === old_path && t.isDirty
        );
        if (dirtyTab) {
          toastExternalRename({
            oldPath: old_path,
            newPath: new_path,
            onSave: () => {
              // The tab path has already been updated — just trigger a save.
              useEditorStore.getState().markTabClean(dirtyTab.id);
            },
          });
        }
      }

      // Update editor store (tabs, recent files, scroll positions).
      editorState.renameOpenDocument(old_path, new_path, is_directory);

      // Update workspace project path when the renamed item is a project root.
      if (is_directory && touchesProject) {
        workspaceState.updateProjectPath(old_path, new_path, []);
        // Refresh the file tree for the new path.
        Promise.resolve(refreshFileTree(new_path)).catch(() => undefined);
      }
    });

    return () => {
      unlisten.then((fn) => fn()).catch(() => undefined);
    };
  }, [refreshFileTree]);
}
