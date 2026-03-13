import {
  Dialog,
  DialogContent,
  DialogTitle,
} from '@/components/ui/dialog';
import { VisuallyHidden } from '@radix-ui/react-visually-hidden';
import { ActionsDashboard } from './ActionsDashboard';
import type { ActionItem } from '@/stores/action-store';

interface ActionsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onActionClick?: (action: ActionItem) => void;
  onToggleAction?: (action: ActionItem) => void;
}

export function ActionsDialog({
  open,
  onOpenChange,
  onActionClick,
  onToggleAction,
}: ActionsDialogProps) {
  const handleActionClick = (action: ActionItem) => {
    onActionClick?.(action);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl w-full h-[80vh] overflow-hidden p-0 flex flex-col" aria-describedby={undefined}>
        <VisuallyHidden>
          <DialogTitle>Actions</DialogTitle>
        </VisuallyHidden>
        <ActionsDashboard
          onActionClick={handleActionClick}
          onToggleAction={onToggleAction}
          embedded
        />
      </DialogContent>
    </Dialog>
  );
}
