import { tauriApi } from "@/lib/tauri";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { useEditorStore } from "@/stores/editor-store";
import { useSettingsStore } from "@/stores/settings-store";
import { applyProjectMoved } from "@/lib/project-moved";
import { collectSidecarFilePaths } from "@/lib/library-migration-run";
import { executeRenameTransaction, type SidecarMigrationInput } from "@/lib/rename-transaction";
import { hashPath } from "@/lib/comment-storage";
import { isUnder } from "@/lib/library-migration-paths";
import { followPath, planLibraryFollow } from "@/lib/library-follow";
import { log } from "@/lib/logger";

export interface FollowResult {
  /** Projects and explorer folders re-pointed at the new library. */
  followed: string[];
}

/**
 * Re-point this Mac's stored paths at a library another device moved.
 * See `library-follow.ts` for the rule; this applies it to the stores.
 *
 * Safe to call on every launch: it does nothing unless something stored here
 * sits under the old root AND that entry is gone from it and present in the
 * new one.
 */
export async function followLibraryMove(oldRoot: string, newRoot: string): Promise<FollowResult> {
  const ws = useWorkspaceStore.getState();
  const editor = useEditorStore.getState();

  const stored = [
    ...ws.projects.map((p) => p.path),
    ...ws.explorerFolders.map((f) => f.path),
    ...ws.pinnedFiles,
    ...ws.recentProjects.map((r) => r.path),
    ...ws.dismissedLibraryProjects,
    ...editor.openDocuments.map((d) => d.filePath),
    ...editor.persistedTabs.map((t) => t.filePath),
    ...(editor.recentFiles ?? []).map((r) => r.path),
  ].filter((p): p is string => Boolean(p));
  if (!stored.some((p) => isUnder(p, oldRoot))) return { followed: [] };

  // Comments on non-project files are keyed by a hash of the path, so they
  // follow too — read only now that there is known to be something to follow.
  const notesRoot = useSettingsStore.getState().notesRootPath;
  let sidecarPaths: string[] = [];
  if (notesRoot && !notesRoot.startsWith("~")) {
    try {
      sidecarPaths = (await collectSidecarFilePaths(notesRoot)).paths;
    } catch (err) {
      log.warn("startup", `library follow: comment sidecars unreadable: ${err}`);
    }
  }

  const plan = await planLibraryFollow({
    oldRoot,
    newRoot,
    paths: [...stored, ...sidecarPaths],
    exists: (p) => tauriApi.pathExists(p),
  });
  if (plan.renames.length === 0) return { followed: [] };
  const to = (p: string) => followPath(p, plan, oldRoot, newRoot);
  const followed: string[] = [];

  // Projects: the shared bookkeeping (tree re-read, metadata re-key, tabs).
  for (const project of ws.projects) {
    const dest = to(project.path);
    if (!dest) continue;
    await applyProjectMoved(project.path, dest, {
      listDirectory: (p) => tauriApi.listDirectory(p, useSettingsStore.getState().showHiddenFiles),
      writeFile: (p, c) => tauriApi.writeFile(p, c),
    });
    followed.push(dest);
  }

  for (const folder of ws.explorerFolders) {
    const dest = to(folder.path);
    if (!dest) continue;
    let tree: Awaited<ReturnType<typeof tauriApi.listDirectory>> = [];
    try {
      tree = await tauriApi.listDirectory(dest, useSettingsStore.getState().showHiddenFiles);
    } catch {
      // Still re-pointed: the right place with an empty tree beats removal.
    }
    useWorkspaceStore.getState().updateExplorerFolderPath(folder.path, dest, tree);
    followed.push(dest);
  }

  // Everything else, one moved entry at a time, so an entry that stayed
  // behind in the old root is never touched.
  for (const r of plan.renames) {
    const from = `${oldRoot}/${r.from}`;
    const dest = `${newRoot}/${r.to}`;
    useWorkspaceStore.getState().rebaseStoredPaths(from, dest);
    useEditorStore.getState().renameOpenDocument(from, dest);
  }

  const sidecars: SidecarMigrationInput[] = [];
  for (const file of sidecarPaths) {
    const dest = to(file);
    if (!dest) continue;
    sidecars.push({
      oldSidecar: `${notesRoot}/.notesage/comments/path-${hashPath(file)}.json`,
      newSidecar: `${notesRoot}/.notesage/comments/path-${hashPath(dest)}.json`,
      newFilePath: dest,
    });
  }
  if (sidecars.length && notesRoot) {
    try {
      await executeRenameTransaction(notesRoot, sidecars);
    } catch (err) {
      log.warn("startup", `library follow: comment sidecars not re-keyed: ${err}`);
    }
  }

  log.info("startup", `Followed library move for ${plan.renames.length} entries`, {
    renames: plan.renames,
  });
  return { followed };
}
