import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { toast } from 'sonner';
import { armAutomation, writeScope } from '@/lib/automations/arm';
import type { Automation } from '@/lib/automations/types';

/**
 * Approve-to-arm review. Shows what the automation can write before pinning its
 * content hash (Task #8). Editing the automation later changes the hash, so it
 * auto-disarms and this re-prompts.
 */
export function ArmDialog({
  automation,
  onClose,
}: {
  automation: Automation | null;
  onClose: () => void;
}) {
  return (
    <AlertDialog open={automation !== null} onOpenChange={(open) => !open && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Arm “{automation?.name}”?</AlertDialogTitle>
          <AlertDialogDescription>
            This automation writes files, so it stays disarmed until you review it. Arming lets it
            run unattended; editing it later re-prompts.
          </AlertDialogDescription>
        </AlertDialogHeader>

        {automation && (
          <div className="space-y-1 rounded-md border border-border bg-muted/40 p-3 text-xs">
            <div className="font-medium text-muted-foreground">Can write to</div>
            {writeScope(automation).map((s) => (
              <div key={s} className="font-mono break-all">
                {s}
              </div>
            ))}
          </div>
        )}

        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={async () => {
              if (automation) {
                try {
                  await armAutomation(automation);
                } catch (e) {
                  // Don't let the dialog close implying success when arming
                  // (SHA-256 hashing / store write) actually failed.
                  toast.error(`Couldn't arm automation: ${e instanceof Error ? e.message : e}`);
                  return;
                }
              }
              onClose();
            }}
          >
            Review &amp; arm
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
