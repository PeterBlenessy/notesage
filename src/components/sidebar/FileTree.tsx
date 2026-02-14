import { useProjectStore } from "@/stores/project-store";
import { FileTreeItem } from "./FileTreeItem";

interface FileTreeProps {
  onFileClick: (filePath: string, fileName: string) => void;
}

export function FileTree({ onFileClick }: FileTreeProps) {
  const { fileTree } = useProjectStore();

  return (
    <div className="space-y-1">
      {fileTree.map((entry) => (
        <FileTreeItem
          key={entry.path}
          entry={entry}
          level={0}
          onFileClick={onFileClick}
        />
      ))}
    </div>
  );
}
