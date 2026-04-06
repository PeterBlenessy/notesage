import React, { useCallback } from "react";
import { FolderKanban, FolderOpen, Plus } from "lucide-react";
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
  onIconHover?: () => void;
  onIconClick?: () => void;
}

export const ProjectsSection = React.memo(function ProjectsSection({
  onFileClick,
  onNewNote,
  onNewProject,
  onOpenExistingProject,
  onOpenProjectSettings,
  onExportFile,
  panelCollapsed,
  onIconHover,
  onIconClick,
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
      onIconHover={onIconHover}
      onIconClick={onIconClick}
      actions={
        <>
          {onOpenExistingProject && (
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={onOpenExistingProject}
              title="Open Project"
            >
              <FolderOpen className="h-3.5 w-3.5" strokeWidth={1.5} />
            </Button>
          )}
          {onNewProject && (
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={onNewProject}
              title="New Project (Cmd+Shift+N)"
            >
              <Plus className="h-3.5 w-3.5" strokeWidth={2} />
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
        <div className="rounded-md border border-border bg-muted/40 px-3 py-2.5 mr-1">
          <p className="text-xs text-muted-foreground leading-relaxed">Organize related notes with their own folder, settings, and AI context. Projects can be synced to iCloud.</p>
          {onNewProject && (
            <div className="flex justify-end mt-2">
              <Button
                variant="outline"
                size="xs"
                onClick={onNewProject}
              >
                New Project
              </Button>
            </div>
          )}
        </div>
      )}
    </SidebarSection>
  );
});
