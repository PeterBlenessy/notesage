import { useState, useCallback, useEffect, useRef } from 'react';
import { useConnectionsStore } from '@/stores/connections-store';
import { useRoutingStore } from '@/stores/routing-store';
import { stopAcpAgent } from '@/hooks/useAIOperations';
import { probeAcpCapabilities, isLocalAgentPreset } from '@/lib/ai/acp-agent-state';
import { log } from '@/lib/logger';
import { toast } from 'sonner';
import { ConnectionCard } from './ConnectionCard';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
import { Plus, Check, Eye, EyeOff, RefreshCw, ShieldCheck } from 'lucide-react';
import { useLocalAIStore } from '@/stores/local-ai-store';
import { cn } from '@/lib/utils';
import { ProviderLogo } from '@/components/ProviderLogo';
import { ConnectionConfigDialog } from './ConnectionConfigDialog';
import { ConnectCopilotLsp } from './ConnectCopilotLsp';
import { ConnectAgent } from './ConnectAgent';
import { ConnectCustomAgent } from './ConnectCustomAgent';
import type { Connection, ProviderOption } from '@/lib/ai/connections';
import { PROVIDER_OPTIONS } from '@/lib/ai/connections';
import { invoke } from '@tauri-apps/api/core';

type AddFlowState =
  | { step: 'pick' }
  | { step: 'configure'; option: ProviderOption }
  | { step: 'connecting'; option: ProviderOption }
  | { step: 'custom' };

export function ConnectionsSettings({ onNavigateToTab }: { onNavigateToTab?: (tab: string) => void } = {}) {
  const connections = useConnectionsStore((s) => s.connections);
  const addConnection = useConnectionsStore((s) => s.addConnection);
  const updateConnection = useConnectionsStore((s) => s.updateConnection);
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
  // Tracks the deferred popover-open timer so it can be cleared on unmount
  // (review Low #5 — avoids a setState after unmount if the dialog closes
  // within the 100 ms delay window).
  const customAgentTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (customAgentTimerRef.current) clearTimeout(customAgentTimerRef.current);
    },
    [],
  );
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

  const openLocalAgentSetup = useLocalAIStore((s) => s.setLocalAgentSetupDialogOpen);
  // Whether the Local Agent preset is already set up (#19 shows ready state).
  const localAgentReady = connections.some(
    (c) => c.provider === 'custom_acp' && c.config?.localAgentPreset === 'goose',
  );
  const handlePickLocalAgent = useCallback(() => {
    openLocalAgentSetup(true);
  }, [openLocalAgentSetup]);

  const handlePickCustomAgent = useCallback(() => {
    setFlow({ step: 'custom' });
    // Delay popover open so it doesn't race with the dropdown close animation
    if (customAgentTimerRef.current) clearTimeout(customAgentTimerRef.current);
    customAgentTimerRef.current = setTimeout(() => {
      setPopoverOpen(true);
      popoverOpenedAt.current = Date.now();
    }, 100);
  }, []);

  // `registerCustomAcpConnection` already persisted the connection (probe-first);
  // this callback only routes it and closes the flow.
  const handleCustomAgentConnected = useCallback(
    (connectionId: string) => {
      autoAssign(connectionId);
      resetFlow();
    },
    [autoAssign, resetFlow]
  );

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
      autoAssign(connectionId);

      // Probe capabilities in background (non-blocking — populates acpCapabilities for config dialog)
      if (!option.lspBinary) {
        const conn = useConnectionsStore.getState().getConnection(connectionId);
        if (conn) {
          probeAcpCapabilities(conn).then((caps) => {
            updateConnection(connectionId, { acpCapabilities: caps });
          }).catch((err) => {
            log.warn('ai', `ACP capability probe failed for ${option.label}: ${String(err)}`);
          });
        }
      }

      setTimeout(() => resetFlow(), 600);
    },
    [addConnection, autoAssign, resetFlow, updateConnection]
  );

  const handleDisconnect = useCallback(
    (connection: Connection) => {
      if (connection.authMethod === 'agent_managed') {
        stopAcpAgent();
      }
      clearRoutingForConnection(connection.id);
      removeConnection(connection.id);
      // Removing the Local Agent preset MUST reset its setup state machine.
      // `localAgentSetup.stage` is persisted, so without this the prior
      // `stage: 'ready'` survives the removal — re-opening the setup dialog then
      // shows the completed/"Done" state (which only closes, never re-running
      // the `configuring` stage that creates the connection), so the agent can
      // never be re-added after removal.
      if (isLocalAgentPreset(connection)) {
        useLocalAIStore.getState().resetLocalAgentSetup();
      }
    },
    [clearRoutingForConnection, removeConnection]
  );

  return (
    <div className="space-y-2">
      {/* "+ Add" then refresh icon — order matches the Skills section
          pattern. Refresh triggers the existing managed-agent update
          check. The panel header ("Connections" + description) is
          owned by the v2 AISettings wrapper. */}
      <div className="flex items-center justify-end gap-1.5">
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
                <Button variant="ghost" size="sm" className="shrink-0">
                  <Plus className="h-3.5 w-3.5 mr-1" strokeWidth={1.5} />
                  Add
                </Button>
              </DropdownMenuTrigger>
            </PopoverAnchor>
            <DropdownMenuContent align="end" className="w-96">
              {/* "Local" group at the top — on-device options, no account
                  needed. Order: Local Agent (recommended, task #19), then Local
                  AI (bundled), then Ollama. */}
              <DropdownMenuGroup>
                <DropdownMenuLabel className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  Local
                </DropdownMenuLabel>
                <DropdownMenuItem
                  className="relative flex items-start gap-2.5 py-2 cursor-pointer"
                  onSelect={handlePickLocalAgent}
                >
                  <ShieldCheck
                    className="w-5 h-5 mt-0.5 shrink-0 text-[var(--color-accent-primary)]"
                    strokeWidth={1.5}
                  />
                  <div className="flex-1 min-w-0">
                    <span className="text-sm font-medium block truncate">Local Agent</span>
                    <span className="text-xs text-muted-foreground block truncate">
                      {localAgentReady
                        ? 'Private on-device agent — set up'
                        : 'Private AI — the model runs on your device, no API keys'}
                    </span>
                    <span className="text-[10px] text-muted-foreground block truncate">
                      Powered by Goose, an open-source agent from the Agentic AI Foundation (AAIF)
                    </span>
                  </div>
                  {localAgentReady && (
                    <Check className="h-3.5 w-3.5 mt-0.5 text-muted-foreground shrink-0" strokeWidth={1.5} />
                  )}
                </DropdownMenuItem>
                {/* Local AI (local_bundled) before Ollama (local). */}
                {PROVIDER_OPTIONS
                  .filter((o) => o.authMethod === 'local' || o.authMethod === 'local_bundled')
                  .sort((a, b) => (a.authMethod === 'local_bundled' ? 0 : 1) - (b.authMethod === 'local_bundled' ? 0 : 1))
                  .map((option) => {
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
                  Custom
                </DropdownMenuLabel>
                {/* Custom agents deliberately have no PROVIDER_OPTIONS entry —
                    managed install/update/allowlist surfaces must never match
                    them (locked by useAcpLifecycle.custom-agent.test.ts). */}
                <DropdownMenuItem
                  className="relative flex items-start gap-2.5 py-1.5 cursor-pointer"
                  onSelect={handlePickCustomAgent}
                >
                  <ProviderLogo provider="custom_acp" className="w-5 h-5 mt-0.5 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <span className="text-sm font-medium block truncate">Custom Agent</span>
                    <span className="text-xs text-muted-foreground block truncate">
                      Bring your own ACP-compatible agent binary
                    </span>
                  </div>
                </DropdownMenuItem>
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
            {flow.step === 'custom' && (
              <ConnectCustomAgent
                onBack={handleBack}
                onConnected={handleCustomAgentConnected}
              />
            )}
          </PopoverContent>
        </Popover>
        {/* Refresh icon — sibling of Add, matches the Skills section
            pattern. Triggers the existing managed-agent update
            check (replaces the standalone "Check for updates" link
            that used to live below the connection list). */}
        <Button
          variant="ghost"
          size="sm"
          onClick={() => checkForUpdates(true)}
          disabled={checkingUpdates}
          title="Check for agent updates"
          aria-label="Check for agent updates"
        >
          <RefreshCw
            className={cn(
              'h-3.5 w-3.5',
              checkingUpdates && 'animate-spin',
            )}
            strokeWidth={1.5}
          />
        </Button>
      </div>

      {/* Connection list */}
      {connections.length > 0 ? (
        <div className="space-y-2">
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
                {showKey ? <EyeOff className="h-4 w-4" strokeWidth={1.5} /> : <Eye className="h-4 w-4" strokeWidth={1.5} />}
              </Button>
            )}
          </div>
          <Button onClick={onSave} size="sm" disabled={!canSave}>
            <Check
              className={`h-4 w-4 mr-1 transition-colors ${savedFlash ? 'text-[var(--color-accent-primary)]' : ''}`}
              strokeWidth={1.5}
            />
            Save
          </Button>
        </div>
      </div>
    </div>
  );
}

