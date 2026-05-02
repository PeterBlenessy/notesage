import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { useEditorStore } from "@/stores/editor-store";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { useSettingsStore } from "@/stores/settings-store";
import { useFileOperations } from "@/hooks/useFileOperations";
import { isSelfRename, consumeSelfRename } from "@/lib/self-rename-filter";
import { toastExternalRename } from "@/lib/notifications";
import { tauriApi } from "@/lib/tauri";
import { log } from "@/lib/logger";

interface FileRenamedPayload {
  old_path: string;
  new_path: string;
  is_directory: boolean;
}

/**
 * Deterministic hash of a file path for sidecar filename derivation.
 * Must stay identical to the same function in useCommentOperations.ts.
 */
function hashPath(path: string): string {
  let h = 0;
  for (let i = 0; i < path.length; i++) {
    h = ((h << 5) - h + path.charCodeAt(i)) | 0;
  }
  return "path-" + (h >>> 0).toString(16);
}

/**
 * Returns true if `filePath` is NOT under any known project root.
 * Non-project files use path-keyed comment sidecars stored in the Notesage library.
 */
function isNonProjectFile(filePath: string, projectRoots: string[]): boolean {
  return !projectRoots.some(
    (root) => filePath === root || filePath.startsWith(root + "/")
  );
}

/**
 * Migrate a single path-keyed comment sidecar from oldPath → newPath.
 * No-op if the sidecar does not exist.
 */
async function migrateFileSidecar(
  oldFilePath: string,
  newFilePath: string,
  notesRoot: string
): Promise<void> {
  const oldHash = hashPath(oldFilePath);
  const newHash = hashPath(newFilePath);
  const oldSidecar = `${notesRoot}/.notesage/comments/${oldHash}.json`;
  const newSidecar = `${notesRoot}/.notesage/comments/${newHash}.json`;

  const exists = await tauriApi.pathExists(oldSidecar);
  if (!exists) return;

  const content = await tauriApi.readFile(oldSidecar);
  await tauriApi.writeFile(newSidecar, content);
  await tauriApi.deletePath(oldSidecar);
}

/**
 * Walk all files under newFolderPath, derive the corresponding oldFilePath,
 * and migrate each path-keyed sidecar.
 */
async function migrateFolderSidecars(
  oldFolderPath: string,
  newFolderPath: string,
  notesRoot: string
): Promise<void> {
  let entries;
  try {
    entries = await tauriApi.listDirectory(newFolderPath);
  } catch {
    return;
  }

  const queue = [...entries];
  while (queue.length > 0) {
    const entry = queue.shift()!;
    if (entry.is_directory) {
      if (entry.children) {
        queue.push(...entry.children);
      }
    } else {
      // Reconstruct old file path by replacing the new folder prefix with old
      const oldFilePath =
        oldFolderPath + entry.path.slice(newFolderPath.length);
      await migrateFileSidecar(oldFilePath, entry.path, notesRoot).catch(
        (err) => {
          log.warn(
            "useFileRenameSync",
            `sidecar migration failed for ${entry.path}: ${err}`
          );
        }
      );
    }
  }
}

/**
 * Listens for `file-renamed` events emitted by the Rust watcher and keeps
 * all in-memory state (open documents, recent files, workspace projects,
 * pinned files) consistent with the rename that happened on disk.
 * Also migrates path-keyed comment sidecars for non-project files.
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
            ? () => {
                saveFile(new_path, affectedTab.content, affectedTab.id);
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

      // --- Path-keyed sidecar migration for non-project files ---
      const projectRoots = useWorkspaceStore
        .getState()
        .projects.map((p) => p.path);
      const notesRootPath = useSettingsStore.getState().notesRootPath;

      // Only migrate sidecars when the notesRoot is resolved (not a ~ path)
      // and the file is not under any project root.
      if (notesRootPath && !notesRootPath.startsWith("~")) {
        if (is_directory) {
          // For folder renames, check each descendant independently since some
          // may be in a project and some may not.
          if (isNonProjectFile(old_path, projectRoots)) {
            migrateFolderSidecars(old_path, new_path, notesRootPath).catch(
              (err) => {
                log.warn(
                  "useFileRenameSync",
                  `folder sidecar migration failed: ${err}`
                );
              }
            );
          }
        } else {
          if (isNonProjectFile(old_path, projectRoots)) {
            migrateFileSidecar(old_path, new_path, notesRootPath).catch(
              (err) => {
                log.warn(
                  "useFileRenameSync",
                  `sidecar migration failed for ${old_path}: ${err}`
                );
              }
            );
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
