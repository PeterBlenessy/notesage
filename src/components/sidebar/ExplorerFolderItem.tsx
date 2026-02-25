import { ChevronRight, Folder, FolderOpen, X, ExternalLink } from "lucide-react";
import { tauriApi } from "@/lib/tauri";
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

interface ExplorerFolderItemProps {
  folderPath: string;
  onFileClick: (filePath: string, fileName: string) => void;
  onNewNote?: (parentPath?: string) => void;
  onMakeProject?: (path: string) => void;
  onExportFile?: (filePath: string, fileName: string) => void;
}

export function ExplorerFolderItem({
  folderPath,
  onFileClick,
  onNewNote,
  onMakeProject,
  onExportFile,
}: ExplorerFolderItemProps) {
  const folder = useWorkspaceStore((s) =>
    s.explorerFolders.find((f) => f.path === folderPath)
  );
  const { isExpanded, toggleFolder, removeExplorerFolder } = useWorkspaceStore();

  const folderName = folderPath.split("/").filter(Boolean).pop() || "Folder";
  const expandKey = `explorer-folder:${folderPath}`;
  const expanded = isExpanded(expandKey);

  if (!folder) return null;

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
              <FolderOpen className="h-3.5 w-3.5 shrink-0 text-muted-foreground" strokeWidth={1.5} />
            ) : (
              <Folder className="h-3.5 w-3.5 shrink-0 text-muted-foreground" strokeWidth={1.5} />
            )}
            <span className="truncate flex-1">{folderName}</span>
            <button
              onClick={(e) => {
                e.stopPropagation();
                removeExplorerFolder(folderPath);
              }}
              className="h-5 w-5 inline-flex items-center justify-center rounded opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-foreground"
              title="Close Folder"
            >
              <X className="h-3 w-3" />
            </button>
          </div>

          {expanded && (
            <div className="pl-2">
              <FileTree
                tree={folder.fileTree}
                onFileClick={onFileClick}
                onNewNote={onNewNote}
                onMakeProject={onMakeProject}
                onExportFile={onExportFile}
                expandKeyPrefix={`explorer:${folderPath}:`}
              />
            </div>
          )}
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onClick={() => tauriApi.revealInFinder(folderPath)}>
          <ExternalLink className="mr-2 h-4 w-4" />
          Reveal in Finder
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onClick={() => removeExplorerFolder(folderPath)}>
          <X className="mr-2 h-4 w-4" />
          Close Folder
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
