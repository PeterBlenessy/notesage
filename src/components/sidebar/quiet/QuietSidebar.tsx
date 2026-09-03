import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type KeyboardEvent,
} from "react";
import { Filter, Settings, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useSidebarStatusSlotStore } from "@/stores/sidebar-status-slot-store";
import { useQuietSidebarStore } from "@/stores/quiet-sidebar-store";
import { useWorkspaceStore } from "@/stores/workspace-store";
import {
  useSettingsStore,
  SIDEBAR_MIN_WIDTH,
  SIDEBAR_MAX_WIDTH,
  SIDEBAR_DEFAULT_WIDTH,
} from "@/stores/settings-store";
import { isAnyCustomizePopoverOpen } from "@/lib/sidebar-context-menu-state";
import { useGitRepoDetection } from "@/hooks/useGitRepoDetection";
import type { FileEntry } from "@/lib/tauri";
import { PinnedSection } from "./PinnedSection";
import { ProjectsSection } from "./ProjectsSection";
import { FoldersSection } from "./FoldersSection";
import { RecentSection } from "./RecentSection";
import { TagsSection } from "./TagsSection";
import { MentionsSection } from "./MentionsSection";
import { InboxSection } from "@/components/sidebar/quiet/InboxSection";
import { t } from "@/lib/i18n";

/**
 * QuietSidebar — flat-list sidebar shell for the quiet-composer UI refresh
 * (PRD `2026-04-21-ui-refresh`, task #30).
 *
 * Renders six stacked sections in fixed order: Pinned, Projects, Folders,
 * Recent, Tags, Mentions. Sections are wired to the workspace-store, editor-store,
 * and SQLite index. Tags and Mentions self-hide when their cap is 0 (the
 * slider IS the visibility control — see settings-store v11→v12 migration).
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
 * (e.g. inline rename rows) keep their keystrokes instead
 * of hijacking them for the sidebar filter.
 */
function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || target.isContentEditable;
}

/**
 * Recursively count markdown files (`.md`) in a `FileEntry[]` tree.
 *
 * Used by the workspace header to display "N projects · M notes" —
 * the count walks every project's tree plus the top-level notes tree.
 * O(N) over total entry count, memoized at the call site so it only
 * recomputes when the tree references actually change.
 */
export function countMarkdownFiles(entries: readonly FileEntry[]): number {
  let count = 0;
  for (const entry of entries) {
    if (entry.is_directory) {
      if (entry.children) count += countMarkdownFiles(entry.children);
    } else if (entry.name.toLowerCase().endsWith(".md")) {
      count += 1;
    }
  }
  return count;
}

/**
 * Workspace header per `mockup-d-synthesis.html` — italic "N" avatar +
 * "Notesage" name + "N projects · M notes" sub-line. Sits above the
 * Pinned section and inside the sidebar's `pt-10` so it clears the
 * macOS traffic-light safe zone.
 */
function WorkspaceHeader() {
  const projects = useWorkspaceStore((s) => s.projects);
  const notesTree = useWorkspaceStore((s) => s.notesTree);

  const projectCount = projects.length;
  const noteCount = useMemo(() => {
    // Notes count = `.md` files in the user's notes root + every open
    // project's tree. Tree references are stable across re-renders
    // unless the underlying directory changed, so this is cheap.
    let total = countMarkdownFiles(notesTree);
    for (const project of projects) {
      total += countMarkdownFiles(project.fileTree);
    }
    return total;
  }, [notesTree, projects]);

  return (
    <div
      className={cn(
        "flex items-center gap-2.5 px-1 py-1.5 mb-2",
        "select-none",
      )}
      data-tauri-drag-region
    >
      <span
        aria-hidden="true"
        className={cn(
          "inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md",
          "bg-foreground text-background text-[12px] italic font-semibold",
          "font-serif",
        )}
      >
        N
      </span>
      <div className="min-w-0 flex flex-col leading-tight">
        <span className="text-[13px] font-semibold truncate">Notesage</span>
        <span className="text-[11px] text-muted-foreground tabular-nums">
          {projectCount} {projectCount === 1 ? "project" : "projects"}
          <span aria-hidden="true"> · </span>
          {noteCount} {noteCount === 1 ? "note" : "notes"}
        </span>
      </div>
    </div>
  );
}

export function QuietSidebar({
  onOpenSettings,
}: {
  /** Opens the Settings dialog — driven from the footer's gear button. */
  onOpenSettings?: () => void;
}) {
  const [filter, setFilter] = useState<string>("");
  // Populate git-store repo detection for every sidebar root (projects +
  // explorer folders) — one `git_is_repo` probe per root per session, so
  // the row indicators / context-menu git actions derive from store state
  // without any per-row IPC.
  useGitRepoDetection();
  const setPendingCreateProject = useQuietSidebarStore(
    (s) => s.setPendingCreateProject,
  );
  // Projects section header `+` button opens the top-of-list inline
  // project-create row via the quiet-sidebar-store flag (task #42).
  const handleAddProject = useCallback(() => {
    setPendingCreateProject(true);
  }, [setPendingCreateProject]);

  const handleKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    // Hard guard: when a Customize folder appearance popover is up, the
    // type-to-filter must not consume keystrokes. The popover may not
    // have stolen keyboard focus (Radix Popover is non-modal), so the
    // event can fire on a focused row inside <nav> and bubble here.
    // Bail before touching the filter.
    if (isAnyCustomizePopoverOpen()) return;

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
      aria-label={t("sidebar.workspace")}
      data-tauri-drag-region
      onKeyDown={handleKeyDown}
      // Live-test 2026-04-25 #154 — `border-r border-border-strong` so
      // the sidebar / doc-area boundary actually reads. The default
      // `border-border` was nearly invisible against `--color-background`
      // because both surfaces share the same colour. The strong border
      // token clears the WCAG 3:1 non-text-contrast threshold.
      //
      // Horizontal padding bumped to `px-4` (16 px) to match the
      // mockup-l-sidebar-interactions spec (`padding: 20px 16px` on
      // the .sidebar block). Gives items more breathing room against
      // the right border.
      //
      // `w-[252px]` + `pt-10` — sidebar now lives at the layout-root
      // level (sibling of the title bar + doc-area column), so it
      // owns its own width and clears the macOS traffic-light safe
      // zone with 40 px of internal top padding. The `nav` itself is
      // a `data-tauri-drag-region` so the empty top zone above the
      // first row stays a draggable surface (matches Linear/Bear
      // ergonomics — drag the sidebar's empty top to move the window).
      // `bg-muted/30` so the sidebar surface is visually distinct from
      // `--color-background` (the doc area). Without it, the sidebar
      // and the doc area share the same colour and the only signal is
      // the right border, which makes the "sidebar extends to top
      // edge" change invisible until content fills the top zone.
      // `overflow-hidden` on the nav + a separate scroll container below keeps
      // the WorkspaceHeader (Notesage icon + name) PINNED at the top while only
      // the section list scrolls. `relative` anchors the resize handle.
      // Width is user-resizable — driven by `--quiet-sidebar-width` (persisted
      // as `settings.sidebarWidth`); the handle writes the var live during drag.
      className="relative flex flex-col px-4 pt-10 pb-2 h-full shrink-0 min-h-0 overflow-hidden border-r border-border-strong bg-muted/30"
      style={{ width: `var(--quiet-sidebar-width, ${SIDEBAR_DEFAULT_WIDTH}px)` }}
    >
      <WorkspaceHeader />
      {/* Scroll body — everything below the header scrolls; the header stays put. */}
      <div className="flex flex-col gap-4 min-h-0 flex-1 overflow-y-auto -mr-2 pr-2">
        {filter.length > 0 && <FilterBadge filter={filter} onClear={() => setFilter("")} />}
        <InboxSection filter={filter} />
    <PinnedSection filter={filter} />
        <ProjectsSection filter={filter} onAdd={handleAddProject} />
        {/* Sidebar-simplification task #10 — Folders section sits
           between Projects and Recent. Self-hides when the user has no
           explorer folders open (locked-in 2026-04-27 — no cap, no
           slider; the user IS the limiter). */}
        <FoldersSection filter={filter} />
        <RecentSection filter={filter} />
        {/* TagsSection / MentionsSection self-hide when their cap is 0
            (the slider IS the visibility control — see settings-store
            v11→v12 migration). */}
        <TagsSection filter={filter} />
        <MentionsSection filter={filter} />
      </div>
      {/* Sticky footer — OUTSIDE the scroll body so it never moves when the
          section list scrolls. Holds the discoverable Settings button and the
          status strip relocated from the editor footer. */}
      <SidebarFooter onOpenSettings={onOpenSettings} />
      <SidebarResizeHandle />
    </nav>
  );
}

/**
 * Drag handle on the sidebar's right edge. The width state lives in the
 * `--quiet-sidebar-width` CSS variable on `<html>` (published by QuietLayout);
 * we write the var on every pointer-move so resize is React-render-free, and
 * persist the final value to `settings.sidebarWidth` on pointer-up — mirroring
 * the pinned command-bar resize handle. The sidebar docks to the window's LEFT
 * edge, so the new width is simply the pointer's x-coordinate.
 */
const SIDEBAR_KEYBOARD_STEP = 16;

function SidebarResizeHandle() {
  const persistedWidth = useSettingsStore((s) => s.sidebarWidth);
  const setSidebarWidth = useSettingsStore((s) => s.setSidebarWidth);

  const clamp = (w: number) =>
    Math.round(Math.max(SIDEBAR_MIN_WIDTH, Math.min(SIDEBAR_MAX_WIDTH, w)));

  const onPointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      event.preventDefault();
      const target = event.currentTarget;
      target.setPointerCapture(event.pointerId);
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";

      const onMove = (moveEvent: PointerEvent) => {
        document.documentElement.style.setProperty(
          "--quiet-sidebar-width",
          `${clamp(moveEvent.clientX)}px`,
        );
      };
      const onUp = (upEvent: PointerEvent) => {
        setSidebarWidth(clamp(upEvent.clientX));
        target.releasePointerCapture(event.pointerId);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    },
    [setSidebarWidth],
  );

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      event.preventDefault();
      const delta =
        event.key === "ArrowRight"
          ? SIDEBAR_KEYBOARD_STEP
          : -SIDEBAR_KEYBOARD_STEP;
      const next = clamp(persistedWidth + delta);
      document.documentElement.style.setProperty(
        "--quiet-sidebar-width",
        `${next}px`,
      );
      setSidebarWidth(next);
    },
    [persistedWidth, setSidebarWidth],
  );

  // Keep the var in sync if the store width changes out of band (rehydration).
  useEffect(() => {
    document.documentElement.style.setProperty(
      "--quiet-sidebar-width",
      `${persistedWidth}px`,
    );
  }, [persistedWidth]);

  return (
    <div
      role="slider"
      tabIndex={0}
      aria-label={t("sidebar.resize")}
      aria-orientation="vertical"
      aria-valuemin={SIDEBAR_MIN_WIDTH}
      aria-valuemax={SIDEBAR_MAX_WIDTH}
      aria-valuenow={persistedWidth}
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
      data-sidebar-resize-handle
      className={cn(
        // Hairline on the right edge; invisible at rest (the border carries the
        // edge), brighter on hover/focus. A 16px invisible hit target keeps the
        // grab comfortable without thickening the line.
        "absolute right-0 top-0 z-10 h-full w-px cursor-col-resize",
        "bg-transparent hover:bg-muted-foreground transition-colors",
        "focus-visible:outline-none focus-visible:bg-muted-foreground",
        "after:absolute after:inset-y-0 after:left-1/2 after:w-4 after:-translate-x-1/2",
      )}
    />
  );
}

/**
 * Sticky bottom bar. Rendered as a sibling of the scroll body (not inside it),
 * so it stays pinned to the sidebar's bottom edge while the section list scrolls
 * — mirroring how `WorkspaceHeader` is pinned at the top.
 *
 * Left: a discoverable Settings gear whose tooltip teaches the `⌘,` shortcut
 * (the reason this exists — the shortcut was previously undiscoverable). Right:
 * the status slot that the editor's `StatusBar` portals into (status-tray
 * trigger + word count + focus-mode hint), relocated here so the editor column
 * runs edge-to-edge.
 */
function SidebarFooter({ onOpenSettings }: { onOpenSettings?: () => void }) {
  const setSlot = useSidebarStatusSlotStore((s) => s.setEl);
  return (
    <div
      // Isolate footer keystrokes from the nav's type-to-filter handler so
      // activating the gear (Space/Enter) or focusing the status strip doesn't
      // leak characters into the filter string.
      onKeyDown={(e) => e.stopPropagation()}
      className="mt-2 pt-2 flex items-center gap-1 shrink-0 border-t border-border"
    >
      <TooltipProvider delayDuration={300}>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={t("sidebar.settings")}
              onClick={onOpenSettings}
              className="size-7 shrink-0 text-muted-foreground hover:text-foreground"
            >
              <Settings className="size-4" strokeWidth={1.5} aria-hidden="true" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="top" className="flex items-center gap-2">
            <span>{t("sidebar.settings")}</span>
            <kbd className="font-sans text-[10px] text-muted-foreground">⌘,</kbd>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
      {/* Portal target for the editor's StatusBar. Empty (0-height content)
          when no document is open — the gear still anchors the bar. */}
      <div
        ref={setSlot}
        data-sidebar-status-slot
        className="flex-1 min-w-0 flex items-center"
      />
    </div>
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
        aria-label={t("sidebar.clearFilter")}
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
