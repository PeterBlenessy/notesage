import React, { useState } from "react";
import { FolderOpen, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { tauriApi } from "@/lib/tauri";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { useSettingsStore } from "@/stores/settings-store";
import { Button } from "@/components/ui/button";
import { SidebarSection } from "./SidebarSection";
import { ExplorerFolderItem } from "./ExplorerFolderItem";

interface FoldersSectionProps {
  onFileClick: (filePath: string, fileName: string) => void;
  onNewNote?: (parentPath?: string) => void;
  onMakeProject?: (path: string) => void;
  onExportFile?: (filePath: string, fileName: string, format?: 'pdf' | 'docx' | 'pptx' | 'html') => void;
  panelCollapsed?: boolean;
}

export const FoldersSection = React.memo(function FoldersSection({
  onFileClick,
  onNewNote,
  onMakeProject,
  onExportFile,
  panelCollapsed,
}: FoldersSectionProps) {
  const [isLoading, setIsLoading] = useState(false);
  const explorerFolders = useWorkspaceStore((s) => s.explorerFolders);
  const addExplorerFolder = useWorkspaceStore((s) => s.addExplorerFolder);
  const explorerCollapsed = useWorkspaceStore((s) => s.explorerCollapsed);
  const setExplorerCollapsed = useWorkspaceStore((s) => s.setExplorerCollapsed);

  const handleOpenFolder = async () => {
    try {
      setIsLoading(true);
      const folderPath = await tauriApi.openFolderDialog();
      if (folderPath) {
        const tree = await tauriApi.listDirectory(folderPath, useSettingsStore.getState().showHiddenFiles);
        addExplorerFolder(folderPath, tree);
      }
    } catch (error) {
      toast.error(`Failed to open folder: ${error}`);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <SidebarSection
      icon={<FolderOpen className="h-4 w-4" strokeWidth={1.5} />}
      title="Folders"
      open={!explorerCollapsed}
      onOpenChange={(open) => setExplorerCollapsed(!open)}
      panelCollapsed={panelCollapsed}
      actions={
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={handleOpenFolder}
          disabled={isLoading}
          title="Open Folder"
        >
          {isLoading ? (
            <Loader2 className="h-3 w-3 animate-spin" strokeWidth={1.5} />
          ) : (
            <FolderOpen className="h-3 w-3" strokeWidth={1.5} />
          )}
        </Button>
      }
    >
      {explorerFolders.length > 0 ? (
        <div className="py-0.5">
          {explorerFolders.map((folder) => (
            <ExplorerFolderItem
              key={folder.path}
              folderPath={folder.path}
              onFileClick={onFileClick}
              onNewNote={onNewNote}
              onMakeProject={onMakeProject}
              onExportFile={onExportFile}
            />
          ))}
        </div>
      ) : (
        <div className="rounded-md border border-border bg-muted/40 px-3 py-2.5 mr-1">
          <p className="text-xs text-muted-foreground leading-relaxed">Browse and edit files in any folder on your computer. Folders can be converted to projects any time.</p>
          <div className="flex justify-end mt-2">
            <Button
              variant="outline"
              size="xs"
              onClick={handleOpenFolder}
            >
              Open Folder
            </Button>
          </div>
        </div>
      )}
    </SidebarSection>
  );
});
