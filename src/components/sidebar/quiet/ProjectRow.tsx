import { useMemo, useState, type DragEvent, type KeyboardEvent, type MouseEvent as ReactMouseEvent } from "react";
import { droppedFilePaths, hasInboxDrag } from "@/components/sidebar/quiet/file-drag";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useProjectMetadataStore } from "@/stores/project-metadata-store";
import { type WorkspaceProject } from "@/stores/workspace-store";
import { resolveFolderIcon } from "@/lib/folder-icon";
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
import { projectBasename, countMarkdownFiles } from "./project-section-utils";

// ---------------------------------------------------------------------------
// ProjectRow
// ---------------------------------------------------------------------------

export interface ProjectRowProps {
  project: WorkspaceProject;
  isActive: boolean;
  isExpanded: boolean;
  isFocused: boolean;
  hasFocusWithin: boolean;
  isRenaming: boolean;
  onOpen: () => void;
  onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void;
  onFocus: () => void;
  onAddNote: () => void;
  onStartRename: () => void;
  onCommitRename: (value: string) => void;
  onCancelRename: () => void;
  registerRef: (el: HTMLDivElement | null) => void;
  /**
   * Inbox items dropped on the row: the caller files them into the project.
   * Only the Inbox's selection payload is accepted. Absent = not a target.
   */
  onDropFiles?: (paths: string[]) => void;
}

export function ProjectRow({
  project,
  isActive,
  isExpanded,
  isFocused,
  hasFocusWithin,
  isRenaming,
  onOpen,
  onKeyDown,
  onFocus,
  onAddNote,
  onStartRename,
  onCommitRename,
  onCancelRename,
  registerRef,
  onDropFiles,
}: ProjectRowProps) {
  const [dropActive, setDropActive] = useState(false);
  // Inbox items only (`hasInboxDrag`): filing is the gesture, not moving
  // arbitrary sidebar files between projects.
  const dragOver = (event: DragEvent<HTMLDivElement>) => {
    if (!onDropFiles || !hasInboxDrag(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    setDropActive(true);
  };
  const dragLeave = (event: DragEvent<HTMLDivElement>) => {
    const next = event.relatedTarget as Node | null;
    if (next && event.currentTarget.contains(next)) return;
    setDropActive(false);
  };
  const drop = (event: DragEvent<HTMLDivElement>) => {
    if (!onDropFiles || !hasInboxDrag(event)) return;
    event.preventDefault();
    setDropActive(false);
    onDropFiles(droppedFilePaths(event));
  };
  const name = useMemo(() => projectBasename(project.path), [project.path]);
  const hasTree = project.fileTree.length > 0;
  const fileCount = useMemo(
    () => (hasTree ? countMarkdownFiles(project.fileTree) : null),
    [project.fileTree, hasTree],
  );
  const ariaLabel =
    fileCount === null
      ? `Open project ${name}`
      : `Open project ${name} (${fileCount} file${fileCount === 1 ? "" : "s"})`;

  // Read custom appearance (icon + color) from project metadata so the
  // user-picked customization actually surfaces on the row. Without this
  // the FolderAppearancePicker stores values that nothing reads.
  const appearance = useProjectMetadataStore(
    (s) => s.getMetadata(project.path)?.appearance,
  );
  const { icon: ProjectIcon, color: projectIconColor } = resolveFolderIcon({
    type: 'standard',
    expanded: isExpanded,
    name,
    appearance,
  });

  // Roving tabindex — before any focus lands in the tree, the first item
  // should still be reachable via Tab, so default to tabIndex 0 when the
  // section has no focused row yet.
  const tabIndex = isFocused || !hasFocusWithin ? 0 : -1;

  const handleRowClick = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (event.detail === 2) {
      event.preventDefault();
      event.stopPropagation();
      onStartRename();
      return;
    }
    onOpen();
  };

  return (
    <div
      ref={registerRef}
      role="treeitem"
      aria-level={1}
      aria-expanded={isExpanded}
      aria-selected={isFocused ? "true" : undefined}
      aria-label={ariaLabel}
      aria-current={isActive ? "true" : undefined}
      data-active={isActive ? "true" : undefined}
      data-row-type="project"
      data-renaming={isRenaming ? "true" : undefined}
      tabIndex={tabIndex}
      onClick={isRenaming ? undefined : handleRowClick}
      onKeyDown={isRenaming ? undefined : onKeyDown}
      onFocus={onFocus}
      onDragOver={dragOver}
      onDragLeave={dragLeave}
      onDrop={drop}
      data-drop-active={dropActive ? "true" : undefined}
      className={cn(
        "group/row h-7 px-2 flex items-center gap-2 rounded-sm text-[13px]",
        "text-foreground/90 transition-colors duration-150",
        !isRenaming && "hover:bg-muted/50 cursor-pointer",
        "relative focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--accent,var(--primary))] focus-visible:z-10",
        isActive && !isRenaming && "bg-muted text-foreground font-medium",
        dropActive && "bg-muted/60 outline outline-1 outline-dashed outline-muted-foreground",
      )}
    >
      {/*
        Folder ↔ FolderOpen swap is the discoverability cue for the
        inline-expand affordance (sidebar-simplification task #3). A
        sighted keyboard user has no way to know `→` will expand the
        project without it; the open-folder glyph also confirms the
        expand state matches the user's mental model after they hit
        `→` or click the row. `aria-expanded` already tells screen
        readers; this is the visual mirror.
      */}
      <ProjectIcon
        className={cn(
          "h-3.5 w-3.5 shrink-0",
          projectIconColor
            ? undefined
            : isActive
              ? "text-[var(--color-accent-primary)]"
              : "text-muted-foreground/70",
        )}
        style={projectIconColor ? { color: projectIconColor } : undefined}
        strokeWidth={1.5}
        aria-hidden="true"
      />

      {isRenaming ? (
        <SidebarInlineEdit
          mode="rename"
          initialValue={name}
          validate={validateRenameBasename}
          onCommit={onCommitRename}
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
          {/* #129 — per-project visual state. */}
          <SidebarRowIndicators path={project.path} kind="project" />
          <span
            className="relative inline-flex h-6 min-w-6 items-center justify-end shrink-0"
            aria-hidden={fileCount === null ? undefined : "false"}
          >
            {fileCount !== null && (
              <span className="text-xs text-muted-foreground tabular-nums opacity-100 group-hover/row:opacity-0 transition-opacity duration-150">
                {fileCount}
              </span>
            )}
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              aria-label={`New note in ${name}`}
              tabIndex={-1}
              onClick={(event) => {
                event.stopPropagation();
                onAddNote();
              }}
              className="absolute right-0 top-0 opacity-0 group-hover/row:opacity-100 transition-opacity duration-150"
            >
              <Plus strokeWidth={1.5} />
            </Button>
          </span>
        </>
      )}
    </div>
  );
}
