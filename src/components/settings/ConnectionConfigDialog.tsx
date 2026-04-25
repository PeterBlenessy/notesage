import { useState, useEffect, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { tauriApi } from '@/lib/tauri';
import { useConnectionsStore } from '@/stores/connections-store';
import { useLocalAIStore } from '@/stores/local-ai-store';
import { stopAcpAgent } from '@/hooks/useAIOperations';
import { stopTaskAgent } from '@/hooks/useAgentTaskOperations';
import type { Connection, ConnectionConfig, ReasoningEffort } from '@/lib/ai/connections';
import { DEFAULT_MODELS } from '@/lib/ai/connections';
import { ModelSelectionForm, MAX_TOKEN_PRESETS, nearestPresetIndex } from './connection/ModelSelectionForm';
import { ApiKeyForm } from './connection/ApiKeyForm';
import { AdvancedSettingsForm } from './connection/AdvancedSettingsForm';

interface ConnectionConfigDialogProps {
  connection: Connection | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onNavigateToTab?: (tab: string) => void;
}

const DEFAULT_URLS: Record<string, string> = {
  anthropic: 'https://api.anthropic.com',
  openai: 'https://api.openai.com',
  ollama: 'http://localhost:11434',
};

export function ConnectionConfigDialog({
  connection,
  open,
  onOpenChange,
  onNavigateToTab,
}: ConnectionConfigDialogProps) {
  const updateConnection = useConnectionsStore((s) => s.updateConnection);

  // Form state
  const [model, setModel] = useState('');
  const [temperature, setTemperature] = useState<number | null>(null);
  const [maxTokensIndex, setMaxTokensIndex] = useState<number | null>(null);
  const [baseUrl, setBaseUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [showApiKey, setShowApiKey] = useState(false);
  const [originalApiKey, setOriginalApiKey] = useState(''); // track keychain value to detect changes

  // Local AI server settings
  const [contextLength, setContextLength] = useState(4096);
  const [gpuLayers, setGpuLayers] = useState(-1);
  const [localModelId, setLocalModelId] = useState<string | null>(null);
  const localModels = useLocalAIStore((s) => s.models);
  const downloadedLocalModels = localModels.filter((m) => m.downloaded);

  // Sandbox state
  const [sandboxEnabled, setSandboxEnabled] = useState(true);
  const [extraWritablePaths, setExtraWritablePaths] = useState<string[]>([]);
  const [newWritablePath, setNewWritablePath] = useState('');

  // Reasoning effort (codex-acp) — undefined means "agent default" (no suffix appended)
  const [reasoningEffort, setReasoningEffort] = useState<ReasoningEffort | undefined>(undefined);

  // ACP defaults (mode and thinking effort from capability probe)
  const [acpDefaultMode, setAcpDefaultMode] = useState<string | undefined>(undefined);
  const [acpDefaultThinkingEffort, setAcpDefaultThinkingEffort] = useState<string | undefined>(undefined);

  // Network sandbox state
  const [networkSandbox, setNetworkSandbox] = useState(false);
  const [kernelNetworkDeny, setKernelNetworkDeny] = useState(true);
  const [newDomain, setNewDomain] = useState('');

  // Model list state
  const [models, setModels] = useState<string[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelsError, setModelsError] = useState<string | null>(null);
  const [modelPopoverOpen, setModelPopoverOpen] = useState(false);

  // Reset form when connection changes
  useEffect(() => {
    if (connection && open) {
      setModel(connection.config?.model ?? '');
      setTemperature(connection.config?.temperature ?? null);
      setMaxTokensIndex(
        connection.config?.maxTokens !== undefined
          ? nearestPresetIndex(connection.config.maxTokens)
          : null
      );
      setBaseUrl(connection.config?.baseUrl ?? '');
      if (connection.credentials.type === 'api_key') {
        // Load key from OS keychain (credentials.key is always empty after keychain migration)
        setApiKey('');
        setOriginalApiKey('');
        invoke<string | null>('get_credential', { service: `notesage:${connection.id}` })
          .then((key) => { if (key) { setApiKey(key); setOriginalApiKey(key); } })
          .catch(() => {});
      } else {
        setApiKey('');
      }
      setShowApiKey(false);
      setModels([]);
      setModelsError(null);
      setSandboxEnabled(connection.sandboxEnabled !== false); // default true for managed
      setExtraWritablePaths(connection.extraWritablePaths ?? []);
      setNewWritablePath('');
      setReasoningEffort(connection.config?.reasoningEffort ?? undefined);
      setAcpDefaultMode(connection.acpDefaults?.modeId ?? undefined);
      setAcpDefaultThinkingEffort(connection.acpDefaults?.thinkingEffort ?? undefined);
      setNetworkSandbox(connection.networkSandboxEnabled ?? false);
      setKernelNetworkDeny(connection.kernelNetworkDeny ?? false); // false for existing connections without the field
      setNewDomain('');

      // Local AI server settings
      if (connection.authMethod === 'local_bundled') {
        const localStore = useLocalAIStore.getState();
        setContextLength(localStore.contextLength);
        setGpuLayers(localStore.gpuLayers);
        setLocalModelId(localStore.activeModelId);
      }
    }
  }, [connection, open]);

  // Auto-probe ACP capabilities when opening config for agent_managed connections
  // with missing or stale (>24h) capabilities
  useEffect(() => {
    if (!connection || !open || connection.authMethod !== 'agent_managed') return;
    const caps = connection.acpCapabilities;
    const stale = !caps?.lastProbed || (Date.now() - caps.lastProbed > 24 * 60 * 60 * 1000);
    if (stale) {
      import('@/lib/ai/acp-agent-state').then(({ probeAcpCapabilities }) => {
        probeAcpCapabilities(connection).then((newCaps) => {
          updateConnection(connection.id, { acpCapabilities: newCaps });
        }).catch(() => {}); // Probe failure is non-blocking
      });
    }
  }, [connection, open, updateConnection]);

  const fetchModels = useCallback(async () => {
    if (!connection) return;

    setModelsLoading(true);
    setModelsError(null);

    try {
      const effectiveBaseUrl = baseUrl || connection.config?.baseUrl || undefined;

      const provider =
        connection.provider === 'openai_compatible' ? 'openai_compatible' : connection.provider;

      const result = await tauriApi.listModels(provider, connection.id, effectiveBaseUrl);
      setModels(result);
    } catch (err) {
      setModelsError(err instanceof Error ? err.message : String(err));
      setModels([]);
    } finally {
      setModelsLoading(false);
    }
  }, [connection, apiKey, baseUrl]);

  // Auto-fetch models when popover opens (not for local_bundled)
  useEffect(() => {
    if (modelPopoverOpen && models.length === 0 && !modelsLoading && !modelsError && connection?.authMethod !== 'local_bundled') {
      fetchModels();
    }
  }, [modelPopoverOpen, models.length, modelsLoading, modelsError, fetchModels, connection?.authMethod]);

  const hasCustomValues = temperature !== null || maxTokensIndex !== null;
  const isAgentManaged = connection?.authMethod === 'agent_managed';
  const isCodexAgent = (() => {
    const ab = connection?.credentials.type === 'agent_managed'
      ? (connection.credentials as { agentBinary: string }).agentBinary
      : '';
    return ab === 'codex-acp';
  })();

  const handleResetDefaults = () => {
    setTemperature(null);
    setMaxTokensIndex(null);
  };

  const handleSave = () => {
    if (!connection) return;

    const isLocalBundled = connection.authMethod === 'local_bundled';

    const config: ConnectionConfig = {};
    if (model.trim()) config.model = model.trim();
    if (temperature !== null) config.temperature = temperature;
    if (maxTokensIndex !== null) config.maxTokens = MAX_TOKEN_PRESETS[maxTokensIndex];
    if (baseUrl.trim()) config.baseUrl = baseUrl.trim();
    if (isCodexAgent && reasoningEffort && !connection.freeAccount) config.reasoningEffort = reasoningEffort;

    // Save ACP defaults (mode and thinking effort)
    const acpDefaults = (acpDefaultMode || acpDefaultThinkingEffort) ? {
      ...(acpDefaultMode ? { modeId: acpDefaultMode } : {}),
      ...(acpDefaultThinkingEffort ? { thinkingEffort: acpDefaultThinkingEffort } : {}),
    } : undefined;

    const updates: Partial<Connection> = {
      config: Object.keys(config).length > 0 ? config : undefined,
      acpDefaults: isAgentManaged ? acpDefaults : undefined,
      sandboxEnabled: isAgentManaged ? sandboxEnabled : undefined,
      networkSandboxEnabled: isAgentManaged ? (sandboxEnabled && networkSandbox) : undefined,
      kernelNetworkDeny: isAgentManaged ? (sandboxEnabled && networkSandbox && kernelNetworkDeny) : undefined,
      extraWritablePaths: isAgentManaged && sandboxEnabled && extraWritablePaths.length > 0
        ? extraWritablePaths : undefined,
    };

    // Update API key if changed — store in keychain, not in localStorage
    if (connection.credentials.type === 'api_key' && apiKey && apiKey !== originalApiKey) {
      invoke('store_credential', { service: `notesage:${connection.id}`, key: apiKey })
        .catch((e) => console.error('Failed to store updated credential:', e));
      updates.credentials = { type: 'api_key', credentialStored: true };
    }

    // Stop running agents so they re-spawn with new config (e.g. --model flag)
    if (isAgentManaged) {
      stopAcpAgent();
      stopTaskAgent();
    }

    // Persist local AI server settings and restart if changed
    if (isLocalBundled) {
      const localStore = useLocalAIStore.getState();
      const ctxChanged = contextLength !== localStore.contextLength;
      const gpuChanged = gpuLayers !== localStore.gpuLayers;
      const modelChanged = localModelId !== localStore.activeModelId;
      localStore.setContextLength(contextLength);
      localStore.setGpuLayers(gpuLayers);
      if (localModelId) localStore.setActiveModel(localModelId);
      // Server will auto-restart via useLocalAI effect when these change
      if (ctxChanged || gpuChanged || modelChanged) {
        // Force a server restart by stopping it — useLocalAI will re-start
        if (localStore.serverStatus === 'running') {
          tauriApi.stopLocalServer().catch(() => {});
          localStore.setServerStatus('stopped');
          localStore.setServerPort(null);
        }
      }
    }

    updateConnection(connection.id, updates);
    onOpenChange(false);
  };

  if (!connection) return null;

  const isLocalBundled = connection.authMethod === 'local_bundled';
  const showBaseUrl = !isLocalBundled && (connection.authMethod === 'api_key' || connection.provider === 'openai_compatible');
  const showApiKeyField = connection.credentials.type === 'api_key';
  const defaultModel = DEFAULT_MODELS[connection.provider] ?? '';
  const placeholderUrl = DEFAULT_URLS[connection.provider] ?? '';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/*
        Live-test 2026-04-25 #145 — chrome upgraded to v2 aesthetic.
        Was: 500 px max-width with `text-base` title and minimal
        header padding — looked clearly older than the v2 settings
        shell that opens it. Now: 640 px wide, 20 px semibold title
        with tracking-tight, generous 28 px header padding (matches
        KeyboardShortcutsDialogV2 / SettingsDialogV2 / ChangelogDialog).
        Body keeps its existing `space-y-5` rhythm but moves into a
        ScrollArea-style container with consistent 28 px horizontal
        padding so content lines up with the new header.
      */}
      <DialogContent
        className="max-w-[640px] p-0 gap-0"
        aria-describedby={undefined}
      >
        <DialogHeader className="px-7 pt-7 pb-3 border-b border-border">
          <DialogTitle className="text-[20px] font-semibold tracking-tight">
            Configure {connection.label}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-5 px-7 py-5 max-h-[70vh] overflow-y-auto">

          {/* ── Model Section ── */}
          <ModelSelectionForm
            connection={connection}
            model={model}
            onModelChange={setModel}
            temperature={temperature}
            onTemperatureChange={setTemperature}
            maxTokensIndex={maxTokensIndex}
            onMaxTokensIndexChange={setMaxTokensIndex}
            reasoningEffort={reasoningEffort}
            onReasoningEffortChange={setReasoningEffort}
            localModelId={localModelId}
            onLocalModelIdChange={setLocalModelId}
            downloadedLocalModels={downloadedLocalModels}
            contextLength={contextLength}
            onContextLengthChange={setContextLength}
            gpuLayers={gpuLayers}
            onGpuLayersChange={setGpuLayers}
            models={models}
            modelsLoading={modelsLoading}
            modelsError={modelsError}
            modelPopoverOpen={modelPopoverOpen}
            onModelPopoverOpenChange={setModelPopoverOpen}
            onFetchModels={fetchModels}
            defaultModel={defaultModel}
            onNavigateToTab={onNavigateToTab}
            onCloseDialog={() => onOpenChange(false)}
          />

          {/* ── ACP Agent Defaults (mode & thinking effort) ── */}
          {isAgentManaged && connection.acpCapabilities && (
            <div className="space-y-3">
              <Label className="text-sm font-semibold">Agent Defaults</Label>

              {/* Default Mode */}
              {connection.acpCapabilities.availableModes && connection.acpCapabilities.availableModes.length > 1 && (
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Default Mode</Label>
                  <Select
                    value={acpDefaultMode ?? connection.acpCapabilities.availableModes[0]?.id ?? ''}
                    onValueChange={setAcpDefaultMode}
                  >
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {connection.acpCapabilities.availableModes.map((mode) => (
                        <SelectItem key={mode.id} value={mode.id} className="text-xs">
                          <div>
                            <span>{mode.name}</span>
                            {mode.description && (
                              <span className="ml-2 text-muted-foreground">{mode.description}</span>
                            )}
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-[10px] text-muted-foreground">
                    Applied when starting a new chat session
                  </p>
                </div>
              )}

              {/* Default Thinking Effort */}
              {(() => {
                const thinkingOpt = connection.acpCapabilities.configOptions?.find(
                  (o) => o.category === 'thought_level'
                );
                if (!thinkingOpt?.options || thinkingOpt.options.length < 2) return null;
                return (
                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground">{thinkingOpt.name}</Label>
                    <Select
                      value={acpDefaultThinkingEffort ?? thinkingOpt.currentValue ?? ''}
                      onValueChange={setAcpDefaultThinkingEffort}
                    >
                      <SelectTrigger className="h-8 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {thinkingOpt.options.map((opt) => (
                          <SelectItem key={opt.value ?? opt.name} value={opt.value ?? opt.name} className="text-xs">
                            <div>
                              <span>{opt.name}</span>
                              {opt.description && (
                                <span className="ml-2 text-muted-foreground">{opt.description}</span>
                              )}
                            </div>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {thinkingOpt.description && (
                      <p className="text-[10px] text-muted-foreground">
                        {thinkingOpt.description}
                      </p>
                    )}
                  </div>
                );
              })()}
            </div>
          )}

          {/* ── API Key & Base URL ── */}
          <ApiKeyForm
            apiKey={apiKey}
            onApiKeyChange={setApiKey}
            showApiKey={showApiKey}
            onShowApiKeyChange={setShowApiKey}
            baseUrl={baseUrl}
            onBaseUrlChange={setBaseUrl}
            showBaseUrl={showBaseUrl}
            showApiKeyField={showApiKeyField}
            placeholderUrl={placeholderUrl}
            isOpenAICompatible={connection.provider === 'openai_compatible'}
          />

          {/* ── Security Section ── */}
          <AdvancedSettingsForm
            connection={connection}
            sandboxEnabled={sandboxEnabled}
            onSandboxEnabledChange={setSandboxEnabled}
            extraWritablePaths={extraWritablePaths}
            onExtraWritablePathsChange={setExtraWritablePaths}
            newWritablePath={newWritablePath}
            onNewWritablePathChange={setNewWritablePath}
            networkSandbox={networkSandbox}
            onNetworkSandboxChange={setNetworkSandbox}
            kernelNetworkDeny={kernelNetworkDeny}
            onKernelNetworkDenyChange={setKernelNetworkDeny}
            newDomain={newDomain}
            onNewDomainChange={setNewDomain}
          />
        </div>

        <DialogFooter className="px-7 py-4 border-t border-border">
          {hasCustomValues && (
            <button
              type="button"
              className="text-xs text-muted-foreground hover:text-foreground transition-colors mr-auto"
              onClick={handleResetDefaults}
            >
              Reset to defaults
            </button>
          )}
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
