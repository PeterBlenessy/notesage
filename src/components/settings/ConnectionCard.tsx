import type { Connection } from '@/lib/ai/connections';
import { CAPABILITY_LABELS } from '@/lib/ai/connections';
import { Button } from '@/components/ui/button';
import { Settings2, Unplug, Github } from 'lucide-react';

const PROVIDER_LOGOS: Record<string, string | null> = {
  anthropic: '/logos/anthropic.svg',
  openai: '/logos/openai.svg',
  ollama: '/logos/ollama-official.png',
  github: null, // Uses lucide icon fallback
  google: '/logos/google.svg',
};

const AUTH_BADGES: Record<string, string> = {
  api_key: 'API Key',
  agent_managed: 'Subscription',
  local: 'Local',
};

function StatusDot({ status }: { status: Connection['status'] }) {
  const colors: Record<Connection['status'], string> = {
    connected: 'bg-green-500',
    expired: 'bg-yellow-500',
    error: 'bg-red-500',
    not_installed: 'bg-muted-foreground/40',
  };

  return (
    <span
      className={`inline-block w-2 h-2 rounded-full shrink-0 ${colors[status]}`}
      title={status.replace('_', ' ')}
    />
  );
}

function ProviderLogo({ provider }: { provider: string }) {
  const src = PROVIDER_LOGOS[provider];

  if (!src) {
    // GitHub fallback — lucide icon
    if (provider === 'github') {
      return (
        <span className="w-6 h-6 rounded flex items-center justify-center bg-white p-0.5">
          <Github className="w-5 h-5 text-black" strokeWidth={1.5} />
        </span>
      );
    }
    return <span className="w-6 h-6 rounded bg-muted" />;
  }

  return (
    <img
      src={src}
      alt={provider}
      className="w-6 h-6 rounded object-contain bg-white p-0.5"
    />
  );
}

interface ConnectionCardProps {
  connection: Connection;
  onConfigure?: (connection: Connection) => void;
  onDisconnect?: (connection: Connection) => void;
}

export function ConnectionCard({ connection, onConfigure, onDisconnect }: ConnectionCardProps) {
  return (
    <div className="flex items-center gap-3 px-4 py-3 rounded-lg border border-border hover:border-muted-foreground/50 transition-colors duration-150">
      {/* Logo + status */}
      <div className="relative shrink-0">
        <ProviderLogo provider={connection.provider} />
        <span className="absolute -bottom-0.5 -right-0.5">
          <StatusDot status={connection.status} />
        </span>
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium truncate">
            {connection.label}
          </span>
          <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-muted text-muted-foreground shrink-0">
            {AUTH_BADGES[connection.authMethod] ?? connection.authMethod}
          </span>
        </div>
        {/* Capability badges */}
        <div className="flex items-center gap-1.5 mt-1">
          {connection.capabilities.map((cap) => (
            <span
              key={cap}
              className="text-[10px] px-1.5 py-0.5 rounded-sm bg-muted/60 text-muted-foreground"
            >
              {CAPABILITY_LABELS[cap]}
            </span>
          ))}
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-1 shrink-0">
        {onConfigure && (
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-muted-foreground hover:text-foreground"
            onClick={() => onConfigure(connection)}
            title="Configure"
          >
            <Settings2 className="h-4 w-4" strokeWidth={1.5} />
          </Button>
        )}
        {onDisconnect && (
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-muted-foreground hover:text-destructive"
            onClick={() => onDisconnect(connection)}
            title="Disconnect"
          >
            <Unplug className="h-4 w-4" strokeWidth={1.5} />
          </Button>
        )}
      </div>
    </div>
  );
}
