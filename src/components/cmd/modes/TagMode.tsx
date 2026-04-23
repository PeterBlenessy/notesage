import { useEffect, useMemo, useRef, useState } from "react";
import { Hash } from "lucide-react";
import { cn } from "@/lib/utils";
import { tauriApi, type IndexedTag } from "@/lib/tauri";
import { useWorkspaceStore } from "@/stores/workspace-store";

/**
 * TagMode — picker for the `#tag` prefix mode in the FloatingCommandBar
 * (PRD `2026-04-21-ui-refresh`, Phase 1, task #16).
 *
 * Reads tags from the SQLite document index (via `tauriApi.indexTags`),
 * filters by case-insensitive substring on the tag name, and renders up to
 * 10 results ordered by usage count descending. Each row shows the tag
 * (with a leading `#` icon) plus a muted "N uses" badge.
 *
 * The picker is intentionally headless about the input/cursor — the parent
 * `FloatingCommandBar` owns the textbox and dispatches `onPick(tagName)`
 * receivers when the user picks a tag (click or Enter). The parent appends
 * the literal `#tag-name ` token at the cursor or replaces the active prefix
 * token.
 *
 * Keyboard nav (ArrowUp/ArrowDown/Enter) is bound to the document, not the
 * picker DOM — the bar's input keeps focus while the picker hovers above it.
 * Esc handling is owned by the parent (two-stage: dismiss prefix, then bar).
 */

export interface TagModeProps {
  /** Text typed after the # prefix (e.g. "fic" for #fic). */
  filter: string;
  /**
   * Called when the user picks a tag. The parent appends `#tag-name ` (with
   * trailing space) at the cursor or replaces the active prefix token.
   */
  onPick: (tagName: string) => void;
  /** Optional callback for explicit dismissal (currently unused — parent owns Esc). */
  onDismiss?: () => void;
  /**
   * DOM id used as the listbox's `id` attribute and as the prefix for option
   * ids. Enables the parent `FloatingCommandBar` to wire `aria-controls` and
   * `aria-activedescendant` on its combobox input.
   */
  listboxId?: string;
  /**
   * Fires whenever the active option / result count changes. Lets the parent
   * FloatingCommandBar keep `aria-activedescendant` in sync without the
   * picker moving DOM focus away from the input.
   */
  onActiveOptionChange?: (info: {
    listboxId: string;
    activeOptionId: string | null;
    count: number;
  }) => void;
}

interface TagRow {
  name: string;
  usageCount: number;
}

const MAX_RESULTS = 10;

function TagMode({
  filter,
  onPick,
  listboxId = 'cmd-tag-listbox',
  onActiveOptionChange,
}: TagModeProps) {
  const projects = useWorkspaceStore((s) => s.projects);
  const projectPaths = useMemo(
    () => projects.map((p) => p.path),
    [projects],
  );

  const [allTags, setAllTags] = useState<TagRow[]>([]);
  const [highlighted, setHighlighted] = useState(0);

  // Latest-request guard so a stale fetch doesn't overwrite fresh state.
  const reqIdRef = useRef(0);

  // Fetch tags from the SQLite document index. We always pass an empty filter
  // to the backend (asking for the full set) and filter client-side — that
  // way a single fetch per project-path-set covers all keystrokes within the
  // mode session, and the empty-filter call returns the global usage ranking
  // we want as the default view.
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

  // Derive the visible result set: substring match (case-insensitive) on name,
  // then take the top N. Ordering is preserved from the backend (which sorts
  // by file_count descending), so we don't need to re-sort.
  const results = useMemo<TagRow[]>(() => {
    const needle = filter.trim().toLowerCase();
    const filtered = needle
      ? allTags.filter((t) => t.name.toLowerCase().includes(needle))
      : allTags;
    return filtered.slice(0, MAX_RESULTS);
  }, [allTags, filter]);

  // Reset highlight to the first row whenever the result set changes.
  useEffect(() => {
    setHighlighted(0);
  }, [results.length]);

  // Report active option state upward so the parent can mirror it on its
  // combobox input via aria-activedescendant.
  useEffect(() => {
    if (!onActiveOptionChange) return;
    const activeOptionId =
      results.length > 0 ? `${listboxId}-opt-${highlighted}` : null;
    onActiveOptionChange({
      listboxId,
      activeOptionId,
      count: results.length,
    });
  }, [onActiveOptionChange, listboxId, highlighted, results.length]);

  // Document-level keyboard nav. The host bar's input keeps focus, so we can't
  // attach listeners to the picker — we bind to `window` and check that there
  // are results before consuming the event.
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
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
        if (pick) onPick(pick.name);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [results, highlighted, onPick]);

  if (results.length === 0) {
    return (
      <div
        data-cmd-mode="tag"
        id={listboxId}
        role="listbox"
        aria-label="Tags"
        className={cn(
          "border-t border-border bg-popover/95 px-3 py-3",
          "text-xs text-muted-foreground",
        )}
      >
        No tags match
      </div>
    );
  }

  return (
    <ul
      data-cmd-mode="tag"
      id={listboxId}
      role="listbox"
      aria-label="Tags"
      className={cn(
        "border-t border-border bg-popover/95",
        "max-h-[280px] overflow-y-auto py-1",
      )}
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
            onClick={() => onPick(row.name)}
            className={cn(
              "flex items-center gap-2 px-3 py-1.5 cursor-pointer",
              "text-sm text-foreground",
              "transition-colors",
              selected ? "bg-accent" : "hover:bg-accent/50",
            )}
          >
            <Hash
              size={14}
              strokeWidth={1.5}
              className="shrink-0 text-muted-foreground"
              aria-hidden
            />
            <span className="font-medium truncate">{row.name}</span>
            <span className="ml-auto text-xs text-muted-foreground shrink-0">
              {formatUsageCount(row.usageCount)}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

function formatUsageCount(n: number): string {
  return n === 1 ? "1 use" : `${n} uses`;
}

export default TagMode;
