import React, { useCallback } from "react";
import { FolderKanban, FolderOpen, FolderPlus } from "lucide-react";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { useProjectMetadataStore } from "@/stores/project-metadata-store";
import { Button } from "@/components/ui/button";
import { SidebarSection } from "./SidebarSection";
import { ProjectItem } from "./ProjectItem";

interface ProjectsSectionProps {
  onFileClick: (filePath: string, fileName: string) => void;
  onNewNote?: (parentPath?: string) => void;
  onNewProject?: () => void;
  onOpenExistingProject?: () => void;
  onOpenProjectSettings?: (projectPath: string) => void;
  onExportFile?: (filePath: string, fileName: string, format?: 'pdf' | 'docx' | 'pptx' | 'html') => void;
  panelCollapsed?: boolean;
}

export const ProjectsSection = React.memo(function ProjectsSection({
  onFileClick,
  onNewNote,
  onNewProject,
  onOpenExistingProject,
  onOpenProjectSettings,
  onExportFile,
  panelCollapsed,
}: ProjectsSectionProps) {
  const projects = useWorkspaceStore((s) => s.projects);
  const removeProject = useWorkspaceStore((s) => s.removeProject);
  const projectsCollapsed = useWorkspaceStore((s) => s.projectsCollapsed);
  const setProjectsCollapsed = useWorkspaceStore((s) => s.setProjectsCollapsed);

  const handleCloseProject = useCallback(
    (projectPath: string) => {
      const metadata = useProjectMetadataStore.getState().getMetadata(projectPath);
      const name = metadata?.name || projectPath.split("/").pop() || projectPath;
      removeProject(projectPath, name);
    },
    [removeProject]
  );

  return (
    <SidebarSection
      icon={<FolderKanban className="h-4 w-4" strokeWidth={1.5} />}
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
              onFileClick={onFileClick}
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
  );
});
