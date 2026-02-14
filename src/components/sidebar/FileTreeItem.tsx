import { ChevronRight, ChevronDown, File, Folder } from "lucide-react";
import { FileEntry } from "@/lib/tauri";
import { useProjectStore } from "@/stores/project-store";
import { cn } from "@/lib/utils";

interface FileTreeItemProps {
  entry: FileEntry;
  level: number;
  onFileClick: (filePath: string, fileName: string) => void;
}

export function FileTreeItem({ entry, level, onFileClick }: FileTreeItemProps) {
  const { isExpanded, toggleFolder } = useProjectStore();
  const expanded = isExpanded(entry.path);

  const handleClick = () => {
    if (entry.is_directory) {
      toggleFolder(entry.path);
    } else {
      onFileClick(entry.path, entry.name);
    }
  };

  const paddingLeft = `${level * 12 + 8}px`;

  return (
    <div>
      <div
        className={cn(
          "flex items-center gap-1 py-1 px-2 rounded-md cursor-pointer hover:bg-accent",
          "text-sm transition-colors"
        )}
        style={{ paddingLeft }}
        onClick={handleClick}
      >
        {entry.is_directory && (
          <span className="flex-shrink-0">
            {expanded ? (
              <ChevronDown className="h-4 w-4" />
            ) : (
              <ChevronRight className="h-4 w-4" />
            )}
          </span>
        )}

        {!entry.is_directory && <span className="w-4" />}

        {entry.is_directory ? (
          <Folder className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
        ) : (
          <File className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
        )}

        <span className="truncate flex-1">{entry.name}</span>
      </div>

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
