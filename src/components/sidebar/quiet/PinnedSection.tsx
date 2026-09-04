import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type KeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { toast } from "sonner";
import { FileIcon } from "@/components/sidebar/FileIcon";
import {
  SIDEBAR_ENTER_RENAME_MODE_EVENT,
  SidebarContextMenu,
} from "@/components/sidebar/quiet/SidebarContextMenu";
import { SidebarInlineEdit } from "@/components/sidebar/quiet/SidebarInlineEdit";
import {
  basename as pathBasename,
  resolveRenamePath,
  validateRenameBasename,
} from "@/components/sidebar/quiet/rename-utils";
import {
  chainKeyHandlers,
  isContextMenuKey,
  openContextMenuOnElement,
  useSidebarItemShortcuts,
} from "@/components/sidebar/quiet/useSidebarItemShortcuts";
import { announce } from "@/components/sidebar/quiet/aria-announcer";
import { useRovingTabindex } from "@/components/sidebar/quiet/useRovingTabindex";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { useEditorStore } from "@/stores/editor-store";
import { useFileOperations } from "@/hooks/useFileOperations";
import { cn } from "@/lib/utils";
import { FilePreview } from "./FilePreview";
import { SidebarRowIndicators } from "./SidebarRowIndicators";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useFormatLocale } from "@/lib/useLocale";
import { formatSavedShort } from "@/lib/saved-ago";
import {
  FILE_DRAG_MIME,
  beginFileDrag,
  computeReorderTarget,
  hasFileDrag,
  isBelowMidpoint,
} from "./file-drag";
import { t } from "@/lib/i18n";

/**
 * PinnedSection — the pinned-files list for the quiet-composer sidebar.
 *
 * Reads absolute file paths from `workspace-store.pinnedFiles`. The entire
 * section is hidden when nothing is pinned (or the active filter excludes every
 * pinned file) to avoid an empty header cluttering the top of the sidebar.
 * Manual ordering from drag-to-reorder (#44) is preserved by rendering
 * `pinnedFiles` in array order.
 *
 * Drag-and-drop (task #44) — HTML5 DnD is plumbed through `file-drag.ts`:
 * Recent / project-child rows use `FILE_DRAG_MIME` to advertise a single
 * absolute path; PinnedSection accepts drops either on a specific row
 * (with above/below midpoint precision) or on the outer `<ul>` (appends).
 * Pinned rows are themselves draggable to reorder within the list.
 */

export interface PinnedSectionProps {
  /**
   * Case-insensitive substring filter applied to pinned file basenames. When
   * non-empty, rows whose basename doesn't contain `filter` are hidden from
   * the list. Task #43 — sidebar type-to-filter. Empty / undefined = no
   * filter (default behavior).
   */
  filter?: string;
}

function basename(path: string): string {
  return path.split("/").pop() ?? path;
}

/**
 * Drop-zone indicator for a pinned row. `above` / `below` draw a thin
 * accent-coloured line at the matching edge; `null` renders nothing. This
 * is ephemeral UI state — no Zustand round-trip.
 */
type DropEdge = "above" | "below" | null;

interface PinnedRowProps {
  path: string;
  index: number;
  isActive: boolean;
  isDragging: boolean;
  dropEdge: DropEdge;
  isRenaming: boolean;
  tabIndex: 0 | -1;
  onOpen: (path: string) => void | Promise<void>;
  onStartRename: (path: string) => void;
  onCommitRename: (oldPath: string, newBasename: string) => void;
  onCancelRename: () => void;
  // Sidebar #23 — these three handlers used to be passed as
  // per-row inline closures (`() => roving.handleFocus(path)`),
  // which made `React.memo` useless because shallow-eq always
  // failed on every parent render. Reshape the contract so the
  // parent passes the stable `useRovingTabindex` handlers and
  // the row binds `path` / `event` inside its own DOM listeners.
  onFocus: (path: string) => void;
  onNavigate: (event: KeyboardEvent<HTMLElement>, path: string) => void;
  onDragStart: (event: DragEvent<HTMLDivElement>, index: number) => void;
  onDragEnd: () => void;
  onDragOverRow: (event: DragEvent<HTMLDivElement>, index: number) => void;
  onDragLeaveRow: (event: DragEvent<HTMLDivElement>, index: number) => void;
  onDropRow: (event: DragEvent<HTMLDivElement>, index: number) => void;
  registerRef: (path: string, el: HTMLDivElement | null) => void;
}

/**
 * Single row in the pinned list. Extracted from PinnedSection so we can
 * install the row-level ⌘⌥C / ⌘⌥R shortcut hook per row (#46) and carry
 * the per-row drag handlers locally (#44). The hook must run inside a
 * component because it captures `filePath` in the returned handler.
 *
 * Sidebar #23 — wrapped in `React.memo` so a parent type-to-filter
 * keystroke that doesn't actually change a row's data props skips the
 * row's render entirely. With N=2000 pinned items this is the dominant
 * win on the `sidebar-filter.perf` benchmark. The interface above was
 * reshaped to keep every handler prop reference-stable across parent
 * renders so default shallow comparison succeeds.
 */
function PinnedRowImpl({
  path,
  index,
  isActive,
  isDragging,
  dropEdge,
  isRenaming,
  tabIndex,
  onOpen,
  onStartRename,
  onCommitRename,
  onCancelRename,
  onFocus,
  onNavigate,
  onDragStart,
  onDragEnd,
  onDragOverRow,
  onDragLeaveRow,
  onDropRow,
  registerRef,
}: PinnedRowProps) {
  const formatLocale = useFormatLocale();
  const name = basename(path);
  // mockup-d — Pinned rows show a short relative-time hint to the
  // right of the name (e.g. "2h"). Pinned files don't carry their own
  // timestamp; we look up the matching `RecentFile` record (which now
  // tracks `lastAccessedAt`) so a pinned + recently-opened file shows
  // a fresh hint. Pinned-but-not-recent files render no hint.
  const lastAccessedAt = useEditorStore((s) => {
    const rec = s.recentFiles.find((r) => r.path === path);
    return rec?.lastAccessedAt;
  });
  const rowRef = useRef<HTMLDivElement | null>(null);
  const { onKeyDown: shortcutKeyDown } = useSidebarItemShortcuts({
    filePath: path,
    kind: "file",
  });

  const handleOpenKeys = (event: KeyboardEvent<HTMLDivElement>) => {
    // #80 — keyboard context-menu gesture. Synthesises a contextmenu event
    // on the row so Radix's ContextMenuTrigger opens the SidebarContextMenu.
    if (isContextMenuKey(event)) {
      event.preventDefault();
      event.stopPropagation();
      if (rowRef.current) openContextMenuOnElement(rowRef.current);
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      void onOpen(path);
    } else if (event.key === "F2") {
      // F2 enters rename mode (task #40). Only fires when the row itself is
      // focused — SidebarInlineEdit's own keydown handler runs inside the
      // input once rename mode is active and won't bubble back here.
      event.preventDefault();
      onStartRename(path);
    }
  };

  // Shortcuts first (⌘⌥C / ⌘⌥R). Then roving-tabindex navigation (↑/↓ within
  // the section). Finally Enter / Space / F2 / ContextMenu. When an earlier
  // handler calls preventDefault chainKeyHandlers short-circuits.
  // Sidebar #23 — bind `path` here (the parent passes
  // `roving.handleKeyDown` directly so the prop ref is stable).
  const navigate = (event: KeyboardEvent<HTMLElement>) => onNavigate(event, path);
  const onKeyDown = chainKeyHandlers(
    shortcutKeyDown,
    navigate,
    handleOpenKeys,
  );

  // #80 — announce the rename transition to screen readers on the tick the
  // row flips into rename mode. The SidebarInlineEdit's `aria-label={t("menu.rename")}`
  // is not enough context — we want "Renaming <filename>" spoken explicitly.
  const prevRenamingRef = useRef(false);
  useEffect(() => {
    if (isRenaming && !prevRenamingRef.current) {
      announce(`Renaming ${name}`);
    }
    prevRenamingRef.current = isRenaming;
  }, [isRenaming, name]);

  const setRowRef = (el: HTMLDivElement | null) => {
    rowRef.current = el;
    registerRef(path, el);
  };

  // Restore focus to the row after a rename session ends (commit or cancel).
  // SidebarInlineEdit steals focus on mount; when it unmounts we want the
  // user's keyboard context back on the row they were editing.
  const wasRenamingRef = useRef(false);
  useEffect(() => {
    if (wasRenamingRef.current && !isRenaming) {
      rowRef.current?.focus();
    }
    wasRenamingRef.current = isRenaming;
  }, [isRenaming]);

  // Use native click event's `detail` to distinguish single vs double click.
  // detail === 2 signals a double-click: start rename instead of opening.
  // We intercept here rather than wire a separate onDoubleClick handler so
  // the single-click path never fires when the user is double-clicking.
  const handleClick = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (event.detail === 2) {
      event.preventDefault();
      event.stopPropagation();
      onStartRename(path);
      return;
    }
    void onOpen(path);
  };

  return (
    <FilePreview filePath={path}>
      <SidebarContextMenu
        filePath={path}
        kind="file"
        onOpen={() => void onOpen(path)}
      >
        <div
          ref={setRowRef}
          role="button"
          tabIndex={tabIndex}
          draggable={!isRenaming}
          data-active={isActive ? "true" : undefined}
          data-dragging={isDragging ? "true" : undefined}
          data-drop-edge={dropEdge ?? undefined}
          data-renaming={isRenaming ? "true" : undefined}
          aria-current={isActive ? "page" : undefined}
          // No native `title` — the `FilePreview` popover that wraps
          // this row covers the same "what is this file?" need with a
          // richer rendered body. Having both on hover caused the
          // native tooltip to overlay the preview (live-test feedback
          // 2026-04-24).
          onClick={isRenaming ? undefined : handleClick}
          onKeyDown={isRenaming ? undefined : onKeyDown}
          onFocus={() => onFocus(path)}
          onDragStart={(e) => onDragStart(e, index)}
          onDragEnd={onDragEnd}
          onDragOver={(e) => onDragOverRow(e, index)}
          onDragLeave={(e) => onDragLeaveRow(e, index)}
          onDrop={(e) => onDropRow(e, index)}
          className={cn(
            "relative h-7 px-2 flex items-center gap-2 rounded-sm text-[13px] transition-colors duration-150",
            !isRenaming && "hover:bg-muted/50 cursor-default",
            "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--accent,var(--primary))] focus-visible:z-10",
            // Active row uses a neutral muted background (live-test
            // 2026-04-26 — the previous accent-fill was too distracting).
            // The accent is preserved on the icon so the active state
            // still has a brand-coloured signal.
            isActive && "bg-muted text-foreground font-medium",
            isDragging && "opacity-50",
          )}
        >
          {dropEdge === "above" && (
            <span
              aria-hidden="true"
              className="absolute left-1 right-1 -top-px h-0.5 bg-[var(--accent,var(--primary))] rounded-full pointer-events-none"
            />
          )}
          {dropEdge === "below" && (
            <span
              aria-hidden="true"
              className="absolute left-1 right-1 -bottom-px h-0.5 bg-[var(--accent,var(--primary))] rounded-full pointer-events-none"
            />
          )}
          <FileIcon
            fileName={name}
            className={cn(isActive && "text-[var(--color-accent-primary)]")}
          />
          {isRenaming ? (
            <SidebarInlineEdit
              mode="rename"
              initialValue={name}
              validate={validateRenameBasename}
              onCommit={(value) => onCommitRename(path, value)}
              onCancel={onCancelRename}
              className="flex-1 min-w-0"
            />
          ) : (
            <>
              <TooltipProvider delayDuration={300}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="truncate min-w-0 flex-1">{name}</span>
                  </TooltipTrigger>
                  <TooltipContent side="right" sideOffset={8}>
                    {name}
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
              {/* #129 — git status + external-change dot. Pinned rows are
                 *  always files, so `kind="file"` is hard-coded. */}
              <SidebarRowIndicators path={path} kind="file" />
              {/* mockup-d — short relative-time hint when the file has
                 *  been opened in this session. Falls back silently
                 *  when there's no recent record for this path.
                 *
                 *  Live-test 2026-04-25 #156 — fixed-width slot
                 *  (`w-[36px]`, right-aligned) so long filenames can't
                 *  overrun the hint. With the previous `ml-auto`-only
                 *  layout, very long names sometimes consumed the
                 *  flex-grow space before the time hint claimed its
                 *  reserved width, making the hint disappear behind
                 *  the truncation ellipsis. The fixed slot also keeps
                 *  the time column visually consistent across rows. */}
              {lastAccessedAt ? (
                <span
                  aria-hidden="true"
                  className="text-[11px] text-muted-foreground tabular-nums shrink-0 w-[36px] text-right"
                  title={`Opened ${new Date(lastAccessedAt).toLocaleString(formatLocale)}`}
                >
                  {formatSavedShort(Date.now() - lastAccessedAt)}
                </span>
              ) : null}
            </>
          )}
        </div>
      </SidebarContextMenu>
    </FilePreview>
  );
}

const PinnedRow = memo(PinnedRowImpl);

export function PinnedSection({ filter }: PinnedSectionProps) {
  const pinnedFiles = useWorkspaceStore((s) => s.pinnedFiles);
  const pinFile = useWorkspaceStore((s) => s.pinFile);
  const reorderPinnedFiles = useWorkspaceStore((s) => s.reorderPinnedFiles);
  const activeFilePath = useEditorStore((s) => {
    const tab = s.openDocuments.find((t) => t.id === s.activeTabId);
    return tab?.filePath ?? null;
  });
  const { openFile, renamePath } = useFileOperations();

  // Task #40 — inline rename state. Only one row at a time can be in rename
  // mode; when `renamingPath` matches a row's path it renders its inline
  // editor. Null = no row in rename mode.
  const [renamingPath, setRenamingPath] = useState<string | null>(null);

  // Apply the case-insensitive filter at render time — transient UI state,
  // no re-fetch. Empty filter leaves the list untouched.
  const visibleFiles = filter
    ? pinnedFiles.filter((path) =>
        basename(path).toLowerCase().includes(filter.toLowerCase()),
      )
    : pinnedFiles;

  // Ephemeral DnD state. `draggingIndex` is set while a row from this list
  // is being dragged; `activeDrop` tracks the hover indicator so only one
  // row shows the edge line at a time. `containerActive` is the dashed
  // border on the outer <ul> when the pointer is over the section but not
  // a specific row.
  const [draggingIndex, setDraggingIndex] = useState<number | null>(null);
  const [activeDrop, setActiveDrop] = useState<{
    index: number;
    edge: DropEdge;
  } | null>(null);
  const [containerActive, setContainerActive] = useState(false);

  // #80 — roving tabindex + ArrowUp/Down navigation. Using the file path as
  // the stable row id is fine here because pinned paths are unique by
  // definition (the store dedupes them on pinFile).
  const rowIds = useMemo(() => visibleFiles.slice(), [visibleFiles]);
  const roving = useRovingTabindex({ rowIds });

  // Sidebar #23 — wrap every handler we pass to <PinnedRow /> in
  // `useCallback` so the memoized row's shallow-prop check actually
  // succeeds. Without this, every parent re-render (e.g. each
  // type-to-filter keystroke) hands every row a fresh closure and
  // the memo is a no-op.
  const handleOpen = useCallback(
    async (path: string) => {
      try {
        await openFile(path, basename(path));
      } catch (error) {
        toast.error(`Failed to open file: ${error}`);
      }
    },
    [openFile],
  );

  // -----------------------------------------------------------------------
  // Rename handlers (task #40).
  // -----------------------------------------------------------------------

  const startRename = useCallback((path: string) => {
    setRenamingPath(path);
  }, []);

  const cancelRename = useCallback(() => {
    setRenamingPath(null);
  }, []);

  const commitRename = useCallback(
    async (oldPath: string, newBasename: string) => {
      setRenamingPath(null);
      const oldName = pathBasename(oldPath);
      if (newBasename === oldName) {
        // No-op commit — user pressed Enter without changing anything.
        return;
      }
      const newPath = resolveRenamePath(oldPath, newBasename);
      try {
        await renamePath(oldPath, newPath);
        toast.success(`Renamed to ${pathBasename(newPath)}`);
      } catch (error) {
        toast.error(`Failed to rename: ${error}`);
      }
    },
    [renamePath],
  );

  // Listen for the Rename context-menu event. Only activate if the path is
  // visible in this section — other sections' listeners will see the same
  // event but their paths won't match, so activation is effectively
  // deduplicated at the path-membership level.
  useEffect(() => {
    function handleRenameEvent(event: Event) {
      const detail = (event as CustomEvent<{ filePath: string }>).detail;
      if (!detail?.filePath) return;
      if (!pinnedFiles.includes(detail.filePath)) return;
      setRenamingPath(detail.filePath);
    }
    window.addEventListener(
      SIDEBAR_ENTER_RENAME_MODE_EVENT,
      handleRenameEvent,
    );
    return () => {
      window.removeEventListener(
        SIDEBAR_ENTER_RENAME_MODE_EVENT,
        handleRenameEvent,
      );
    };
  }, [pinnedFiles]);

  // -----------------------------------------------------------------------
  // Drag source — pinned rows being reordered within the list.
  // -----------------------------------------------------------------------

  // Sidebar #23 — the drag handlers below need fresh `visibleFiles`,
  // `pinnedFiles`, and `draggingIndex` on every fire, but their
  // identity must stay stable across parent re-renders so the memoized
  // PinnedRow shallow-prop check survives a type-to-filter keystroke.
  // Stash mutating values on refs and read through them in the
  // callbacks; the callbacks themselves carry empty dep arrays.
  const visibleFilesRef = useRef(visibleFiles);
  visibleFilesRef.current = visibleFiles;
  const pinnedFilesRef = useRef(pinnedFiles);
  pinnedFilesRef.current = pinnedFiles;
  const draggingIndexRef = useRef(draggingIndex);
  draggingIndexRef.current = draggingIndex;

  const handleRowDragStart = useCallback(
    (event: DragEvent<HTMLDivElement>, index: number) => {
      const path = visibleFilesRef.current[index];
      if (!path) return;
      beginFileDrag(event, path);
      // `move` effect during same-list reorder; the outer container reads the
      // MIME type via `hasFileDrag` regardless of effectAllowed.
      event.dataTransfer.effectAllowed = "move";
      // Use the ORIGINAL (unfiltered) index because reorderPinnedFiles works
      // against `pinnedFiles`. When a filter is active `visibleFiles` is a
      // subset; we need to map back to the source array.
      const originalIndex = pinnedFilesRef.current.indexOf(path);
      setDraggingIndex(originalIndex);
    },
    [],
  );

  const handleRowDragEnd = useCallback(() => {
    setDraggingIndex(null);
    setActiveDrop(null);
    setContainerActive(false);
  }, []);

  // -----------------------------------------------------------------------
  // Drop target — pinned rows (precise above/below insertion).
  // -----------------------------------------------------------------------

  const handleRowDragOver = useCallback(
    (event: DragEvent<HTMLDivElement>, visibleIndex: number) => {
      if (!hasFileDrag(event)) return;
      event.preventDefault();
      event.stopPropagation();
      event.dataTransfer.dropEffect =
        draggingIndexRef.current !== null ? "move" : "copy";

      const below = isBelowMidpoint(event, event.currentTarget);
      // Translate visibleIndex back to the original pinnedFiles index so
      // reorder math stays consistent under filtering.
      const path = visibleFilesRef.current[visibleIndex];
      if (!path) return;
      const originalIndex = pinnedFilesRef.current.indexOf(path);
      setActiveDrop({
        index: originalIndex,
        edge: below ? "below" : "above",
      });
    },
    [],
  );

  const handleRowDragLeave = useCallback(
    (event: DragEvent<HTMLDivElement>, _visibleIndex: number) => {
      // Only clear if the pointer actually leaves the row element (not moving
      // to a child). `relatedTarget` is the node the pointer moved INTO.
      const next = event.relatedTarget as Node | null;
      if (next && event.currentTarget.contains(next)) return;
      setActiveDrop((current) => {
        if (current === null) return current;
        // We can't cheaply tell which row is leaving, so just clear when any
        // row fires dragleave. The next dragover will repaint.
        return null;
      });
    },
    [],
  );

  const handleRowDrop = useCallback(
    (event: DragEvent<HTMLDivElement>, visibleIndex: number) => {
      if (!hasFileDrag(event)) return;
      event.preventDefault();
      event.stopPropagation();

      const path = event.dataTransfer.getData(FILE_DRAG_MIME);
      if (!path) return;

      const targetPath = visibleFilesRef.current[visibleIndex];
      if (!targetPath) return;
      const pinned = pinnedFilesRef.current;
      const targetIndex = pinned.indexOf(targetPath);
      if (targetIndex < 0) return;

      const below = isBelowMidpoint(event, event.currentTarget);

      const existingIndex = pinned.indexOf(path);
      if (existingIndex >= 0) {
        // Reorder — path is already pinned.
        const to = computeReorderTarget(existingIndex, targetIndex, below);
        if (to !== null) reorderPinnedFiles(existingIndex, to);
      } else {
        // New pin — append, then reorder into place.
        pinFile(path);
        const fromIndex = pinned.length; // post-append index
        const to = computeReorderTarget(fromIndex, targetIndex, below);
        if (to !== null) reorderPinnedFiles(fromIndex, to);
      }

      setActiveDrop(null);
      setContainerActive(false);
      setDraggingIndex(null);
    },
    [pinFile, reorderPinnedFiles],
  );

  // -----------------------------------------------------------------------
  // Drop target — outer container (append at end).
  // -----------------------------------------------------------------------

  const handleContainerDragOver = (event: DragEvent<HTMLElement>) => {
    if (!hasFileDrag(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect =
      draggingIndex !== null ? "move" : "copy";
    setContainerActive(true);
  };

  const handleContainerDragLeave = (event: DragEvent<HTMLElement>) => {
    const next = event.relatedTarget as Node | null;
    if (next && event.currentTarget.contains(next)) return;
    setContainerActive(false);
    setActiveDrop(null);
  };

  const handleContainerDrop = (event: DragEvent<HTMLElement>) => {
    if (!hasFileDrag(event)) return;
    event.preventDefault();

    const path = event.dataTransfer.getData(FILE_DRAG_MIME);
    if (!path) {
      setContainerActive(false);
      return;
    }

    // If the drop was already handled by a row, the event is stopped there.
    // We only reach here on the empty space of the <ul> → append semantics.
    const existingIndex = pinnedFiles.indexOf(path);
    if (existingIndex >= 0) {
      // Reorder to end.
      const to = pinnedFiles.length - 1;
      if (existingIndex !== to) reorderPinnedFiles(existingIndex, to);
    } else {
      pinFile(path);
    }

    setContainerActive(false);
    setActiveDrop(null);
    setDraggingIndex(null);
  };

  // Hide the whole section when nothing is pinned (or the filter excludes every
  // pinned file) — an empty "Pinned" header + drop zone at the top of the
  // sidebar reads as visual clutter. Pinning is still reachable via the row
  // context menu / drag onto a non-empty list.
  if (visibleFiles.length === 0) return null;

  return (
    <section
      aria-label={t("section.pinned")}
      className="group/section flex flex-col gap-1"
    >
      <header className="flex items-center gap-2 px-2 h-6">
        <h2 className="text-xs font-medium tracking-wider uppercase text-muted-foreground">
          Pinned
        </h2>
      </header>
      <ul
        data-testid="pinned-drop-zone"
        data-drop-active={containerActive ? "true" : undefined}
        onDragOver={handleContainerDragOver}
        onDragLeave={handleContainerDragLeave}
        onDrop={handleContainerDrop}
        className={cn(
          "flex flex-col gap-0.5 rounded-sm transition-colors duration-150",
          // Empty-state hit box so users can drop even when nothing is pinned.
          visibleFiles.length === 0 && "min-h-[2rem]",
          containerActive &&
            "ring-1 ring-dashed ring-[var(--accent,var(--primary))]",
        )}
      >
        {visibleFiles.map((path, visibleIndex) => {
          const originalIndex = pinnedFiles.indexOf(path);
          const dropEdge =
            activeDrop && activeDrop.index === originalIndex
              ? activeDrop.edge
              : null;
          const isDragging = draggingIndex === originalIndex;
          const isRenaming = renamingPath === path;
          return (
            <li key={path}>
              <PinnedRow
                path={path}
                index={visibleIndex}
                isActive={activeFilePath === path}
                isDragging={isDragging}
                dropEdge={dropEdge}
                isRenaming={isRenaming}
                tabIndex={roving.getTabIndex(path)}
                onOpen={handleOpen}
                onStartRename={startRename}
                onCommitRename={commitRename}
                onCancelRename={cancelRename}
                onFocus={roving.handleFocus}
                onNavigate={roving.handleKeyDown}
                onDragStart={handleRowDragStart}
                onDragEnd={handleRowDragEnd}
                onDragOverRow={handleRowDragOver}
                onDragLeaveRow={handleRowDragLeave}
                onDropRow={handleRowDrop}
                registerRef={roving.registerRef}
              />
            </li>
          );
        })}
      </ul>
    </section>
  );
}
