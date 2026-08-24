import { useState, useMemo, useEffect } from 'react';
import { Lock } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { ProviderLogo } from '@/components/ProviderLogo';
import { useConnectionsStore } from '@/stores/connections-store';
import { useProjectMetadataStore } from '@/stores/project-metadata-store';
import { t } from '@/lib/i18n';

interface LockProjectDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectPath: string;
  projectName: string;
}

export function LockProjectDialog({ open, onOpenChange, projectPath, projectName }: LockProjectDialogProps) {
  const connections = useConnectionsStore((s) => s.connections);
  const setAiLock = useProjectMetadataStore((s) => s.setAiLock);

  const interactiveConnections = useMemo(
    () => connections.filter((c) => c.capabilities.includes('interactive')),
    [connections],
  );

  const [selectedConnectionId, setSelectedConnectionId] = useState<string>('');
  const [reason, setReason] = useState<string>('');

  // Pre-select the first interactive connection when the dialog opens
  useEffect(() => {
    if (open) {
      setSelectedConnectionId(interactiveConnections[0]?.id ?? '');
      setReason('');
    }
  }, [open, interactiveConnections]);

  const selectedConnection = useMemo(
    () => interactiveConnections.find((c) => c.id === selectedConnectionId) ?? null,
    [interactiveConnections, selectedConnectionId],
  );

  const handleLock = () => {
    if (!selectedConnectionId) return;
    setAiLock(projectPath, selectedConnectionId, reason);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Lock className="h-4 w-4" strokeWidth={1.5} aria-hidden="true" />
            Lock project to provider
          </DialogTitle>
          <DialogDescription>
            Only the selected provider will be allowed to access &ldquo;{projectName}&rdquo;.
            All other AI providers will be refused. You can unlock at any time in Folder Settings.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="lock-connection" className="text-sm font-medium">
              Provider
            </Label>
            {interactiveConnections.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                No providers available. Add a connection in Settings first.
              </p>
            ) : (
              <Select value={selectedConnectionId} onValueChange={setSelectedConnectionId}>
                <SelectTrigger id="lock-connection" className="w-full text-left">
                  <SelectValue>
                    {selectedConnection ? (
                      <div className="flex items-center gap-2">
                        <ProviderLogo provider={selectedConnection.provider} className="w-4 h-4" />
                        <span>{selectedConnection.label}</span>
                      </div>
                    ) : (
                      <span className="text-muted-foreground">{t("lock.selectProvider")}</span>
                    )}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {interactiveConnections.map((conn) => (
                    <SelectItem key={conn.id} value={conn.id}>
                      <div className="flex items-center gap-2">
                        <ProviderLogo provider={conn.provider} className="w-4 h-4" />
                        <span>{conn.label}</span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="lock-reason" className="text-sm font-medium">
              Reason <span className="text-xs font-normal text-muted-foreground">(optional)</span>
            </Label>
            <Textarea
              id="lock-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g., Contains sensitive client data — only Claude Code approved."
              rows={3}
              className="text-sm resize-none"
            />
            <p className="text-xs text-muted-foreground">
              Shown to you in project settings and when a lock conflict occurs.
            </p>
          </div>

          <div className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
            <p className="font-medium text-foreground">{t("lock.hardEnforcement")}</p>
            <p className="mt-1">
              Every send path (chat, resend, comment delegation, inline action) will be refused
              unless it targets the selected provider. The lock cannot be bypassed without unlocking
              from Folder Settings.
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={handleLock}
            disabled={!selectedConnectionId || interactiveConnections.length === 0}
          >
            <Lock className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden="true" />
            Lock project
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
