import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BookOpen } from "lucide-react";
import { tauriApi, type IndexResearchResult } from "@/lib/tauri";
import {
  getDefaultPaletteScope,
  resolveSearchPaths,
} from "@/lib/command-palette";
import type { AttachmentChip } from "@/components/cmd/AttachmentChips";
import { cn } from "@/lib/utils";

/**
 * ResearchMode — picker for the `?research` prefix mode (PRD
 * `2026-04-21-ui-refresh`, Phase 1, task #18).
 *
 * Wraps the existing `index_search_research` Tauri command (the SQLite-
 * backed canonical caller used by `CommandPalette` in research mode). The
 * picker is **pure presentation** — the parent FloatingCommandBar passes
 * the active filter text and an `onPick` callback. Selecting a row fires
 * `onPick` with an AttachmentChip the parent inserts; the parent is also
 * responsible for clearing the `?` token from the input.
 *
 * Keyboard nav uses a document-level keydown listener so the parent input
 * keeps focus while the picker is mounted (matches how the suggestion-style
 * mode pickers are wired in #14–#19).
 */

export interface ResearchModeProps {
  /** Text typed after the `?` prefix. */
  filter: string;
  onPick: (chip: AttachmentChip) => void;
  onDismiss?: () => void;
}

/** Hard cap on results — keep the dropdown short and snappy. */
const RESULT_LIMIT = 10;

/** Debounce window for backend queries — mirrors CommandPalette's 300ms. */
const QUERY_DEBOUNCE_MS = 300;

function ResearchMode({
  filter,
  onPick,
  onDismiss,
}: ResearchModeProps) {
  const [results, setResults] = useState<IndexResearchResult[]>([]);
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ------------------------------------------------------------------
  // Fetch results whenever the filter changes (debounced).
  // ------------------------------------------------------------------

  useEffect(() => {
    if (debounceTimer.current) {
      clearTimeout(debounceTimer.current);
    }

    let cancelled = false;
    debounceTimer.current = setTimeout(async () => {
      try {
        const paths = resolveSearchPaths(getDefaultPaletteScope());
        const fetched = await tauriApi.indexSearchResearch(
          paths,
          filter,
          undefined,
          RESULT_LIMIT,
        );
        if (cancelled) return;
        setResults(fetched);
        setHighlightedIndex(0);
      } catch (err) {
        if (cancelled) return;
        console.error("[ResearchMode] indexSearchResearch failed", err);
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
  }, [filter]);

  // ------------------------------------------------------------------
  // Selection helpers.
  // ------------------------------------------------------------------

  const selectIndex = useCallback(
    (index: number) => {
      const result = results[index];
      if (!result) return;
      onPick({
        id: result.file,
        kind: "research",
        name: result.title,
      });
    },
    [results, onPick],
  );

  // ------------------------------------------------------------------
  // Keyboard nav (document-level so the parent input keeps focus).
  // ------------------------------------------------------------------

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (results.length === 0 && event.key !== "Escape") return;
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setHighlightedIndex((prev) =>
          results.length === 0 ? 0 : Math.min(prev + 1, results.length - 1),
        );
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        setHighlightedIndex((prev) => Math.max(prev - 1, 0));
      } else if (event.key === "Enter") {
        if (results.length === 0) return;
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
  }, [results, highlightedIndex, selectIndex, onDismiss]);

  // ------------------------------------------------------------------
  // Source URL → hostname (with fallback to raw url).
  // ------------------------------------------------------------------

  const rows = useMemo(() => {
    return results.map((result) => {
      let domain = "";
      try {
        if (result.source_url) {
          domain = new URL(result.source_url).hostname;
        }
      } catch {
        // invalid URL — fall back to raw string below.
      }
      const displaySource = domain || result.source_url || "";
      return { result, displaySource };
    });
  }, [results]);

  // ------------------------------------------------------------------
  // Render.
  // ------------------------------------------------------------------

  if (results.length === 0) {
    return (
      <div
        role="listbox"
        aria-label="Research results"
        className="px-3 py-2 text-xs text-muted-foreground"
      >
        No research matches
      </div>
    );
  }

  return (
    <div
      role="listbox"
      aria-label="Research results"
      className="flex flex-col py-1"
    >
      {rows.map(({ result, displaySource }, index) => {
        const isActive = index === highlightedIndex;
        return (
          <button
            type="button"
            role="option"
            aria-selected={isActive}
            key={`${result.file}-${index}`}
            data-index={index}
            onMouseEnter={() => setHighlightedIndex(index)}
            onClick={() => selectIndex(index)}
            className={cn(
              "flex flex-col items-start gap-0.5 px-3 py-1.5 text-left",
              "transition-colors",
              isActive ? "bg-muted" : "hover:bg-muted/60",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
            )}
          >
            <div className="flex w-full items-center gap-2">
              <BookOpen
                className="h-4 w-4 shrink-0 text-muted-foreground"
                strokeWidth={1.5}
                aria-hidden="true"
              />
              <span className="flex-1 truncate text-sm font-medium text-foreground">
                {result.title}
              </span>
              {result.date_saved && (
                <span className="shrink-0 text-[11px] text-muted-foreground tabular-nums">
                  {result.date_saved}
                </span>
              )}
            </div>
            {(displaySource || result.tags.length > 0) && (
              <div className="flex w-full items-center gap-2 pl-6 text-xs text-muted-foreground">
                {displaySource && (
                  <span className="truncate">{displaySource}</span>
                )}
                {!displaySource && result.tags.length > 0 && (
                  <span className="truncate">
                    {result.tags.slice(0, 3).join(", ")}
                  </span>
                )}
              </div>
            )}
          </button>
        );
      })}
    </div>
  );
}

export default ResearchMode;
