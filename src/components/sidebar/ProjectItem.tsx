import { ChevronRight, Folder, FolderOpen, Settings, X } from "lucide-react";
import { useProjectMetadataStore } from "@/stores/project-metadata-store";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { FileTree } from "./FileTree";
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
}

export function ProjectItem({
  projectPath,
  onFileClick,
  onNewNote,
  onOpenProjectSettings,
  onCloseProject,
}: ProjectItemProps) {
  const project = useWorkspaceStore((s) =>
    s.projects.find((p) => p.path === projectPath)
  );
  const metadata = useProjectMetadataStore((s) => s.metadataMap[projectPath]);
  const { isExpanded, toggleFolder } = useWorkspaceStore();

  const folderName = projectPath.split("/").filter(Boolean).pop() || "Project";
  const displayName = metadata?.name || folderName;
  const expandKey = `project:${projectPath}`;
  const expanded = isExpanded(expandKey);

  if (!project) return null;

  return (
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
            {expanded ? (
              <FolderOpen className="h-3.5 w-3.5 shrink-0 text-muted-foreground/70" />
            ) : (
              <Folder className="h-3.5 w-3.5 shrink-0 text-muted-foreground/70" />
            )}
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
              />
            </div>
          )}
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onClick={() => onOpenProjectSettings?.(projectPath)}>
          <Settings className="mr-2 h-4 w-4" />
          Project Settings
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onClick={() => onCloseProject?.(projectPath)}>
          <X className="mr-2 h-4 w-4" />
          Close Project
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
