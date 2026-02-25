import { useState } from "react";
import { FileText, FolderDot, FolderOpen, FolderPlus, FilePlus, Loader2 } from "lucide-react";
import { tauriApi } from "@/lib/tauri";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { useProjectMetadataStore } from "@/stores/project-metadata-store";
import { useSettingsStore } from "@/stores/settings-store";
import { useFileOperations } from "@/hooks/useFileOperations";
import { Button } from "@/components/ui/button";
import { SidebarSection } from "./SidebarSection";
import { ProjectItem } from "./ProjectItem";
import { FileTree } from "./FileTree";

interface SidebarProps {
  onNewNote?: (parentPath?: string) => void;
  onNewProject?: () => void;
  onOpenExistingProject?: () => void;
  onOpenProjectSettings?: (projectPath: string) => void;
  onMakeProject?: (path: string) => void;
  onExportFile?: (filePath: string, fileName: string) => void;
  panelCollapsed?: boolean;
}

export function Sidebar({ onNewNote, onNewProject, onOpenExistingProject, onOpenProjectSettings, onMakeProject, onExportFile, panelCollapsed }: SidebarProps) {
  const [isLoading, setIsLoading] = useState(false);
  const {
    explorerPath,
    explorerTree,
    setExplorerPath,
    setExplorerTree,
    projects,
    removeProject,
    notesTree,
    explorerCollapsed,
    projectsCollapsed,
    notesCollapsed,
    setExplorerCollapsed,
    setProjectsCollapsed,
    setNotesCollapsed,
  } = useWorkspaceStore();
  const { notesRootPath } = useSettingsStore();
  const { openFile } = useFileOperations();

  const handleOpenFolder = async () => {
    try {
      setIsLoading(true);
      const folderPath = await tauriApi.openFolderDialog();
      if (folderPath) {
        setExplorerPath(folderPath);
        const tree = await tauriApi.listDirectory(folderPath);
        setExplorerTree(tree);
      }
    } catch (error) {
      console.error("Failed to open folder:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleFileClick = async (filePath: string, fileName: string) => {
    try {
      await openFile(filePath, fileName);
    } catch (error) {
      console.error("Error reading file:", error);
    }
  };

  const handleCloseProject = (projectPath: string) => {
    const metadata = useProjectMetadataStore.getState().getMetadata(projectPath);
    const name = metadata?.name || projectPath.split("/").pop() || projectPath;
    removeProject(projectPath, name);
  };

  return (
    <div className="h-full w-full flex flex-col overflow-hidden">
      <div className="flex-1 overflow-y-auto py-1">
        {/* QUICK NOTES */}
        <SidebarSection
          icon={<FileText className="h-4 w-4" strokeWidth={1.5} />}
          title="Quick Notes"
          open={!notesCollapsed}
          onOpenChange={(open) => setNotesCollapsed(!open)}
          panelCollapsed={panelCollapsed}
          actions={
            onNewNote
              ? (
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    onClick={() => onNewNote(notesRootPath)}
                    title="New Note (Cmd+N)"
                  >
                    <FilePlus className="h-3 w-3" strokeWidth={1.5} />
                  </Button>
                )
              : undefined
          }
        >
          {notesTree.length > 0 ? (
            <FileTree
              tree={notesTree}
              onFileClick={handleFileClick}
              onNewNote={onNewNote}
              showMoveToProject
              onExportFile={onExportFile}
              expandKeyPrefix="notes:"
            />
          ) : (
            <p className="text-xs text-muted-foreground py-1.5">
              Notes in {notesRootPath}
            </p>
          )}
        </SidebarSection>

        {/* PROJECTS */}
        <SidebarSection
          icon={<FolderDot className="h-4 w-4" strokeWidth={1.5} />}
          title="Projects"
          open={!projectsCollapsed}
          onOpenChange={(open) => setProjectsCollapsed(!open)}
          panelCollapsed={panelCollapsed}
          actions={
            <>
              {onOpenExistingProject && (
                <Button
                  variant="ghost"
                  size="icon-xs"
                  onClick={onOpenExistingProject}
                  title="Open Project"
                >
                  <FolderOpen className="h-3 w-3" strokeWidth={1.5} />
                </Button>
              )}
              {onNewProject && (
                <Button
                  variant="ghost"
                  size="icon-xs"
                  onClick={onNewProject}
                  title="New Project (Cmd+Shift+N)"
                >
                  <FolderPlus className="h-3 w-3" strokeWidth={1.5} />
                </Button>
              )}
            </>
          }
        >
          {projects.length > 0 ? (
            <div className="py-0.5">
              {projects.map((project) => (
                <ProjectItem
                  key={project.path}
                  projectPath={project.path}
                  onFileClick={handleFileClick}
                  onNewNote={onNewNote}
                  onOpenProjectSettings={onOpenProjectSettings}
                  onCloseProject={handleCloseProject}
                  onExportFile={onExportFile}
                />
              ))}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground py-1.5">
              No projects open
            </p>
          )}
        </SidebarSection>

        {/* FOLDERS */}
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
          {explorerPath ? (
            <FileTree
              tree={explorerTree}
              onFileClick={handleFileClick}
              onNewNote={onNewNote}
              onMakeProject={onMakeProject}
              onExportFile={onExportFile}
              expandKeyPrefix="explorer:"
            />
          ) : (
            <p className="text-xs text-muted-foreground py-1.5">
              Open a folder to browse files
            </p>
          )}
        </SidebarSection>
      </div>
    </div>
  );
}
