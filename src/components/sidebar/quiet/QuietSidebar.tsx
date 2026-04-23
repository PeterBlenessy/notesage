import { useCallback, useState, type KeyboardEvent } from "react";
import { Filter, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useQuietSidebarStore } from "@/stores/quiet-sidebar-store";
import { PinnedSection } from "./PinnedSection";
import { ProjectsSection } from "./ProjectsSection";
import { RecentSection } from "./RecentSection";
import { TagsSection } from "./TagsSection";

/**
 * QuietSidebar — flat-list sidebar shell for the quiet-composer UI refresh
 * (PRD `2026-04-21-ui-refresh`, task #30).
 *
 * Renders four stacked sections in fixed order: Pinned, Projects, Recent,
 * Tags. Sections are empty stubs — G2 tasks #31–#34 wire them to the
 * workspace-store, editor-store, and SQLite index respectively.
 *
 * Only mounted when `settings.uiPreview === "quiet-composer"`. That gate
 * lives on `QuietLayout`, so this component does not need its own flag check.
 *
 * Task #43 — type-to-filter. When the sidebar has focus, pressing a
 * printable key appends to a local `filter` string that's passed down to
 * every section. Each section applies the filter to its own data
 * (basenames for Pinned / Projects / Recent, tag names for Tags). A small
 * badge at the top shows the current filter so the user can see what
 * they're typing. Backspace deletes, Esc clears.
 */

/**
 * Returns true when the key event originated inside a text-entry surface
 * (<input>, <textarea>, or contenteditable). Used to let nested inputs
 * (e.g. the TreeOverlay search box from #38) keep their keystrokes instead
 * of hijacking them for the sidebar filter.
 */
function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || target.isContentEditable;
}

export function QuietSidebar() {
  const [filter, setFilter] = useState<string>("");
  const setPendingCreateProject = useQuietSidebarStore(
    (s) => s.setPendingCreateProject,
  );

  // Projects section header `+` button opens the top-of-list inline
  // project-create row via the quiet-sidebar-store flag (task #42).
  const handleAddProject = useCallback(() => {
    setPendingCreateProject(true);
  }, [setPendingCreateProject]);

  const handleKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    // Let text-entry surfaces inside the sidebar (TreeOverlay search,
    // inline rename, future inputs) own their own keystrokes.
    if (isTypingTarget(event.target)) return;

    // Shortcut combos must pass through to the global shortcut hooks
    // (⌘⌥C copy-path, ⌘⌥R rename, ⌘1-⌘4 palette prefixes, etc.).
    if (event.metaKey || event.ctrlKey || event.altKey) return;

    if (event.key === "Escape") {
      if (filter.length > 0) {
        event.preventDefault();
        setFilter("");
      }
      return;
    }

    if (event.key === "Backspace") {
      if (filter.length > 0) {
        event.preventDefault();
        setFilter((prev) => prev.slice(0, -1));
      }
      // When empty, let Backspace bubble (no-op anyway — avoids swallowing
      // nav-shell shortcuts that might hook Backspace in the future).
      return;
    }

    // Printable characters — single-character keys that aren't named
    // modifier keys like "Enter", "Tab", "Shift". `event.key.length === 1`
    // is the standard guard: it's true for letters, digits, punctuation,
    // and whitespace " ", but false for "Enter", "ArrowUp", etc.
    if (event.key.length === 1) {
      event.preventDefault();
      setFilter((prev) => prev + event.key);
    }
  };

  return (
    <nav
      aria-label="Workspace sidebar"
      onKeyDown={handleKeyDown}
      className="flex flex-col gap-4 overflow-y-auto p-2 h-full min-h-0"
    >
      {filter.length > 0 && <FilterBadge filter={filter} onClear={() => setFilter("")} />}
      <PinnedSection filter={filter} />
      <ProjectsSection filter={filter} onAdd={handleAddProject} />
      <RecentSection filter={filter} />
      <TagsSection filter={filter} />
    </nav>
  );
}

interface FilterBadgeProps {
  filter: string;
  onClear: () => void;
}

function FilterBadge({ filter, onClear }: FilterBadgeProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        "flex items-center gap-1.5 px-2 py-1 rounded-sm",
        "bg-muted/50 text-xs text-muted-foreground",
        "transition-colors duration-150",
      )}
    >
      <Filter
        className="h-3 w-3 shrink-0"
        strokeWidth={1.5}
        aria-hidden="true"
      />
      <span className="truncate min-w-0 flex-1">{filter}</span>
      <button
        type="button"
        aria-label="Clear filter"
        onClick={onClear}
        className={cn(
          "shrink-0 rounded-sm p-0.5 -m-0.5",
          "hover:text-foreground hover:bg-muted transition-colors duration-150",
          "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
        )}
      >
        <X className="h-3 w-3" strokeWidth={1.5} aria-hidden="true" />
      </button>
    </div>
  );
}
