import React from "react";
import { FileText, FilePlus } from "lucide-react";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { useSettingsStore } from "@/stores/settings-store";
import { Button } from "@/components/ui/button";
import { SidebarSection } from "./SidebarSection";
import { FileTree } from "./FileTree";

interface QuickNotesSectionProps {
  onFileClick: (filePath: string, fileName: string) => void;
  onNewNote?: (parentPath?: string) => void;
  onExportFile?: (filePath: string, fileName: string, format?: 'pdf' | 'pptx') => void;
  panelCollapsed?: boolean;
}

export const QuickNotesSection = React.memo(function QuickNotesSection({
  onFileClick,
  onNewNote,
  onExportFile,
  panelCollapsed,
}: QuickNotesSectionProps) {
  const notesTree = useWorkspaceStore((s) => s.notesTree);
  const notesCollapsed = useWorkspaceStore((s) => s.notesCollapsed);
  const setNotesCollapsed = useWorkspaceStore((s) => s.setNotesCollapsed);
  const notesRootPath = useSettingsStore((s) => s.notesRootPath);

  return (
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
          onFileClick={onFileClick}
          onNewNote={onNewNote}
          onExportFile={onExportFile}
          expandKeyPrefix="notes:"
        />
      ) : (
        <p className="text-xs text-muted-foreground py-1.5">
          Notes in {notesRootPath}
        </p>
      )}
    </SidebarSection>
  );
});
