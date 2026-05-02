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
 * Listens for `file-renamed` events emitted by the Rust watcher and keeps
 * all in-memory state (open documents, recent files, workspace projects,
 * pinned files) consistent with the rename that happened on disk.
 */
export function useFileRenameSync(): void {
  const { refreshFileTree } = useFileOperations();

  useEffect(() => {
    const unlisten = listen<FileRenamedPayload>("file-renamed", (event) => {
      const { old_path, new_path, is_directory } = event.payload;

      log.info("useFileRenameSync", `rename detected: ${old_path} → ${new_path} (dir=${is_directory})`);

      // --- Editor store: update open documents and recent files ---
      const editorStore = useEditorStore.getState();
      editorStore.renameOpenDocument(old_path, new_path);

      // --- Toast notification ---
      // Find any open tab matching the old path (or a descendant for folders).
      const openDocs = useEditorStore.getState().openDocuments;
      const affectedTab = openDocs.find((tab) =>
        is_directory
          ? tab.filePath.startsWith(new_path + "/") || tab.filePath === new_path
          : tab.filePath === new_path
      );

      if (affectedTab) {
        toastExternalRename({
          oldPath: old_path,
          newPath: new_path,
          onSave: affectedTab.isDirty
            ? () => {
                // Content stays at the new path; mark it clean via a no-op save
                // (editor auto-save will pick it up on next keystroke or blur).
              }
            : undefined,
        });
      } else {
        // No open tab — still show the info toast if there was a recent file.
        const wasRecent = useEditorStore.getState().recentFiles.some(
          (rf) => rf.path === new_path || rf.path.startsWith(new_path + "/")
        );
        if (wasRecent) {
          toastExternalRename({ oldPath: old_path, newPath: new_path });
        }
      }

      // --- Workspace store: update projects and pinned files ---
      const workspaceStore = useWorkspaceStore.getState();

      if (is_directory) {
        // Check if a project root was renamed.
        const renamedProject = workspaceStore.projects.find(
          (p) => p.path === old_path
        );
        if (renamedProject) {
          workspaceStore.updateProjectPath(old_path, new_path, []);
        } else {
          // Non-root folder rename: refresh the file tree so the sidebar updates.
          void Promise.resolve(refreshFileTree()).catch((err) => {
            log.warn("useFileRenameSync", `refreshFileTree failed: ${err}`);
          });
        }

        // Update any pinned files under the renamed folder.
        workspaceStore.updateFilePaths(old_path, new_path);
      } else {
        // Single file rename: update pinned files if needed.
        workspaceStore.updateFilePaths(old_path, new_path);
      }
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, [refreshFileTree]);
}
