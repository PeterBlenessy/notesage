import { ChevronRight, ChevronDown, File, Folder, FilePlus, FolderPlus, Pencil, Trash2 } from "lucide-react";
import { FileEntry } from "@/lib/tauri";
import { useProjectStore } from "@/stores/project-store";
import { useEditorStore } from "@/stores/editor-store";
import { useFileOperations } from "@/hooks/useFileOperations";
import { cn } from "@/lib/utils";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";

interface FileTreeItemProps {
  entry: FileEntry;
  level: number;
  onFileClick: (filePath: string, fileName: string) => void;
}

export function FileTreeItem({ entry, level, onFileClick }: FileTreeItemProps) {
  const { isExpanded, toggleFolder } = useProjectStore();
  const { tabs, activeTabId } = useEditorStore();
  const { createFile, createFolder, renamePath, deletePath, openFile } = useFileOperations();
  const expanded = isExpanded(entry.path);

  const activeTab = tabs.find((t) => t.id === activeTabId);
  const isActive = activeTab?.filePath === entry.path;

  const handleClick = () => {
    if (entry.is_directory) {
      toggleFolder(entry.path);
    } else {
      onFileClick(entry.path, entry.name);
    }
  };

  const handleNewFile = async () => {
    const fileName = window.prompt("Enter file name:", "untitled.md");
    if (!fileName) return;

    try {
      const parentPath = entry.is_directory ? entry.path : entry.path.substring(0, entry.path.lastIndexOf("/"));
      const newPath = await createFile(parentPath, fileName);
      await openFile(newPath, fileName);
    } catch (error) {
      alert(`Failed to create file: ${error}`);
    }
  };

  const handleNewFolder = async () => {
    if (!entry.is_directory) return;

    const folderName = window.prompt("Enter folder name:", "New Folder");
    if (!folderName) return;

    try {
      await createFolder(entry.path, folderName);
    } catch (error) {
      alert(`Failed to create folder: ${error}`);
    }
  };

  const handleRename = async () => {
    const newName = window.prompt("Enter new name:", entry.name);
    if (!newName || newName === entry.name) return;

    try {
      const parentPath = entry.path.substring(0, entry.path.lastIndexOf("/"));
      const newPath = `${parentPath}/${newName}`;
      await renamePath(entry.path, newPath);
    } catch (error) {
      alert(`Failed to rename: ${error}`);
    }
  };

  const handleDelete = async () => {
    const confirmMessage = entry.is_directory
      ? `Delete folder "${entry.name}" and all its contents?`
      : `Delete file "${entry.name}"?`;

    if (!window.confirm(confirmMessage)) return;

    try {
      await deletePath(entry.path);
    } catch (error) {
      alert(`Failed to delete: ${error}`);
    }
  };

  const paddingLeft = `${level * 14 + 6}px`;

  return (
    <div>
      <ContextMenu>
        <ContextMenuTrigger>
          <div
            className={cn(
              "group flex items-center gap-1.5 h-7 px-1.5 rounded-md cursor-pointer transition-colors",
              "text-[13px]",
              isActive
                ? "text-foreground font-medium"
                : "text-muted-foreground hover:text-foreground"
            )}
            style={{
              paddingLeft,
              backgroundColor: isActive ? 'var(--color-accent)' : undefined,
            }}
            onMouseEnter={(e) => { if (!isActive) e.currentTarget.style.backgroundColor = 'var(--color-accent)'; }}
            onMouseLeave={(e) => { if (!isActive) e.currentTarget.style.backgroundColor = ''; }}
            onClick={handleClick}
          >
            {entry.is_directory ? (
              <span className="shrink-0 text-muted-foreground">
                {expanded ? (
                  <ChevronDown className="h-3.5 w-3.5" />
                ) : (
                  <ChevronRight className="h-3.5 w-3.5" />
                )}
              </span>
            ) : (
              <span className="w-3.5 shrink-0" />
            )}

            {entry.is_directory ? (
              <Folder className="h-3.5 w-3.5 shrink-0 text-muted-foreground/70" />
            ) : (
              <File className="h-3.5 w-3.5 shrink-0 text-muted-foreground/70" />
            )}

            <span className="truncate flex-1">{entry.name}</span>
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem onClick={handleNewFile}>
            <FilePlus className="mr-2 h-4 w-4" />
            New File
          </ContextMenuItem>
          {entry.is_directory && (
            <ContextMenuItem onClick={handleNewFolder}>
              <FolderPlus className="mr-2 h-4 w-4" />
              New Folder
            </ContextMenuItem>
          )}
          <ContextMenuSeparator />
          <ContextMenuItem onClick={handleRename}>
            <Pencil className="mr-2 h-4 w-4" />
            Rename
          </ContextMenuItem>
          <ContextMenuItem onClick={handleDelete} className="text-destructive">
            <Trash2 className="mr-2 h-4 w-4" />
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
            />
          ))}
        </div>
      )}
    </div>
  );
}
