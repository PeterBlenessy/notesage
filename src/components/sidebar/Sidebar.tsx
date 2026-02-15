import { useState } from "react";
import { Button } from "@/components/ui/button";
import { FolderOpen } from "lucide-react";
import { tauriApi } from "@/lib/tauri";
import { useProjectStore } from "@/stores/project-store";
import { useFileOperations } from "@/hooks/useFileOperations";
import { FileTree } from "./FileTree";

export function Sidebar() {
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

  return (
    <div className="h-full w-full border-r border-border bg-card flex flex-col">
      <div className="p-4 border-b border-border">
        <Button
          onClick={handleOpenFolder}
          disabled={isLoading}
          className="w-full"
          variant="outline"
        >
          <FolderOpen className="mr-2 h-4 w-4" />
          {isLoading ? "Loading..." : "Open Folder"}
        </Button>
      </div>

      {rootPath && (
        <div className="flex-1 overflow-y-auto p-2">
          <div className="text-xs text-muted-foreground mb-2 px-2 truncate">
            {rootPath}
          </div>
          <FileTree onFileClick={handleFileClick} />
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
