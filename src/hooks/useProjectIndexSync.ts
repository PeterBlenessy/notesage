import { useEffect, useRef } from "react";
import { tauriApi } from "@/lib/tauri";
import { log } from "@/lib/logger";
import { isReservedLibraryFolder } from "@/lib/library-reserved-folders";
import { ensureProjectIndex, forgetProjectIndex } from "@/lib/project-index-sync";
import { useSettingsStore } from "@/stores/settings-store";
import { useWorkspaceStore } from "@/stores/workspace-store";

/** Separates project paths in the effect key. Cannot occur in a path. */
const KEY_SEPARATOR = "\n";

/** The Inbox and Recordings folders are native features, never projects. */
function isReservedFolder(path: string): boolean {
  const { notesRootPath, icloudNotesagePath } = useSettingsStore.getState();
  return [notesRootPath, icloudNotesagePath].some(
    (root) => Boolean(root) && isReservedLibraryFolder(path, root as string),
  );
}

/**
 * Open the databases first, so the watcher's events for these projects are
 * routed to them from now on instead of to the global database, then build
 * each index in the background. The backend announces each finished pass with
 * `index-ready`, which is what the index-backed views re-query on.
 */
async function indexAddedProjects(paths: string[]): Promise<void> {
  try {
    await tauriApi.indexOpen(paths);
  } catch (error) {
    // `index_init` opens the database itself; only the routing came late.
    log.warn("index", "Could not open the index databases of added projects", error);
  }
  await Promise.all(paths.map((path) => ensureProjectIndex(path)));
}

/**
 * Index a project that joins the workspace while the app is running.
 *
 * The document index used to be built at startup only, so a project that was
 * created, opened, discovered by the watcher or the cross-device scan, renamed
 * or moved with the library afterwards had no index until the next launch:
 * nothing of it in search, tags, mentions, tasks or backlinks, and its watcher
 * events were indexed into the global database instead.
 *
 * The projects present when startup finishes belong to the startup pass; this
 * hook takes every path that appears after that. Both go through
 * `ensureProjectIndex`, so neither can double the other. A renamed or moved
 * project is a new path here and is indexed as one.
 *
 * Must be mounted in App.tsx.
 */
export function useProjectIndexSync() {
  const startupReady = useSettingsStore((s) => s.startupReady);
  // A joined string, so the effect runs when the SET of roots changes and not
  // when a tree's contents do (which replaces `projects` on every file event).
  const projectPathsKey = useWorkspaceStore((s) =>
    s.projects.map((p) => p.path).join(KEY_SEPARATOR),
  );
  /** The project paths seen last; null until startup has finished. */
  const known = useRef<Set<string> | null>(null);

  useEffect(() => {
    // Until reloadTrees() has validated the paths, nothing is settled.
    if (!startupReady) return;

    const current = new Set(projectPathsKey === "" ? [] : projectPathsKey.split(KEY_SEPARATOR));
    const previous = known.current;
    known.current = current;
    // First look: these are the startup pass's projects.
    if (previous === null) return;

    for (const path of previous) {
      if (!current.has(path)) forgetProjectIndex(path);
    }
    const added = [...current].filter((path) => !previous.has(path) && !isReservedFolder(path));
    if (added.length > 0) {
      // Never rejects (`ensureProjectIndex` reports and recovers on its own);
      // the catch keeps it that way if that ever changes.
      void indexAddedProjects(added).catch((error) => {
        log.error("index", "Indexing added projects failed", error);
      });
    }
  }, [startupReady, projectPathsKey]);
}
