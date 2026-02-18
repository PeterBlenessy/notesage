import { useState, useRef, useEffect, useMemo } from "react";
import { ChevronRight, ChevronDown, File, Folder, FolderDot, FilePlus, FolderPlus, FolderInput, Pencil, Trash2, ExternalLink, GitCommitVertical, FileDown } from "lucide-react";
import { toast } from "sonner";
import { FileEntry, tauriApi } from "@/lib/tauri";
import type { GitStatus } from "@/lib/tauri";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { useProjectMetadataStore } from "@/stores/project-metadata-store";
import { useEditorStore } from "@/stores/editor-store";
import { useSettingsStore } from "@/stores/settings-store";
import { useGitStore } from "@/stores/git-store";
import { useFileOperations } from "@/hooks/useFileOperations";
import { cn } from "@/lib/utils";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
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

const GIT_STATUS_CONFIG: Record<GitStatus, { label: string; color: string; tooltip: string }> = {
  modified: { label: "M", color: "text-muted-foreground/50", tooltip: "Modified" },
  added: { label: "A", color: "text-muted-foreground/50", tooltip: "Added — new file staged for commit" },
  staged: { label: "S", color: "text-muted-foreground/50", tooltip: "Staged" },
  untracked: { label: "U", color: "text-muted-foreground/50", tooltip: "Untracked — not yet tracked by git" },
  deleted: { label: "D", color: "text-muted-foreground/50", tooltip: "Deleted" },
  renamed: { label: "R", color: "text-muted-foreground/50", tooltip: "Renamed" },
  conflicted: { label: "C", color: "text-destructive", tooltip: "Conflicted — merge conflict" },
};

interface FileTreeItemProps {
  entry: FileEntry;
  level: number;
  onFileClick: (filePath: string, fileName: string) => void;
  onNewNote?: (parentPath?: string) => void;
  onMakeProject?: (path: string) => void;
  showMoveToProject?: boolean;
  expandKeyPrefix?: string;
  gitRepoRoot?: string;
  onCommitFile?: (filePath: string) => void;
  onExportFile?: (filePath: string, fileName: string) => void;
}

export function FileTreeItem({ entry, level, onFileClick, onNewNote, onMakeProject, showMoveToProject, expandKeyPrefix = "", gitRepoRoot, onCommitFile, onExportFile }: FileTreeItemProps) {
  const { isExpanded, toggleFolder } = useWorkspaceStore();
  const { tabs, activeTabId } = useEditorStore();
  const { createFolder, renamePath, deletePath } = useFileOperations();
  const expandKey = expandKeyPrefix + entry.path;
  const expanded = isExpanded(expandKey);
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(entry.name);
  const renameInputRef = useRef<HTMLInputElement>(null);

  const projects = useWorkspaceStore((s) => s.projects);
  const metadataMap = useProjectMetadataStore((s) => s.metadataMap);

  const externalChanges = useEditorStore((s) => s.externalChanges);
  const hasExternalChange = !entry.is_directory && entry.path in externalChanges;

  const activeTab = tabs.find((t) => t.id === activeTabId);
  const isActive = activeTab?.filePath === entry.path;

  // Detect if this directory is a project (in workspace or has .notesage/ child)
  const isProjectFolder = entry.is_directory && (
    projects.some((p) => p.path === entry.path) ||
    entry.children?.some((c) => c.name === ".notesage" && c.is_directory)
  );

  // Git status — paths from the backend are absolute, so we match directly.
  const gitEnabled = useSettingsStore((s) => s.gitEnabled);
  const repo = useGitStore((s) => gitRepoRoot ? s.repos[gitRepoRoot] : undefined);
  const fileStatuses = repo?.fileStatuses ?? [];
  const gitInfo = useMemo(() => {
    if (!gitEnabled || !gitRepoRoot || fileStatuses.length === 0) return null;

    if (!entry.is_directory) {
      // Direct lookup by absolute path (prefer unstaged over staged for display)
      const unstaged = fileStatuses.find((s) => s.path === entry.path && !s.staged);
      const staged = fileStatuses.find((s) => s.path === entry.path && s.staged);
      if (unstaged) return GIT_STATUS_CONFIG[unstaged.status];
      if (staged) return GIT_STATUS_CONFIG[staged.status];
      return null;
    }

    // For directories: check if any status path is inside this directory
    const dirPrefix = entry.path + "/";
    const hasChanges = fileStatuses.some((s) => s.path.startsWith(dirPrefix));
    if (hasChanges) return { label: "●", color: "text-muted-foreground/50", tooltip: "Contains changes" };
    return null;
  }, [gitEnabled, gitRepoRoot, entry.path, entry.is_directory, fileStatuses]);

  useEffect(() => {
    if (isRenaming && renameInputRef.current) {
      renameInputRef.current.focus();
      // Select the name part without extension for files
      const dotIndex = entry.name.lastIndexOf(".");
      if (!entry.is_directory && dotIndex > 0) {
        renameInputRef.current.setSelectionRange(0, dotIndex);
      } else {
        renameInputRef.current.select();
      }
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

  const handleNewFolder = async () => {
    if (!entry.is_directory) return;

    const folderName = window.prompt("Enter folder name:", "New Folder");
    if (!folderName) return;

    try {
      await createFolder(entry.path, folderName);
    } catch (error) {
      toast.error(`Failed to create folder: ${error}`);
    }
  };

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
  };

  const handleDelete = async () => {
    const confirmMessage = entry.is_directory
      ? `Delete folder "${entry.name}" and all its contents?`
      : `Delete file "${entry.name}"?`;

    if (!window.confirm(confirmMessage)) return;

    try {
      await deletePath(entry.path);
    } catch (error) {
      toast.error(`Failed to delete: ${error}`);
    }
  };

  const handleMoveToProject = async (destProjectPath: string) => {
    const destPath = `${destProjectPath}/${entry.name}`;
    try {
      await renamePath(entry.path, destPath);
    } catch (error) {
      console.error("Failed to move to project:", error);
    }
  };

  const handleRevealInFinder = async () => {
    try {
      await tauriApi.revealInFinder(entry.path);
    } catch (error) {
      console.error("Failed to reveal in Finder:", error);
    }
  };

  const paddingLeft = `${level * 14 + 6}px`;

  return (
    <div>
      <ContextMenu>
        <ContextMenuTrigger>
          <div
            className={cn(
              "group flex items-center gap-1.5 h-7 px-1.5 rounded-md cursor-pointer transition-colors duration-150",
              "text-sm",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
              isActive
                ? "bg-accent text-foreground font-medium"
                : "text-muted-foreground hover:bg-accent hover:text-foreground"
            )}
            style={{ paddingLeft }}
            onClick={handleClick}
            tabIndex={0}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleClick(); } }}
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
              isProjectFolder ? (
                <FolderDot className="h-3.5 w-3.5 shrink-0 text-muted-foreground/70" strokeWidth={1.5} />
              ) : (
                <Folder className="h-3.5 w-3.5 shrink-0 text-muted-foreground/70" strokeWidth={1.5} />
              )
            ) : (
              <File className="h-3.5 w-3.5 shrink-0 text-muted-foreground/70" strokeWidth={1.5} />
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
                onBlur={commitRename}
                onClick={(e) => e.stopPropagation()}
                className="flex-1 min-w-0 h-5 px-1 text-sm rounded border border-primary bg-background text-foreground outline-none transition-colors duration-150"
              />
            ) : (
              <span className="truncate flex-1">{entry.name}</span>
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
            <FilePlus className="mr-2 h-4 w-4" strokeWidth={1.5} />
            New File
          </ContextMenuItem>
          {entry.is_directory && (
            <ContextMenuItem onClick={handleNewFolder}>
              <FolderPlus className="mr-2 h-4 w-4" strokeWidth={1.5} />
              New Folder
            </ContextMenuItem>
          )}
          {entry.is_directory && onMakeProject && (
            <>
              <ContextMenuSeparator />
              <ContextMenuItem onClick={() => onMakeProject(entry.path)}>
                <FolderDot className="mr-2 h-4 w-4" strokeWidth={1.5} />
                {isProjectFolder ? "Open as Project" : "Make Project"}
              </ContextMenuItem>
            </>
          )}
          {showMoveToProject && projects.length > 0 && (
            <>
              <ContextMenuSeparator />
              <ContextMenuSub>
                <ContextMenuSubTrigger>
                  <FolderInput className="mr-2 h-4 w-4" strokeWidth={1.5} />
                  Move to Project
                </ContextMenuSubTrigger>
                <ContextMenuSubContent>
                  {projects.map((p) => {
                    const projectName = metadataMap[p.path]?.name || p.path.split("/").filter(Boolean).pop() || "Project";
                    const isCurrentProject = entry.path.startsWith(p.path + "/");
                    return (
                      <ContextMenuItem
                        key={p.path}
                        disabled={isCurrentProject}
                        onClick={() => handleMoveToProject(p.path)}
                      >
                        {projectName}
                      </ContextMenuItem>
                    );
                  })}
                </ContextMenuSubContent>
              </ContextMenuSub>
            </>
          )}
          <ContextMenuSeparator />
          <ContextMenuItem onClick={handleRevealInFinder}>
            <ExternalLink className="mr-2 h-4 w-4" strokeWidth={1.5} />
            Reveal in Finder
          </ContextMenuItem>
          {!entry.is_directory && entry.name.endsWith(".md") && onExportFile && (
            <>
              <ContextMenuSeparator />
              <ContextMenuItem onClick={() => onExportFile(entry.path, entry.name)}>
                <FileDown className="mr-2 h-4 w-4" strokeWidth={1.5} />
                Export as PDF
              </ContextMenuItem>
            </>
          )}
          {gitInfo && onCommitFile && (
            <>
              <ContextMenuSeparator />
              <ContextMenuItem onClick={() => onCommitFile(entry.path)}>
                <GitCommitVertical className="mr-2 h-4 w-4" strokeWidth={1.5} />
                Commit...
              </ContextMenuItem>
            </>
          )}
          <ContextMenuSeparator />
          <ContextMenuItem onClick={startRename}>
            <Pencil className="mr-2 h-4 w-4" strokeWidth={1.5} />
            Rename
          </ContextMenuItem>
          <ContextMenuItem onClick={handleDelete}>
            <Trash2 className="mr-2 h-4 w-4 text-destructive" strokeWidth={1.5} />
            Delete
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>

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
              showMoveToProject={showMoveToProject}
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
}
