import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { useWorkspaceStore } from "@/stores/workspace-store";

/** Separates project paths in the roots key. Cannot occur in a path. */
const KEY_SEPARATOR = "\n";

/**
 * How long a burst of tree changes is allowed to settle before the index is
 * asked again. A watcher batch reaches the tree a file at a time, and the
 * backend reindexes the same files in the background; asking once, shortly
 * after the last change, costs one query instead of one per change.
 */
export const INDEX_REQUERY_DEBOUNCE_MS = 500;

export interface IndexQueryTrigger {
  /** The project roots to query. Same array for as long as the set of roots is the same. */
  projectPaths: string[];
  /** Bumped when the index should be asked again although the roots did not change. */
  revision: number;
}

/**
 * When a sidebar section that reads the document index (Tags, Mentions)
 * should query it.
 *
 * - Immediately, when the SET of project roots changes: `projectPaths` gets a
 *   new identity only then.
 * - Once, {@link INDEX_REQUERY_DEBOUNCE_MS} after the last change, when a
 *   project's tree really changed (a file created, deleted or renamed) or the
 *   backend reports that an index pass finished (`index-ready`): `revision`
 *   is bumped.
 *
 * The backend emits nothing when a single file is reindexed, so the tree is
 * the nearest signal there is for "the index content may have changed".
 * `updateProjectTree` keeps `projects` identical when a refresh found nothing
 * new, so a refresh that changed nothing triggers no query at all; before,
 * every refresh was a new array and each one queried the index.
 */
export function useIndexQueryTrigger(): IndexQueryTrigger {
  const projects = useWorkspaceStore((s) => s.projects);
  const rootsKey = projects.map((p) => p.path).join(KEY_SEPARATOR);
  const projectPaths = useMemo(
    () => (rootsKey === "" ? [] : rootsKey.split(KEY_SEPARATOR)),
    [rootsKey],
  );

  const [revision, setRevision] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const bumpSoon = useCallback(() => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setRevision((r) => r + 1), INDEX_REQUERY_DEBOUNCE_MS);
  }, []);

  const seen = useRef({ projects, rootsKey });
  useEffect(() => {
    const previous = seen.current;
    seen.current = { projects, rootsKey };
    if (previous.rootsKey !== rootsKey) {
      // The consumer queries at once for a new set of roots; a re-query still
      // waiting from before would only repeat it.
      clearTimeout(timer.current);
    } else if (previous.projects !== projects) {
      bumpSoon();
    }
  }, [projects, rootsKey, bumpSoon]);

  useEffect(() => {
    let active = true;
    let unlisten: (() => void) | null = null;
    // A query made while a project is still being indexed returns what is
    // indexed so far; ask again when the pass finishes.
    listen("index-ready", () => {
      if (active) bumpSoon();
    })
      .then((fn) => {
        if (active) unlisten = fn;
        else fn();
      })
      .catch(() => {
        // No event bridge (tests, a non-Tauri host): tree changes still trigger.
      });
    return () => {
      active = false;
      unlisten?.();
      clearTimeout(timer.current);
    };
  }, [bumpSoon]);

  return { projectPaths, revision };
}
