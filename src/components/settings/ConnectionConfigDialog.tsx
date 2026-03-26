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

    const updates: Partial<Connection> = {
      config: Object.keys(config).length > 0 ? config : undefined,
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
      <DialogContent className="sm:max-w-[500px]" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle className="text-base">
            Configure {connection.label}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-5 py-2 max-h-[70vh] overflow-y-auto pr-1">

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

        <DialogFooter>
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
