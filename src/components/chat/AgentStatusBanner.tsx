import { useState, useEffect } from 'react';
import { Clock, AlertTriangle, RefreshCw, Play } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAgentStatusStore } from '@/stores/agent-status-store';

interface AgentStatusBannerProps {
  onKeepWaiting: () => void;
  onRetry: () => void;
  onCancel: () => void;
}

export function AgentStatusBanner({ onKeepWaiting, onRetry, onCancel }: AgentStatusBannerProps) {
  const status = useAgentStatusStore((s) => s.status);
  const since = useAgentStatusStore((s) => s.since);
  const exitCode = useAgentStatusStore((s) => s.exitCode);

  // Elapsed time counter (updates every second)
  const [elapsed, setElapsed] = useState('');
  useEffect(() => {
    if (!since || status !== 'unresponsive') return;
    const update = () => {
      const secs = Math.floor((Date.now() - since) / 1000);
      const mins = Math.floor(secs / 60);
      const remainSecs = secs % 60;
      setElapsed(mins > 0 ? `${mins}m ${remainSecs}s` : `${remainSecs}s`);
    };
    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [since, status]);

  if (!status) return null;

  if (status === 'exited') {
    return (
      <div className="mx-2 mb-3 rounded-lg border border-border bg-muted/80 p-3">
        <div className="flex items-start gap-2">
          <AlertTriangle size={16} strokeWidth={1.5} className="text-muted-foreground mt-0.5 shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-foreground">Agent process exited unexpectedly</p>
            {exitCode !== null && (
              <p className="text-xs text-muted-foreground mt-0.5">Exit code: {exitCode}</p>
            )}
            <div className="flex items-center gap-2 mt-2">
              <Button size="sm" variant="outline" className="h-7 text-xs" onClick={onRetry}>
                <RefreshCw size={12} strokeWidth={1.5} className="mr-1" />
                Restart & restore session
              </Button>
              <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={onCancel}>
                Cancel
              </Button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // status === 'unresponsive'
  return (
    <div className="mx-2 mb-3 rounded-lg border border-border bg-muted/80 p-3">
      <div className="flex items-start gap-2">
        <Clock size={16} strokeWidth={1.5} className="text-muted-foreground mt-0.5 shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-foreground">
            Agent hasn&apos;t responded in {elapsed}
          </p>
          <p className="text-xs text-muted-foreground mt-0.5">
            The agent process is still running.
          </p>
          <div className="flex items-center gap-2 mt-2">
            <Button size="sm" variant="outline" className="h-7 text-xs" onClick={onKeepWaiting}>
              <Play size={12} strokeWidth={1.5} className="mr-1" />
              Keep waiting
            </Button>
            <Button size="sm" variant="outline" className="h-7 text-xs" onClick={onRetry}>
              <RefreshCw size={12} strokeWidth={1.5} className="mr-1" />
              Retry session
            </Button>
            <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={onCancel}>
              Cancel
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
