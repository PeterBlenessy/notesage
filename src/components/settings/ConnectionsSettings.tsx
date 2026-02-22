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
import { Plus, Check, Eye, EyeOff, Loader2, AlertCircle, RefreshCw, Copy } from 'lucide-react';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { ProviderLogo } from '@/components/ProviderLogo';
import type { Connection, ProviderOption } from '@/lib/ai/connections';
import { PROVIDER_OPTIONS, CAPABILITY_LABELS, ROUTING_SLOT_LABELS } from '@/lib/ai/connections';
import { invoke } from '@tauri-apps/api/core';

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
    if (option.lspBinary || option.authMethod === 'agent_managed') {
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
      const credentials = option.lspBinary
        ? { type: 'agent_managed' as const, agentBinary: option.lspBinary }
        : {
            type: 'agent_managed' as const,
            agentBinary: option.agentBinary!,
            ...(option.agentArgs ? { agentArgs: option.agentArgs } : {}),
          };

      const connectionId = addConnection({
        provider: option.provider,
        authMethod: 'agent_managed',
        status: 'connected',
        label: option.label,
        credentials,
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
          <PopoverContent align="end" className="w-96 p-0">
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
            {flow.step === 'connecting' && flow.option.lspBinary && (
              <ConnectCopilotLsp
                option={flow.option}
                onBack={() => setFlow({ step: 'pick' })}
                onConnected={handleAgentConnected}
              />
            )}
            {flow.step === 'connecting' && !flow.option.lspBinary && (
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
            <ProviderPickerItem key={`${option.provider}-${option.authMethod}-${option.label}`} option={option} onPick={onPick} />
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
            <ProviderPickerItem key={`${option.provider}-${option.authMethod}-${option.label}`} option={option} onPick={onPick} />
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
  const onConnectedRef = useRef(onConnected);
  onConnectedRef.current = onConnected;

  // Listen for auth completion via didChangeStatus — attach BEFORE starting LSP
  // so we don't miss early "Normal" events from cached credentials.
  // Guard: onConnected must only be called ONCE per attempt.
  const authCompleted = useRef(false);

  const completeAuth = useCallback(() => {
    if (authCompleted.current) return; // already fired
    authCompleted.current = true;
    console.log('[copilot-lsp-ui] Auth succeeded, completing connection (once)');
    setPhase('connected');
    // Don't stop the LSP here — useCopilotCompletion will restart it with
    // the correct working directory. Stopping here races with the hook's start.
    onConnectedRef.current(option);
  }, [option]);

  useEffect(() => {
    authCompleted.current = false;

    const unlisten = listen<{ message: string; kind: string }>(
      'copilot-status-changed',
      (event) => {
        const { message, kind } = event.payload;
        console.log('[copilot-lsp-ui] status changed:', kind, message);
        if (kind === 'Normal') {
          completeAuth();
        }
      }
    );

    return () => {
      unlisten.then((fn) => fn());
    };
  }, [completeAuth, retryCount]);

  // Check binary availability, start LSP, and sign in
  useEffect(() => {
    let active = true;

    (async () => {
      setPhase('checking');
      setError(null);

      try {
        console.log('[copilot-lsp-ui] Checking binary availability...');
        const available = await invoke<boolean>('copilot_lsp_check_availability');
        console.log('[copilot-lsp-ui] Binary available:', available);
        if (!active) return;

        if (!available) {
          setPhase('not_installed');
          return;
        }

        // Binary found — start LSP and sign in
        setPhase('signing_in');

        console.log('[copilot-lsp-ui] Starting LSP...');
        await invoke('copilot_lsp_start', { workingDirectory: '/tmp' });
        console.log('[copilot-lsp-ui] LSP started');
        if (!active) return;

        // Check if already authenticated (status event arrived during init)
        if (authCompleted.current) {
          console.log('[copilot-lsp-ui] Already authenticated during LSP init, skipping signIn');
          return;
        }

        // Check status before attempting sign-in
        console.log('[copilot-lsp-ui] Checking LSP status...');
        try {
          const status = await invoke<{ authenticated: boolean; message: string; kind: string }>(
            'copilot_lsp_status'
          );
          console.log('[copilot-lsp-ui] LSP status:', JSON.stringify(status));
          if (!active) return;

          if (status.authenticated) {
            completeAuth();
            return;
          }
        } catch (statusErr) {
          console.log('[copilot-lsp-ui] Status check failed (non-fatal):', statusErr);
        }

        console.log('[copilot-lsp-ui] Calling signIn...');
        const result = await invoke<{ user_code: string; verification_uri: string }>(
          'copilot_lsp_sign_in'
        );
        console.log('[copilot-lsp-ui] signIn result:', JSON.stringify(result));
        if (!active) return;

        if (!result.user_code) {
          // Empty user code may mean already authenticated
          console.log('[copilot-lsp-ui] Empty user_code — may be already authenticated');
          if (!authCompleted.current) {
            // Give the status event a moment to arrive
            await new Promise((r) => setTimeout(r, 1000));
            if (authCompleted.current) return;
            // Still not authenticated — show error
            setError('Sign-in returned empty device code. You may already be authenticated — try removing and re-adding the connection.');
            setPhase('error');
          }
          return;
        }

        setDeviceCode(result.user_code);
        setPhase('device_code');
      } catch (err) {
        if (!active) return;
        const msg = err instanceof Error ? err.message : String(err);
        console.error('[copilot-lsp-ui] Error:', msg);
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

  const handleCopyCode = useCallback(() => {
    if (deviceCode) {
      navigator.clipboard.writeText(deviceCode).catch(() => {});
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
          <SetupGuideView guide={getInstallGuide('copilot-language-server')} />
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
            <button
              onClick={handleCopyCode}
              className="text-2xl font-mono font-bold tracking-widest cursor-pointer hover:opacity-70 transition-opacity"
              title="Click to copy"
            >
              {deviceCode}
            </button>
            <p className="text-xs text-muted-foreground mt-2">
              Click code to copy
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={onBack} className="flex-1">
              Back
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
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
          <SetupGuideView guide={getInstallGuide(binary)} />
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
          <SetupGuideView guide={getAuthGuide(binary)} />
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
          { label: 'Run in your terminal:', command: 'gemini auth login' },
          { note: 'Free with any Google account' },
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
    <div className="space-y-2.5">
      <p className="text-sm font-medium">{guide.title}</p>
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
