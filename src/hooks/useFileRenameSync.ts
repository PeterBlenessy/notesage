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
import { commentSidecarPath, parseSidecar, serializeSidecar } from "@/lib/comment-storage";

interface FileRenamedPayload {
  old_path: string;
  new_path: string;
  is_directory: boolean;
}

/** Migrate a single non-project file's path-keyed sidecar on rename. */
async function migrateFileSidecar(
  oldFilePath: string,
  newFilePath: string,
  notesRootPath: string
): Promise<void> {
  const oldSidecar = commentSidecarPath(notesRootPath, oldFilePath);
  const newSidecar = commentSidecarPath(notesRootPath, newFilePath);
  try {
    const exists = await tauriApi.pathExists(oldSidecar);
    if (!exists) return;
    const content = await tauriApi.readFile(oldSidecar);
    await tauriApi.writeFile(newSidecar, content);
    await tauriApi.deletePath(oldSidecar);
  } catch (err) {
    log.warn("useFileRenameSync", `sidecar migration failed ${oldSidecar} → ${newSidecar}: ${err}`);
  }
}

/**
 * Reverse-lookup pass for closed-tab non-project files on folder rename.
 *
 * Lists all path-keyed sidecars in the comments directory and migrates any
 * whose `originalPath` falls inside the renamed folder. Sidecars already
 * migrated by the open-tab pass are skipped (their new hash path exists).
 */
async function migrateClosedTabSidecars(
  oldFolderPath: string,
  newFolderPath: string,
  notesRootPath: string,
  projectRoots: string[],
): Promise<void> {
  const commentsDir = `${notesRootPath}/.notesage/comments`;
  let entries: Awaited<ReturnType<typeof tauriApi.listDirectory>>;
  try {
    entries = await tauriApi.listDirectory(commentsDir);
  } catch {
    return; // comments directory does not exist yet
  }

  for (const entry of entries) {
    if (entry.is_directory || !entry.name.endsWith(".json") || !entry.name.startsWith("path-")) {
      continue;
    }
    let raw: string;
    try {
      raw = await tauriApi.readFile(entry.path);
    } catch {
      continue;
    }
    let data: ReturnType<typeof parseSidecar>;
    try {
      data = parseSidecar(raw);
    } catch {
      continue;
    }
    if (!data.originalPath) continue;
    if (!data.originalPath.startsWith(oldFolderPath + "/")) continue;

    const isProjectFile = projectRoots.some((p) => data.originalPath!.startsWith(p + "/"));
    if (isProjectFile) continue;

    const newFilePath = newFolderPath + data.originalPath.slice(oldFolderPath.length);
    const newSidecar = commentSidecarPath(notesRootPath, newFilePath);

    // Skip if open-tab migration already created the new sidecar
    try {
      const alreadyMigrated = await tauriApi.pathExists(newSidecar);
      if (alreadyMigrated) continue;
    } catch {
      // proceed
    }

    try {
      await tauriApi.writeFile(newSidecar, serializeSidecar(data.comments, newFilePath));
      await tauriApi.deletePath(entry.path);
    } catch (err) {
      log.warn("useFileRenameSync", `closed-tab sidecar migration failed ${entry.path}: ${err}`);
    }
  }
}

/**
 * Listens for `file-renamed` events emitted by the Rust watcher and keeps
 * all in-memory state (open documents, recent files, workspace projects,
 * pinned files) consistent with the rename that happened on disk.
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
            ? async () => {
                await saveFile(affectedTab.filePath, affectedTab.content ?? "", affectedTab.id);
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

      // --- Sidecar migration for non-project files ---
      const { notesRootPath } = useSettingsStore.getState();
      const { projects } = useWorkspaceStore.getState();

      const isValidNotesRoot =
        notesRootPath != null &&
        notesRootPath.length > 0 &&
        !notesRootPath.startsWith("~");

      if (isValidNotesRoot) {
        if (!is_directory) {
          // Single file rename: migrate sidecar if not inside a project.
          const isProjectFile = projects.some((p) => old_path.startsWith(p.path + "/"));
          if (!isProjectFile) {
            void migrateFileSidecar(old_path, new_path, notesRootPath!).catch(() => {});
          }
        } else {
          // Folder rename: fast path for open tabs (synchronous iteration),
          // then reverse-lookup pass for closed-tab files via originalPath.
          const descendantTabs = openDocs.filter((tab) =>
            tab.filePath.startsWith(new_path + "/")
          );
          for (const tab of descendantTabs) {
            const isProjectFile = projects.some((p) => tab.filePath.startsWith(p.path + "/"));
            if (!isProjectFile) {
              // Reconstruct the old file path: replace the new prefix with the old one.
              const oldFilePath = old_path + tab.filePath.slice(new_path.length);
              void migrateFileSidecar(oldFilePath, tab.filePath, notesRootPath!).catch(() => {});
            }
          }
          // Reverse-lookup: migrate sidecars for closed-tab files whose
          // originalPath was inside the renamed folder.
          void migrateClosedTabSidecars(
            old_path,
            new_path,
            notesRootPath!,
            projects.map((p) => p.path),
          ).catch(() => {});
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
