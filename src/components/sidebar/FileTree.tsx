import { FileEntry } from "@/lib/tauri";
import { FileTreeItem } from "./FileTreeItem";

interface FileTreeProps {
  tree: FileEntry[];
  onFileClick: (filePath: string, fileName: string) => void;
  onNewNote?: (parentPath?: string) => void;
  onMakeProject?: (path: string) => void;
  expandKeyPrefix?: string;
}

export function FileTree({ tree, onFileClick, onNewNote, onMakeProject, expandKeyPrefix }: FileTreeProps) {
  return (
    <div className="space-y-0.5">
      {tree.map((entry) => (
        <FileTreeItem
          key={entry.path}
          entry={entry}
          level={0}
          onFileClick={onFileClick}
          onNewNote={onNewNote}
          onMakeProject={onMakeProject}
          expandKeyPrefix={expandKeyPrefix}
        />
      ))}
    </div>
  );
}
