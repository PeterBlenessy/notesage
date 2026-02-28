import { useState, useEffect, useRef, useCallback } from "react";
import {
  ChevronUp,
  ChevronDown,
  ChevronRight,
  X,
  Replace,
  ReplaceAll,
} from "lucide-react";

interface FindBarProps {
  open: boolean;
  onClose: () => void;
  matchCount: number;
  currentMatch: number; // 0-based index (-1 when no matches)
  onSearch: (query: string) => void;
  onNext: () => void;
  onPrevious: () => void;
  replaceEnabled: boolean;
  replaceExpanded: boolean;
  onReplaceExpandedChange: (expanded: boolean) => void;
  onReplace?: (replacement: string) => void;
  onReplaceAll?: (replacement: string) => void;
  initialQuery?: string;
}

export function FindBar({
  open,
  onClose,
  matchCount,
  currentMatch,
  onSearch,
  onNext,
  onPrevious,
  replaceEnabled,
  replaceExpanded,
  onReplaceExpandedChange,
  onReplace,
  onReplaceAll,
  initialQuery = "",
}: FindBarProps) {
  const [query, setQuery] = useState(initialQuery);
  const [replacement, setReplacement] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const replaceRef = useRef<HTMLInputElement>(null);

  // Auto-focus search input on open
  useEffect(() => {
    if (open) {
      // Use rAF to ensure the DOM is rendered
      requestAnimationFrame(() => {
        searchRef.current?.focus({ preventScroll: true });
        searchRef.current?.select();
      });
    }
  }, [open]);

  // Sync query when FindBar opens: from initialQuery or persisted local query
  useEffect(() => {
    if (open) {
      if (initialQuery) {
        setQuery(initialQuery);
        onSearch(initialQuery);
      } else if (query) {
        // Reopen with persisted query — re-trigger search to restore matches
        onSearch(query);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialQuery]);

  const handleQueryChange = useCallback(
    (value: string) => {
      setQuery(value);
      onSearch(value);
    },
    [onSearch]
  );

  const handleSearchKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter") {
        e.preventDefault();
        if (e.shiftKey) {
          onPrevious();
        } else {
          onNext();
        }
      }
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    },
    [onNext, onPrevious, onClose]
  );

  const handleReplaceKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter") {
        e.preventDefault();
        if (e.metaKey && e.shiftKey) {
          onReplaceAll?.(replacement);
        } else {
          onReplace?.(replacement);
        }
      }
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    },
    [onReplace, onReplaceAll, replacement, onClose]
  );

  if (!open) return null;

  const matchLabel =
    matchCount === 0 && query
      ? "No results"
      : matchCount > 0
        ? `${currentMatch + 1} of ${matchCount}`
        : "";

  return (
    <div className="absolute top-0 right-4 z-30 flex flex-col gap-1 bg-background border border-border rounded-b-lg shadow-sm px-2 py-1.5 animate-in slide-in-from-top-2 duration-150">
      {/* Search row */}
      <div className="flex items-center gap-1">
        {replaceEnabled && (
          <button
            onClick={() => onReplaceExpandedChange(!replaceExpanded)}
            className="p-0.5 rounded hover:bg-muted transition-colors text-muted-foreground"
            title={replaceExpanded ? "Hide replace" : "Show replace"}
          >
            <ChevronRight
              size={14}
              strokeWidth={1.5}
              className={`transition-transform duration-150 ${replaceExpanded ? "rotate-90" : ""}`}
            />
          </button>
        )}
        <input
          ref={searchRef}
          type="text"
          value={query}
          onChange={(e) => handleQueryChange(e.target.value)}
          onKeyDown={handleSearchKeyDown}
          placeholder="Find..."
          className="h-6 w-48 px-2 text-xs bg-muted border border-border rounded focus:outline-none focus:ring-1 focus:ring-muted-foreground/50"
        />
        <span className="text-[10px] text-muted-foreground w-16 text-center select-none tabular-nums">
          {matchLabel}
        </span>
        <button
          onClick={onPrevious}
          disabled={matchCount === 0}
          className="p-0.5 rounded hover:bg-muted transition-colors text-muted-foreground disabled:opacity-30"
          title="Previous match (Shift+Enter)"
        >
          <ChevronUp size={14} strokeWidth={1.5} />
        </button>
        <button
          onClick={onNext}
          disabled={matchCount === 0}
          className="p-0.5 rounded hover:bg-muted transition-colors text-muted-foreground disabled:opacity-30"
          title="Next match (Enter)"
        >
          <ChevronDown size={14} strokeWidth={1.5} />
        </button>
        <button
          onClick={onClose}
          className="p-0.5 rounded hover:bg-muted transition-colors text-muted-foreground"
          title="Close (Escape)"
        >
          <X size={14} strokeWidth={1.5} />
        </button>
      </div>

      {/* Replace row */}
      {replaceEnabled && replaceExpanded && (
        <div className="flex items-center gap-1 animate-in slide-in-from-top-1 duration-100">
          {/* Spacer to align with search input (accounts for expand chevron) */}
          <div className="w-[18px] shrink-0" />
          <input
            ref={replaceRef}
            type="text"
            value={replacement}
            onChange={(e) => setReplacement(e.target.value)}
            onKeyDown={handleReplaceKeyDown}
            placeholder="Replace..."
            className="h-6 w-48 px-2 text-xs bg-muted border border-border rounded focus:outline-none focus:ring-1 focus:ring-muted-foreground/50"
          />
          <button
            onClick={() => onReplace?.(replacement)}
            disabled={matchCount === 0}
            className="p-0.5 rounded hover:bg-muted transition-colors text-muted-foreground disabled:opacity-30"
            title="Replace (Enter in replace field)"
          >
            <Replace size={14} strokeWidth={1.5} />
          </button>
          <button
            onClick={() => onReplaceAll?.(replacement)}
            disabled={matchCount === 0}
            className="p-0.5 rounded hover:bg-muted transition-colors text-muted-foreground disabled:opacity-30"
            title="Replace All (Cmd+Shift+Enter)"
          >
            <ReplaceAll size={14} strokeWidth={1.5} />
          </button>
        </div>
      )}
    </div>
  );
}
