import {
  useEffect,
  useRef,
  type KeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { Folder, FileText } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { SidebarInlineEdit } from "@/components/sidebar/quiet/SidebarInlineEdit";
import { SidebarRowIndicators } from "@/components/sidebar/quiet/SidebarRowIndicators";
import { validateRenameBasename } from "@/components/sidebar/quiet/rename-utils";
import { announce } from "@/components/sidebar/quiet/aria-announcer";
import { isSystemFolderName, type RowDescriptor } from "./project-section-utils";
import { useProjectRowDrag } from "./useProjectRowDrag";

// ---------------------------------------------------------------------------
// ChildRow
// ---------------------------------------------------------------------------

export interface ChildRowProps {
  row: RowDescriptor;
  isFocused: boolean;
  hasFocusWithin: boolean;
  /** Whether this child directory is currently expanded inline (#158). */
  isExpanded?: boolean;
  /** True when this row's file is the active document — highlights the icon. */
  isActive?: boolean;
  /** ARIA tree level (project = 1, direct child = 2, …). */
  level?: number;
  isRenaming: boolean;
  onActivate: () => void;
  onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void;
  onFocus: () => void;
  onStartRename: (path: string) => void;
  onCommitRename: (
    oldPath: string,
    newBasename: string,
    isDirectory?: boolean,
  ) => void;
  onCancelRename: () => void;
  registerRef: (el: HTMLDivElement | null) => void;
}

export function ChildRow({
  row,
  isFocused,
  hasFocusWithin,
  isExpanded,
  isActive,
  level,
  isRenaming,
  onActivate,
  onKeyDown,
  onFocus,
  onStartRename,
  onCommitRename,
  onCancelRename,
  registerRef,
}: ChildRowProps) {
  // Roving tabindex — child rows only participate in focus order once the
  // user has entered the tree. Otherwise they stay out of the Tab sequence.
  const tabIndex = isFocused ? 0 : -1;
  const internalRef = useRef<HTMLDivElement | null>(null);
  const setRef = (el: HTMLDivElement | null) => {
    internalRef.current = el;
    registerRef(el);
  };

  // Restore focus to the row when rename mode ends.
  const wasRenamingRef = useRef(false);
  useEffect(() => {
    if (wasRenamingRef.current && !isRenaming) {
      internalRef.current?.focus();
    }
    wasRenamingRef.current = isRenaming;
  }, [isRenaming]);

  // #80 — announce the rename transition to screen readers via aria-live.
  const prevRenamingRef = useRef(false);
  useEffect(() => {
    if (isRenaming && !prevRenamingRef.current && row.entry) {
      announce(`Renaming ${row.entry.name}`);
    }
    prevRenamingRef.current = isRenaming;
  }, [isRenaming, row.entry]);

  const entry = row.entry;
  if (!entry) return null;

  const Icon = entry.is_directory ? Folder : FileText;
  const ariaLabel = entry.is_directory
    ? `Open folder ${entry.name}`
    : `Open file ${entry.name}`;

  // Issue #89 — any dotfile folder must never enter rename mode.
  const isSystemFolder = entry.is_directory && isSystemFolderName(entry.name);
  // F2 rename — files only (folders excluded per task #40).
  // Double-click rename — files AND non-system folders (task #62, #89).
  const renameableViaKeyboard = !entry.is_directory;
  const renameableViaDoubleClick = !isSystemFolder;

  // Drag handling — files only, not while renaming (#44).
  const { draggable, onDragStart } = useProjectRowDrag(entry, isRenaming);

  // Chain rename-aware handling with the parent's navigation handler.
  const handleRowKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (renameableViaKeyboard && event.key === "F2") {
      event.preventDefault();
      onStartRename(entry.path);
      return;
    }
    onKeyDown(event);
  };

  const handleRowClick = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (event.detail === 2) {
      event.preventDefault();
      event.stopPropagation();
      if (renameableViaDoubleClick) {
        onStartRename(entry.path);
      }
      return;
    }
    onActivate();
  };

  return (
    <div
      ref={setRef}
      role="treeitem"
      aria-level={level ?? 2}
      aria-expanded={entry.is_directory ? (isExpanded ?? false) : undefined}
      aria-selected={isFocused ? "true" : undefined}
      aria-current={isActive ? "page" : undefined}
      aria-label={ariaLabel}
      data-row-type="child"
      data-row-kind={entry.is_directory ? "folder" : "file"}
      data-active={isActive ? "true" : undefined}
      data-renaming={isRenaming ? "true" : undefined}
      tabIndex={hasFocusWithin ? tabIndex : -1}
      draggable={draggable}
      onClick={isRenaming ? undefined : handleRowClick}
      onKeyDown={isRenaming ? undefined : handleRowKeyDown}
      onFocus={onFocus}
      onDragStart={isRenaming ? undefined : onDragStart}
      className={cn(
        "h-7 px-2 flex items-center gap-2 rounded-sm text-[13px]",
        "text-foreground/90 transition-colors duration-150",
        !isRenaming && "hover:bg-muted/50 cursor-pointer",
        // Active document — name goes solid/medium, icon gets the accent below.
        isActive && "text-foreground font-medium",
        "relative focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--accent,var(--primary))] focus-visible:z-10",
      )}
    >
      <Icon
        className={cn(
          "h-3.5 w-3.5 shrink-0",
          isActive
            ? "text-[var(--color-accent-primary)]"
            : "text-muted-foreground/70",
        )}
        strokeWidth={1.5}
        aria-hidden="true"
      />
      {isRenaming ? (
        <SidebarInlineEdit
          mode="rename"
          initialValue={entry.name}
          validate={validateRenameBasename}
          onCommit={(value) =>
            onCommitRename(entry.path, value, entry.is_directory)
          }
          onCancel={onCancelRename}
          className="flex-1 min-w-0"
        />
      ) : (
        <>
          <TooltipProvider delayDuration={300}>
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="truncate min-w-0 flex-1">{entry.name}</span>
              </TooltipTrigger>
              <TooltipContent side="right" sideOffset={8}>
                {entry.name}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
          {/* #129 — per-row visual state. */}
          <SidebarRowIndicators
            path={entry.path}
            kind={entry.is_directory ? "folder" : "file"}
          />
        </>
      )}
    </div>
  );
}
