import { useState } from "react";
import { FolderOpen, FolderPlus, FilePlus, Loader2 } from "lucide-react";
import { tauriApi } from "@/lib/tauri";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { useProjectMetadataStore } from "@/stores/project-metadata-store";
import { useSettingsStore } from "@/stores/settings-store";
import { useFileOperations } from "@/hooks/useFileOperations";
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
}

export function Sidebar({ onNewNote, onNewProject, onOpenExistingProject, onOpenProjectSettings, onMakeProject, onExportFile }: SidebarProps) {
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
      alert(`Error reading file: ${error}`);
    }
  };

  const handleCloseProject = (projectPath: string) => {
    const metadata = useProjectMetadataStore.getState().getMetadata(projectPath);
    const name = metadata?.name || projectPath.split("/").pop() || projectPath;
    removeProject(projectPath, name);
  };

  const iconButton = (
    onClick: () => void,
    icon: React.ReactNode,
    title: string,
    disabled?: boolean
  ) => (
    <button
      onClick={onClick}
      disabled={disabled}
      className="h-5 w-5 inline-flex items-center justify-center rounded transition-colors text-muted-foreground hover:text-foreground disabled:opacity-50"
      onMouseEnter={(e) => {
        e.currentTarget.style.backgroundColor = "var(--color-accent)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.backgroundColor = "";
      }}
      title={title}
    >
      {icon}
    </button>
  );

  return (
    <div
      className="h-full w-full flex flex-col overflow-hidden"
      style={{ backgroundColor: "var(--color-card)" }}
    >
      {/* Sidebar header */}
      <div className="h-11 px-3 flex items-center shrink-0">
        <h2 className="text-sm font-semibold tracking-tight">Workspace</h2>
      </div>

      {/* Scrollable sections */}
      <div className="flex-1 overflow-y-auto pt-0.5 pb-2">
        {/* EXPLORER Section */}
        <SidebarSection
          title="Explorer"
          open={!explorerCollapsed}
          onOpenChange={(open) => setExplorerCollapsed(!open)}
          actions={
            iconButton(
              handleOpenFolder,
              isLoading ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <FolderOpen className="h-3 w-3" />
              ),
              "Open Folder",
              isLoading
            )
          }
        >
          {explorerPath ? (
            <div className="px-1 py-1">
              <FileTree
                tree={explorerTree}
                onFileClick={handleFileClick}
                onNewNote={onNewNote}
                onMakeProject={onMakeProject}
                onExportFile={onExportFile}
                expandKeyPrefix="explorer:"
              />
            </div>
          ) : (
            <div className="px-3 py-2.5">
              <p className="text-xs text-muted-foreground">
                Open a folder to browse files
              </p>
            </div>
          )}
        </SidebarSection>

        {/* PROJECTS Section */}
        <SidebarSection
          title="Projects"
          open={!projectsCollapsed}
          onOpenChange={(open) => setProjectsCollapsed(!open)}
          actions={
            <>
              {onOpenExistingProject && iconButton(
                onOpenExistingProject,
                <FolderOpen className="h-3 w-3" />,
                "Open Project"
              )}
              {onNewProject && iconButton(
                onNewProject,
                <FolderPlus className="h-3 w-3" />,
                "New Project (Cmd+Shift+N)"
              )}
            </>
          }
        >
          {projects.length > 0 ? (
            <div className="py-1">
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
            <div className="px-3 py-2.5">
              <p className="text-xs text-muted-foreground">
                No projects open
              </p>
            </div>
          )}
        </SidebarSection>

        {/* NOTES Section */}
        <SidebarSection
          title="Notes"
          open={!notesCollapsed}
          onOpenChange={(open) => setNotesCollapsed(!open)}
          actions={
            onNewNote
              ? iconButton(
                  () => onNewNote(notesRootPath),
                  <FilePlus className="h-3 w-3" />,
                  "New Note (Cmd+N)"
                )
              : undefined
          }
        >
          {notesTree.length > 0 ? (
            <div className="px-1 py-1">
              <FileTree
                tree={notesTree}
                onFileClick={handleFileClick}
                onNewNote={onNewNote}
                showMoveToProject
                onExportFile={onExportFile}
                expandKeyPrefix="notes:"
              />
            </div>
          ) : (
            <div className="px-3 py-2.5">
              <p className="text-xs text-muted-foreground">
                Notes in {notesRootPath}
              </p>
            </div>
          )}
        </SidebarSection>
      </div>
    </div>
  );
}
