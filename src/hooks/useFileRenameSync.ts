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
 * Listens for `file-renamed` Tauri events from the filesystem watcher and
 * synchronises in-app state:
 *
 * - Open tab paths (editor-store) — exact match for file renames, prefix
 *   cascade for folder renames
 * - Recent files list (editor-store)
 * - Workspace project paths (workspace-store) — for project-root renames
 * - File tree refresh — for folder renames to surface the new hierarchy
 * - A sticky toast when the renamed file has unsaved edits, offering a Save
 *   action so edits land at the new path
 */
export function useFileRenameSync() {
  const { refreshFileTree } = useFileOperations();

  useEffect(() => {
    const unlistenPromise = listen<FileRenamedPayload>("file-renamed", (event) => {
      const { old_path, new_path, is_directory } = event.payload;

      log.info("useFileRenameSync", `renamed: ${old_path} → ${new_path} (dir=${is_directory})`);

      const editorState = useEditorStore.getState();
      const workspaceState = useWorkspaceStore.getState();
      const oldName = old_path.split("/").pop() ?? old_path;
      const newName = new_path.split("/").pop() ?? new_path;

      // Check if the renamed file is open and has unsaved edits before rewriting
      // the path — we need the old path to find the tab.
      const dirtyTab = editorState.openDocuments.find(
        (t) => t.filePath === old_path && t.isDirty
      );

      // Rewrite open tab paths and recent files in editor-store.
      editorState.renameOpenDocument(old_path, new_path);

      // Show a sticky toast when the renamed file had unsaved edits.
      if (dirtyTab) {
        const newFilePath = new_path;
        toastExternalRename(oldName, newName, () => {
          const { updateTabContent, openDocuments } = useEditorStore.getState();
          const tab = openDocuments.find((t) => t.filePath === newFilePath);
          if (tab) {
            // Trigger a save by marking the tab clean — the save flow reads
            // the in-memory content and writes it to the new path.
            updateTabContent(tab.id, tab.content ?? "", true);
          }
        });
      }

      // For folder renames: refresh the file tree so the sidebar reflects
      // the new structure.
      if (is_directory) {
        refreshFileTree();
      }

      // Update workspace project paths if a project root was renamed.
      const renamedProject = workspaceState.projects.find((p) => p.path === old_path);
      if (renamedProject) {
        workspaceState.updateProjectPath(old_path, new_path, []);
        // Refresh tree for the renamed project root.
        if (!is_directory) refreshFileTree();
      }
    });

    return () => {
      unlistenPromise.then((unlisten) => unlisten()).catch(() => {});
    };
  }, [refreshFileTree]);
}
