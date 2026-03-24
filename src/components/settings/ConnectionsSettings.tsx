import { useState, useCallback, useEffect, useRef } from 'react';
import { useConnectionsStore } from '@/stores/connections-store';
import { useRoutingStore } from '@/stores/routing-store';
import { stopAcpAgent } from '@/hooks/useAIOperations';
import { toast } from 'sonner';
import { ConnectionCard } from './ConnectionCard';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
} from '@/components/ui/popover';
import { Plus, Check, Eye, EyeOff, Loader2, AlertCircle, RefreshCw, Copy, Download } from 'lucide-react';
import { ProviderLogo } from '@/components/ProviderLogo';
import { ConnectionConfigDialog } from './ConnectionConfigDialog';
import type { Connection, ProviderOption } from '@/lib/ai/connections';
import { PROVIDER_OPTIONS } from '@/lib/ai/connections';
import { invoke } from '@tauri-apps/api/core';
import { log } from '@/lib/logger';

const COPILOT_PATH = "M7.998 15.035c-4.562 0-7.873-2.914-7.998-3.749V9.338c.085-.628.677-1.686 1.588-2.065.013-.07.024-.143.036-.218.029-.183.06-.384.126-.612-.201-.508-.254-1.084-.254-1.656 0-.87.128-1.769.693-2.484.579-.733 1.494-1.124 2.724-1.261 1.206-.134 2.262.034 2.944.765.05.053.096.108.139.165.044-.057.094-.112.143-.165.682-.731 1.738-.899 2.944-.765 1.23.137 2.145.528 2.724 1.261.566.715.693 1.614.693 2.484 0 .572-.053 1.148-.254 1.656.066.228.098.429.126.612.012.076.024.148.037.218.924.385 1.522 1.471 1.591 2.095v1.872c0 .766-3.351 3.795-8.002 3.795Zm0-1.485c2.28 0 4.584-1.11 5.002-1.433V7.862l-.023-.116c-.49.21-1.075.291-1.727.291-1.146 0-2.059-.327-2.71-.991A3.222 3.222 0 0 1 8 6.303a3.24 3.24 0 0 1-.544.743c-.65.664-1.563.991-2.71.991-.652 0-1.236-.081-1.727-.291l-.023.116v4.255c.419.323 2.722 1.433 5.002 1.433ZM6.762 2.83c-.193-.206-.637-.413-1.682-.297-1.019.113-1.479.404-1.713.7-.247.312-.369.789-.369 1.554 0 .793.129 1.171.308 1.371.162.181.519.379 1.442.379.853 0 1.339-.235 1.638-.54.315-.322.527-.827.617-1.553.117-.935-.037-1.395-.241-1.614Zm4.155-.297c-1.044-.116-1.488.091-1.681.297-.204.219-.359.679-.242 1.614.091.726.303 1.231.618 1.553.299.305.784.54 1.638.54.922 0 1.28-.198 1.442-.379.179-.2.308-.578.308-1.371 0-.765-.123-1.242-.37-1.554-.233-.296-.693-.587-1.713-.7Z";
const COPILOT_EYES = "M6.25 9.037a.75.75 0 0 1 .75.75v1.501a.75.75 0 0 1-1.5 0V9.787a.75.75 0 0 1 .75-.75Zm4.25.75v1.501a.75.75 0 0 1-1.5 0V9.787a.75.75 0 0 1 1.5 0Z";

function CopilotIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="currentColor" className={className}>
      <path d={COPILOT_PATH} />
      <path d={COPILOT_EYES} />
    </svg>
  );
}

type AddFlowState =
  | { step: 'pick' }
  | { step: 'configure'; option: ProviderOption }
  | { step: 'connecting'; option: ProviderOption };

export function ConnectionsSettings({ onNavigateToTab }: { onNavigateToTab?: (tab: string) => void } = {}) {
  const connections = useConnectionsStore((s) => s.connections);
  const addConnection = useConnectionsStore((s) => s.addConnection);
  const removeConnection = useConnectionsStore((s) => s.removeConnection);
  const clearRoutingForConnection = useRoutingStore((s) => s.clearRoutingForConnection);
  const autoAssign = useRoutingStore((s) => s.autoAssign);

  // Track which provider options are already connected (by label)
  const connectedLabels = new Set(connections.map((c) => c.label));

  // Two-stage flow: DropdownMenu for picking, Popover for configure/connect
  const [flow, setFlow] = useState<AddFlowState>({ step: 'pick' });
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [popoverOpen, setPopoverOpen] = useState(false);
  const popoverOpenedAt = useRef(0);
  const [inputValue, setInputValue] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);
  const [configDialogConnection, setConfigDialogConnection] = useState<Connection | null>(null);
  // Extra fields for OpenAI-Compatible provider
  const [oaiBaseUrl, setOaiBaseUrl] = useState('');
  const [oaiModel, setOaiModel] = useState('');
  const [oaiLabel, setOaiLabel] = useState('');

  // Agent update checking
  const [agentUpdates, setAgentUpdates] = useState<Record<string, { currentVersion: string; latestVersion: string }>>({});
  const [checkingUpdates, setCheckingUpdates] = useState(false);

  const checkForUpdates = useCallback((force = false) => {
    setCheckingUpdates(true);
    const minDelay = new Promise((r) => setTimeout(r, 1000));
    let toastMsg: (() => void) | null = null;
    const check = invoke<{ agent_id: string; current_version: string; latest_version: string }[]>('agent_check_updates', { force })
      .then((updates) => {
        const map: Record<string, { currentVersion: string; latestVersion: string }> = {};
        for (const u of updates) {
          map[u.agent_id] = { currentVersion: u.current_version, latestVersion: u.latest_version };
        }
        setAgentUpdates(map);
        if (force) {
          toastMsg = updates.length > 0
            ? () => toast.info(`${updates.length} update${updates.length > 1 ? 's' : ''} available`)
            : () => toast.success('All agents are up to date');
        }
      })
      .catch(() => {
        if (force) toastMsg = () => toast.error('Failed to check for updates');
      });
    Promise.all([check, minDelay]).then(() => {
      setCheckingUpdates(false);
      toastMsg?.();
    });
  }, []);

  useEffect(() => {
    checkForUpdates();
  }, []);

  const resetFlow = useCallback(() => {
    setFlow({ step: 'pick' });
    setInputValue('');
    setShowKey(false);
    setSavedFlash(false);
    setPopoverOpen(false);
    setOaiBaseUrl('');
    setOaiModel('');
    setOaiLabel('');
  }, []);

  const handleBack = useCallback(() => {
    setPopoverOpen(false);
    setFlow({ step: 'pick' });
    setInputValue('');
    // Reopen the dropdown after the popover closes
    requestAnimationFrame(() => setDropdownOpen(true));
  }, []);

  const finishLocalAIConnect = useCallback(() => {
    // Start as 'expired' (amber) — useLocalAI hook will set 'connected' (green) once server is running
    const connectionId = addConnection({
      provider: 'local_ai',
      authMethod: 'local_bundled',
      status: 'expired',
      label: 'Local AI',
      credentials: { type: 'local_bundled' },
    });
    autoAssign(connectionId);
  }, [addConnection, autoAssign]);

  const handlePickProvider = useCallback((option: ProviderOption) => {
    // Local AI: connect immediately (binary is always bundled as sidecar)
    if (option.authMethod === 'local_bundled') {
      finishLocalAIConnect();
      return;
    }

    if (option.lspBinary || option.authMethod === 'agent_managed') {
      setFlow({ step: 'connecting', option });
    } else {
      setFlow({ step: 'configure', option });
    }
    // Delay popover open so it doesn't race with the dropdown close animation
    setTimeout(() => {
      setPopoverOpen(true);
      popoverOpenedAt.current = Date.now();
    }, 100);
  }, [addConnection, autoAssign, finishLocalAIConnect]);

  const handleSave = useCallback(() => {
    if (flow.step !== 'configure') return;
    const { option } = flow;

    const value = inputValue.trim();

    // OpenAI-Compatible needs base URL + API key + model
    if (option.provider === 'openai_compatible') {
      if (!value || !oaiBaseUrl.trim() || !oaiModel.trim()) return;
      const connectionId = addConnection({
        provider: 'openai_compatible',
        authMethod: 'api_key',
        status: 'connected',
        label: oaiLabel.trim() || option.label,
        credentials: { type: 'api_key', key: value },
        config: { baseUrl: oaiBaseUrl.trim(), model: oaiModel.trim() },
      });
      autoAssign(connectionId);
      setSavedFlash(true);
      setTimeout(() => resetFlow(), 600);
      return;
    }

    // API keys are required; local (Ollama) falls back to default URL
    if (option.authMethod === 'api_key' && !value) return;
    const localDefault = 'http://localhost:11434';

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
        credentials: { type: 'local', url: value || localDefault },
      });
    }

    autoAssign(connectionId);
    setSavedFlash(true);
    setTimeout(() => resetFlow(), 600);
  }, [flow, inputValue, oaiBaseUrl, oaiModel, oaiLabel, addConnection, autoAssign, resetFlow]);

  const handleAgentConnected = useCallback(
    (option: ProviderOption, envVars?: Record<string, string>) => {
      const credentials = option.lspBinary
        ? { type: 'agent_managed' as const, agentBinary: option.lspBinary }
        : {
            type: 'agent_managed' as const,
            agentBinary: option.agentBinary!,
            ...(option.agentArgs ? { agentArgs: option.agentArgs } : {}),
            ...(envVars && Object.keys(envVars).length > 0 ? { envVars } : {}),
          };

      const connectionId = addConnection({
        provider: option.provider,
        authMethod: 'agent_managed',
        status: 'connected',
        label: option.label,
        credentials,
      });
      // Copilot LSP only supports inline completions — not chat or agent tasks.
      // Override the auto-derived capabilities to prevent it being assigned to
      // the interactive/agent_tasks routing slots (it speaks LSP, not ACP).
      if (option.lspBinary) {
        useConnectionsStore.getState().updateConnection(connectionId, { capabilities: ['inline_completion'] });
      }
      autoAssign(connectionId);
      setTimeout(() => resetFlow(), 600);
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

        {/* Popover anchors to the button; DropdownMenu opens from it too */}
        <Popover
          open={popoverOpen}
          onOpenChange={(open) => {
            if (!open) {
              // Guard: ignore dismiss within 300ms of opening (dropdown close race)
              if (Date.now() - popoverOpenedAt.current < 300) return;
              resetFlow();
            }
          }}
        >
          <DropdownMenu open={dropdownOpen} onOpenChange={setDropdownOpen}>
            <PopoverAnchor asChild>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="shrink-0">
                  <Plus className="h-4 w-4 mr-1.5" strokeWidth={1.5} />
                  Add Connection
                </Button>
              </DropdownMenuTrigger>
            </PopoverAnchor>
            <DropdownMenuContent align="end" className="w-96">
              <DropdownMenuGroup>
                <DropdownMenuLabel className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  Subscription
                </DropdownMenuLabel>
                {PROVIDER_OPTIONS.filter((o) => o.authMethod === 'agent_managed').map((option) => {
                  const alreadyConnected = connectedLabels.has(option.label);
                  return (
                    <DropdownMenuItem
                      key={`${option.provider}-${option.authMethod}-${option.label}`}
                      className={`relative flex items-start gap-2.5 py-1.5 ${alreadyConnected ? 'opacity-50' : 'cursor-pointer'}`}
                      disabled={alreadyConnected}
                      onSelect={() => handlePickProvider(option)}
                    >
                      <ProviderLogo provider={option.provider} className="w-5 h-5 mt-0.5 shrink-0" />
                      <div className="flex-1 min-w-0">
                        <span className="text-sm font-medium block truncate">{option.label}</span>
                        <span className="text-xs text-muted-foreground block truncate">{option.description}</span>
                      </div>
                      {alreadyConnected && (
                        <Check className="h-3.5 w-3.5 mt-0.5 text-muted-foreground shrink-0" strokeWidth={1.5} />
                      )}
                    </DropdownMenuItem>
                  );
                })}
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
              <DropdownMenuGroup>
                <DropdownMenuLabel className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  API Key
                </DropdownMenuLabel>
                {PROVIDER_OPTIONS.filter((o) => o.authMethod === 'api_key').map((option) => {
                  // openai_compatible allows multiple connections — skip dedup
                  const alreadyConnected = option.provider !== 'openai_compatible' && connectedLabels.has(option.label);
                  const oaiCompatCount = option.provider === 'openai_compatible'
                    ? connections.filter((c) => c.provider === 'openai_compatible').length
                    : 0;
                  return (
                    <DropdownMenuItem
                      key={`${option.provider}-${option.authMethod}-${option.label}`}
                      className={`relative flex items-start gap-2.5 py-1.5 ${alreadyConnected ? 'opacity-50' : 'cursor-pointer'}`}
                      disabled={alreadyConnected}
                      onSelect={() => handlePickProvider(option)}
                    >
                      <ProviderLogo provider={option.provider} className="w-5 h-5 mt-0.5 shrink-0" />
                      <div className="flex-1 min-w-0">
                        <span className="text-sm font-medium block truncate">
                          {option.label}
                          {oaiCompatCount > 0 && (
                            <span className="ml-1.5 text-xs font-normal text-muted-foreground">({oaiCompatCount})</span>
                          )}
                        </span>
                        <span className="text-xs text-muted-foreground block truncate">{option.description}</span>
                      </div>
                      {alreadyConnected && (
                        <Check className="h-3.5 w-3.5 mt-0.5 text-muted-foreground shrink-0" strokeWidth={1.5} />
                      )}
                    </DropdownMenuItem>
                  );
                })}
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
              <DropdownMenuGroup>
                <DropdownMenuLabel className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  Local
                </DropdownMenuLabel>
                {PROVIDER_OPTIONS.filter((o) => o.authMethod === 'local' || o.authMethod === 'local_bundled').map((option) => {
                  const alreadyConnected = connectedLabels.has(option.label);
                  return (
                    <DropdownMenuItem
                      key={`${option.provider}-${option.authMethod}-${option.label}`}
                      className={`relative flex items-start gap-2.5 py-1.5 ${alreadyConnected ? 'opacity-50' : 'cursor-pointer'}`}
                      disabled={alreadyConnected}
                      onSelect={() => handlePickProvider(option)}
                    >
                      <ProviderLogo provider={option.provider} className="w-5 h-5 mt-0.5 shrink-0" />
                      <div className="flex-1 min-w-0">
                        <span className="text-sm font-medium block truncate">{option.label}</span>
                        <span className="text-xs text-muted-foreground block truncate">{option.description}</span>
                      </div>
                      {alreadyConnected && (
                        <Check className="h-3.5 w-3.5 mt-0.5 text-muted-foreground shrink-0" strokeWidth={1.5} />
                      )}
                    </DropdownMenuItem>
                  );
                })}
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>

          <PopoverContent align="end" className="w-96 p-0">
            {flow.step === 'configure' && (
              <ConfigureForm
                option={flow.option}
                value={inputValue}
                onChange={setInputValue}
                showKey={showKey}
                onToggleShow={() => setShowKey(!showKey)}
                onSave={handleSave}
                savedFlash={savedFlash}
                baseUrl={oaiBaseUrl}
                onBaseUrlChange={setOaiBaseUrl}
                model={oaiModel}
                onModelChange={setOaiModel}
                customLabel={oaiLabel}
                onCustomLabelChange={setOaiLabel}
              />
            )}
            {flow.step === 'connecting' && flow.option.lspBinary && (
              <ConnectCopilotLsp
                option={flow.option}
                onBack={handleBack}
                onConnected={handleAgentConnected}
              />
            )}
            {flow.step === 'connecting' && !flow.option.lspBinary && (
              <ConnectAgent
                option={flow.option}
                onBack={handleBack}
                onConnected={handleAgentConnected}
              />
            )}
          </PopoverContent>
        </Popover>
      </div>

      {/* Connection list */}
      {connections.length > 0 ? (
        <div className="space-y-2">
          {connections.some((c) => c.authMethod === 'agent_managed') && (
            <div className="flex items-center justify-end">
              <button
                className="text-[11px] text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1"
                onClick={() => checkForUpdates(true)}
                disabled={checkingUpdates}
              >
                {checkingUpdates
                  ? <Loader2 className="h-3 w-3 animate-spin" strokeWidth={1.5} />
                  : <RefreshCw className="h-3 w-3" strokeWidth={1.5} />
                }
                Check for updates
              </button>
            </div>
          )}
          {connections.map((conn) => (
            <ConnectionCard
              key={conn.id}
              connection={conn}
              onConfigure={setConfigDialogConnection}
              onDisconnect={handleDisconnect}
              updateAvailable={
                conn.credentials.type === 'agent_managed'
                  ? (() => {
                      const creds = conn.credentials as { agentBinary: string };
                      const u = agentUpdates[creds.agentBinary];
                      return u ? { agentId: creds.agentBinary, ...u } : null;
                    })()
                  : null
              }
              onUpdateComplete={() => {
                // Clear the update for this agent
                setAgentUpdates((prev) => {
                  const next = { ...prev };
                  const creds = conn.credentials as { agentBinary?: string };
                  if (creds.agentBinary) delete next[creds.agentBinary];
                  return next;
                });
              }}
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

      {/* Connection config dialog */}
      <ConnectionConfigDialog
        connection={configDialogConnection}
        open={!!configDialogConnection}
        onOpenChange={(open) => {
          if (!open) setConfigDialogConnection(null);
        }}
        onNavigateToTab={onNavigateToTab}
      />

    </div>
  );
}

// --- Sub-components ---

function ConfigureForm({
  option,
  value,
  onChange,
  showKey,
  onToggleShow,
  onSave,
  savedFlash,
  baseUrl,
  onBaseUrlChange,
  model,
  onModelChange,
  customLabel,
  onCustomLabelChange,
}: {
  option: ProviderOption;
  value: string;
  onChange: (v: string) => void;
  showKey: boolean;
  onToggleShow: () => void;
  onSave: () => void;
  savedFlash: boolean;
  baseUrl?: string;
  onBaseUrlChange?: (v: string) => void;
  model?: string;
  onModelChange?: (v: string) => void;
  customLabel?: string;
  onCustomLabelChange?: (v: string) => void;
}) {
  const isApiKey = option.authMethod === 'api_key';
  const isOaiCompat = option.provider === 'openai_compatible';

  const placeholder = isOaiCompat
    ? 'API key'
    : isApiKey
      ? option.provider === 'anthropic'
        ? 'sk-ant-...'
        : 'sk-...'
      : 'http://localhost:11434';

  const helpText = isOaiCompat
    ? 'vLLM, LiteLLM, Together AI, Groq, or any compatible API'
    : isApiKey
      ? option.provider === 'anthropic'
        ? 'Get your key from console.anthropic.com'
        : 'Get your key from platform.openai.com'
      : 'Default: http://localhost:11434';

  const canSave = isOaiCompat
    ? value.trim() && baseUrl?.trim() && model?.trim()
    : isApiKey
      ? value.trim()
      : true;

  return (
    <div className="p-3 space-y-3">
      <div className="flex items-center gap-2">
        <ProviderLogo provider={option.provider} className="w-5 h-5 shrink-0" />
        <span className="text-sm font-medium">{option.label}</span>
      </div>

      <p className="text-xs text-muted-foreground">{helpText}</p>

      {/* Custom name — OpenAI-Compatible only */}
      {isOaiCompat && onCustomLabelChange && (
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Name</Label>
          <Input
            type="text"
            placeholder="e.g. Groq, Together AI, My vLLM"
            value={customLabel ?? ''}
            onChange={(e) => onCustomLabelChange(e.target.value)}
            className="text-sm"
            autoFocus
          />
        </div>
      )}

      {/* Base URL — OpenAI-Compatible only */}
      {isOaiCompat && onBaseUrlChange && (
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Base URL</Label>
          <Input
            type="url"
            placeholder="https://api.example.com"
            value={baseUrl ?? ''}
            onChange={(e) => onBaseUrlChange(e.target.value)}
            className="text-sm"
          />
        </div>
      )}

      {/* Model — OpenAI-Compatible only */}
      {isOaiCompat && onModelChange && (
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Model</Label>
          <Input
            type="text"
            placeholder="gpt-4o, llama-3.1-70b, etc."
            value={model ?? ''}
            onChange={(e) => onModelChange(e.target.value)}
            className="text-sm"
          />
        </div>
      )}

      <div className="space-y-1">
        <Label className="text-xs text-muted-foreground">
          {isApiKey ? 'API Key' : 'Server URL'}
        </Label>
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Input
              type={isApiKey && !showKey ? 'password' : 'text'}
              placeholder={placeholder}
              value={value}
              onChange={(e) => onChange(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') onSave(); }}
              className="font-mono text-sm pr-9"
              autoFocus={!isOaiCompat}
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
          <Button onClick={onSave} size="sm" disabled={!canSave}>
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

// --- Copilot LSP connection flow ---

import { listen } from '@tauri-apps/api/event';

type CopilotLspPhase = 'checking' | 'not_installed' | 'signing_in' | 'device_code' | 'connected' | 'error';

function ConnectCopilotLsp({
  option,
  onBack,
  onConnected,
}: {
  option: ProviderOption;
  onBack: () => void;
  onConnected: (option: ProviderOption) => void;
}) {
  const [phase, setPhase] = useState<CopilotLspPhase>('checking');
  const [error, setError] = useState<string | null>(null);
  const [deviceCode, setDeviceCode] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);
  const [retrying, setRetrying] = useState(false);
  const [copied, setCopied] = useState(false);
  const isRetryRef = useRef(false);
  const deviceCodeReceivedRef = useRef(false);
  const onConnectedRef = useRef(onConnected);
  onConnectedRef.current = onConnected;

  // Listen for auth completion via didChangeStatus — attach BEFORE starting LSP
  // so we don't miss early "Normal" events from cached credentials.
  // Guard: onConnected must only be called ONCE per attempt.
  const authCompleted = useRef(false);

  const completeAuth = useCallback(() => {
    if (authCompleted.current) return; // already fired
    authCompleted.current = true;
    log.debug('settings', 'Auth succeeded, completing connection (once)');
    setPhase('connected');
    // Don't stop the LSP here — useCopilotCompletion will restart it with
    // the correct working directory. Stopping here races with the hook's start.
    onConnectedRef.current(option);
  }, [option]);

  useEffect(() => {
    authCompleted.current = false;

    const unlistenStatus = listen<{ message: string; kind: string }>(
      'copilot-status-changed',
      (event) => {
        const { message, kind } = event.payload;
        log.debug('settings', 'Copilot status changed', { kind, message });
        if (kind === 'Normal') {
          completeAuth();
        }
      }
    );

    // Listen for device code from server→client signIn request (fallback path).
    // When the direct signIn RPC returns an empty code, the LSP sends the
    // device code asynchronously via a server→client request handled in Rust.
    deviceCodeReceivedRef.current = false;
    const unlistenDeviceCode = listen<{ userCode: string; verificationUri: string }>(
      'copilot-auth-device-code',
      (event) => {
        const { userCode, verificationUri } = event.payload;
        log.debug('settings', 'Device code received via event', { userCode, verificationUri });
        if (userCode && !authCompleted.current) {
          deviceCodeReceivedRef.current = true;
          setDeviceCode(userCode);
          setPhase('device_code');
          // Auto-copy code to clipboard so it's ready when user opens GitHub
          navigator.clipboard.writeText(userCode).catch(() => {});
        }
      }
    );

    // Log ALL LSP messages during auth for debugging
    const unlistenLspMsg = listen<Record<string, unknown>>(
      'copilot-lsp-message',
      (event) => {
        log.debug('copilot-lsp', 'LSP message', event.payload);
        console.log('[Copilot LSP]', event.payload);
      }
    );

    return () => {
      unlistenStatus.then((fn) => fn());
      unlistenDeviceCode.then((fn) => fn());
      unlistenLspMsg.then((fn) => fn());
    };
  }, [completeAuth, retryCount]);

  // Check binary availability, start LSP, and sign in
  useEffect(() => {
    let active = true;
    const isRetry = isRetryRef.current;
    isRetryRef.current = false;
    const retryStart = isRetry ? Date.now() : 0;
    const endRetry = async () => {
      if (!isRetry) return;
      const elapsed = Date.now() - retryStart;
      if (elapsed < 600) await new Promise((r) => setTimeout(r, 600 - elapsed));
      setRetrying(false);
    };

    (async () => {
      // On retry, keep showing current guide — only reset on first load
      if (!isRetry) {
        setPhase('checking');
      }
      setError(null);

      try {
        log.debug('settings', 'Checking binary availability');
        const available = await withTimeout(
          invoke<boolean>('copilot_lsp_check_availability'),
          CONNECTION_TIMEOUT_MS,
          'Availability check',
        );
        log.debug('settings', 'Binary availability result', { available });
        if (!active) return;

        await endRetry();
        if (!available) {
          setPhase('not_installed');
          return;
        }

        // Binary found — start LSP and sign in
        setPhase('signing_in');

        log.debug('settings', 'Starting Copilot LSP');
        await withTimeout(
          invoke('copilot_lsp_start', { workingDirectory: '/tmp' }),
          CONNECTION_TIMEOUT_MS,
          'Starting Copilot',
        );
        log.debug('settings', 'Copilot LSP started');
        if (!active) return;

        // Check if already authenticated (status event arrived during init)
        if (authCompleted.current) {
          log.debug('settings', 'Already authenticated during LSP init, skipping signIn');
          return;
        }

        // Check status before attempting sign-in
        log.debug('settings', 'Checking Copilot LSP status');
        try {
          const status = await invoke<{ authenticated: boolean; message: string; kind: string }>(
            'copilot_lsp_status'
          );
          log.debug('settings', 'Copilot LSP status', status);
          if (!active) return;

          if (status.authenticated) {
            completeAuth();
            return;
          }
        } catch (statusErr) {
          log.debug('settings', 'Status check failed (non-fatal)', statusErr);
        }

        log.debug('settings', `Calling copilot_lsp_sign_in (timeout: ${CONNECTION_TIMEOUT_MS}ms)`);
        const signInStart = Date.now();
        const result = await withTimeout(
          invoke<{ user_code: string; verification_uri: string }>(
            'copilot_lsp_sign_in'
          ),
          CONNECTION_TIMEOUT_MS,
          'Sign-in',
        );
        log.debug('settings', `signIn returned after ${Date.now() - signInStart}ms`, result);
        if (!active) return;

        // Check if the device code was already received via event while signIn was running
        if (deviceCodeReceivedRef.current) {
          log.debug('settings', 'Device code already received via event during signIn call — skipping result processing');
          return;
        }

        if (!result.user_code) {
          // Neither Phase 1 (signIn) nor Phase 2 (signInInitiate) returned a
          // device code. Wait for the LSP to send it asynchronously via a
          // server→client signIn request → copilot-auth-device-code event.
          log.debug('settings', 'Empty user_code from signIn — waiting for device code event or auth completion');
          if (!authCompleted.current) {
            // Wait up to 10 seconds for either the device code event or auth completion
            for (let i = 0; i < 20; i++) {
              await new Promise((r) => setTimeout(r, 500));
              if (!active || authCompleted.current || deviceCodeReceivedRef.current) {
                log.debug('settings', 'Wait resolved', { authCompleted: authCompleted.current, deviceCodeReceived: deviceCodeReceivedRef.current });
                return;
              }
            }
            if (!active) return;
            // Still nothing — show error
            log.error('settings', 'Timed out waiting for device code after signIn returned empty');
            setError('Sign-in timed out waiting for device code. You may already be authenticated — try removing and re-adding the connection.');
            setPhase('error');
          }
          return;
        }

        log.debug('settings', 'Got device code from signIn result', { userCode: result.user_code });
        setDeviceCode(result.user_code);
        setPhase('device_code');
        // Auto-copy code to clipboard so it's ready when user opens GitHub
        navigator.clipboard.writeText(result.user_code).catch(() => {});
      } catch (err) {
        if (!active) return;
        await endRetry();
        const msg = err instanceof Error ? err.message : String(err);
        log.error('settings', 'Copilot connection error', { error: msg });
        setError(msg);
        setPhase('error');
      }
    })();

    return () => {
      active = false;
    };
  }, [retryCount, completeAuth]);

  // Note: no LSP cleanup on unmount — useCopilotCompletion manages the lifecycle.
  // Stopping here would race with the hook restarting the LSP.

  const handleRetry = useCallback(() => {
    isRetryRef.current = true;
    setRetrying(true);
    setRetryCount((c) => c + 1);
  }, []);

  const handleCopyCode = useCallback(() => {
    if (deviceCode) {
      navigator.clipboard.writeText(deviceCode).then(
        () => {
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        },
        () => {}
      );
    }
  }, [deviceCode]);

  return (
    <div className="p-4 space-y-3">
      <div className="flex items-center gap-2">
        <CopilotIcon className="w-5 h-5 shrink-0" />
        <span className="text-sm font-medium">{option.label}</span>
      </div>

      {phase === 'checking' && (
        <div className="flex items-center gap-2.5 py-3">
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" strokeWidth={1.5} />
          <span className="text-sm text-muted-foreground">
            Checking for copilot-language-server...
          </span>
        </div>
      )}

      {phase === 'not_installed' && (
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">
            {option.label} wasn't found on your system. Follow the steps below to install it.
          </p>
          <SetupGuideView guide={getInstallGuide('copilot-language-server')} />
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={onBack} className="flex-1">
              Back
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleRetry}
              disabled={retrying}
              className="flex-1"
            >
              <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${retrying ? 'animate-spin' : ''}`} strokeWidth={1.5} />
              Retry
            </Button>
          </div>
        </div>
      )}

      {phase === 'signing_in' && (
        <div className="flex items-center gap-2.5 py-3">
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" strokeWidth={1.5} />
          <span className="text-sm text-muted-foreground">Starting Copilot...</span>
        </div>
      )}

      {phase === 'device_code' && deviceCode && (
        <div className="space-y-3">
          <div className="p-3 rounded-lg bg-muted/50 border border-border text-center">
            <p className="text-xs text-muted-foreground mb-2">
              Enter this code on GitHub:
            </p>
            <div className="flex items-center justify-center gap-2">
              <span className="text-2xl font-mono font-bold tracking-widest">
                {deviceCode}
              </span>
              <button
                onClick={handleCopyCode}
                className="p-1 rounded hover:bg-muted transition-colors"
                title="Copy code"
              >
                {copied ? (
                  <Check className="h-4 w-4 text-foreground" strokeWidth={2} />
                ) : (
                  <Copy className="h-4 w-4 text-muted-foreground" strokeWidth={1.5} />
                )}
              </button>
            </div>
            <p className="text-xs text-muted-foreground mt-2">
              {copied ? 'Copied!' : 'Copied to clipboard — click icon to copy again'}
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={onBack} className="flex-1">
              Back
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={async () => {
                // Trigger finishDeviceFlow (starts OAuth polling + opens browser)
                invoke('copilot_lsp_finish_auth').catch(() => {});
                // Also open the page ourselves in case the LSP's open fails
                window.open('https://github.com/login/device', '_blank');
              }}
              className="flex-1"
            >
              <CopilotIcon className="h-3.5 w-3.5 mr-1.5" />
              Open GitHub
            </Button>
          </div>
          <p className="text-xs text-muted-foreground text-center">
            Waiting for authentication...
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
              onClick={handleRetry}
              disabled={retrying}
              className="flex-1"
            >
              <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${retrying ? 'animate-spin' : ''}`} strokeWidth={1.5} />
              Retry
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

// --- Connection timeout helper ---

const CONNECTION_TIMEOUT_MS = 120_000;

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${ms / 1000}s`)), ms)
    ),
  ]);
}

// --- Agent connection flow ---

type AgentPhase = 'checking' | 'not_installed' | 'installing' | 'not_authenticated' | 'connecting' | 'authenticating' | 'connected' | 'error';

function ConnectAgent({
  option,
  onBack,
  onConnected,
}: {
  option: ProviderOption;
  onBack: () => void;
  onConnected: (option: ProviderOption, envVars?: Record<string, string>) => void;
}) {
  const [phase, setPhase] = useState<AgentPhase>('checking');
  const [error, setError] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);
  const [retrying, setRetrying] = useState(false);
  const [installProgress, setInstallProgress] = useState<{ phase: string; progress: number; total: number; message: string } | null>(null);
  const [showManualGuide, setShowManualGuide] = useState(false);
  const [binarySource, setBinarySource] = useState<'managed' | 'system' | null>(null);
  const [apiKeyInput, setApiKeyInput] = useState('');
  const isRetryRef = useRef(false);
  const onConnectedRef = useRef(onConnected);
  onConnectedRef.current = onConnected;

  useEffect(() => {
    let active = true;
    const binary = option.agentBinary!;
    const isRetry = isRetryRef.current;
    isRetryRef.current = false;
    const retryStart = isRetry ? Date.now() : 0;
    const endRetry = async () => {
      if (!isRetry) return;
      const elapsed = Date.now() - retryStart;
      if (elapsed < 600) await new Promise((r) => setTimeout(r, 600 - elapsed));
      setRetrying(false);
    };

    (async () => {
      // On retry, keep showing current guide — only reset on first load
      if (!isRetry) {
        setPhase('checking');
      }
      setError(null);

      try {
        const avail = await withTimeout(
          invoke<{ installed: boolean; path: string | null; authenticated: boolean | null }>('acp_agent_check_availability', {
            agentId: binary,
          }),
          CONNECTION_TIMEOUT_MS,
          'Availability check',
        );
        if (!active) return;
        await endRetry();

        // Also check binary source via new resolver
        try {
          const resolution = await invoke<{ path: string; source: string; version: string | null } | null>('agent_resolve_binary', { agentId: binary });
          if (resolution) {
            setBinarySource(resolution.source as 'managed' | 'system');
          }
        } catch {
          // Non-critical — source tracking is informational
        }

        if (!avail.installed) {
          setPhase('not_installed');
          return;
        }
        // If not authenticated, check if this agent can handle in-app auth.
        // Some agents (e.g., Gemini) try to open a browser from the subprocess
        // which fails silently. For those, show the manual guide immediately.
        if (avail.authenticated === false) {
          // Agents whose OAuth flow requires browser access from the subprocess
          // can't authenticate via ACP — show manual guide directly
          const needsManualAuth = ['gemini'];
          if (needsManualAuth.includes(binary)) {
            setPhase('not_authenticated');
            return;
          }
        }
      } catch (err) {
        if (!active) return;
        await endRetry();
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes('timed out')) {
          setError(msg);
          setPhase('error');
        } else {
          setPhase('not_installed');
        }
        return;
      }

      // Phase 2: Spawn agent and authenticate
      await endRetry();
      setPhase('connecting');
      let instanceId: string | null = null;

      try {
        const result = await withTimeout(
          invoke<{ instance_id: string }>('acp_agent_spawn', {
            agentBinary: binary,
            agentArgs: option.agentArgs ?? null,
            role: 'interactive',
            workingDirectory: '/tmp',
          }),
          CONNECTION_TIMEOUT_MS,
          'Connection',
        );
        if (!active) {
          invoke('acp_agent_stop', { instanceId: result.instance_id }).catch(() => {});
          return;
        }
        instanceId = result.instance_id;

        // Switch to authenticating phase — the agent may open a browser
        setPhase('authenticating');

        // Try to authenticate — some agents handle auth internally.
        // Use a shorter timeout (30s) since if the agent can't open a browser,
        // waiting longer won't help.
        try {
          await withTimeout(
            invoke('acp_agent_authenticate', { instanceId }),
            30_000,
            'Authentication',
          );
        } catch (authErr) {
          const msg = String(authErr);
          if (!msg.toLowerCase().includes('not implemented')) {
            throw authErr;
          }
        }
        if (!active) {
          invoke('acp_agent_stop', { instanceId }).catch(() => {});
          return;
        }

        invoke('acp_agent_stop', { instanceId }).catch(() => {});

        setPhase('connected');
        onConnectedRef.current(option);
      } catch (err) {
        if (instanceId) {
          invoke('acp_agent_stop', { instanceId }).catch(() => {});
        }
        if (!active) return;
        // If spawn/auth failed, show the manual auth guide instead of a generic error
        // so users know exactly what to run
        setError(err instanceof Error ? err.message : String(err));
        setPhase('not_authenticated');
      }
    })();

    return () => { active = false; };
  }, [option, retryCount]);

  const binary = option.agentBinary!;
  const canManagedInstall = !!option.installMeta;

  const handleRetry = useCallback(() => {
    isRetryRef.current = true;
    setRetrying(true);
    setRetryCount((c) => c + 1);
  }, []);

  const handleManagedInstall = useCallback(async () => {
    setPhase('installing');
    setInstallProgress(null);
    setError(null);

    const unlisten = await listen<{ agent_id: string; phase: string; progress: number; total: number; message: string }>(
      'agent-install-progress',
      (event) => {
        if (event.payload.agent_id === binary) {
          setInstallProgress(event.payload);
        }
      },
    );

    try {
      await invoke('agent_install', { agentId: binary });
      setBinarySource('managed');
      // Trigger retry to proceed through the connection flow
      isRetryRef.current = true;
      setRetryCount((c) => c + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPhase('error');
    } finally {
      unlisten();
    }
  }, [binary]);

  const retryButton = (
    <Button
      variant="outline"
      size="sm"
      onClick={handleRetry}
      disabled={retrying}
      className="flex-1"
    >
      <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${retrying ? 'animate-spin' : ''}`} strokeWidth={1.5} />
      Retry
    </Button>
  );

  return (
    <div className="p-4 space-y-3">
      <div className="flex items-center gap-2">
        <ProviderLogo provider={option.provider} className="w-5 h-5 shrink-0" />
        <span className="text-sm font-medium">{option.label}</span>
        {binarySource && phase === 'connected' && (
          <span className="text-[10px] text-muted-foreground px-1.5 py-0.5 rounded border border-border">
            {binarySource === 'managed' ? 'Managed' : 'System'}
          </span>
        )}
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
          <p className="text-xs text-muted-foreground">
            {option.label} wasn't found on your system.
          </p>

          {canManagedInstall && !showManualGuide && (
            <>
              <Button
                size="sm"
                onClick={handleManagedInstall}
                className="w-full"
              >
                <Download className="h-3.5 w-3.5 mr-1.5" strokeWidth={1.5} />
                Install {option.label}
              </Button>
              <button
                onClick={() => setShowManualGuide(true)}
                className="text-xs text-muted-foreground hover:text-foreground transition-colors cursor-pointer w-full text-center"
              >
                or install manually
              </button>
            </>
          )}

          {(!canManagedInstall || showManualGuide) && (
            <>
              <SetupGuideView guide={getInstallGuide(binary)} />
              {canManagedInstall && showManualGuide && (
                <button
                  onClick={() => setShowManualGuide(false)}
                  className="text-xs text-muted-foreground hover:text-foreground transition-colors cursor-pointer w-full text-center"
                >
                  or install automatically
                </button>
              )}
            </>
          )}

          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={onBack} className="flex-1">
              Back
            </Button>
            {retryButton}
          </div>
        </div>
      )}

      {phase === 'installing' && (
        <div className="space-y-3 py-2">
          <div className="flex items-center gap-2.5">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" strokeWidth={1.5} />
            <span className="text-sm text-muted-foreground">
              {installProgress?.message || 'Preparing install...'}
            </span>
          </div>
          {installProgress && installProgress.total > 0 && (
            <Progress
              value={installProgress.total > 0 ? (installProgress.progress / installProgress.total) * 100 : 0}
              className="h-1.5"
            />
          )}
          <p className="text-[10px] text-muted-foreground capitalize">
            {installProgress?.phase || 'initializing'}
          </p>
        </div>
      )}

      {phase === 'not_authenticated' && (
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">
            {option.label} is installed but needs sign-in.
          </p>
          {error && (
            <div className="p-2 rounded-lg bg-destructive/10 border border-destructive/20">
              <p className="text-xs text-destructive/80 break-words">{error}</p>
            </div>
          )}

          {/* Gemini: show API key input (best in-app UX) + terminal fallback */}
          {binary === 'gemini' ? (
            <>
              <div className="space-y-2">
                <Input
                  type="password"
                  placeholder="Paste your Gemini API key"
                  value={apiKeyInput}
                  onChange={(e) => setApiKeyInput(e.target.value)}
                  className="text-sm h-8"
                />
                <Button
                  size="sm"
                  className="w-full"
                  disabled={!apiKeyInput.trim()}
                  onClick={() => {
                    onConnectedRef.current(option, { GEMINI_API_KEY: apiKeyInput.trim() });
                  }}
                >
                  Connect with API key
                </Button>
                <p className="text-[11px] text-muted-foreground text-center">
                  Free API key from{' '}
                  <button
                    className="underline hover:text-foreground transition-colors cursor-pointer"
                    onClick={() => window.open('https://aistudio.google.com/apikey', '_blank')}
                  >
                    Google AI Studio
                  </button>
                </p>
              </div>
              <div className="relative py-1">
                <div className="absolute inset-0 flex items-center">
                  <span className="w-full border-t border-border" />
                </div>
                <div className="relative flex justify-center text-[10px]">
                  <span className="bg-background px-2 text-muted-foreground">or</span>
                </div>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="w-full"
                onClick={async () => {
                  try {
                    await invoke('run_in_terminal', { command: 'cd /tmp && gemini' });
                  } catch {
                    navigator.clipboard.writeText('cd /tmp && gemini').catch(() => {});
                  }
                }}
              >
                Sign in with Google via Terminal
              </Button>
              <p className="text-[11px] text-muted-foreground text-center">
                Opens Terminal for Google OAuth sign-in. Click Retry when done.
              </p>
            </>
          ) : (
            /* Other agents: terminal sign-in button */
            <>
              <Button
                size="sm"
                className="w-full"
                onClick={async () => {
                  const guide = getAuthGuide(binary);
                  const cmd = guide.steps.find((s) => s.command)?.command;
                  if (cmd) {
                    try {
                      await invoke('run_in_terminal', { command: cmd });
                    } catch {
                      if (cmd) navigator.clipboard.writeText(cmd).catch(() => {});
                    }
                  }
                }}
              >
                Sign in to {option.label}
              </Button>
              <p className="text-[11px] text-muted-foreground text-center">
                Opens a terminal window to complete sign-in. Click Retry when done.
              </p>
            </>
          )}

          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={onBack} className="flex-1">
              Back
            </Button>
            {retryButton}
          </div>
        </div>
      )}

      {phase === 'connecting' && (
        <div className="space-y-2 py-2">
          <div className="flex items-center gap-2.5">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" strokeWidth={1.5} />
            <span className="text-sm text-muted-foreground">Starting agent...</span>
          </div>
        </div>
      )}

      {phase === 'authenticating' && (
        <div className="space-y-2 py-2">
          <div className="flex items-center gap-2.5">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" strokeWidth={1.5} />
            <span className="text-sm text-muted-foreground">Waiting for sign-in...</span>
          </div>
          <p className="text-xs text-muted-foreground pl-6.5">
            A browser window should open. Complete sign-in there, then return here.
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
                  {phase === 'error' && installProgress ? 'Install failed' : 'Connection failed'}
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
            {retryButton}
          </div>
        </div>
      )}
    </div>
  );
}

// --- Setup guide types and data ---

interface GuideStep {
  label?: string;
  command?: string;
  note?: string;
  url?: string;
}

interface SetupGuide {
  title: string;
  steps: GuideStep[];
}

function getInstallGuide(binary: string): SetupGuide {
  switch (binary) {
    case 'claude-agent-acp':
      return {
        title: 'Install Claude Code',
        steps: [
          { label: 'Install Node.js if you don\'t have it', url: 'https://nodejs.org' },
          { label: 'Run in your terminal:', command: 'npm install -g @zed-industries/claude-agent-acp' },
          { label: 'Requires a Claude Pro or Max subscription', url: 'https://anthropic.com/claude' },
        ],
      };
    case 'codex-acp':
    case 'codex':
      return {
        title: 'Install OpenAI Codex',
        steps: [
          { label: 'Install Node.js if you don\'t have it', url: 'https://nodejs.org' },
          { label: 'Run in your terminal:', command: 'npm install -g @zed-industries/codex-acp' },
          { label: 'Requires a ChatGPT Plus or Pro subscription' },
        ],
      };
    case 'copilot':
      return {
        title: 'Install GitHub Copilot CLI',
        steps: [
          { label: 'Install Node.js if you don\'t have it', url: 'https://nodejs.org' },
          { label: 'Run in your terminal:', command: 'npm install -g @github/copilot' },
          { label: 'Requires a GitHub Copilot subscription', url: 'https://github.com/features/copilot' },
        ],
      };
    case 'gemini':
      return {
        title: 'Install Google Gemini CLI',
        steps: [
          { label: 'Install Node.js if you don\'t have it', url: 'https://nodejs.org' },
          { label: 'Run in your terminal:', command: 'npm install -g @google/gemini-cli' },
          { label: 'Free with a Google account', url: 'https://github.com/google-gemini/gemini-cli' },
        ],
      };
    case 'copilot-language-server':
      return {
        title: 'Install Copilot Language Server',
        steps: [
          { label: 'Install Node.js if you don\'t have it', url: 'https://nodejs.org' },
          { label: 'Run in your terminal:', command: 'npm install -g @github/copilot-language-server' },
          { label: 'Requires a GitHub Copilot subscription', url: 'https://github.com/features/copilot' },
        ],
      };
    default:
      return {
        title: `Install ${binary}`,
        steps: [
          { label: `Install "${binary}" to continue` },
        ],
      };
  }
}

function getAuthGuide(binary: string): SetupGuide {
  switch (binary) {
    case 'claude-agent-acp':
      return {
        title: 'Sign in to Claude',
        steps: [
          { label: 'Run in your terminal:', command: 'claude auth login' },
          { label: 'A browser window will open for sign-in', note: 'Requires Claude Pro or Max subscription' },
        ],
      };
    case 'codex-acp':
    case 'codex':
      return {
        title: 'Sign in to OpenAI',
        steps: [
          { label: 'Run in your terminal:', command: 'codex login --device-auth' },
          { note: 'Requires ChatGPT Plus or Pro subscription' },
        ],
      };
    case 'copilot':
      return {
        title: 'Sign in to GitHub',
        steps: [
          { label: 'Run in your terminal:', command: 'copilot auth login' },
          { note: 'Requires a GitHub Copilot subscription' },
        ],
      };
    case 'gemini':
      return {
        title: 'Sign in to Google',
        steps: [
          { label: 'Option 1 — Run Gemini CLI to sign in via browser:', command: 'cd /tmp && gemini' },
          { note: 'Choose "Sign in with Google" when prompted, complete sign-in in browser, then close the terminal session' },
          { label: 'Option 2 — Use an API key:', command: 'export GEMINI_API_KEY=your-key-here' },
          { note: 'Get a free API key from', url: 'https://aistudio.google.com/apikey' },
        ],
      };
    default:
      return {
        title: `Sign in to ${binary}`,
        steps: [
          { label: `Sign in to "${binary}" before connecting` },
        ],
      };
  }
}

// --- Setup guide UI components ---

function CopyableCommand({ command }: { command: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(command).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch(() => {});
  }, [command]);

  return (
    <div className="flex items-center gap-1.5 mt-1 rounded-md bg-muted/50 border border-border px-2.5 py-1.5 font-mono text-xs">
      <span className="flex-1 overflow-x-auto whitespace-nowrap select-all">{command}</span>
      <button
        onClick={handleCopy}
        className="shrink-0 p-0.5 rounded hover:bg-muted transition-colors cursor-pointer"
        title="Copy to clipboard"
      >
        {copied ? (
          <Check className="h-3.5 w-3.5 text-green-500" strokeWidth={1.5} />
        ) : (
          <Copy className="h-3.5 w-3.5 text-muted-foreground" strokeWidth={1.5} />
        )}
      </button>
    </div>
  );
}

function CopyableUrl({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch(() => {});
  }, [url]);

  return (
    <div className="flex items-center gap-1.5 mt-1">
      <span className="text-xs text-muted-foreground select-all truncate">{url}</span>
      <button
        onClick={handleCopy}
        className="shrink-0 p-0.5 rounded hover:bg-muted transition-colors cursor-pointer"
        title="Copy URL"
      >
        {copied ? (
          <Check className="h-3 w-3 text-green-500" strokeWidth={1.5} />
        ) : (
          <Copy className="h-3 w-3 text-muted-foreground" strokeWidth={1.5} />
        )}
      </button>
    </div>
  );
}

function SetupGuideView({ guide }: { guide: SetupGuide }) {
  return (
    <div className="rounded-lg border border-border bg-muted/30 p-3">
      <ol className="space-y-2.5">
        {guide.steps.map((step, i) => (
          <li key={i} className="flex gap-2">
            <span className="text-xs text-muted-foreground font-medium mt-0.5 shrink-0 w-4 text-right">
              {step.label || step.note ? `${i + 1}.` : ''}
            </span>
            <div className="flex-1 min-w-0">
              {step.label && (
                <p className="text-sm text-foreground">{step.label}</p>
              )}
              {step.command && <CopyableCommand command={step.command} />}
              {step.url && <CopyableUrl url={step.url} />}
              {step.note && (
                <p className="text-xs text-muted-foreground mt-0.5 italic">{step.note}</p>
              )}
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
