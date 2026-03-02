import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronRight, Folder, FolderOpen, FolderDot, X, ExternalLink, FilePlus, FolderPlus } from "lucide-react";
import { toast } from "sonner";
import { tauriApi } from "@/lib/tauri";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { useFileOperations } from "@/hooks/useFileOperations";
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
  const projects = useWorkspaceStore((s) => s.projects);
  const { isExpanded, toggleFolder, removeExplorerFolder } = useWorkspaceStore();
  const { createFolder, renamePath } = useFileOperations();
  const [isDragOver, setIsDragOver] = useState(false);
  const dragLeaveTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
    if (dragLeaveTimeout.current) { clearTimeout(dragLeaveTimeout.current); dragLeaveTimeout.current = null; }

    const raw = e.dataTransfer.getData("text/plain");
    if (!raw) return;
    let dragged: { _notesage?: boolean; path: string; name: string; isDirectory: boolean };
    try { dragged = JSON.parse(raw); } catch { return; }
    if (!dragged._notesage) return;

    if (dragged.path === folderPath) return;
    const draggedParent = dragged.path.substring(0, dragged.path.lastIndexOf("/"));
    if (draggedParent === folderPath) return;
    if (dragged.isDirectory && folderPath.startsWith(dragged.path + "/")) {
      toast.error("Cannot move a folder into itself");
      return;
    }
    const destPath = `${folderPath}/${dragged.name}`;
    try {
      const exists = await tauriApi.pathExists(destPath);
      if (exists) {
        toast.error(`"${dragged.name}" already exists in this folder`);
        return;
      }
      await renamePath(dragged.path, destPath);
    } catch (error) {
      console.error("Failed to move:", error);
    }
  }, [folderPath, renamePath]);

  useEffect(() => {
    return () => { if (dragLeaveTimeout.current) clearTimeout(dragLeaveTimeout.current); };
  }, []);

  const handleNewFolder = async () => {
    const folderName = window.prompt("Enter folder name:", "New Folder");
    if (!folderName) return;
    try {
      await createFolder(folderPath, folderName);
    } catch (error) {
      toast.error(`Failed to create folder: ${error}`);
    }
  };

  const folderName = folderPath.split("/").filter(Boolean).pop() || "Folder";
  const expandKey = `explorer-folder:${folderPath}`;
  const expanded = isExpanded(expandKey);

  const isProjectFolder = projects.some((p) => p.path === folderPath) ||
    folder?.fileTree.some((c) => c.name === ".notesage" && c.is_directory);

  if (!folder) return null;

  return (
    <div>
      <div
        onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect = "move"; }}
        onDragEnter={(e) => {
          e.preventDefault();
          e.stopPropagation();
          if (dragLeaveTimeout.current) { clearTimeout(dragLeaveTimeout.current); dragLeaveTimeout.current = null; }
          setIsDragOver(true);
        }}
        onDragLeave={(e) => {
          e.stopPropagation();
          dragLeaveTimeout.current = setTimeout(() => setIsDragOver(false), 50);
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
        </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onClick={() => onNewNote?.(folderPath)}>
          <FilePlus className="mr-2 h-4 w-4" strokeWidth={1.5} />
          New File
        </ContextMenuItem>
        <ContextMenuItem onClick={handleNewFolder}>
          <FolderPlus className="mr-2 h-4 w-4" strokeWidth={1.5} />
          New Folder
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onClick={() => tauriApi.revealInFinder(folderPath)}>
          <ExternalLink className="mr-2 h-4 w-4" />
          Reveal in Finder
        </ContextMenuItem>
        {onMakeProject && (
          <>
            <ContextMenuSeparator />
            <ContextMenuItem onClick={() => onMakeProject(folderPath)}>
              <FolderDot className="mr-2 h-4 w-4" strokeWidth={1.5} />
              {isProjectFolder ? "Open as Project" : "Make Project"}
            </ContextMenuItem>
          </>
        )}
        <ContextMenuSeparator />
        <ContextMenuItem onClick={() => removeExplorerFolder(folderPath)}>
          <X className="mr-2 h-4 w-4" />
          Close Folder
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
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
  );
}
