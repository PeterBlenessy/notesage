import { BrainCog } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { LocalAISettings } from './LocalAISettings';

interface LocalAIModelsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Dedicated dialog for Local AI model management.
 *
 * Mounts the existing `<LocalAISettings>` legacy panel (model catalog,
 * downloads, server status, advanced power-user knobs) without forcing
 * it to share the per-connection config dialog. Triggered from the
 * BrainCog button on Local AI connection cards.
 *
 * Chrome matches the v2 dialog aesthetic — wider 864 px, generous
 * 28 px header padding, 20 px semibold title, ScrollArea body — same
 * shape as ChangelogDialog so the two read as siblings.
 */
export function LocalAIModelsDialog({
  open,
  onOpenChange,
}: LocalAIModelsDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* Same outer dimensions as SettingsShell so opening this dialog
          on top of the settings dialog doesn't shift sizes (live-test
          2026-04-26 — avoids a "jumpy" feeling). */}
      <DialogContent className="w-[calc(100vw-48px)] sm:max-w-[920px] h-[min(720px,calc(100vh-48px))] p-0 gap-0 overflow-hidden flex flex-col">
        <DialogHeader className="px-7 pt-7 pb-3 border-b border-border shrink-0">
          <DialogTitle className="text-[20px] font-semibold tracking-tight flex items-center gap-2">
            <BrainCog className="h-5 w-5" strokeWidth={1.5} />
            Local AI models
          </DialogTitle>
          <DialogDescription className="mt-1 text-[13px] text-muted-foreground leading-relaxed">
            Manage the bundled inference server, downloaded models, and
            advanced runtime settings.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 min-h-0">
          <ScrollArea className="h-full">
            <div className="px-7 py-5">
              <LocalAISettings />
            </div>
          </ScrollArea>
        </div>
      </DialogContent>
    </Dialog>
  );
}
