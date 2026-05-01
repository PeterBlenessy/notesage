import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronRight, Folder, FolderOpen, Lock, Settings, X, ExternalLink, GitCommitVertical, GitBranch, Target, FilePlus, FolderPlus } from "lucide-react";
import { parseNotesageDrop } from "@/lib/drag-utils";
import { SyncedIcon } from "./SyncedIcon";
import { tauriApi } from "@/lib/tauri";
import { useProjectMetadataStore } from "@/stores/project-metadata-store";
import { useConnectionsStore } from "@/stores/connections-store";
import { describeLockTarget } from "@/lib/ai/project-lock";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useWorkspaceStore, type WorkspaceProject } from "@/stores/workspace-store";
import { useSettingsStore } from "@/stores/settings-store";
import { useIsProjectSynced } from "@/lib/icloud-sync";
import { useGitOperations } from "@/hooks/useGitOperations";
import { useFileOperations } from "@/hooks/useFileOperations";
import { toast } from "sonner";
import { FileTree } from "./FileTree";
import { BranchIndicator } from "./BranchIndicator";
import { NewFolderDialog } from "./NewFolderDialog";
import { CommitDialog } from "@/components/git/CommitDialog";
import { GoalTemplateDialog } from "@/components/goals/GoalTemplateDialog";
import { cn } from "@/lib/utils";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";

interface ProjectItemProps {
  projectPath: string;
  onFileClick: (filePath: string, fileName: string) => void;
  onNewNote?: (parentPath?: string) => void;
  onOpenProjectSettings?: (projectPath: string) => void;
  onCloseProject?: (projectPath: string) => void;
  onExportFile?: (filePath: string, fileName: string, format?: 'pdf' | 'docx' | 'pptx' | 'html') => void;
}

export function ProjectItem({
  projectPath,
  onFileClick,
  onNewNote,
  onOpenProjectSettings,
  onCloseProject,
  onExportFile,
}: ProjectItemProps) {
  const selectProject = useMemo(
    () => (s: { projects: WorkspaceProject[] }) =>
      s.projects.find((p) => p.path === projectPath),
    [projectPath]
  );
  const project = useWorkspaceStore(selectProject);
  const metadata = useProjectMetadataStore((s) => s.metadataMap[projectPath]);
  const connections = useConnectionsStore((s) => s.connections);
  const aiLock = metadata?.aiLock;
  const lockedConnection = aiLock ? connections.find((c) => c.id === aiLock.connectionId) : undefined;
  const lockTooltip = aiLock
    ? `Locked to ${describeLockTarget(aiLock.connectionId, lockedConnection?.label)} — only this provider can access`
    : null;
  const { isExpanded, toggleFolder } = useWorkspaceStore();
  const gitEnabled = useSettingsStore((s) => s.gitEnabled);
  const isSynced = useIsProjectSynced(projectPath);
  const { isGitRepo, initGit, initRepo } = useGitOperations(projectPath);

  // Initialize git when this project is first rendered (only if git is enabled)
  useEffect(() => {
    if (gitEnabled) {
      initGit();
    }
  }, [projectPath, initGit, gitEnabled]);

  const [commitDialogOpen, setCommitDialogOpen] = useState(false);
  const [commitPreSelected, setCommitPreSelected] = useState<string[]>([]);
  const [goalsDialogOpen, setGoalsDialogOpen] = useState(false);
  const [newFolderDialogOpen, setNewFolderDialogOpen] = useState(false);
  const { refreshFileTree, openFile, renamePath } = useFileOperations();
  const [isDragOver, setIsDragOver] = useState(false);
  const dragCounter = useRef(0);

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current = 0;
    setIsDragOver(false);

    const dragged = parseNotesageDrop(e);
    if (!dragged) return;

    if (dragged.path === projectPath) return;
    const draggedParent = dragged.path.substring(0, dragged.path.lastIndexOf("/"));
    if (draggedParent === projectPath) return;
    if (dragged.isDirectory && projectPath.startsWith(dragged.path + "/")) {
      toast.error("Cannot move a folder into itself");
      return;
    }
    const destPath = `${projectPath}/${dragged.name}`;
    try {
      const exists = await tauriApi.pathExists(destPath);
      if (exists) {
        toast.error(`"${dragged.name}" already exists in this project`);
        return;
      }
      await renamePath(dragged.path, destPath);
    } catch (error) {
      toast.error(`Failed to move "${dragged.name}": ${error}`);
    }
  }, [projectPath, renamePath]);

  const handleNewFolder = useCallback(() => {
    setNewFolderDialogOpen(true);
  }, []);

  // Determine if this project has active git data
  const isGitActive = gitEnabled && isGitRepo;

  const folderName = projectPath.split("/").filter(Boolean).pop() || "Project";
  const displayName = metadata?.name || folderName;
  const expandKey = `project:${projectPath}`;
  const expanded = isExpanded(expandKey);

  if (!project) return null;

  return (
    <>
    <div>
      <div
        onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect = "move"; }}
        onDragEnter={(e) => {
          e.preventDefault();
          e.stopPropagation();
          dragCounter.current++;
          if (dragCounter.current === 1) setIsDragOver(true);
        }}
        onDragLeave={(e) => {
          e.stopPropagation();
          dragCounter.current--;
          if (dragCounter.current === 0) setIsDragOver(false);
        }}
        onDrop={handleDrop}
      >
      <ContextMenu>
        <ContextMenuTrigger>
          <div
            className={cn(
              "group flex items-center gap-1.5 h-7 px-3 cursor-pointer transition-colors",
              "text-[13px] font-medium text-muted-foreground hover:text-foreground hover:bg-accent",
              isDragOver && "bg-accent ring-2 ring-ring/30"
            )}
            onClick={() => toggleFolder(expandKey)}
          >
            <ChevronRight
              className={cn(
                "h-3 w-3 shrink-0 text-muted-foreground transition-transform duration-150",
                expanded && "rotate-90"
              )}
              aria-hidden="true"
            />
            {aiLock ? (
              <TooltipProvider delayDuration={200}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span
                      data-testid="project-lock-badge"
                      className="relative shrink-0 h-3.5 w-3.5"
                      aria-label={lockTooltip ?? 'Locked project'}
                    >
                      <SyncedIcon icon={expanded ? FolderOpen : Folder} synced={isSynced} folder />
                      <span className="absolute -right-[3px] -bottom-[1px] flex items-center justify-center h-[11px] w-[11px] rounded-full bg-background">
                        <Lock className="h-[8px] w-[8px] text-muted-foreground" strokeWidth={2} aria-hidden="true" />
                      </span>
                    </span>
                  </TooltipTrigger>
                  <TooltipContent side="right" sideOffset={8}>
                    {lockTooltip}
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            ) : (
              <SyncedIcon icon={expanded ? FolderOpen : Folder} synced={isSynced} folder />
            )}
            <span className="truncate flex-1">{displayName}</span>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onOpenProjectSettings?.(projectPath);
              }}
              className="h-6 w-6 inline-flex items-center justify-center rounded-md opacity-0 group-hover:opacity-100 transition-all text-muted-foreground hover:text-foreground hover:bg-foreground/10"
              title="Project Settings"
            >
              <Settings className="h-3.5 w-3.5" />
            </button>
          </div>
        </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onClick={() => onOpenProjectSettings?.(projectPath)}>
          <Settings className="mr-2 h-4 w-4" aria-hidden="true" />
          Project Settings
        </ContextMenuItem>
        <ContextMenuItem onClick={() => setGoalsDialogOpen(true)}>
          <Target className="mr-2 h-4 w-4" aria-hidden="true" />
          New Goals File...
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onClick={() => onNewNote?.(projectPath)}>
          <FilePlus className="mr-2 h-4 w-4" strokeWidth={1.5} aria-hidden="true" />
          New File
        </ContextMenuItem>
        <ContextMenuItem onClick={handleNewFolder}>
          <FolderPlus className="mr-2 h-4 w-4" strokeWidth={1.5} aria-hidden="true" />
          New Folder
        </ContextMenuItem>
        {gitEnabled && !isGitActive && (
          <>
            <ContextMenuSeparator />
            <ContextMenuItem onClick={async () => {
              try {
                await initRepo();
              } catch (error) {
                console.error("Failed to initialize git repository:", error);
              }
            }}>
              <GitBranch className="mr-2 h-4 w-4" aria-hidden="true" />
              Initialize Git Repository
            </ContextMenuItem>
          </>
        )}
        {isGitActive && (
          <>
            <ContextMenuSeparator />
            <ContextMenuItem onClick={() => {
              setCommitPreSelected([]);
              setCommitDialogOpen(true);
            }}>
              <GitCommitVertical className="mr-2 h-4 w-4" aria-hidden="true" />
              Commit...
            </ContextMenuItem>
          </>
        )}
        <ContextMenuSeparator />
        <ContextMenuItem onClick={() => tauriApi.revealInFinder(projectPath)}>
          <ExternalLink className="mr-2 h-4 w-4" aria-hidden="true" />
          Reveal in Finder
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onClick={() => onCloseProject?.(projectPath)}>
          <X className="mr-2 h-4 w-4" aria-hidden="true" />
          Close Project
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
      </div>

      {expanded && (
        <div className="pl-2">
          <FileTree
            tree={project.fileTree}
            onFileClick={onFileClick}
            onNewNote={onNewNote}
            expandKeyPrefix="project:"
            gitRepoRoot={isGitActive ? projectPath : undefined}
            onExportFile={onExportFile}
            onCommitFile={isGitActive ? (filePath) => {
              setCommitPreSelected([filePath]);
              setCommitDialogOpen(true);
            } : undefined}
          />
          {isGitActive && <BranchIndicator projectPath={projectPath} />}
        </div>
      )}
    </div>

    {isGitActive && (
      <CommitDialog
        open={commitDialogOpen}
        onOpenChange={setCommitDialogOpen}
        repoPath={projectPath}
        preSelectedFiles={commitPreSelected}
      />
    )}

    <GoalTemplateDialog
      open={goalsDialogOpen}
      onOpenChange={setGoalsDialogOpen}
      projectPath={projectPath}
      onCreated={(filePath) => {
        refreshFileTree(projectPath);
        const fileName = filePath.split("/").pop() || filePath;
        openFile(filePath, fileName);
      }}
    />

    <NewFolderDialog
      open={newFolderDialogOpen}
      onOpenChange={setNewFolderDialogOpen}
      parentPath={projectPath}
      onCreated={() => refreshFileTree(projectPath)}
    />
    </>
  );
}
