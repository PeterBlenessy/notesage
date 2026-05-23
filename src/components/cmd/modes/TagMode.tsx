import { useEffect, useMemo, useRef, useState } from "react";
import { Hash, ChevronLeft, FileText } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  tauriApi,
  type IndexedTag,
  type IndexTagOccurrence,
} from "@/lib/tauri";
import { useWorkspaceStore } from "@/stores/workspace-store";

/**
 * TagMode — picker for the `#tag` prefix mode in the FloatingCommandBar.
 *
 * Two-level drilldown:
 *   1. Top level — list of tags from `tauriApi.indexTags`, ordered by
 *      file_count descending. Click / Enter selects a tag and drills into
 *      its occurrences.
 *   2. Second level — list of files containing the selected tag, fetched
 *      via `tauriApi.indexTagOccurrences`. Each row shows the file name and
 *      a context snippet around the tag. Click / Enter on an occurrence
 *      emits `{ kind: 'occurrence', filePath, fileName, symbol, occurrenceInFile }`
 *      via `onPick`; the parent dispatches the file-open. Esc returns to
 *      the top level.
 *
 * Keyboard nav (ArrowUp/ArrowDown/Enter/Esc) is bound to `window` so the
 * parent FloatingCommandBar's textarea can keep focus while the picker
 * floats above it. Esc behaviour:
 *   - At level 2 → return to level 1 (don't dismiss the bar)
 *   - At level 1 → no-op here; the parent's bus subscriber owns dismissal
 *
 * Live-test 2026-04-26 — slice 2 (drilldown) of the cmd-bar parity work.
 * Slice 1 wired single-level pickers + navigation; this slice adds the
 * two-level drilldown the user explicitly asked for.
 */

export type TagPickAction = {
  kind: "occurrence";
  filePath: string;
  fileName: string;
  /** The full `#tagname` symbol — matches `useFileOperations.openFileAtTag`. */
  symbol: string;
  /** 0-based index of the occurrence within the file. */
  occurrenceInFile: number;
};

export interface TagModeProps {
  filter: string;
  /** Fires when the user picks an occurrence at level 2. */
  onPick: (action: TagPickAction) => void;
  onDismiss?: () => void;
  listboxId?: string;
  onActiveOptionChange?: (info: {
    listboxId: string;
    activeOptionId: string | null;
    count: number;
  }) => void;
  /**
   * When set, the picker mounts directly at the level-2 (occurrences) view
   * for the given tag — used by the sidebar TagsSection click path so a
   * single click jumps from the row to the file list. Optional.
   */
  initialDrilldown?: string | null;
}

interface TagRow {
  name: string;
  usageCount: number;
}

const MAX_RESULTS = 50;

function TagMode({
  filter,
  onPick,
  listboxId = "cmd-tag-listbox",
  onActiveOptionChange,
  initialDrilldown,
}: TagModeProps) {
  const projects = useWorkspaceStore((s) => s.projects);
  const projectPaths = useMemo(() => projects.map((p) => p.path), [projects]);

  // ---------------------------------------------------------------------
  // Level 1 — tag list
  // ---------------------------------------------------------------------
  const [allTags, setAllTags] = useState<TagRow[]>([]);
  const [highlighted, setHighlighted] = useState(0);
  const reqIdRef = useRef(0);

  useEffect(() => {
    const reqId = ++reqIdRef.current;
    tauriApi
      .indexTags(projectPaths, undefined)
      .then((rows: IndexedTag[]) => {
        if (reqId !== reqIdRef.current) return;
        setAllTags(
          rows.map((r) => ({ name: r.tag, usageCount: r.file_count })),
        );
      })
      .catch(() => {
        if (reqId !== reqIdRef.current) return;
        setAllTags([]);
      });
  }, [projectPaths]);

  // ---------------------------------------------------------------------
  // Level 2 — occurrences for the selected tag
  // ---------------------------------------------------------------------
  const [selectedTag, setSelectedTag] = useState<string | null>(
    initialDrilldown ?? null,
  );

  // Re-sync when the drilldown seed changes (e.g. user clicks a different
  // sidebar tag while the bar is already open).
  useEffect(() => {
    if (initialDrilldown != null) setSelectedTag(initialDrilldown);
  }, [initialDrilldown]);
  const [occurrences, setOccurrences] = useState<IndexTagOccurrence[]>([]);
  const [occHighlighted, setOccHighlighted] = useState(0);
  const occReqIdRef = useRef(0);

  useEffect(() => {
    if (selectedTag === null) {
      setOccurrences([]);
      return;
    }
    const reqId = ++occReqIdRef.current;
    tauriApi
      .indexTagOccurrences(selectedTag, projectPaths)
      .then((rows) => {
        if (reqId !== occReqIdRef.current) return;
        setOccurrences(rows);
        setOccHighlighted(0);
      })
      .catch(() => {
        if (reqId !== occReqIdRef.current) return;
        setOccurrences([]);
      });
  }, [selectedTag, projectPaths]);

  // Derive level-1 results. Ordering preserved from the backend (file_count desc).
  const results = useMemo<TagRow[]>(() => {
    const needle = filter.trim().toLowerCase();
    const filtered = needle
      ? allTags.filter((t) => t.name.toLowerCase().includes(needle))
      : allTags;
    return filtered.slice(0, MAX_RESULTS);
  }, [allTags, filter]);

  useEffect(() => {
    setHighlighted(0);
  }, [results.length]);

  // Report active option upward so the parent's combobox can mirror state
  // via aria-activedescendant. Switches between the two levels' listbox ids.
  useEffect(() => {
    if (!onActiveOptionChange) return;
    if (selectedTag !== null) {
      const id =
        occurrences.length > 0
          ? `${listboxId}-occ-${occHighlighted}`
          : null;
      onActiveOptionChange({
        listboxId: `${listboxId}-occ`,
        activeOptionId: id,
        count: occurrences.length,
      });
      return;
    }
    const id =
      results.length > 0 ? `${listboxId}-opt-${highlighted}` : null;
    onActiveOptionChange({
      listboxId,
      activeOptionId: id,
      count: results.length,
    });
  }, [
    onActiveOptionChange,
    listboxId,
    selectedTag,
    occurrences.length,
    occHighlighted,
    results.length,
    highlighted,
  ]);

  // Window-level keyboard nav (input keeps focus).
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      // Level 2 — occurrences
      if (selectedTag !== null) {
        if (event.key === "ArrowDown") {
          if (occurrences.length === 0) return;
          event.preventDefault();
          setOccHighlighted((h) =>
            Math.min(h + 1, occurrences.length - 1),
          );
        } else if (event.key === "ArrowUp") {
          if (occurrences.length === 0) return;
          event.preventDefault();
          setOccHighlighted((h) => Math.max(h - 1, 0));
        } else if (event.key === "Enter") {
          if (occurrences.length === 0) return;
          event.preventDefault();
          const occ = occurrences[occHighlighted];
          if (!occ) return;
          // The occurrence index from the backend is sequential within the
          // returned list — `occHighlighted` is the index INTO that list,
          // which is also the 0-based occurrence index within the file
          // when the file appears multiple times. The backend currently
          // returns one row per (file, position), so this matches.
          onPick({
            kind: "occurrence",
            filePath: occ.path,
            fileName: occ.file_name,
            symbol: `#${selectedTag}`,
            occurrenceInFile: occHighlighted,
          });
        } else if (event.key === "Escape") {
          event.preventDefault();
          // Stop propagation so the bar's window-level dismiss handler
          // doesn't ALSO consume this Esc and collapse the bar — Esc at
          // level 2 means "back to level 1", not "dismiss".
          event.stopPropagation();
          setSelectedTag(null);
        }
        return;
      }

      // Level 1 — tags
      if (results.length === 0) return;
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setHighlighted((h) => Math.min(h + 1, results.length - 1));
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        setHighlighted((h) => Math.max(h - 1, 0));
      } else if (event.key === "Enter") {
        event.preventDefault();
        const pick = results[highlighted];
        if (pick) setSelectedTag(pick.name);
      }
    };
    // Capture phase so we beat the bar's window-level dismiss handler at
    // level 2 (where Esc means "back", not "dismiss").
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, [
    results,
    highlighted,
    selectedTag,
    occurrences,
    occHighlighted,
    onPick,
  ]);

  // ---------------------------------------------------------------------
  // Render — level 2 (drilldown) when a tag is selected, level 1 otherwise.
  // ---------------------------------------------------------------------

  if (selectedTag !== null) {
    return (
      <div
        data-cmd-mode="tag"
        data-cmd-mode-level="occurrences"
        id={`${listboxId}-occ`}
        role="listbox"
        aria-label={`Occurrences of #${selectedTag}`}
      >
        <DrilldownHeader
          label={`#${selectedTag}`}
          count={occurrences.length}
          onBack={() => setSelectedTag(null)}
        />
        {occurrences.length === 0 ? (
          <div className="px-3 py-3 text-xs text-muted-foreground">
            No occurrences found
          </div>
        ) : (
          <ul className="py-1">
            {occurrences.map((occ, idx) => {
              const selected = idx === occHighlighted;
              return (
                <li
                  key={`${occ.path}-${idx}`}
                  id={`${listboxId}-occ-${idx}`}
                  role="option"
                  aria-selected={selected ? "true" : "false"}
                  onMouseEnter={() => setOccHighlighted(idx)}
                  onClick={() =>
                    onPick({
                      kind: "occurrence",
                      filePath: occ.path,
                      fileName: occ.file_name,
                      symbol: `#${selectedTag}`,
                      occurrenceInFile: idx,
                    })
                  }
                  className={cn(
                    "flex items-start gap-2 px-3 py-1.5 cursor-pointer",
                    "text-[13px] transition-colors",
                    selected
                      ? "bg-muted/80 text-foreground"
                      : "text-foreground hover:bg-muted/60",
                  )}
                >
                  <FileText
                    size={12}
                    strokeWidth={1.5}
                    className="mt-[3px] shrink-0 text-muted-foreground"
                    aria-hidden
                  />
                  <div className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate font-medium">
                      {occ.file_name}
                    </span>
                    {(occ.context_before || occ.context_after) && (
                      <span className="truncate text-xs text-muted-foreground">
                        …{occ.context_before}
                        <span className="font-medium text-foreground">
                          #{selectedTag}
                        </span>
                        {occ.context_after}…
                      </span>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    );
  }

  // Level 1
  if (results.length === 0) {
    return (
      <div
        data-cmd-mode="tag"
        data-cmd-mode-level="tags"
        id={listboxId}
        role="listbox"
        aria-label="Tags"
        className={cn("px-3 py-3", "text-xs text-muted-foreground")}
      >
        No tags match
      </div>
    );
  }

  return (
    <ul
      data-cmd-mode="tag"
      data-cmd-mode-level="tags"
      id={listboxId}
      role="listbox"
      aria-label="Tags"
      className={cn("py-1")}
    >
      {results.map((row, idx) => {
        const selected = idx === highlighted;
        return (
          <li
            key={row.name}
            id={`${listboxId}-opt-${idx}`}
            role="option"
            aria-selected={selected ? "true" : "false"}
            onMouseEnter={() => setHighlighted(idx)}
            onClick={() => setSelectedTag(row.name)}
            className={cn(
              "flex items-center gap-2 px-3 py-1.5 cursor-pointer",
              "text-[13px]",
              "transition-colors",
              selected
                ? "bg-muted/80 text-foreground"
                : "text-foreground hover:bg-muted/60",
            )}
          >
            <Hash
              size={12}
              strokeWidth={1.5}
              className="shrink-0 text-muted-foreground"
              aria-hidden
            />
            <span className="font-medium truncate">{row.name}</span>
            <span className="ml-auto text-xs shrink-0 text-muted-foreground">

              {formatFileCount(row.usageCount)}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

interface DrilldownHeaderProps {
  label: string;
  count: number;
  onBack: () => void;
}

function DrilldownHeader({ label, count, onBack }: DrilldownHeaderProps) {
  return (
    <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border">
      <button
        type="button"
        onClick={onBack}
        aria-label="Back to tags"
        className={cn(
          "inline-flex items-center gap-1 rounded px-1.5 py-0.5",
          "text-[11px] text-muted-foreground hover:text-foreground hover:bg-muted/60",
          "transition-colors",
        )}
      >
        <ChevronLeft className="h-3 w-3" strokeWidth={1.5} />
        <span>Back</span>
      </button>
      <span className="text-[13px] font-medium">{label}</span>
      <span className="ml-auto text-xs text-muted-foreground">
        {count === 1 ? "1 file" : `${count} files`}
      </span>
    </div>
  );
}

function formatFileCount(n: number): string {
  return n === 1 ? "1 file" : `${n} files`;
}

export default TagMode;
