import { useEffect, useState } from 'react';
import { Loader2, Check, AlertTriangle, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';
import { useConnectionsStore } from '@/stores/connections-store';
import { useRoutingStore } from '@/stores/routing-store';
import type { SystemStatusType } from '@/lib/ai/types';
import type { Connection } from '@/lib/ai/connections';
import { getCapabilities } from '@/lib/ai/connections';

interface ReconnectCardProps {
  statusType: SystemStatusType;
  agentName: string;
  attempt?: number;
  maxAttempts?: number;
  dismissAt?: number;
  messageId: string;
  onRetry?: () => void;
  onSelectConnection?: (connectionId: string) => void;
  onDismiss?: (messageId: string) => void;
  /** The provider of the failed connection (for "same backend" notes) */
  failedProvider?: string;
}

export function ReconnectCard({
  statusType,
  agentName,
  attempt,
  maxAttempts,
  dismissAt,
  messageId,
  onRetry,
  onSelectConnection,
  onDismiss,
  failedProvider,
}: ReconnectCardProps) {
  const [fading, setFading] = useState(false);
  const [switchOpen, setSwitchOpen] = useState(false);

  const connections = useConnectionsStore((s) => s.connections);
  const routing = useRoutingStore((s) => s.routing);

  // Find alternative connections that support the interactive use case
  const currentConnectionId = routing.interactive?.connectionId;
  const alternatives = connections.filter((c) => {
    if (c.id === currentConnectionId) return false;
    const caps = getCapabilities(c.provider, c.authMethod);
    return caps.includes('interactive');
  });

  // Auto-dismiss reconnected state after 3s
  useEffect(() => {
    if (statusType !== 'reconnected' || !dismissAt) return;
    const remaining = dismissAt - Date.now();
    if (remaining <= 0) {
      onDismiss?.(messageId);
      return;
    }
    const fadeTimer = setTimeout(() => setFading(true), Math.max(0, remaining - 500));
    const removeTimer = setTimeout(() => onDismiss?.(messageId), remaining);
    return () => {
      clearTimeout(fadeTimer);
      clearTimeout(removeTimer);
    };
  }, [statusType, dismissAt, messageId, onDismiss]);

  if (statusType === 'reconnecting') {
    return (
      <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-muted/50 border border-border/50 text-sm text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" strokeWidth={1.5} />
        <span>
          <span className="font-medium text-foreground">Connection interrupted</span>
          {` — reconnecting to ${agentName}`}
          {attempt != null && maxAttempts != null && (
            <span> (attempt {attempt} of {maxAttempts})</span>
          )}
          ...
        </span>
      </div>
    );
  }

  if (statusType === 'reconnected') {
    return (
      <div
        className={`flex items-center gap-2 px-3 py-2 rounded-lg bg-muted/50 border border-border/50 text-sm transition-opacity duration-500 ${
          fading ? 'opacity-0' : 'opacity-100'
        }`}
      >
        <Check className="h-3.5 w-3.5 text-foreground shrink-0" strokeWidth={1.5} />
        <span className="text-foreground font-medium">Reconnected</span>
      </div>
    );
  }

  // statusType === 'failed'
  return (
    <div className="flex flex-col gap-2 px-3 py-2.5 rounded-lg bg-muted/50 border border-border/50 text-sm">
      <div className="flex items-center gap-2 text-muted-foreground">
        <AlertTriangle className="h-3.5 w-3.5 text-destructive shrink-0" strokeWidth={1.5} />
        <span>
          <span className="font-medium text-foreground">Unable to reach {agentName}</span>
          {' — this is likely an API availability issue.'}
        </span>
      </div>
      <div className="flex items-center gap-2 pl-5">
        {onRetry && (
          <Button variant="outline" size="sm" className="h-7 text-xs" onClick={onRetry}>
            <RefreshCw className="h-3 w-3 mr-1" strokeWidth={1.5} />
            Retry
          </Button>
        )}
        {alternatives.length > 0 && onSelectConnection && (
          <Popover open={switchOpen} onOpenChange={setSwitchOpen}>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" className="h-7 text-xs">
                Switch provider…
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-64 p-1" align="start">
              <div className="flex flex-col">
                {alternatives.map((conn) => (
                  <ProviderOption
                    key={conn.id}
                    connection={conn}
                    isSameBackend={!!failedProvider && conn.provider === failedProvider}
                    onSelect={() => {
                      setSwitchOpen(false);
                      onSelectConnection(conn.id);
                    }}
                  />
                ))}
              </div>
            </PopoverContent>
          </Popover>
        )}
      </div>
    </div>
  );
}

function ProviderOption({
  connection,
  isSameBackend,
  onSelect,
}: {
  connection: Connection;
  isSameBackend: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      className="flex flex-col gap-0.5 px-2 py-1.5 rounded-md text-left hover:bg-muted transition-colors"
      onClick={onSelect}
    >
      <span className="text-xs font-medium text-foreground">
        {connection.label || connection.provider}
      </span>
      {isSameBackend && (
        <span className="text-[10px] text-muted-foreground">
          Same backend — may have the same issue
        </span>
      )}
    </button>
  );
}
