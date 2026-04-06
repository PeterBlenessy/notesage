import React from "react";
import { FileText, Plus } from "lucide-react";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { useSettingsStore } from "@/stores/settings-store";
import { Button } from "@/components/ui/button";
import { SidebarSection } from "./SidebarSection";
import { FileTree } from "./FileTree";

interface QuickNotesSectionProps {
  onFileClick: (filePath: string, fileName: string) => void;
  onNewNote?: (parentPath?: string) => void;
  onExportFile?: (filePath: string, fileName: string, format?: 'pdf' | 'docx' | 'pptx' | 'html') => void;
  panelCollapsed?: boolean;
  onIconHover?: () => void;
  onIconClick?: () => void;
}

export const QuickNotesSection = React.memo(function QuickNotesSection({
  onFileClick,
  onNewNote,
  onExportFile,
  panelCollapsed,
  onIconHover,
  onIconClick,
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
      onIconHover={onIconHover}
      onIconClick={onIconClick}
      actions={
        onNewNote
          ? (
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => onNewNote(notesRootPath)}
                title="New Note (Cmd+N)"
              >
                <Plus className="h-3.5 w-3.5" strokeWidth={2} />
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
        <div className="rounded-md border border-border bg-muted/40 px-3 py-2.5 mr-1">
          <p className="text-xs text-muted-foreground leading-relaxed">Jot down ideas and drafts that haven't grown into a project yet. Notes are stored in <span className="font-mono text-[10px]">~/Notesage</span>.</p>
          {onNewNote && (
            <div className="flex justify-end mt-2">
              <Button
                variant="outline"
                size="xs"
                onClick={() => onNewNote(notesRootPath)}
              >
                Create a note
              </Button>
            </div>
          )}
        </div>
      )}
    </SidebarSection>
  );
});
