import { FileEntry } from "@/lib/tauri";
import { FileTreeItem } from "./FileTreeItem";

interface FileTreeProps {
  tree: FileEntry[];
  onFileClick: (filePath: string, fileName: string) => void;
  onNewNote?: (parentPath?: string) => void;
  onMakeProject?: (path: string) => void;
  expandKeyPrefix?: string;
  gitRepoRoot?: string;
  onCommitFile?: (filePath: string) => void;
  onExportFile?: (filePath: string, fileName: string, format?: 'pdf' | 'docx' | 'pptx' | 'html') => void;
}

export function FileTree({ tree, onFileClick, onNewNote, onMakeProject, expandKeyPrefix, gitRepoRoot, onCommitFile, onExportFile }: FileTreeProps) {
  return (
    <div className="space-y-0.5" role="tree" aria-label="File explorer">
      {tree.map((entry) => (
        <FileTreeItem
          key={entry.path}
          entry={entry}
          level={0}
          onFileClick={onFileClick}
          onNewNote={onNewNote}
          onMakeProject={onMakeProject}
          expandKeyPrefix={expandKeyPrefix}
          gitRepoRoot={gitRepoRoot}
          onCommitFile={onCommitFile}
          onExportFile={onExportFile}
        />
      ))}
    </div>
  );
}
