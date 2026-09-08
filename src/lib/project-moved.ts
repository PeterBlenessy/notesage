import type { FileEntry } from "@/lib/tauri";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { useProjectMetadataStore } from "@/stores/project-metadata-store";
import { useEditorStore } from "@/stores/editor-store";

/**
 * Everything that has to change when ONE project's folder moves.
 *
 * There are two features that move a project — the per-project iCloud sync
 * toggle (and project rename, which shares its path) and the library
 * migration — and they had grown two different answers to the same question.
 * The migration's answer was missing a step, which is how a migrated project
 * kept its `project-metadata-store` entry keyed to the OLD path: metadata is
 * keyed by absolute path, so `getProjectLock` returned nothing for every
 * project that moved and an **AI provider lock silently stopped enforcing**
 * until the next launch re-read it from disk. A lock exists precisely so a
 * project's contents cannot reach the wrong provider; quietly switching it
 * off is not a failure it may have.
 *
 * So the bookkeeping lives here once and both call it. The alternative —
 * adding the missing step to the second copy — leaves two routines for one
 * job, which is what produced the gap.
 *
 * Callers still differ in HOW they touch the disk, which is why the two disk
 * operations are injected: during a library migration the roots are locked
 * (`library-lock.ts`) and ordinary writes into them are refused, so that
 * caller passes the migration's own entry points.
 */

export interface ProjectMovedDeps {
  listDirectory: (path: string) => Promise<FileEntry[]>;
  writeFile: (path: string, content: string) => Promise<void>;
  /** Told when the new tree could not be read, rather than swallowing it. */
  onTreeReadFailure?: (path: string, error: unknown) => void;
}

export async function applyProjectMoved(
  oldPath: string,
  newPath: string,
  deps: ProjectMovedDeps,
): Promise<void> {
  // The tree is RE-READ, not blanked. `updateProjectPath(from, to, [])` wipes
  // the cached tree and nothing refills it: the watchers on the new root
  // report only future events, so files already sitting there never produce
  // one, and every moved project renders as an empty folder until a restart —
  // the "my notes are gone" moment this must never cause.
  let tree: FileEntry[] = [];
  try {
    tree = await deps.listDirectory(newPath);
  } catch (error) {
    // Recorded, not swallowed. Pointing at the right place with a stale tree
    // beats pointing at a folder that is no longer there, so the path still
    // updates below.
    deps.onTreeReadFailure?.(newPath, error);
  }
  useWorkspaceStore.getState().updateProjectPath(oldPath, newPath, tree);

  // Project metadata is keyed by ABSOLUTE PATH, and carries the AI lock, the
  // per-project AI overrides and the name. Re-keyed here, and the name
  // brought in line with the folder it now lives in.
  const meta = useProjectMetadataStore.getState().metadataMap[oldPath];
  if (meta) {
    const store = useProjectMetadataStore.getState();
    const name = newPath.split("/").filter(Boolean).pop() || meta.name;
    const updated = { ...meta, name };
    store.removeMetadata(oldPath);
    store.setMetadata(newPath, updated);
    try {
      await deps.writeFile(`${newPath}/.notesage/project.json`, JSON.stringify(updated, null, 2));
    } catch (error) {
      // In-memory state is already correct; the file is refreshed from it on
      // the next bootstrap. Not worth failing a move over.
      deps.onTreeReadFailure?.(`${newPath}/.notesage/project.json`, error);
    }
  }

  // `renameOpenDocument`, NOT `updateFilePaths`. The latter matches on a bare
  // `startsWith(oldPrefix)` with no path boundary, so moving a project called
  // `Notes` also rewrites a sibling `Notesbook.md` into `<new>book.md` —
  // pointing an open tab, a recent and a scroll position at a file that does
  // not exist. `renameOpenDocument` matches the path or the path plus a
  // separator, and covers the same state (open documents, persisted tabs, the
  // persisted active path, recents, scroll positions).
  useEditorStore.getState().renameOpenDocument(oldPath, newPath);
}
