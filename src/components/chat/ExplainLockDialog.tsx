import { useMemo } from 'react';
import { Lock } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { ProviderLogo } from '@/components/ProviderLogo';
import { useConnectionsStore } from '@/stores/connections-store';
import { useProjectMetadataStore } from '@/stores/project-metadata-store';
import { describeLockTarget, getProjectLock } from '@/lib/ai/project-lock';
import { t } from "@/lib/i18n";
import { useLocale } from "@/lib/useLocale";

interface ExplainLockDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Paths of locked projects currently in scope for the active chat. */
  lockedProjectPaths: string[];
}

/**
 * Read-only explanation of why the provider picker is locked in the command bar.
 * Users who want to unlock go through Settings > Project — this dialog is purely
 * informative so we don't silently disable controls without a rationale.
 */
export function ExplainLockDialog({ open, onOpenChange, lockedProjectPaths }: ExplainLockDialogProps) {
  // `t()` reads module state — subscribe so a language change repaints this.
  useLocale();
  const metadataMap = useProjectMetadataStore((s) => s.metadataMap);
  const connections = useConnectionsStore((s) => s.connections);

  const entries = useMemo(() => {
    return lockedProjectPaths
      .map((path) => {
        const lock = getProjectLock(path, metadataMap);
        if (!lock) return null;
        const meta = metadataMap[path];
        const connection = connections.find((c) => c.id === lock.connectionId) ?? null;
        const projectName = meta?.name || path.split('/').filter(Boolean).pop() || path;
        const reason = meta?.aiLock?.reason?.trim();
        return {
          path,
          projectName,
          connection,
          lockedConnectionId: lock.connectionId,
          reason,
        };
      })
      .filter((entry): entry is NonNullable<typeof entry> => entry !== null);
  }, [lockedProjectPaths, metadataMap, connections]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Lock className="h-4 w-4" strokeWidth={1.5} aria-hidden="true" />
            Provider locked by project
          </DialogTitle>
          <DialogDescription>
            {entries.length === 1
              ? 'This project is locked to a specific AI provider. All messages, resends, and inline actions must route through it.'
              : 'These projects are each locked to a specific AI provider. All messages, resends, and inline actions must route through them.'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-2">
          {entries.map((entry) => (
            <div
              key={entry.path}
              className="rounded-lg border border-border px-3 py-2 space-y-1.5"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium truncate">{entry.projectName}</span>
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  {entry.connection && (
                    <ProviderLogo provider={entry.connection.provider} className="w-4 h-4" />
                  )}
                  <span className="truncate">
                    {describeLockTarget(entry.lockedConnectionId, entry.connection?.label)}
                  </span>
                </div>
              </div>
              {entry.reason && (
                <p className="text-xs text-muted-foreground italic">&ldquo;{entry.reason}&rdquo;</p>
              )}
            </div>
          ))}

          <p className="text-xs text-muted-foreground">
            Unlock from{' '}
            <button
              type="button"
              onClick={() => {
                window.dispatchEvent(
                  new CustomEvent('notesage:open-settings', {
                    detail: { tab: 'projects' },
                  }),
                );
                onOpenChange(false);
              }}
              className="font-medium text-[var(--color-accent-primary)] underline-offset-2 hover:underline rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
            >
              Folder Settings &gt; AI Provider Lock
            </button>
            .
          </p>
        </div>

        <DialogFooter>
          <Button onClick={() => onOpenChange(false)}>{t("chat.gotIt")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
