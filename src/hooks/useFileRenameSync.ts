import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { useEditorStore } from "@/stores/editor-store";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { useSettingsStore } from "@/stores/settings-store";
import { useFileOperations } from "@/hooks/useFileOperations";
import { isSelfRename, consumeSelfRename } from "@/lib/self-rename-filter";
import { toastExternalRename } from "@/lib/notifications";
import { log } from "@/lib/logger";
import { commentSidecarPath, parseSidecar } from "@/lib/comment-storage";
import { executeRenameTransaction, type SidecarMigrationInput } from "@/lib/rename-transaction";
import { tauriApi } from "@/lib/tauri";

interface FileRenamedPayload {
  old_path: string;
  new_path: string;
  is_directory: boolean;
}

/**
 * Reverse-lookup pass for closed-tab non-project files on folder rename.
 *
 * Lists all path-keyed sidecars in the comments directory and collects
 * migration inputs for any whose `originalPath` falls inside the renamed
 * folder. Returns the inputs so the caller can run them through
 * `executeRenameTransaction` as part of a single crash-safe transaction.
 *
 * Sidecars already migrated by the open-tab pass (new hash path exists) are
 * skipped.
 */
async function collectClosedTabMigrationInputs(
  oldFolderPath: string,
  newFolderPath: string,
  notesRootPath: string,
  projectRoots: string[],
): Promise<SidecarMigrationInput[]> {
  const commentsDir = `${notesRootPath}/.notesage/comments`;
  let entries: Awaited<ReturnType<typeof tauriApi.listDirectory>>;
  try {
    entries = await tauriApi.listDirectory(commentsDir);
  } catch {
    return []; // comments directory does not exist yet
  }

  const inputs: SidecarMigrationInput[] = [];

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

    inputs.push({ oldSidecar: entry.path, newSidecar, newFilePath });
  }

  return inputs;
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
            const oldSidecar = commentSidecarPath(notesRootPath!, old_path);
            const newSidecar = commentSidecarPath(notesRootPath!, new_path);
            void executeRenameTransaction(notesRootPath!, [
              { oldSidecar, newSidecar, newFilePath: new_path },
            ]).catch(() => {});
          }
        } else {
          // Folder rename: collect all migration inputs (open-tab fast path +
          // closed-tab reverse-lookup pass), then run them through a single
          // crash-safe transaction.
          const descendantTabs = openDocs.filter((tab) =>
            tab.filePath.startsWith(new_path + "/")
          );
          const openTabInputs: SidecarMigrationInput[] = [];
          for (const tab of descendantTabs) {
            const isProjectFile = projects.some((p) => tab.filePath.startsWith(p.path + "/"));
            if (!isProjectFile) {
              const oldFilePath = old_path + tab.filePath.slice(new_path.length);
              openTabInputs.push({
                oldSidecar: commentSidecarPath(notesRootPath!, oldFilePath),
                newSidecar: commentSidecarPath(notesRootPath!, tab.filePath),
                newFilePath: tab.filePath,
              });
            }
          }

          // Run open-tab migrations first in their own transaction so they are
          // available to the closed-tab dedup check (alreadyMigrated check uses
          // pathExists on the new sidecar path).
          if (openTabInputs.length > 0) {
            void executeRenameTransaction(notesRootPath!, openTabInputs).catch(() => {});
          }

          // Reverse-lookup: migrate sidecars for closed-tab files whose
          // originalPath was inside the renamed folder.
          void collectClosedTabMigrationInputs(
            old_path,
            new_path,
            notesRootPath!,
            projects.map((p) => p.path),
          ).then((closedInputs) => {
            if (closedInputs.length > 0) {
              return executeRenameTransaction(notesRootPath!, closedInputs);
            }
          }).catch(() => {});
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
