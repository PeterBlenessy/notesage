import { useState } from "react";
import { FolderOpen, FilePlus, FolderPlus, Loader2 } from "lucide-react";
import { tauriApi } from "@/lib/tauri";
import { useProjectStore } from "@/stores/project-store";
import { useProjectMetadataStore } from "@/stores/project-metadata-store";
import { useFileOperations } from "@/hooks/useFileOperations";
import { FileTree } from "./FileTree";

interface SidebarProps {
  onNewNote?: (parentPath?: string) => void;
  onNewProject?: () => void;
}

export function Sidebar({ onNewNote, onNewProject }: SidebarProps) {
  const [isLoading, setIsLoading] = useState(false);
  const { rootPath, setRootPath, setFileTree } = useProjectStore();
  const { openFile } = useFileOperations();

  const handleOpenFolder = async () => {
    try {
      setIsLoading(true);
      const folderPath = await tauriApi.openFolderDialog();

      if (folderPath) {
        setRootPath(folderPath);
        const tree = await tauriApi.listDirectory(folderPath);
        setFileTree(tree);
      }
    } catch (error) {
      console.error("Failed to open folder:", error);
      alert(`Error: ${error}`);
    } finally {
      setIsLoading(false);
    }
  };

  const handleFileClick = async (filePath: string, fileName: string) => {
    try {
      await openFile(filePath, fileName);
    } catch (error) {
      alert(`Error reading file: ${error}`);
    }
  };

  const metadata = useProjectMetadataStore((s) => s.metadata);

  // Use project metadata name if available, otherwise extract from path
  const folderName = metadata?.name || (rootPath ? rootPath.split('/').filter(Boolean).pop() : null);

  return (
    <div className="h-full w-full flex flex-col" style={{ backgroundColor: 'var(--color-card)' }}>
      <div className="h-11 px-3 border-b border-border flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <h2 className="text-sm font-semibold tracking-tight shrink-0">Explorer</h2>
          {folderName && (
            <span className="text-xs text-muted-foreground truncate">· {folderName}</span>
          )}
        </div>
        <div className="flex items-center gap-0.5">
          {rootPath && onNewNote && (
            <button
              onClick={() => onNewNote()}
              className="h-7 w-7 inline-flex items-center justify-center rounded-md transition-colors text-muted-foreground hover:text-foreground"
              onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'var(--color-accent)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = ''; }}
              title="New Note (Cmd+N)"
            >
              <FilePlus className="h-3.5 w-3.5" />
            </button>
          )}
          {onNewProject && (
            <button
              onClick={onNewProject}
              className="h-7 w-7 inline-flex items-center justify-center rounded-md transition-colors text-muted-foreground hover:text-foreground"
              onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'var(--color-accent)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = ''; }}
              title="New Project (Cmd+Shift+N)"
            >
              <FolderPlus className="h-3.5 w-3.5" />
            </button>
          )}
          <button
            onClick={handleOpenFolder}
            disabled={isLoading}
            className="h-7 w-7 inline-flex items-center justify-center rounded-md transition-colors text-muted-foreground hover:text-foreground disabled:opacity-50"
            onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'var(--color-accent)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = ''; }}
            title="Open Folder"
          >
            {isLoading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <FolderOpen className="h-3.5 w-3.5" />
            )}
          </button>
        </div>
      </div>

      {rootPath && (
        <div className="flex-1 overflow-y-auto p-2">
          <FileTree onFileClick={handleFileClick} onNewNote={onNewNote} />
        </div>
      )}

      {!rootPath && (
        <div className="flex-1 flex items-center justify-center p-4">
          <p className="text-sm text-muted-foreground text-center">
            Open a folder to start browsing files
          </p>
        </div>
      )}
    </div>
  );
}
