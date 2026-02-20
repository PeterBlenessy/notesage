import { FolderCog } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ProjectSettings } from './ProjectSettings';

interface ProjectSettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectPath: string;
  onPathChanged?: (newPath: string) => void;
}

export function ProjectSettingsDialog({ open, onOpenChange, projectPath, onPathChanged }: ProjectSettingsDialogProps) {
  const folderName = projectPath.split('/').filter(Boolean).pop() || 'Project';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[80vw] lg:max-w-2xl max-h-[85vh] p-0 gap-0 overflow-hidden flex flex-col">
        <DialogHeader className="px-6 py-4 border-b shrink-0 bg-card">
          <div className="flex items-center gap-3">
            <FolderCog className="h-8 w-8 shrink-0 text-foreground" strokeWidth={1.5} />
            <div>
              <DialogTitle className="text-lg">Project Settings</DialogTitle>
              <DialogDescription className="text-xs">
                {folderName}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto p-6">
          <ProjectSettings projectPath={projectPath} onPathChanged={onPathChanged} />
        </div>
      </DialogContent>
    </Dialog>
  );
}
