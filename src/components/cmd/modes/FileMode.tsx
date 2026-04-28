import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { tauriApi, type IndexFilenameSearchResult } from "@/lib/tauri";
import {
  getDefaultPaletteScope,
  resolveSearchPaths,
} from "@/lib/command-palette";
import { useEditorStore } from "@/stores/editor-store";
import { useSettingsStore } from "@/stores/settings-store";
import { useFileOperations } from "@/hooks/useFileOperations";
import { FileIcon } from "@/components/sidebar/FileIcon";
import { cn } from "@/lib/utils";

/**
 * FileMode — picker for the `:file <query>` verb mode (PRD
 * `2026-04-28-cmd-bar-verb-prefixes`, tasks #8 + #9 + #10).
 *
 * Filename-only substring search across the active chat scope, backed
 * by the SQLite-backed `index_search_filenames` Tauri command (#1).
 * Results render as a vertical list — file icon, basename, parent
 * directory in muted text. Enter / click opens the file in a new
 * editor tab via `useFileOperations.openFile`.
 *
 * Empty filter (`:file ` with nothing after) renders an MRU list
 * sourced from `editor-store.recentFiles` instead of querying the
 * backend — lets the user start scanning before they've typed (#10).
 *
 * Scope rules (#9): `getDefaultPaletteScope` returns the active chat
 * conversation's selected project paths (or `'all'` when none are
 * selected); `resolveSearchPaths` intersects with the indexed-paths
 * set so callers can't leak outside known workspace folders. Hidden
 * files are filtered in the frontend so the user can flip the
 * Settings > System > "Show hidden files" toggle without re-querying.
 *
 * Wrapping component (`FloatingCommandBar`) is the single keyboard /
 * focus owner — this picker uses a document-level keydown listener
 * so the parent input keeps focus while the picker is mounted
 * (matches the suggestion-style mode pickers wired in #14–#19).
 */

export interface FileModeProps {
  /** Text typed after the `:file ` prefix. */
  filter: string;
  /** Called after Enter / click on a row, after the file opens. */
  onPick?: () => void;
  /** Called when the user presses Esc inside the picker. */
  onDismiss?: () => void;
  /**
   * DOM id used as the listbox's `id` attribute and as the prefix for
   * option ids. Enables the parent FloatingCommandBar to wire
   * `aria-controls` and `aria-activedescendant` on its combobox input.
   */
  listboxId?: string;
  /**
   * Fires whenever the active option / result count changes. Lets the
   * parent FloatingCommandBar keep `aria-activedescendant` in sync
   * without the picker moving DOM focus away from the input.
   */
  onActiveOptionChange?: (info: {
    listboxId: string;
    activeOptionId: string | null;
    count: number;
  }) => void;
}

const RESULT_LIMIT = 50;
const QUERY_DEBOUNCE_MS = 300;

interface FileRow {
  /** Absolute path. */
  path: string;
  /** Basename. */
  name: string;
  /** Parent directory (muted text on the right). */
  parentDir: string;
}

function FileMode({
  filter,
  onPick,
  onDismiss,
  listboxId = "cmd-file-listbox",
  onActiveOptionChange,
}: FileModeProps) {
  const [results, setResults] = useState<IndexFilenameSearchResult[]>([]);
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showHiddenFiles = useSettingsStore((s) => s.showHiddenFiles);
  // MRU empty-state — when the filter is empty, we render this list
  // instead of querying the backend (#10). Subscribe lazily to keep
  // the picker re-render cost flat while the user is typing.
  const recentFiles = useEditorStore((s) => s.recentFiles);
  const { openFile: openFileEntry } = useFileOperations();

  const trimmedFilter = filter.trim();
  const isEmptyFilter = trimmedFilter.length === 0;

  // ------------------------------------------------------------------
  // Backend query (debounced) — only fires when the filter is
  // non-empty. The empty path renders the MRU list instead.
  // ------------------------------------------------------------------

  useEffect(() => {
    if (debounceTimer.current) {
      clearTimeout(debounceTimer.current);
    }

    if (isEmptyFilter) {
      setResults([]);
      setHighlightedIndex(0);
      return;
    }

    let cancelled = false;
    debounceTimer.current = setTimeout(async () => {
      try {
        const paths = resolveSearchPaths(getDefaultPaletteScope());
        const fetched = await tauriApi.indexSearchFilenames(
          paths,
          trimmedFilter,
          RESULT_LIMIT,
        );
        if (cancelled) return;
        setResults(fetched);
        setHighlightedIndex(0);
      } catch (err) {
        if (cancelled) return;
        console.error("[FileMode] indexSearchFilenames failed", err);
        setResults([]);
        setHighlightedIndex(0);
      }
    }, QUERY_DEBOUNCE_MS);

    return () => {
      cancelled = true;
      if (debounceTimer.current) {
        clearTimeout(debounceTimer.current);
        debounceTimer.current = null;
      }
    };
  }, [trimmedFilter, isEmptyFilter]);

  // ------------------------------------------------------------------
  // Hidden-files filtering + scope-aware MRU build (#9 + #10).
  // ------------------------------------------------------------------

  const rows: FileRow[] = useMemo(() => {
    if (isEmptyFilter) {
      // MRU empty-state — scope MRU entries by the same project
      // paths the backend query uses; only show entries inside the
      // active scope. Hidden-files toggle applies the same way.
      const scopePaths = resolveSearchPaths(getDefaultPaletteScope());
      const scopeSet = scopePaths;
      return recentFiles
        .filter((rec) => {
          const baseName = rec.path.split("/").pop() ?? "";
          if (baseName === ".DS_Store") return false;
          if (!showHiddenFiles && baseName.startsWith(".")) return false;
          // In-scope = path begins with one of the resolved scope
          // paths. Empty scope (no projects + no notes root) falls
          // through to all-indexed via `resolveSearchPaths`, so
          // this prefix-check still does the right thing.
          return scopeSet.some((p) => rec.path.startsWith(p + "/") || rec.path === p);
        })
        .slice(0, RESULT_LIMIT)
        .map((rec) => ({
          path: rec.path,
          name: rec.name,
          parentDir: rec.path.slice(0, rec.path.length - rec.name.length - 1),
        }));
    }
    // Search-result path. Hidden-files filter happens here so the
    // toggle is interactive without re-querying the backend.
    return results
      .filter((r) => {
        if (r.file_name === ".DS_Store") return false;
        if (!showHiddenFiles && r.file_name.startsWith(".")) return false;
        return true;
      })
      .map((r) => ({
        path: r.path,
        name: r.file_name,
        parentDir: r.parent_dir,
      }));
  }, [isEmptyFilter, results, recentFiles, showHiddenFiles]);

  // Report active option state upward so the parent can mirror it on
  // its combobox input via aria-activedescendant.
  useEffect(() => {
    if (!onActiveOptionChange) return;
    const activeOptionId =
      rows.length > 0 ? `${listboxId}-opt-${highlightedIndex}` : null;
    onActiveOptionChange({
      listboxId,
      activeOptionId,
      count: rows.length,
    });
  }, [onActiveOptionChange, listboxId, highlightedIndex, rows.length]);

  // ------------------------------------------------------------------
  // Selection helpers.
  // ------------------------------------------------------------------

  const selectIndex = useCallback(
    (index: number) => {
      const row = rows[index];
      if (!row) return;
      void openFileEntry(row.path, row.name);
      onPick?.();
    },
    [rows, openFileEntry, onPick],
  );

  // ------------------------------------------------------------------
  // Keyboard nav (document-level so the parent input keeps focus).
  // ------------------------------------------------------------------

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (rows.length === 0 && event.key !== "Escape") return;
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setHighlightedIndex((prev) =>
          rows.length === 0 ? 0 : Math.min(prev + 1, rows.length - 1),
        );
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        setHighlightedIndex((prev) => Math.max(prev - 1, 0));
      } else if (event.key === "Enter") {
        if (rows.length === 0) return;
        event.preventDefault();
        selectIndex(highlightedIndex);
      } else if (event.key === "Escape") {
        onDismiss?.();
      }
    };
    document.addEventListener("keydown", handler);
    return () => {
      document.removeEventListener("keydown", handler);
    };
  }, [rows, highlightedIndex, selectIndex, onDismiss]);

  // ------------------------------------------------------------------
  // Render.
  // ------------------------------------------------------------------

  if (rows.length === 0) {
    if (isEmptyFilter) {
      return (
        <div
          id={listboxId}
          role="listbox"
          aria-label="Recent files"
          className="px-3 py-2 text-xs text-muted-foreground"
        >
          No recent files in the active scope.
        </div>
      );
    }
    return (
      <div
        id={listboxId}
        role="listbox"
        aria-label="File search results"
        className="px-3 py-2 text-xs text-muted-foreground"
      >
        No files matching "{trimmedFilter}".
        {!showHiddenFiles && (
          <span className="block mt-1 text-[11px] opacity-70">
            Hidden files are excluded — toggle in Settings &gt; System.
          </span>
        )}
      </div>
    );
  }

  return (
    <div
      id={listboxId}
      role="listbox"
      aria-label={isEmptyFilter ? "Recent files" : "File search results"}
      className="flex flex-col py-1"
    >
      {rows.map((row, index) => {
        const isActive = index === highlightedIndex;
        return (
          <button
            type="button"
            id={`${listboxId}-opt-${index}`}
            role="option"
            aria-selected={isActive}
            key={`${row.path}-${index}`}
            data-index={index}
            onMouseEnter={() => setHighlightedIndex(index)}
            onClick={() => selectIndex(index)}
            className={cn(
              "flex items-center gap-2 px-3 py-1.5 text-left transition-colors text-[13px]",
              isActive
                ? "bg-[var(--color-accent-primary)] text-[oklch(100%_0_0)]"
                : "text-foreground hover:bg-muted/60",
              "focus-visible:outline-none focus-visible:[outline:1px_solid_var(--color-accent-primary)] focus-visible:[outline-offset:2px]",
            )}
          >
            <FileIcon
              fileName={row.name}
              className={cn(
                "h-3.5 w-3.5 shrink-0",
                isActive ? "opacity-90" : "text-muted-foreground",
              )}
            />
            <span className="flex-1 truncate font-medium">{row.name}</span>
            {row.parentDir && (
              <span
                className={cn(
                  "shrink-0 truncate max-w-[40%] text-xs",
                  isActive
                    ? "text-[oklch(100%_0_0)]/75"
                    : "text-muted-foreground",
                )}
                title={row.parentDir}
              >
                {row.parentDir}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

export default FileMode;
