import { useState, useCallback } from 'react';
import type { Connection } from '@/lib/ai/connections';
import { CAPABILITY_LABELS, prettyModelName, setAgentModels } from '@/lib/ai/connections';
import { useConnectionsStore } from '@/stores/connections-store';
import { ProviderLogo } from '@/components/ProviderLogo';
import { Button } from '@/components/ui/button';
import { Settings2, Unplug, HeartPulse, Loader2, Check, X, ArrowUpCircle, Shield, Globe } from 'lucide-react';
import { toast } from 'sonner';
import { invoke } from '@tauri-apps/api/core';

const AUTH_BADGES: Record<string, string> = {
  api_key: 'API Key',
  agent_managed: 'Subscription',
  local: 'Local',
  local_bundled: 'On-device',
};

function StatusDot({ status, tooltip }: { status: Connection['status']; tooltip?: string }) {
  const colors: Record<Connection['status'], string> = {
    connected: 'bg-green-500',
    expired: 'bg-yellow-500',
    error: 'bg-red-500',
    not_installed: 'bg-muted-foreground/40',
  };

  const defaultTooltips: Record<Connection['status'], string> = {
    connected: 'Connected',
    expired: 'Not ready',
    error: 'Error',
    not_installed: 'Not installed',
  };

  return (
    <span
      className={`inline-block w-2 h-2 rounded-full shrink-0 ${colors[status]}`}
      title={tooltip ?? defaultTooltips[status]}
    />
  );
}

type HealthState = 'idle' | 'testing' | 'ok' | 'fail';

export interface AgentUpdateAvailable {
  agentId: string;
  currentVersion: string;
  latestVersion: string;
}

interface ConnectionCardProps {
  connection: Connection;
  onConfigure?: (connection: Connection) => void;
  onDisconnect?: (connection: Connection) => void;
  updateAvailable?: AgentUpdateAvailable | null;
  onUpdateComplete?: () => void;
}

export function ConnectionCard({ connection, onConfigure, onDisconnect, updateAvailable, onUpdateComplete }: ConnectionCardProps) {
  const [health, setHealth] = useState<HealthState>('idle');
  const [healthError, setHealthError] = useState<string | null>(null);
  const [updating, setUpdating] = useState(false);
  const updateConnection = useConnectionsStore((s) => s.updateConnection);

  const testConnection = useCallback(async () => {
    setHealth('testing');
    setHealthError(null);

    try {
      if (connection.authMethod === 'agent_managed') {
        const creds = connection.credentials as { agentBinary: string; agentArgs?: string[] };
        const isLsp = creds.agentBinary === 'copilot-language-server';

        if (isLsp) {
          // Copilot LSP: check status via LSP protocol (don't use ACP)
          const status = await invoke<{ authenticated: boolean; message: string; kind: string }>(
            'copilot_lsp_status'
          );
          if (!status.authenticated) {
            throw new Error(status.message || 'Not authenticated');
          }
        } else {
          // ACP: spawn agent, create session, check for models, stop
          const args = [...(creds.agentArgs ?? [])];
          if (connection.config?.model) {
            if (creds.agentBinary === 'codex-acp') {
              args.push('-c', `model="${connection.config.model}"`);
            } else {
              args.push('--model', connection.config.model);
            }
          }

          const spawn = await invoke<{ instance_id: string }>('acp_agent_spawn', {
            agentBinary: creds.agentBinary,
            agentArgs: args.length > 0 ? args : null,
            role: 'interactive',
            workingDirectory: '/tmp',
            sandboxPaths: [],  // Health check: /tmp only
          });

          try {
            // Try authenticate
            try {
              await invoke('acp_agent_authenticate', { instanceId: spawn.instance_id });
            } catch (authErr) {
              const msg = String(authErr);
              if (!msg.toLowerCase().includes('not implemented')) {
                throw authErr;
              }
            }

            // Create session to get models
            const session = await invoke<{
              session_id: string;
              current_model: string | null;
              available_models: { model_id: string; name: string; description: string | null }[];
            }>('acp_session_new', {
              instanceId: spawn.instance_id,
              workingDirectory: '/tmp',
            });

            // Cache models
            if (session.available_models.length > 0) {
              setAgentModels(
                connection.id,
                session.available_models.map((m) => ({
                  modelId: m.model_id,
                  name: m.name,
                  description: m.description,
                })),
                session.current_model,
              );
            }
          } finally {
            invoke('acp_agent_stop', { instanceId: spawn.instance_id }).catch(() => {});
          }
        }

        updateConnection(connection.id, { status: 'connected' });
        setHealth('ok');
      } else if (connection.authMethod === 'api_key') {
        // API key: try listing models
        const key = connection.credentials.type === 'api_key' ? connection.credentials.key : undefined;
        const baseUrl = connection.config?.baseUrl;
        const provider = connection.provider === 'openai_compatible' ? 'openai_compatible' : connection.provider;
        await invoke('list_models', { provider, apiKey: key, baseUrl: baseUrl ?? null });
        updateConnection(connection.id, { status: 'connected' });
        setHealth('ok');
      } else if (connection.authMethod === 'local') {
        // Ollama: check tags endpoint
        const url = connection.credentials.type === 'local' ? connection.credentials.url : 'http://localhost:11434';
        await invoke('list_models', { provider: 'ollama', apiKey: null, baseUrl: url });
        updateConnection(connection.id, { status: 'connected' });
        setHealth('ok');
      } else if (connection.authMethod === 'local_bundled') {
        // Local AI: check if llama-server is actually running
        const status = await invoke<{ running: boolean; port: number | null }>('get_local_server_status');
        if (status.running) {
          updateConnection(connection.id, { status: 'connected' });
          setHealth('ok');
        } else {
          throw new Error('Local AI server is not running. Enable it in the Local AI tab.');
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setHealthError(msg);
      updateConnection(connection.id, { status: 'error' });
      setHealth('fail');
    }

    // Reset indicator after 4 seconds
    setTimeout(() => setHealth('idle'), 4000);
  }, [connection, updateConnection]);

  const handleUpdate = useCallback(async () => {
    if (!updateAvailable) return;
    setUpdating(true);
    try {
      const newVersion = await invoke<string>('agent_update', { agentId: updateAvailable.agentId });
      toast.success(`Updated ${updateAvailable.agentId} to v${newVersion}`);
      onUpdateComplete?.();
    } catch (err) {
      toast.error(`Update failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setUpdating(false);
    }
  }, [updateAvailable, onUpdateComplete]);

  // Derive a contextual tooltip for the status dot
  const statusTooltip = (() => {
    if (connection.authMethod === 'local_bundled' && connection.status === 'expired') {
      return 'No local models available';
    }
    return undefined; // use default
  })();

  return (
    <div className="space-y-0">
      <div className="flex items-start gap-3 px-4 py-3 rounded-lg border border-border hover:border-muted-foreground/50 transition-colors duration-150">
        {/* Logo + status */}
        <div className="relative shrink-0 mt-0.5">
          <ProviderLogo provider={connection.provider} />
          <span className="absolute -bottom-0.5 -right-0.5">
            <StatusDot status={connection.status} tooltip={statusTooltip} />
          </span>
        </div>

        {/* Center: name + badges */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">
              {connection.label}
            </span>
            <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-muted text-muted-foreground shrink-0">
              {AUTH_BADGES[connection.authMethod] ?? connection.authMethod}
            </span>
          </div>
          <div className="flex items-center gap-1.5 mt-1">
            {connection.config?.model && (
              <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-muted text-muted-foreground shrink-0 max-w-[140px] truncate" title={connection.config.model}>
                {prettyModelName(connection.config.model)}
              </span>
            )}
            {connection.capabilities.map((cap) => (
              <span
                key={cap}
                className="text-[10px] px-1.5 py-0.5 rounded-sm bg-muted/60 text-muted-foreground shrink-0"
              >
                {CAPABILITY_LABELS[cap]}
              </span>
            ))}
            {connection.authMethod === 'agent_managed' && connection.sandboxEnabled !== false && (
              <span className="text-[10px] px-1.5 py-0.5 rounded-sm bg-muted/60 text-muted-foreground shrink-0 flex items-center gap-0.5" title="Filesystem sandbox enabled">
                <Shield className="h-2.5 w-2.5" strokeWidth={2} />
                Sandbox
              </span>
            )}
            {connection.networkSandboxEnabled && (
              <span className="text-[10px] px-1.5 py-0.5 rounded-sm bg-muted/60 text-muted-foreground shrink-0 flex items-center gap-0.5" title="Network restriction enabled">
                <Globe className="h-2.5 w-2.5" strokeWidth={2} />
                Network
              </span>
            )}
            {connection.binarySource === 'managed' && (
              <span className="text-[10px] px-1.5 py-0.5 rounded-sm bg-muted/60 text-muted-foreground shrink-0" title="Installed by Notesage">
                Managed
              </span>
            )}
            {updateAvailable && (
              <button
                onClick={handleUpdate}
                disabled={updating}
                className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-foreground/10 text-foreground shrink-0 hover:bg-foreground/20 transition-colors cursor-pointer flex items-center gap-1"
                title={`Update from v${updateAvailable.currentVersion} to v${updateAvailable.latestVersion}`}
              >
                {updating ? (
                  <Loader2 className="h-2.5 w-2.5 animate-spin" strokeWidth={2} />
                ) : (
                  <ArrowUpCircle className="h-2.5 w-2.5" strokeWidth={2} />
                )}
                v{updateAvailable.currentVersion} → v{updateAvailable.latestVersion}
              </button>
            )}
          </div>
        </div>

        {/* Right: action buttons */}
        <div className="flex items-center gap-1 shrink-0">
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-muted-foreground hover:text-foreground"
            onClick={testConnection}
            disabled={health === 'testing'}
            title="Test connection"
          >
            {health === 'testing' && <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={1.5} />}
            {health === 'ok' && <Check className="h-3.5 w-3.5 text-green-500" strokeWidth={1.5} />}
            {health === 'fail' && <X className="h-3.5 w-3.5 text-destructive" strokeWidth={1.5} />}
            {health === 'idle' && <HeartPulse className="h-3.5 w-3.5" strokeWidth={1.5} />}
          </Button>
          {onConfigure && (
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-muted-foreground hover:text-foreground"
              onClick={() => onConfigure(connection)}
              title="Configure"
            >
              <Settings2 className="h-3.5 w-3.5" strokeWidth={1.5} />
            </Button>
          )}
          {onDisconnect && (
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-muted-foreground hover:text-destructive"
              onClick={() => onDisconnect(connection)}
              title="Disconnect"
            >
              <Unplug className="h-3.5 w-3.5" strokeWidth={1.5} />
            </Button>
          )}
        </div>
      </div>
      {health === 'fail' && healthError && (
        <p className="text-xs text-destructive px-4 py-1.5 break-words">
          {healthError}
        </p>
      )}
    </div>
  );
}
