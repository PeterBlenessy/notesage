import { useState, useRef, useEffect, useCallback, useMemo, memo } from "react";
import { ChevronRight, ChevronDown, File, Folder, FolderDot, FilePlus, FolderPlus, FolderInput, Pencil, Trash2, ExternalLink, GitCommitVertical, FileDown, Eye } from "lucide-react";
import { SyncedIcon } from "./SyncedIcon";
import { FolderPickerItem } from "./FolderPickerItem";
import { NewFolderDialog } from "./NewFolderDialog";
import { toast } from "sonner";
import { FileEntry, tauriApi } from "@/lib/tauri";
import { NOTESAGE_DRAG_MIME, parseNotesageDrop } from "@/lib/drag-utils";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { useEditorStore } from "@/stores/editor-store";
import { useProjectMetadataStore } from "@/stores/project-metadata-store";
import { useSettingsStore } from "@/stores/settings-store";
import { useFileOperations } from "@/hooks/useFileOperations";
import { useFileTreeItemState } from "@/hooks/useFileTreeItemState";
import { cn } from "@/lib/utils";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

interface FileTreeItemProps {
  entry: FileEntry;
  level: number;
  onFileClick: (filePath: string, fileName: string) => void;
  onNewNote?: (parentPath?: string) => void;
  onMakeProject?: (path: string) => void;
  expandKeyPrefix?: string;
  gitRepoRoot?: string;
  onCommitFile?: (filePath: string) => void;
  onExportFile?: (filePath: string, fileName: string, format?: 'pdf' | 'docx' | 'pptx' | 'html') => void;
}

const FileTreeItemInner = memo(function FileTreeItem({ entry, level, onFileClick, onNewNote, onMakeProject, expandKeyPrefix = "", gitRepoRoot, onCommitFile, onExportFile }: FileTreeItemProps) {
  const toggleFolder = useWorkspaceStore((s) => s.toggleFolder);
  const { renamePath, deletePath } = useFileOperations();
  const expandKey = expandKeyPrefix + entry.path;
  const expanded = useWorkspaceStore((s) => s.expandedFolders.has(expandKey));
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(entry.name);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const [newFolderDialogOpen, setNewFolderDialogOpen] = useState(false);
  const renameInputRef = useRef<HTMLInputElement>(null);
  const renameFocusingRef = useRef(false);
  const dragCounter = useRef(0);
  const dragExpandTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  const projects = useWorkspaceStore((s) => s.projects);
  const explorerFolders = useWorkspaceStore((s) => s.explorerFolders);
  const notesTree = useWorkspaceStore((s) => s.notesTree);
  const metadataMap = useProjectMetadataStore((s) => s.metadataMap);
  const notesRootPath = useSettingsStore((s) => s.notesRootPath);

  // Consolidated store computations via hook
  const { isActive, hasExternalChange, isCloudFile, gitInfo } = useFileTreeItemState(
    entry.path,
    entry.is_directory,
    gitRepoRoot,
  );

  // Detect if this directory is a project (in workspace or has .notesage/ child)
  const isProjectFolder = entry.is_directory && (
    projects.some((p) => p.path === entry.path) ||
    entry.children?.some((c) => c.name === ".notesage" && c.is_directory)
  );

  useEffect(() => {
    if (isRenaming) {
      // Guard against onBlur firing before focus is established
      renameFocusingRef.current = true;
      // Delay focus to ensure context menu has fully closed and released focus
      const timer = setTimeout(() => {
        if (renameInputRef.current) {
          renameInputRef.current.focus();
          const dotIndex = entry.name.lastIndexOf(".");
          if (!entry.is_directory && dotIndex > 0) {
            renameInputRef.current.setSelectionRange(0, dotIndex);
          } else {
            renameInputRef.current.select();
          }
        }
        renameFocusingRef.current = false;
      }, 50);
      return () => { clearTimeout(timer); renameFocusingRef.current = false; };
    }
  }, [isRenaming, entry.name, entry.is_directory]);

  const handleClick = () => {
    if (isRenaming) return;
    if (entry.is_directory) {
      toggleFolder(expandKey);
    } else {
      onFileClick(entry.path, entry.name);
    }
  };

  const handleNewFile = () => {
    const parentPath = entry.is_directory ? entry.path : entry.path.substring(0, entry.path.lastIndexOf("/"));
    if (onNewNote) {
      onNewNote(parentPath);
    }
  };

  const handleNewFolder = useCallback(() => {
    if (!entry.is_directory) return;
    setNewFolderDialogOpen(true);
  }, [entry.is_directory]);

  const startRename = () => {
    setRenameValue(entry.name);
    setIsRenaming(true);
  };

  const commitRename = async () => {
    const newName = renameValue.trim();
    setIsRenaming(false);

    if (!newName || newName === entry.name) return;

    try {
      const parentPath = entry.path.substring(0, entry.path.lastIndexOf("/"));
      const newPath = `${parentPath}/${newName}`;
      await renamePath(entry.path, newPath);
    } catch (error) {
      console.error("Failed to rename:", error);
    }
  };

  const cancelRename = () => {
    setIsRenaming(false);
    setRenameValue(entry.name);
    // Blur focus so the parent div doesn't show a focus outline
    (document.activeElement as HTMLElement)?.blur();
  };

  const handleDeleteConfirm = async () => {
    try {
      await deletePath(entry.path);
    } catch (error) {
      toast.error(`Failed to delete: ${error}`);
    }
  };

  const currentParent = entry.path.substring(0, entry.path.lastIndexOf("/"));

  // Task #24: Memoize destinations for "Move to..." context menu
  const moveDestinations = useMemo(() => {
    const destinations = [
      // Quick Notes root
      ...(notesRootPath && !notesRootPath.startsWith("~") ? [{ path: notesRootPath, label: "Quick Notes", category: "notes" as const, tree: notesTree }] : []),
      // Projects
      ...projects.map((p) => ({
        path: p.path,
        label: metadataMap[p.path]?.name || p.path.split("/").filter(Boolean).pop() || "Project",
        category: "project" as const,
        tree: p.fileTree,
      })),
      // Explorer folders
      ...explorerFolders.map((f) => ({
        path: f.path,
        label: f.path.split("/").filter(Boolean).pop() || "Folder",
        category: "folder" as const,
        tree: f.fileTree,
      })),
    ];
    // Deduplicate by path (a project may also be an explorer folder or Quick Notes root)
    const seen = new Set<string>();
    const unique = destinations.filter((d) => {
      if (seen.has(d.path)) return false;
      seen.add(d.path);
      return true;
    });
    // Filter out the entry itself if it's a directory (can't move into self)
    return unique.filter((d) => !(entry.is_directory && d.path === entry.path));
  }, [notesRootPath, projects, explorerFolders, notesTree, metadataMap, currentParent, entry.path, entry.is_directory]);

  const handleMoveTo = async (destFolderPath: string) => {
    if (destFolderPath === currentParent) return;
    if (entry.is_directory && (destFolderPath === entry.path || destFolderPath.startsWith(entry.path + "/"))) {
      toast.error("Cannot move a folder into itself");
      return;
    }
    const destPath = `${destFolderPath}/${entry.name}`;
    try {
      const exists = await tauriApi.pathExists(destPath);
      if (exists) {
        toast.error(`A file named "${entry.name}" already exists in the destination`);
        return;
      }
      await renamePath(entry.path, destPath);
    } catch (error) {
      console.error("Failed to move file:", error);
    }
  };

  // Task #25: Extract context menu callbacks to useCallback
  const handlePreviewAsHtml = useCallback(() => {
    onFileClick(entry.path, entry.name);
    setTimeout(() => {
      const { tabs, setViewMode } = useEditorStore.getState();
      const tab = tabs.find((t) => t.filePath === entry.path);
      if (tab) setViewMode(tab.id, "html-preview");
    }, 100);
  }, [onFileClick, entry.path, entry.name]);

  const handleMakeProject = useCallback(() => {
    onMakeProject?.(entry.path);
  }, [onMakeProject, entry.path]);

  const handleCommitFile = useCallback(() => {
    onCommitFile?.(entry.path);
  }, [onCommitFile, entry.path]);

  const handleOpenDeleteDialog = useCallback(() => {
    setDeleteDialogOpen(true);
  }, []);

  const handleExportPdf = useCallback(() => {
    onExportFile?.(entry.path, entry.name, 'pdf');
  }, [onExportFile, entry.path, entry.name]);

  const handleExportDocx = useCallback(() => {
    onExportFile?.(entry.path, entry.name, 'docx');
  }, [onExportFile, entry.path, entry.name]);

  const handleExportPptx = useCallback(() => {
    onExportFile?.(entry.path, entry.name, 'pptx');
  }, [onExportFile, entry.path, entry.name]);

  const handleExportHtml = useCallback(() => {
    onExportFile?.(entry.path, entry.name, 'html');
  }, [onExportFile, entry.path, entry.name]);

  const handleRevealInFinder = async () => {
    try {
      await tauriApi.revealInFinder(entry.path);
    } catch (error) {
      console.error("Failed to reveal in Finder:", error);
    }
  };

  const handleDragStart = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    const payload = JSON.stringify({
      _notesage: true,
      path: entry.path,
      name: entry.name,
      isDirectory: entry.is_directory,
    });
    e.dataTransfer.setData(NOTESAGE_DRAG_MIME, payload);
    e.dataTransfer.effectAllowed = "move";
    e.currentTarget.style.opacity = "0.5";
  }, [entry.path, entry.name, entry.is_directory]);

  const handleDragEnd = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.currentTarget.style.opacity = "";
  }, []);

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current = 0;
    setIsDragOver(false);
    if (dragExpandTimeout.current) {
      clearTimeout(dragExpandTimeout.current);
      dragExpandTimeout.current = null;
    }
    if (!entry.is_directory) return;

    const dragged = parseNotesageDrop(e);
    if (!dragged) return;

    // Don't drop onto self
    if (dragged.path === entry.path) return;
    // Don't drop into current parent (no-op)
    const draggedParent = dragged.path.substring(0, dragged.path.lastIndexOf("/"));
    if (draggedParent === entry.path) return;
    // Don't drop a directory into its own descendant
    if (dragged.isDirectory && entry.path.startsWith(dragged.path + "/")) {
      toast.error("Cannot move a folder into itself");
      return;
    }
    const destPath = `${entry.path}/${dragged.name}`;
    try {
      const exists = await tauriApi.pathExists(destPath);
      if (exists) {
        toast.error(`"${dragged.name}" already exists in "${entry.name}"`);
        return;
      }
      await renamePath(dragged.path, destPath);
    } catch (error) {
      console.error("Failed to move:", error);
    }
  }, [entry.path, entry.name, entry.is_directory, renamePath]);

  // Cleanup timeouts on unmount
  useEffect(() => {
    return () => {
      if (dragExpandTimeout.current) clearTimeout(dragExpandTimeout.current);
    };
  }, []);

  const paddingLeft = `${level * 16 + 12}px`;

  return (
    <div>
      <div
        draggable={!isRenaming}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragOver={(e) => {
          if (!entry.is_directory) return;
          e.preventDefault();
          e.stopPropagation();
          e.dataTransfer.dropEffect = "move";
        }}
        onDragEnter={(e) => {
          if (!entry.is_directory) return;
          e.preventDefault();
          e.stopPropagation();
          dragCounter.current++;
          if (dragCounter.current === 1) {
            setIsDragOver(true);
            if (!expanded) {
              dragExpandTimeout.current = setTimeout(() => toggleFolder(expandKey), 600);
            }
          }
        }}
        onDragLeave={(e) => {
          if (!entry.is_directory) return;
          e.stopPropagation();
          dragCounter.current--;
          if (dragCounter.current === 0) {
            setIsDragOver(false);
            if (dragExpandTimeout.current) { clearTimeout(dragExpandTimeout.current); dragExpandTimeout.current = null; }
          }
        }}
        onDrop={handleDrop}
      >
      <ContextMenu>
        <ContextMenuTrigger>
          <div
            className={cn(
              "group flex items-center gap-1.5 h-7 px-1.5 rounded-md cursor-pointer transition-colors duration-150",
              "text-sm",
              "focus-visible:outline-none",
              isActive
                ? "bg-accent text-foreground font-medium"
                : "text-muted-foreground hover:bg-accent hover:text-foreground",
              isDragOver && entry.is_directory && "bg-accent ring-2 ring-ring/30"
            )}
            style={{ paddingLeft }}
            onClick={handleClick}
            tabIndex={0}
            aria-current={isActive ? "page" : undefined}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                handleClick();
              } else if (entry.is_directory && e.key === 'ArrowRight' && !expanded) {
                e.preventDefault();
                toggleFolder(expandKey);
              } else if (entry.is_directory && e.key === 'ArrowLeft' && expanded) {
                e.preventDefault();
                toggleFolder(expandKey);
              }
            }}
          >
            {entry.is_directory ? (
              <span className="shrink-0 text-muted-foreground">
                {expanded ? (
                  <ChevronDown className="h-3.5 w-3.5" strokeWidth={1.5} />
                ) : (
                  <ChevronRight className="h-3.5 w-3.5" strokeWidth={1.5} />
                )}
              </span>
            ) : (
              <span className="w-3.5 shrink-0" />
            )}

            {entry.is_directory ? (
              <SyncedIcon icon={isProjectFolder ? FolderDot : Folder} synced={isCloudFile} folder />
            ) : (
              <SyncedIcon icon={File} synced={isCloudFile} />
            )}

            {isRenaming ? (
              <input
                ref={renameInputRef}
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    commitRename();
                  } else if (e.key === "Escape") {
                    e.preventDefault();
                    cancelRename();
                  }
                  e.stopPropagation();
                }}
                onBlur={() => { if (!renameFocusingRef.current) commitRename(); }}
                onClick={(e) => e.stopPropagation()}
                className="flex-1 min-w-0 h-5 px-1 text-sm rounded border border-primary bg-background text-foreground outline-none transition-colors duration-150"
              />
            ) : (
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="truncate flex-1">{entry.name}</span>
                  </TooltipTrigger>
                  <TooltipContent side="right" sideOffset={8}>
                    {entry.name}
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}

            {hasExternalChange && (
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="shrink-0 text-[10px] leading-none text-muted-foreground/70">
                      ●
                    </span>
                  </TooltipTrigger>
                  <TooltipContent side="right">
                    Modified externally
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}
            {gitInfo && (
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span
                      className={cn(
                        "shrink-0 font-mono text-[10px] leading-none transition-opacity duration-150",
                        gitInfo.color
                      )}
                    >
                      {gitInfo.label}
                    </span>
                  </TooltipTrigger>
                  <TooltipContent side="right">
                    {gitInfo.tooltip}
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem onClick={handleNewFile}>
            <FilePlus className="h-4 w-4" strokeWidth={1.5} />
            New File
          </ContextMenuItem>
          {entry.is_directory && (
            <ContextMenuItem onClick={handleNewFolder}>
              <FolderPlus className="h-4 w-4" strokeWidth={1.5} />
              New Folder
            </ContextMenuItem>
          )}
          {entry.is_directory && onMakeProject && (
            <>
              <ContextMenuSeparator />
              <ContextMenuItem onClick={handleMakeProject}>
                <FolderDot className="h-4 w-4" strokeWidth={1.5} />
                {isProjectFolder ? "Open as Project" : "Make Project"}
              </ContextMenuItem>
            </>
          )}
          {(() => {
            if (moveDestinations.length === 0) return null;

            const hasMultipleCategories = new Set(moveDestinations.map((d) => d.category)).size > 1;

            const renderDestination = (d: typeof moveDestinations[number]) => {
              const subfolders = d.tree.filter((e) =>
                e.is_directory && e.name !== ".notesage" && e.name !== ".git" &&
                !(entry.is_directory && (e.path === entry.path || e.path.startsWith(entry.path + "/")))
              );
              const isRootCurrentParent = d.path === currentParent;
              if (subfolders.length === 0 && !entry.path.startsWith(d.path + "/")) {
                return (
                  <ContextMenuItem key={d.path} onClick={() => handleMoveTo(d.path)}>
                    {d.label}
                  </ContextMenuItem>
                );
              }
              // If entry is not inside this destination and there are no subfolders, just show root
              if (subfolders.length === 0) {
                return (
                  <ContextMenuItem key={d.path} onClick={() => handleMoveTo(d.path)} disabled={isRootCurrentParent}>
                    {d.label}{isRootCurrentParent ? <span className="ml-1 text-muted-foreground text-xs">(current)</span> : null}
                  </ContextMenuItem>
                );
              }
              return (
                <ContextMenuSub key={d.path}>
                  <ContextMenuSubTrigger>{d.label}</ContextMenuSubTrigger>
                  <ContextMenuSubContent>
                    <ContextMenuItem onClick={() => handleMoveTo(d.path)} disabled={isRootCurrentParent}>
                      <span className="text-muted-foreground">(root){isRootCurrentParent ? " — current location" : ""}</span>
                    </ContextMenuItem>
                    <ContextMenuSeparator />
                    {subfolders.map((folder) => (
                      <FolderPickerItem key={folder.path} folder={folder} onMoveTo={handleMoveTo} entryPath={entry.path} entryIsDirectory={entry.is_directory} currentParent={currentParent} />
                    ))}
                  </ContextMenuSubContent>
                </ContextMenuSub>
              );
            };

            return (
              <>
                <ContextMenuSeparator />
                <ContextMenuSub>
                  <ContextMenuSubTrigger>
                    <FolderInput className="mr-2 h-4 w-4" strokeWidth={1.5} />
                    Move to...
                  </ContextMenuSubTrigger>
                  <ContextMenuSubContent>
                    {hasMultipleCategories ? (
                      <>
                        {moveDestinations.some((d) => d.category === "notes") && (
                          <>
                            <ContextMenuLabel className="text-xs text-muted-foreground">QUICK NOTES</ContextMenuLabel>
                            {moveDestinations.filter((d) => d.category === "notes").map(renderDestination)}
                          </>
                        )}
                        {moveDestinations.some((d) => d.category === "project") && (
                          <>
                            <ContextMenuLabel className="text-xs text-muted-foreground">PROJECTS</ContextMenuLabel>
                            {moveDestinations.filter((d) => d.category === "project").map(renderDestination)}
                          </>
                        )}
                        {moveDestinations.some((d) => d.category === "folder") && (
                          <>
                            <ContextMenuLabel className="text-xs text-muted-foreground">FOLDERS</ContextMenuLabel>
                            {moveDestinations.filter((d) => d.category === "folder").map(renderDestination)}
                          </>
                        )}
                      </>
                    ) : (
                      moveDestinations.map(renderDestination)
                    )}
                  </ContextMenuSubContent>
                </ContextMenuSub>
              </>
            );
          })()}
          <ContextMenuSeparator />
          <ContextMenuItem onClick={handleRevealInFinder}>
            <ExternalLink className="h-4 w-4" strokeWidth={1.5} />
            Reveal in Finder
          </ContextMenuItem>
          {!entry.is_directory && entry.name.endsWith(".md") && onExportFile && (
            <>
              <ContextMenuSeparator />
              <ContextMenuSub>
                <ContextMenuSubTrigger>
                  <FileDown className="mr-2 h-4 w-4" strokeWidth={1.5} />
                  Export as...
                </ContextMenuSubTrigger>
                <ContextMenuSubContent>
                  <ContextMenuItem onClick={handleExportPdf}>
                    PDF
                  </ContextMenuItem>
                  <ContextMenuItem onClick={handleExportDocx}>
                    Word (.docx)
                  </ContextMenuItem>
                  <ContextMenuItem onClick={handleExportPptx}>
                    PowerPoint
                  </ContextMenuItem>
                  <ContextMenuItem onClick={handleExportHtml}>
                    HTML
                  </ContextMenuItem>
                </ContextMenuSubContent>
              </ContextMenuSub>
              <ContextMenuItem onClick={handlePreviewAsHtml}>
                <Eye className="h-4 w-4" strokeWidth={1.5} />
                Preview as HTML
              </ContextMenuItem>
            </>
          )}
          {gitInfo && onCommitFile && (
            <>
              <ContextMenuSeparator />
              <ContextMenuItem onClick={handleCommitFile}>
                <GitCommitVertical className="h-4 w-4" strokeWidth={1.5} />
                Commit...
              </ContextMenuItem>
            </>
          )}
          <ContextMenuSeparator />
          <ContextMenuItem onClick={startRename}>
            <Pencil className="h-4 w-4" strokeWidth={1.5} />
            Rename
          </ContextMenuItem>
          <ContextMenuItem onClick={handleOpenDeleteDialog}>
            <Trash2 className="h-4 w-4 text-destructive" strokeWidth={1.5} />
            Delete
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
      </div>

      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Delete {entry.is_directory ? "folder" : "file"}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              {entry.is_directory
                ? `"${entry.name}" and all its contents will be permanently deleted.`
                : `"${entry.name}" will be permanently deleted.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteConfirm}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {entry.is_directory && (
        <NewFolderDialog
          open={newFolderDialogOpen}
          onOpenChange={setNewFolderDialogOpen}
          parentPath={entry.path}
          onCreated={() => {}}
        />
      )}

      {entry.is_directory && expanded && entry.children && (
        <div>
          {entry.children.map((child) => (
            <FileTreeItem
              key={child.path}
              entry={child}
              level={level + 1}
              onFileClick={onFileClick}
              onNewNote={onNewNote}
              onMakeProject={onMakeProject}
              expandKeyPrefix={expandKeyPrefix}
              gitRepoRoot={gitRepoRoot}
              onCommitFile={onCommitFile}
              onExportFile={onExportFile}
            />
          ))}
        </div>
      )}
    </div>
  );
}, fileTreeItemAreEqual);

function fileTreeItemAreEqual(
  prev: Readonly<FileTreeItemProps>,
  next: Readonly<FileTreeItemProps>,
): boolean {
  return (
    prev.entry.path === next.entry.path &&
    prev.entry.name === next.entry.name &&
    prev.entry.is_directory === next.entry.is_directory &&
    prev.entry.children === next.entry.children &&
    prev.level === next.level &&
    prev.expandKeyPrefix === next.expandKeyPrefix &&
    prev.gitRepoRoot === next.gitRepoRoot &&
    prev.onFileClick === next.onFileClick &&
    prev.onNewNote === next.onNewNote &&
    prev.onMakeProject === next.onMakeProject &&
    prev.onCommitFile === next.onCommitFile &&
    prev.onExportFile === next.onExportFile
  );
}

export const FileTreeItem = FileTreeItemInner;
