/**
 * useDocumentRelations — loads the link-graph relations (backlinks + outlinks)
 * for a document path from the standalone `links.db` (OKF wiki-navigation,
 * tasks #7–#9).
 *
 * The hook backs the {@link RelationsPanel}: it surfaces *Linked from*
 * (backlinks, grouped by source) and *Links to* (forward links, enriched with
 * the target's frontmatter) for the active document, plus loading / error /
 * empty states. Results are memoized per path — switching documents re-fetches,
 * but a re-render with the same path reuses the in-flight / settled result.
 *
 * Source of truth for the active path is `editor-store` (`activeTabId` →
 * `openDocuments[].filePath`); callers that already know the path (e.g. the
 * hover-preview resolver) can pass it explicitly.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { tauriApi } from "@/lib/tauri";
import type { BacklinkGroup, LinkRow } from "@/lib/tauri";
import { useEditorStore } from "@/stores/editor-store";

export interface DocumentRelations {
  /** "Linked from" — backlinks grouped by source document (ADR 0006). */
  backlinks: BacklinkGroup[];
  /** "Links to" — forward links enriched with target frontmatter (ADR 0006). */
  outlinks: LinkRow[];
}

export interface UseDocumentRelationsResult extends DocumentRelations {
  /** The resolved path the relations belong to (`null` when no doc is open). */
  path: string | null;
  /** True while the initial load for the current path is in flight. */
  loading: boolean;
  /** Error message when the query failed, else `null`. */
  error: string | null;
  /** True once loaded and there are zero backlinks AND zero outlinks. */
  isEmpty: boolean;
  /** Total relation count (backlink occurrences + forward links) for the badge. */
  count: number;
  /** Re-run the query for the current path (e.g. after an external reindex). */
  refresh: () => void;
}

const EMPTY_BACKLINKS: BacklinkGroup[] = [];
const EMPTY_OUTLINKS: LinkRow[] = [];

/** Count every relation that contributes to the panel's badge. */
export function countRelations(
  backlinks: BacklinkGroup[],
  outlinks: LinkRow[],
): number {
  const backlinkOccurrences = backlinks.reduce(
    (sum, group) => sum + group.occurrences.length,
    0,
  );
  return backlinkOccurrences + outlinks.length;
}

/**
 * Load relations for `pathArg`, or — when omitted — for the active document.
 * Only markdown-ish documents are queried; a non-string path yields the empty
 * state without an IPC call.
 */
export function useDocumentRelations(
  pathArg?: string | null,
): UseDocumentRelationsResult {
  // Resolve the active document path from editor-store unless the caller
  // supplied an explicit path. The selector returns a stable string so the
  // effect below only re-fires on a genuine document switch.
  const activePath = useEditorStore((s) => {
    if (!s.activeTabId) return null;
    const tab = s.openDocuments.find((t) => t.id === s.activeTabId);
    return tab?.filePath ?? null;
  });

  const path = pathArg !== undefined ? pathArg : activePath;

  const [backlinks, setBacklinks] = useState<BacklinkGroup[]>(EMPTY_BACKLINKS);
  const [outlinks, setOutlinks] = useState<LinkRow[]>(EMPTY_OUTLINKS);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Bump to force a re-fetch of the current path without changing it.
  const [refreshTick, setRefreshTick] = useState(0);
  const refresh = useCallback(() => setRefreshTick((n) => n + 1), []);

  // Guards async writes so a stale in-flight request for a previous path (or a
  // request after unmount) never clobbers the current state.
  const requestIdRef = useRef(0);

  useEffect(() => {
    // No open document (or a non-path) → clear to the empty state, no IPC.
    if (!path) {
      requestIdRef.current += 1;
      setBacklinks(EMPTY_BACKLINKS);
      setOutlinks(EMPTY_OUTLINKS);
      setLoading(false);
      setError(null);
      return;
    }

    const requestId = ++requestIdRef.current;
    let cancelled = false;
    setLoading(true);
    setError(null);

    void Promise.all([tauriApi.getBacklinks(path), tauriApi.getOutlinks(path)])
      .then(([back, out]) => {
        if (cancelled || requestIdRef.current !== requestId) return;
        setBacklinks(back);
        setOutlinks(out);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (cancelled || requestIdRef.current !== requestId) return;
        setBacklinks(EMPTY_BACKLINKS);
        setOutlinks(EMPTY_OUTLINKS);
        setError(err instanceof Error ? err.message : String(err));
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [path, refreshTick]);

  const count = useMemo(
    () => countRelations(backlinks, outlinks),
    [backlinks, outlinks],
  );

  // "Empty" means a settled (not loading, no error) query returned nothing.
  const isEmpty = !loading && error === null && count === 0;

  return {
    path,
    backlinks,
    outlinks,
    loading,
    error,
    isEmpty,
    count,
    refresh,
  };
}
