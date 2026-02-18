import { FileEntry } from "@/lib/tauri";
import { FileTreeItem } from "./FileTreeItem";

interface FileTreeProps {
  tree: FileEntry[];
  onFileClick: (filePath: string, fileName: string) => void;
  onNewNote?: (parentPath?: string) => void;
  onMakeProject?: (path: string) => void;
  showMoveToProject?: boolean;
  expandKeyPrefix?: string;
  gitRepoRoot?: string;
  onCommitFile?: (filePath: string) => void;
  onExportFile?: (filePath: string, fileName: string) => void;
}

export function FileTree({ tree, onFileClick, onNewNote, onMakeProject, showMoveToProject, expandKeyPrefix, gitRepoRoot, onCommitFile, onExportFile }: FileTreeProps) {
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
          showMoveToProject={showMoveToProject}
          expandKeyPrefix={expandKeyPrefix}
          gitRepoRoot={gitRepoRoot}
          onCommitFile={onCommitFile}
          onExportFile={onExportFile}
        />
      ))}
    </div>
  );
}
