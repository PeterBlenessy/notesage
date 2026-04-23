import {
  useEffect,
  useRef,
  useState,
  type DragEvent,
  type KeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
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
  useSidebarItemShortcuts,
} from "@/components/sidebar/quiet/useSidebarItemShortcuts";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { useEditorStore } from "@/stores/editor-store";
import { useFileOperations } from "@/hooks/useFileOperations";
import { cn } from "@/lib/utils";
import { FilePreview } from "./FilePreview";
import {
  FILE_DRAG_MIME,
  beginFileDrag,
  computeReorderTarget,
  hasFileDrag,
  isBelowMidpoint,
} from "./file-drag";

/**
 * PinnedSection — the pinned-files list for the quiet-composer sidebar.
 *
 * Reads absolute file paths from `workspace-store.pinnedFiles`. The list is
 * hidden (header only) when nothing is pinned to avoid an empty-state
 * placeholder. Manual ordering from drag-to-reorder (#44) is preserved by
 * rendering `pinnedFiles` in array order.
 *
 * Drag-and-drop (task #44) — HTML5 DnD is plumbed through `file-drag.ts`:
 * Recent / project-child rows use `FILE_DRAG_MIME` to advertise a single
 * absolute path; PinnedSection accepts drops either on a specific row
 * (with above/below midpoint precision) or on the outer `<ul>` (appends).
 * Pinned rows are themselves draggable to reorder within the list.
 */

export interface PinnedSectionProps {
  /**
   * Click handler for the `+` add button. When omitted, the button pins the
   * currently active tab (if any); otherwise the caller decides what "add"
   * means. The button is always rendered so its hover/focus affordances are
   * exercised by visual regression tests.
   */
  onAdd?: () => void;
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
  onOpen: (path: string) => void | Promise<void>;
  onStartRename: (path: string) => void;
  onCommitRename: (oldPath: string, newBasename: string) => void;
  onCancelRename: () => void;
  onDragStart: (event: DragEvent<HTMLDivElement>, index: number) => void;
  onDragEnd: () => void;
  onDragOverRow: (event: DragEvent<HTMLDivElement>, index: number) => void;
  onDragLeaveRow: (event: DragEvent<HTMLDivElement>, index: number) => void;
  onDropRow: (event: DragEvent<HTMLDivElement>, index: number) => void;
}

/**
 * Single row in the pinned list. Extracted from PinnedSection so we can
 * install the row-level ⌘⌥C / ⌘⌥R shortcut hook per row (#46) and carry
 * the per-row drag handlers locally (#44). The hook must run inside a
 * component because it captures `filePath` in the returned handler.
 */
function PinnedRow({
  path,
  index,
  isActive,
  isDragging,
  dropEdge,
  isRenaming,
  onOpen,
  onStartRename,
  onCommitRename,
  onCancelRename,
  onDragStart,
  onDragEnd,
  onDragOverRow,
  onDragLeaveRow,
  onDropRow,
}: PinnedRowProps) {
  const name = basename(path);
  const rowRef = useRef<HTMLDivElement | null>(null);
  const { onKeyDown: shortcutKeyDown } = useSidebarItemShortcuts({
    filePath: path,
    kind: "file",
  });

  const handleOpenKeys = (event: KeyboardEvent<HTMLDivElement>) => {
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

  // Shortcuts first (⌘⌥C / ⌘⌥R). When a shortcut matches it calls
  // preventDefault and chainKeyHandlers short-circuits so Enter/Space
  // handling doesn't double-fire on the same keystroke.
  const onKeyDown = chainKeyHandlers(shortcutKeyDown, handleOpenKeys);

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
          ref={rowRef}
          role="button"
          tabIndex={0}
          draggable={!isRenaming}
          data-active={isActive ? "true" : undefined}
          data-dragging={isDragging ? "true" : undefined}
          data-drop-edge={dropEdge ?? undefined}
          data-renaming={isRenaming ? "true" : undefined}
          aria-current={isActive ? "page" : undefined}
          title={path}
          onClick={isRenaming ? undefined : handleClick}
          onKeyDown={isRenaming ? undefined : onKeyDown}
          onDragStart={(e) => onDragStart(e, index)}
          onDragEnd={onDragEnd}
          onDragOver={(e) => onDragOverRow(e, index)}
          onDragLeave={(e) => onDragLeaveRow(e, index)}
          onDrop={(e) => onDropRow(e, index)}
          className={cn(
            "relative h-7 px-2 flex items-center gap-2 rounded-sm text-sm transition-colors duration-150",
            !isRenaming && "hover:bg-muted/50 cursor-pointer",
            "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--accent,var(--primary))]",
            isActive && "bg-muted",
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
          <FileIcon fileName={name} />
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
            <span className="truncate min-w-0">{name}</span>
          )}
        </div>
      </SidebarContextMenu>
    </FilePreview>
  );
}

export function PinnedSection({ onAdd, filter }: PinnedSectionProps) {
  const pinnedFiles = useWorkspaceStore((s) => s.pinnedFiles);
  const pinFile = useWorkspaceStore((s) => s.pinFile);
  const reorderPinnedFiles = useWorkspaceStore((s) => s.reorderPinnedFiles);
  const activeFilePath = useEditorStore((s) => {
    const tab = s.tabs.find((t) => t.id === s.activeTabId);
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

  const handleDefaultAdd = () => {
    if (!activeFilePath) {
      toast.info("Open a file to pin it");
      return;
    }
    pinFile(activeFilePath);
  };

  const handleOpen = async (path: string) => {
    try {
      await openFile(path, basename(path));
    } catch (error) {
      toast.error(`Failed to open file: ${error}`);
    }
  };

  // -----------------------------------------------------------------------
  // Rename handlers (task #40).
  // -----------------------------------------------------------------------

  const startRename = (path: string) => {
    setRenamingPath(path);
  };

  const cancelRename = () => {
    setRenamingPath(null);
  };

  const commitRename = async (oldPath: string, newBasename: string) => {
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
  };

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

  const handleRowDragStart = (
    event: DragEvent<HTMLDivElement>,
    index: number,
  ) => {
    const path = visibleFiles[index];
    if (!path) return;
    beginFileDrag(event, path);
    // `move` effect during same-list reorder; the outer container reads the
    // MIME type via `hasFileDrag` regardless of effectAllowed.
    event.dataTransfer.effectAllowed = "move";
    // Use the ORIGINAL (unfiltered) index because reorderPinnedFiles works
    // against `pinnedFiles`. When a filter is active `visibleFiles` is a
    // subset; we need to map back to the source array.
    const originalIndex = pinnedFiles.indexOf(path);
    setDraggingIndex(originalIndex);
  };

  const handleRowDragEnd = () => {
    setDraggingIndex(null);
    setActiveDrop(null);
    setContainerActive(false);
  };

  // -----------------------------------------------------------------------
  // Drop target — pinned rows (precise above/below insertion).
  // -----------------------------------------------------------------------

  const handleRowDragOver = (
    event: DragEvent<HTMLDivElement>,
    visibleIndex: number,
  ) => {
    if (!hasFileDrag(event)) return;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect =
      draggingIndex !== null ? "move" : "copy";

    const below = isBelowMidpoint(event, event.currentTarget);
    // Translate visibleIndex back to the original pinnedFiles index so
    // reorder math stays consistent under filtering.
    const path = visibleFiles[visibleIndex];
    if (!path) return;
    const originalIndex = pinnedFiles.indexOf(path);
    setActiveDrop({ index: originalIndex, edge: below ? "below" : "above" });
  };

  const handleRowDragLeave = (
    event: DragEvent<HTMLDivElement>,
    _visibleIndex: number,
  ) => {
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
  };

  const handleRowDrop = (
    event: DragEvent<HTMLDivElement>,
    visibleIndex: number,
  ) => {
    if (!hasFileDrag(event)) return;
    event.preventDefault();
    event.stopPropagation();

    const path = event.dataTransfer.getData(FILE_DRAG_MIME);
    if (!path) return;

    const targetPath = visibleFiles[visibleIndex];
    if (!targetPath) return;
    const targetIndex = pinnedFiles.indexOf(targetPath);
    if (targetIndex < 0) return;

    const below = isBelowMidpoint(event, event.currentTarget);

    const existingIndex = pinnedFiles.indexOf(path);
    if (existingIndex >= 0) {
      // Reorder — path is already pinned.
      const to = computeReorderTarget(existingIndex, targetIndex, below);
      if (to !== null) reorderPinnedFiles(existingIndex, to);
    } else {
      // New pin — append, then reorder into place.
      pinFile(path);
      const fromIndex = pinnedFiles.length; // post-append index
      const to = computeReorderTarget(fromIndex, targetIndex, below);
      if (to !== null) reorderPinnedFiles(fromIndex, to);
    }

    setActiveDrop(null);
    setContainerActive(false);
    setDraggingIndex(null);
  };

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

  return (
    <section
      aria-label="Pinned"
      className="group/section flex flex-col gap-1"
    >
      <header className="flex items-center justify-between gap-2 px-2 h-6">
        <h2 className="text-xs font-medium tracking-wider uppercase text-muted-foreground">
          Pinned
        </h2>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label="Add pinned"
          onClick={onAdd ?? handleDefaultAdd}
          className="opacity-0 group-hover/section:opacity-100 focus-visible:opacity-100 focus-within:opacity-100 transition-opacity duration-150"
        >
          <Plus strokeWidth={1.5} />
        </Button>
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
                onOpen={handleOpen}
                onStartRename={startRename}
                onCommitRename={commitRename}
                onCancelRename={cancelRename}
                onDragStart={handleRowDragStart}
                onDragEnd={handleRowDragEnd}
                onDragOverRow={handleRowDragOver}
                onDragLeaveRow={handleRowDragLeave}
                onDropRow={handleRowDrop}
              />
            </li>
          );
        })}
      </ul>
    </section>
  );
}
