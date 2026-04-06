import { useCallback } from "react";
import { toast } from "sonner";
import { useFileOperations } from "@/hooks/useFileOperations";
import { QuickNotesSection } from "./QuickNotesSection";
import { ProjectsSection } from "./ProjectsSection";
import { FoldersSection } from "./FoldersSection";

interface SidebarProps {
  onNewNote?: (parentPath?: string) => void;
  onNewProject?: () => void;
  onOpenExistingProject?: () => void;
  onOpenProjectSettings?: (projectPath: string) => void;
  onMakeProject?: (path: string) => void;
  onExportFile?: (filePath: string, fileName: string, format?: 'pdf' | 'docx' | 'pptx' | 'html') => void;
  panelCollapsed?: boolean;
  /** Called when a section rail icon is hovered. */
  onSectionIconHover?: (section: "notes" | "projects" | "folders") => void;
  /** Called when a section rail icon is clicked. */
  onSectionIconClick?: (section: "notes" | "projects" | "folders") => void;
}

export function Sidebar({ onNewNote, onNewProject, onOpenExistingProject, onOpenProjectSettings, onMakeProject, onExportFile, panelCollapsed, onSectionIconHover, onSectionIconClick }: SidebarProps) {
  const { openFile } = useFileOperations();

  const handleFileClick = useCallback(
    async (filePath: string, fileName: string) => {
      try {
        await openFile(filePath, fileName);
      } catch (error) {
        toast.error(`Failed to open file: ${error}`);
      }
    },
    [openFile]
  );

  return (
    <div className="h-full w-full flex flex-col overflow-hidden">
      <div className="flex-1 overflow-y-auto py-1">
        <QuickNotesSection
          onFileClick={handleFileClick}
          onNewNote={onNewNote}
          onExportFile={onExportFile}
          panelCollapsed={panelCollapsed}
          onIconHover={() => onSectionIconHover?.("notes")}
          onIconClick={() => onSectionIconClick?.("notes")}
        />

        <ProjectsSection
          onFileClick={handleFileClick}
          onNewNote={onNewNote}
          onNewProject={onNewProject}
          onOpenExistingProject={onOpenExistingProject}
          onOpenProjectSettings={onOpenProjectSettings}
          onExportFile={onExportFile}
          panelCollapsed={panelCollapsed}
          onIconHover={() => onSectionIconHover?.("projects")}
          onIconClick={() => onSectionIconClick?.("projects")}
        />

        <FoldersSection
          onFileClick={handleFileClick}
          onNewNote={onNewNote}
          onMakeProject={onMakeProject}
          onExportFile={onExportFile}
          panelCollapsed={panelCollapsed}
          onIconHover={() => onSectionIconHover?.("folders")}
          onIconClick={() => onSectionIconClick?.("folders")}
        />
      </div>
    </div>
  );
}
