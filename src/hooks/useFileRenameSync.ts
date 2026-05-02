import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { useEditorStore } from "@/stores/editor-store";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { useSettingsStore } from "@/stores/settings-store";
import { useFileOperations } from "@/hooks/useFileOperations";
import { isSelfRename, consumeSelfRename } from "@/lib/self-rename-filter";
import { toastExternalRename } from "@/lib/notifications";
import { log } from "@/lib/logger";

interface FileRenamedPayload {
  old_path: string;
  new_path: string;
  is_directory: boolean;
}

/** djb2-style hash matching useCommentOperations — produces `path-<hex>`. */
function hashPath(filePath: string): string {
  let h = 0;
  for (let i = 0; i < filePath.length; i++) {
    h = ((h << 5) - h + filePath.charCodeAt(i)) | 0;
  }
  return "path-" + ((h >>> 0).toString(16));
}

/**
 * Migrate a comment sidecar file from the old hash-keyed path to the new one
 * when a non-project file is renamed externally. No-op when no sidecar exists.
 */
async function migrateFileSidecar(
  oldFilePath: string,
  newFilePath: string,
  notesRootPath: string,
): Promise<void> {
  const oldSidecar = `${notesRootPath}/.notesage/comments/${hashPath(oldFilePath)}.json`;
  const newSidecar = `${notesRootPath}/.notesage/comments/${hashPath(newFilePath)}.json`;

  try {
    const exists = await invoke<boolean>("path_exists", { path: oldSidecar });
    if (!exists) return;

    const content = await invoke<string>("read_file", { path: oldSidecar });
    await invoke("write_file", { path: newSidecar, content });
    await invoke("delete_path", { path: oldSidecar });
  } catch (err) {
    log.warn("useFileRenameSync", `sidecar migration failed: ${err}`);
  }
}

/**
 * Listens for `file-renamed` events emitted by the Rust watcher and keeps
 * all in-memory state (open documents, recent files, workspace projects,
 * pinned files) consistent with the rename that happened on disk.
 *
 * Also migrates comment sidecar files for non-project files and wires up the
 * "Save now" toast action for dirty tabs so unsaved edits are persisted to the
 * new path.
 */
export function useFileRenameSync(): void {
  const { refreshFileTree, saveFile } = useFileOperations();

  useEffect(() => {
    const unlisten = listen<FileRenamedPayload>("file-renamed", (event) => {
      const { old_path, new_path, is_directory } = event.payload;

      if (isSelfRename(old_path, new_path)) {
        consumeSelfRename(old_path, new_path);
        return;
      }

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
            ? () => saveFile(new_path, affectedTab.content, affectedTab.id)
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

      // --- Sidecar migration for non-project files ---
      if (!is_directory) {
        const projects = useWorkspaceStore.getState().projects;
        const isProjectFile = projects.some((p) => old_path.startsWith(p.path + "/") || old_path === p.path);
        if (!isProjectFile) {
          const notesRootPath = useSettingsStore.getState().notesRootPath;
          if (notesRootPath) {
            void migrateFileSidecar(old_path, new_path, notesRootPath);
          }
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
  }, [refreshFileTree, saveFile]);
}
