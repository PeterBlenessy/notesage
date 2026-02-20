import { useEffect, useState } from "react";
import { ChevronRight, Folder, FolderOpen, Settings, X, ExternalLink, GitCommitVertical, GitBranch, Target } from "lucide-react";
import { SyncedIcon } from "./SyncedIcon";
import { tauriApi } from "@/lib/tauri";
import { useProjectMetadataStore } from "@/stores/project-metadata-store";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { useSettingsStore } from "@/stores/settings-store";
import { useSyncStore } from "@/stores/sync-store";
import { useGitOperations } from "@/hooks/useGitOperations";
import { useFileOperations } from "@/hooks/useFileOperations";
import { FileTree } from "./FileTree";
import { BranchIndicator } from "./BranchIndicator";
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
  onExportFile?: (filePath: string, fileName: string) => void;
}

export function ProjectItem({
  projectPath,
  onFileClick,
  onNewNote,
  onOpenProjectSettings,
  onCloseProject,
  onExportFile,
}: ProjectItemProps) {
  const project = useWorkspaceStore((s) =>
    s.projects.find((p) => p.path === projectPath)
  );
  const metadata = useProjectMetadataStore((s) => s.metadataMap[projectPath]);
  const { isExpanded, toggleFolder } = useWorkspaceStore();
  const gitEnabled = useSettingsStore((s) => s.gitEnabled);
  const isSynced = useSyncStore((s) => s.syncedProjectPaths.includes(projectPath));
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
  const { refreshFileTree, openFile } = useFileOperations();

  // Determine if this project has active git data
  const isGitActive = gitEnabled && isGitRepo;

  const folderName = projectPath.split("/").filter(Boolean).pop() || "Project";
  const displayName = metadata?.name || folderName;
  const expandKey = `project:${projectPath}`;
  const expanded = isExpanded(expandKey);

  if (!project) return null;

  return (
    <>
    <ContextMenu>
      <ContextMenuTrigger>
        <div>
          <div
            className={cn(
              "group flex items-center gap-1.5 h-7 px-3 cursor-pointer transition-colors",
              "text-[13px] font-medium text-muted-foreground hover:text-foreground"
            )}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = "var(--color-accent)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = "";
            }}
            onClick={() => toggleFolder(expandKey)}
          >
            <ChevronRight
              className={cn(
                "h-3 w-3 shrink-0 text-muted-foreground transition-transform duration-150",
                expanded && "rotate-90"
              )}
            />
            <SyncedIcon icon={expanded ? FolderOpen : Folder} synced={isSynced} folder />
            <span className="truncate flex-1">{displayName}</span>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onOpenProjectSettings?.(projectPath);
              }}
              className="h-5 w-5 inline-flex items-center justify-center rounded opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-foreground"
              title="Project Settings"
            >
              <Settings className="h-3 w-3" />
            </button>
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
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onClick={() => onOpenProjectSettings?.(projectPath)}>
          <Settings className="mr-2 h-4 w-4" />
          Project Settings
        </ContextMenuItem>
        <ContextMenuItem onClick={() => setGoalsDialogOpen(true)}>
          <Target className="mr-2 h-4 w-4" />
          New Goals File...
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
              <GitBranch className="mr-2 h-4 w-4" />
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
              <GitCommitVertical className="mr-2 h-4 w-4" />
              Commit...
            </ContextMenuItem>
          </>
        )}
        <ContextMenuSeparator />
        <ContextMenuItem onClick={() => tauriApi.revealInFinder(projectPath)}>
          <ExternalLink className="mr-2 h-4 w-4" />
          Reveal in Finder
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onClick={() => onCloseProject?.(projectPath)}>
          <X className="mr-2 h-4 w-4" />
          Close Project
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>

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
    </>
  );
}
