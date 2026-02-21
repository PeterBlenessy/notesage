import { useState, useCallback, useEffect, useRef } from 'react';
import { useConnectionsStore } from '@/stores/connections-store';
import { useRoutingStore } from '@/stores/routing-store';
import { stopAcpAgent } from '@/hooks/useAIOperations';
import { ConnectionCard } from './ConnectionCard';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Plus, Check, Eye, EyeOff, Github, Loader2, AlertCircle, RefreshCw } from 'lucide-react';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import type { Connection, ProviderOption } from '@/lib/ai/connections';
import { PROVIDER_OPTIONS, CAPABILITY_LABELS, ROUTING_SLOT_LABELS } from '@/lib/ai/connections';
import { invoke } from '@tauri-apps/api/core';

const PROVIDER_LOGOS: Record<string, string | null> = {
  anthropic: '/logos/anthropic.svg',
  openai: '/logos/openai.svg',
  ollama: '/logos/ollama-official.png',
  github: null,
};

type AddFlowState =
  | { step: 'pick' }
  | { step: 'configure'; option: ProviderOption }
  | { step: 'connecting'; option: ProviderOption };

export function ConnectionsSettings() {
  const connections = useConnectionsStore((s) => s.connections);
  const addConnection = useConnectionsStore((s) => s.addConnection);
  const removeConnection = useConnectionsStore((s) => s.removeConnection);
  const clearRoutingForConnection = useRoutingStore((s) => s.clearRoutingForConnection);
  const autoAssign = useRoutingStore((s) => s.autoAssign);

  const [popoverOpen, setPopoverOpen] = useState(false);
  const [flow, setFlow] = useState<AddFlowState>({ step: 'pick' });
  const [inputValue, setInputValue] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);

  const resetFlow = useCallback(() => {
    setFlow({ step: 'pick' });
    setInputValue('');
    setShowKey(false);
    setSavedFlash(false);
  }, []);

  const handlePopoverChange = useCallback(
    (open: boolean) => {
      setPopoverOpen(open);
      if (!open) resetFlow();
    },
    [resetFlow]
  );

  const handlePickProvider = useCallback((option: ProviderOption) => {
    if (option.authMethod === 'agent_managed') {
      setFlow({ step: 'connecting', option });
    } else {
      setFlow({ step: 'configure', option });
    }
  }, []);

  const handleSave = useCallback(() => {
    if (flow.step !== 'configure') return;
    const { option } = flow;

    const value = inputValue.trim();
    if (!value) return;

    let connectionId: string;
    if (option.authMethod === 'api_key') {
      connectionId = addConnection({
        provider: option.provider,
        authMethod: 'api_key',
        status: 'connected',
        label: option.label,
        credentials: { type: 'api_key', key: value },
      });
    } else {
      // local (Ollama)
      connectionId = addConnection({
        provider: option.provider,
        authMethod: 'local',
        status: 'connected',
        label: option.label,
        credentials: { type: 'local', url: value },
      });
    }

    autoAssign(connectionId);
    setSavedFlash(true);
    setTimeout(() => {
      setPopoverOpen(false);
      resetFlow();
    }, 600);
  }, [flow, inputValue, addConnection, autoAssign, resetFlow]);

  const handleAgentConnected = useCallback(
    (option: ProviderOption) => {
      const connectionId = addConnection({
        provider: option.provider,
        authMethod: 'agent_managed',
        status: 'connected',
        label: option.label,
        credentials: {
          type: 'agent_managed',
          agentBinary: option.agentBinary!,
          ...(option.agentArgs ? { agentArgs: option.agentArgs } : {}),
        },
      });
      autoAssign(connectionId);
      setTimeout(() => {
        setPopoverOpen(false);
        resetFlow();
      }, 600);
    },
    [addConnection, autoAssign, resetFlow]
  );

  const handleDisconnect = useCallback(
    (connection: Connection) => {
      if (connection.authMethod === 'agent_managed') {
        stopAcpAgent();
      }
      clearRoutingForConnection(connection.id);
      removeConnection(connection.id);
    },
    [clearRoutingForConnection, removeConnection]
  );

  return (
    <div className="space-y-6">
      {/* Header + Add button */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <Label className="text-sm font-semibold">Connections</Label>
          <p className="text-xs text-muted-foreground mt-1">
            Manage your AI provider connections
          </p>
        </div>

        <Popover open={popoverOpen} onOpenChange={handlePopoverChange}>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm" className="shrink-0">
              <Plus className="h-4 w-4 mr-1.5" strokeWidth={1.5} />
              Add Connection
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-80 p-0">
            {flow.step === 'pick' && (
              <ProviderPicker onPick={handlePickProvider} />
            )}
            {flow.step === 'configure' && (
              <ConfigureForm
                option={flow.option}
                value={inputValue}
                onChange={setInputValue}
                showKey={showKey}
                onToggleShow={() => setShowKey(!showKey)}
                onSave={handleSave}
                savedFlash={savedFlash}
              />
            )}
            {flow.step === 'connecting' && (
              <ConnectAgent
                option={flow.option}
                onBack={() => setFlow({ step: 'pick' })}
                onConnected={handleAgentConnected}
              />
            )}
          </PopoverContent>
        </Popover>
      </div>

      {/* Connection list */}
      {connections.length > 0 ? (
        <div className="space-y-2">
          {connections.map((conn) => (
            <ConnectionCard
              key={conn.id}
              connection={conn}
              onDisconnect={handleDisconnect}
            />
          ))}
        </div>
      ) : (
        <div className="p-8 text-center border border-dashed border-border rounded-lg">
          <div className="h-12 w-12 mx-auto mb-3 rounded-full bg-muted flex items-center justify-center">
            <Plus className="h-6 w-6 text-muted-foreground/50" strokeWidth={1.5} />
          </div>
          <p className="text-sm font-medium">No connections yet</p>
          <p className="text-xs text-muted-foreground mt-1.5 max-w-[240px] mx-auto">
            Connect an AI provider to enable chat, inline actions, and agent tasks. Use your existing subscription or an API key.
          </p>
        </div>
      )}
    </div>
  );
}

// --- Sub-components ---

function ProviderLogo({ provider, className = 'w-6 h-6' }: { provider: string; className?: string }) {
  const src = PROVIDER_LOGOS[provider];
  if (!src) {
    if (provider === 'github') {
      return (
        <span className={`${className} rounded flex items-center justify-center bg-white p-0.5`}>
          <Github className="w-5 h-5 text-black" strokeWidth={1.5} />
        </span>
      );
    }
    return <span className={`${className} rounded bg-muted`} />;
  }
  return (
    <img
      src={src}
      alt={provider}
      className={`${className} rounded object-contain bg-white p-0.5`}
    />
  );
}

function ProviderPicker({ onPick }: { onPick: (option: ProviderOption) => void }) {
  // Group by subscription-based (agent) vs API key
  const subscriptionOptions = PROVIDER_OPTIONS.filter((o) => o.authMethod === 'agent_managed');
  const apiKeyOptions = PROVIDER_OPTIONS.filter((o) => o.authMethod !== 'agent_managed');

  return (
    <div className="py-1">
      <div className="px-3 py-2 border-b border-border">
        <p className="text-sm font-medium">Add a provider</p>
        <p className="text-xs text-muted-foreground">
          Use your existing subscription or an API key
        </p>
      </div>
      {subscriptionOptions.length > 0 && (
        <>
          <div className="px-3 pt-2 pb-1">
            <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              Subscription
            </p>
          </div>
          {subscriptionOptions.map((option) => (
            <ProviderPickerItem key={`${option.provider}-${option.authMethod}`} option={option} onPick={onPick} />
          ))}
        </>
      )}
      {apiKeyOptions.length > 0 && (
        <>
          <div className="mx-3 my-1 border-t border-border" />
          <div className="px-3 pt-1 pb-1">
            <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              API Key
            </p>
          </div>
          {apiKeyOptions.map((option) => (
            <ProviderPickerItem key={`${option.provider}-${option.authMethod}`} option={option} onPick={onPick} />
          ))}
        </>
      )}
    </div>
  );
}

function ProviderPickerItem({
  option,
  onPick,
}: {
  option: ProviderOption;
  onPick: (option: ProviderOption) => void;
}) {
  const isFreeAvailable = option.provider === 'github';

  return (
    <button
      onClick={() => onPick(option)}
      className="w-full flex items-start gap-3 px-3 py-2.5 text-left hover:bg-accent transition-colors duration-150"
    >
      <ProviderLogo provider={option.provider} className="w-6 h-6 mt-0.5 shrink-0" />
      <div className="flex-1 min-w-0">
        <span className="text-sm font-medium truncate block">
          {option.label}
        </span>
        <p className="text-xs text-muted-foreground mt-0.5">
          {option.description}
          {isFreeAvailable && (
            <span className="ml-1 text-[10px] font-medium text-muted-foreground"> · Free tier available</span>
          )}
        </p>
        <div className="flex items-center gap-1.5 mt-1.5">
          {option.capabilities.map((cap) => (
            <TooltipProvider key={cap}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span
                    className="text-[10px] px-1.5 py-0.5 rounded-sm bg-muted/60 text-muted-foreground cursor-default"
                  >
                    {CAPABILITY_LABELS[cap]}
                  </span>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="max-w-[200px] text-xs">
                  {ROUTING_SLOT_LABELS[cap].description}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          ))}
        </div>
      </div>
    </button>
  );
}

function ConfigureForm({
  option,
  value,
  onChange,
  showKey,
  onToggleShow,
  onSave,
  savedFlash,
}: {
  option: ProviderOption;
  value: string;
  onChange: (v: string) => void;
  showKey: boolean;
  onToggleShow: () => void;
  onSave: () => void;
  savedFlash: boolean;
}) {
  const isApiKey = option.authMethod === 'api_key';

  const placeholder = isApiKey
    ? option.provider === 'anthropic'
      ? 'sk-ant-...'
      : 'sk-...'
    : 'http://localhost:11434';

  const helpText = isApiKey
    ? option.provider === 'anthropic'
      ? 'Get your key from console.anthropic.com'
      : 'Get your key from platform.openai.com'
    : 'Default: http://localhost:11434';

  return (
    <div className="p-3 space-y-3">
      <div className="flex items-center gap-2">
        <ProviderLogo provider={option.provider} className="w-5 h-5 shrink-0" />
        <span className="text-sm font-medium">{option.label}</span>
      </div>

      <div className="space-y-1.5">
        <Label className="text-xs text-muted-foreground">
          {isApiKey ? 'API Key' : 'Server URL'}
        </Label>
        <p className="text-xs text-muted-foreground">{helpText}</p>
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Input
              type={isApiKey && !showKey ? 'password' : 'text'}
              placeholder={placeholder}
              value={value}
              onChange={(e) => onChange(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') onSave(); }}
              className="font-mono text-sm pr-9"
              autoFocus
            />
            {isApiKey && (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="absolute right-0 top-0 h-full w-9 text-muted-foreground hover:text-foreground"
                onClick={onToggleShow}
                tabIndex={-1}
              >
                {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </Button>
            )}
          </div>
          <Button onClick={onSave} size="sm" disabled={!value.trim()}>
            <Check
              className={`h-4 w-4 mr-1 transition-colors ${savedFlash ? 'text-green-500' : ''}`}
            />
            Save
          </Button>
        </div>
      </div>
    </div>
  );
}

// --- Agent connection flow ---

type AgentPhase = 'checking' | 'not_installed' | 'not_authenticated' | 'connecting' | 'connected' | 'error';

function ConnectAgent({
  option,
  onBack,
  onConnected,
}: {
  option: ProviderOption;
  onBack: () => void;
  onConnected: (option: ProviderOption) => void;
}) {
  const [phase, setPhase] = useState<AgentPhase>('checking');
  const [error, setError] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);
  const onConnectedRef = useRef(onConnected);
  onConnectedRef.current = onConnected;

  useEffect(() => {
    let active = true;
    const binary = option.agentBinary!;

    (async () => {
      // Phase 1: Check binary availability
      setPhase('checking');
      setError(null);

      try {
        const avail = await invoke<{ installed: boolean; path: string | null; authenticated: boolean | null }>('acp_agent_check_availability', {
          agentId: binary,
        });
        if (!active) return;
        if (!avail.installed) {
          setPhase('not_installed');
          return;
        }
        if (avail.authenticated === false) {
          setPhase('not_authenticated');
          return;
        }
      } catch {
        if (!active) return;
        setPhase('not_installed');
        return;
      }

      // Phase 2: Spawn agent and authenticate
      setPhase('connecting');
      let instanceId: string | null = null;

      try {
        const result = await invoke<{ instance_id: string }>('acp_agent_spawn', {
          agentBinary: binary,
          agentArgs: option.agentArgs ?? null,
          role: 'interactive',
          workingDirectory: '/tmp',
        });
        if (!active) {
          invoke('acp_agent_stop', { instanceId: result.instance_id }).catch(() => {});
          return;
        }
        instanceId = result.instance_id;

        // Try to authenticate — some agents handle auth internally
        // (e.g. claude-agent-acp uses Claude CLI's stored credentials)
        try {
          await invoke('acp_agent_authenticate', { instanceId });
        } catch (authErr) {
          const msg = String(authErr);
          // "not implemented" means the agent doesn't need explicit auth — that's fine
          if (!msg.toLowerCase().includes('not implemented')) {
            throw authErr;
          }
        }
        if (!active) {
          invoke('acp_agent_stop', { instanceId }).catch(() => {});
          return;
        }

        // Stop temporary agent used for the connection test
        invoke('acp_agent_stop', { instanceId }).catch(() => {});

        setPhase('connected');
        onConnectedRef.current(option);
      } catch (err) {
        if (instanceId) {
          invoke('acp_agent_stop', { instanceId }).catch(() => {});
        }
        if (!active) return;
        setError(err instanceof Error ? err.message : String(err));
        setPhase('error');
      }
    })();

    return () => { active = false; };
  }, [option, retryCount]);

  const binary = option.agentBinary!;

  return (
    <div className="p-4 space-y-3">
      <div className="flex items-center gap-2">
        <ProviderLogo provider={option.provider} className="w-5 h-5 shrink-0" />
        <span className="text-sm font-medium">{option.label}</span>
      </div>

      {phase === 'checking' && (
        <div className="flex items-center gap-2.5 py-3">
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" strokeWidth={1.5} />
          <span className="text-sm text-muted-foreground">
            Checking for {binary}...
          </span>
        </div>
      )}

      {phase === 'not_installed' && (
        <div className="space-y-3">
          <div className="p-3 rounded-lg bg-muted/50 border border-border">
            <div className="flex items-start gap-2">
              <AlertCircle className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" strokeWidth={1.5} />
              <div>
                <p className="text-sm font-medium">
                  {binary} not found
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  {getInstallHint(binary)}
                </p>
              </div>
            </div>
          </div>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={onBack} className="flex-1">
              Back
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setRetryCount((c) => c + 1)}
              className="flex-1"
            >
              <RefreshCw className="h-3.5 w-3.5 mr-1.5" strokeWidth={1.5} />
              Retry
            </Button>
          </div>
        </div>
      )}

      {phase === 'not_authenticated' && (
        <div className="space-y-3">
          <div className="p-3 rounded-lg bg-muted/50 border border-border">
            <div className="flex items-start gap-2">
              <AlertCircle className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" strokeWidth={1.5} />
              <div>
                <p className="text-sm font-medium">
                  Not signed in
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  {getAuthHint(binary)}
                </p>
              </div>
            </div>
          </div>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={onBack} className="flex-1">
              Back
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setRetryCount((c) => c + 1)}
              className="flex-1"
            >
              <RefreshCw className="h-3.5 w-3.5 mr-1.5" strokeWidth={1.5} />
              Retry
            </Button>
          </div>
        </div>
      )}

      {phase === 'connecting' && (
        <div className="space-y-2 py-2">
          <div className="flex items-center gap-2.5">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" strokeWidth={1.5} />
            <span className="text-sm text-muted-foreground">Connecting...</span>
          </div>
          <p className="text-xs text-muted-foreground pl-6.5">
            A browser window may open for sign-in.
          </p>
        </div>
      )}

      {phase === 'connected' && (
        <div className="flex items-center gap-2.5 py-3">
          <Check className="h-4 w-4 text-green-500" strokeWidth={2} />
          <span className="text-sm font-medium">Connected!</span>
        </div>
      )}

      {phase === 'error' && (
        <div className="space-y-3">
          <div className="p-3 rounded-lg bg-destructive/10 border border-destructive/20">
            <div className="flex items-start gap-2">
              <AlertCircle className="h-4 w-4 text-destructive mt-0.5 shrink-0" strokeWidth={1.5} />
              <div>
                <p className="text-sm font-medium text-destructive">
                  Connection failed
                </p>
                {error && (
                  <p className="text-xs text-destructive/80 mt-1 break-words">
                    {error}
                  </p>
                )}
              </div>
            </div>
          </div>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={onBack} className="flex-1">
              Back
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setRetryCount((c) => c + 1)}
              className="flex-1"
            >
              <RefreshCw className="h-3.5 w-3.5 mr-1.5" strokeWidth={1.5} />
              Retry
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function getAuthHint(binary: string): string {
  switch (binary) {
    case 'claude-agent-acp':
      return 'Run "claude auth login" in your terminal to sign in with your Claude subscription.';
    case 'codex-acp':
    case 'codex':
      return 'Run "codex login --device-auth" in your terminal to sign in with your ChatGPT subscription.';
    case 'copilot':
      return 'Run "copilot auth login" in your terminal to sign in with your GitHub account.';
    default:
      return `Sign in to "${binary}" before connecting.`;
  }
}

function getInstallHint(binary: string): string {
  switch (binary) {
    case 'claude-agent-acp':
      return 'Run: npm install -g @zed-industries/claude-agent-acp';
    case 'codex-acp':
      return 'Download from github.com/zed-industries/codex-acp/releases';
    case 'codex':
      return 'Run: npm install -g @openai/codex';
    case 'copilot':
      return 'Install GitHub Copilot CLI from github.com/github/copilot-cli';
    default:
      return `Install "${binary}" to continue.`;
  }
}
