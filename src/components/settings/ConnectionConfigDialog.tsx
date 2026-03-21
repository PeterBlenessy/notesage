import { useState, useEffect, useCallback } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { Slider } from '@/components/ui/slider';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Loader2, RefreshCw, ChevronsUpDown, Check, Eye, EyeOff, GlobeLock, Shield, X as XIcon, Plus, Brain } from 'lucide-react';
import { Separator } from '@/components/ui/separator';
import { tauriApi } from '@/lib/tauri';
import { useConnectionsStore } from '@/stores/connections-store';
import { useLocalAIStore } from '@/stores/local-ai-store';
import { stopAcpAgent } from '@/hooks/useAIOperations';
import { stopTaskAgent } from '@/hooks/useAgentTaskOperations';
import type { Connection, ConnectionConfig, ReasoningEffort } from '@/lib/ai/connections';
import { DEFAULT_MODELS, getAgentModels, prettyModelName, PROVIDER_OPTIONS } from '@/lib/ai/connections';
import { usePermissionStore } from '@/stores/permission-store';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';

const TEMPERATURE_LABELS: { value: number; label: string }[] = [
  { value: 0, label: 'Precise' },
  { value: 0.5, label: 'Balanced' },
  { value: 1.0, label: 'Creative' },
  { value: 1.5, label: 'Experimental' },
  { value: 2.0, label: 'Wild' },
];

function getTemperatureLabel(value: number): string {
  if (value <= 0.25) return 'Precise';
  if (value <= 0.75) return 'Balanced';
  if (value <= 1.25) return 'Creative';
  if (value <= 1.75) return 'Experimental';
  return 'Wild';
}

const MAX_TOKEN_PRESETS = [256, 512, 1024, 2048, 4096, 8192, 16384, 32768] as const;

/** Telemetry domains managed by the toggle (not shown in the domain list) */
const TELEMETRY_DOMAINS: readonly string[] = ['sentry.io', '*.sentry.io'];

function nearestPresetIndex(tokens: number): number {
  let bestIdx = 0;
  let bestDist = Math.abs(MAX_TOKEN_PRESETS[0] - tokens);
  for (let i = 1; i < MAX_TOKEN_PRESETS.length; i++) {
    const dist = Math.abs(MAX_TOKEN_PRESETS[i] - tokens);
    if (dist < bestDist) {
      bestDist = dist;
      bestIdx = i;
    }
  }
  return bestIdx;
}

function formatTokenCount(tokens: number): string {
  if (tokens >= 1024) return `${tokens / 1024}k`;
  return String(tokens);
}

/** Known models per agent binary — curated list for the model picker */
interface AgentModelOption {
  id: string;
  label: string;
  note?: string;
}

const AGENT_KNOWN_MODELS: Record<string, AgentModelOption[]> = {
  'claude-agent-acp': [
    { id: 'sonnet', label: 'Claude Sonnet', note: 'Default — fast and capable' },
    { id: 'opus', label: 'Claude Opus', note: 'Most capable, slower' },
    { id: 'haiku', label: 'Claude Haiku', note: 'Fastest, lightweight' },
  ],
  'codex-acp': [
    { id: 'gpt-5.2-codex', label: 'GPT-5.2 Codex', note: 'Recommended — works with all account types' },
    { id: 'gpt-5.3-codex', label: 'GPT-5.3 Codex', note: 'Requires paid plan' },
    { id: 'gpt-5.4', label: 'GPT-5.4', note: 'Latest flagship — requires paid plan' },
    { id: 'o4-mini', label: 'o4-mini', note: 'Fast reasoning model' },
  ],
  'copilot': [
    { id: 'claude-sonnet-4.6', label: 'Claude Sonnet 4.6' },
    { id: 'claude-sonnet-4.5', label: 'Claude Sonnet 4.5' },
    { id: 'claude-sonnet-4', label: 'Claude Sonnet 4', note: 'Default' },
    { id: 'claude-opus-4.6', label: 'Claude Opus 4.6' },
    { id: 'claude-opus-4.6-fast', label: 'Claude Opus 4.6 Fast' },
    { id: 'claude-opus-4.5', label: 'Claude Opus 4.5' },
    { id: 'claude-haiku-4.5', label: 'Claude Haiku 4.5' },
    { id: 'gpt-5.3-codex', label: 'GPT-5.3 Codex' },
    { id: 'gpt-5.2-codex', label: 'GPT-5.2 Codex' },
    { id: 'gpt-5.2', label: 'GPT-5.2' },
    { id: 'gpt-5.1-codex', label: 'GPT-5.1 Codex' },
    { id: 'gpt-5.1-codex-max', label: 'GPT-5.1 Codex Max' },
    { id: 'gpt-5.1-codex-mini', label: 'GPT-5.1 Codex Mini' },
    { id: 'gpt-5.1', label: 'GPT-5.1' },
    { id: 'gpt-5-mini', label: 'GPT-5 Mini' },
    { id: 'gpt-4.1', label: 'GPT-4.1' },
    { id: 'o4-mini', label: 'o4-mini' },
    { id: 'gemini-3-pro-preview', label: 'Gemini 3 Pro (Preview)' },
    { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro' },
  ],
  'gemini': [
    { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro', note: 'Default — most capable' },
    { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash', note: 'Fast and efficient' },
  ],
};
// Copilot LSP shares the same model catalog as Copilot CLI
AGENT_KNOWN_MODELS['copilot-language-server'] = AGENT_KNOWN_MODELS['copilot'];

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
  const domainAlwaysAllowed = usePermissionStore((s) => s.domainAlwaysAllowed);

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
        setApiKey(connection.credentials.key);
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
      const effectiveApiKey =
        connection.credentials.type === 'api_key' ? apiKey || connection.credentials.key : undefined;
      const effectiveBaseUrl = baseUrl || connection.config?.baseUrl || undefined;

      const provider =
        connection.provider === 'openai_compatible' ? 'openai_compatible' : connection.provider;

      const result = await tauriApi.listModels(provider, effectiveApiKey, effectiveBaseUrl);
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
  const agentBinary = connection?.credentials.type === 'agent_managed'
    ? (connection.credentials as { agentBinary: string }).agentBinary
    : '';
  const isCodexAgent = agentBinary === 'codex-acp';

  const handleResetDefaults = () => {
    setTemperature(null);
    setMaxTokensIndex(null);
  };

  const handleSave = () => {
    if (!connection) return;

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

    // Update API key if changed
    if (connection.credentials.type === 'api_key' && apiKey !== connection.credentials.key) {
      updates.credentials = { type: 'api_key', key: apiKey };
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
          <div className="space-y-3">
            {/* Local AI model picker */}
            {isLocalBundled && (
              <div className="space-y-1.5">
                <Label className="text-sm">Model</Label>
                {downloadedLocalModels.length > 0 ? (
                  <Select
                    value={localModelId ?? ''}
                    onValueChange={setLocalModelId}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Select a model" />
                    </SelectTrigger>
                    <SelectContent>
                      {downloadedLocalModels.map((m) => (
                        <SelectItem key={m.id} value={m.id}>
                          <span className="flex items-center gap-2">
                            <span>{m.name}</span>
                            {m.size_bytes > 0 && (
                              <span className="text-xs text-muted-foreground">
                                {m.size_bytes < 1_000_000_000
                                  ? `${(m.size_bytes / 1_000_000).toFixed(0)} MB`
                                  : `${(m.size_bytes / 1_000_000_000).toFixed(1)} GB`}
                              </span>
                            )}
                          </span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    No models downloaded yet. Download one in the{' '}
                    {onNavigateToTab ? (
                      <button
                        className="underline hover:text-foreground transition-colors"
                        onClick={() => {
                          onOpenChange(false);
                          onNavigateToTab('local-ai');
                        }}
                      >
                        Local AI tab
                      </button>
                    ) : (
                      'Local AI tab'
                    )}.
                  </p>
                )}
              </div>
            )}

            {/* Agent-managed or API model picker */}
            {!isLocalBundled && <div className="space-y-1.5">
              <Label className="text-sm">Model</Label>
              {isAgentManaged ? (() => {
                const ab = connection.credentials.type === 'agent_managed'
                  ? (connection.credentials as { agentBinary: string }).agentBinary
                  : '';
                const cached = getAgentModels(connection.id);
                const dynamicModels = cached?.models.map((m) => ({
                  id: m.modelId,
                  label: m.name,
                  note: m.description ?? undefined,
                })) ?? [];
                const fallbackModels = AGENT_KNOWN_MODELS[ab] ?? [];
                const displayModels = dynamicModels.length > 0 ? dynamicModels : fallbackModels;
                const currentModel = cached?.currentModel;
                const defaultLabel = currentModel
                  ? `Agent default (${prettyModelName(currentModel)})`
                  : 'Agent default';

                return (
                  <>
                    <Select
                      value={model || '__default__'}
                      onValueChange={(val) => setModel(val === '__default__' ? '' : val)}
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__default__">
                          <span className="text-muted-foreground">{defaultLabel}</span>
                        </SelectItem>
                        {displayModels.map((m) => (
                          <SelectItem key={m.id} value={m.id}>
                            <span className="flex items-center gap-2">
                              <span>{prettyModelName(m.id)}</span>
                              {currentModel === m.id && (
                                <span className="text-[10px] text-muted-foreground">(current)</span>
                              )}
                            </span>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {displayModels.length === 0 && (
                      <p className="text-[11px] text-muted-foreground italic">
                        Send a message first to discover available models.
                      </p>
                    )}
                  </>
                );
              })() : (
                <Popover open={modelPopoverOpen} onOpenChange={setModelPopoverOpen}>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      role="combobox"
                      aria-expanded={modelPopoverOpen}
                      className="w-full justify-between font-normal"
                    >
                      <span className="truncate">
                        {model ? prettyModelName(model) : (
                          <span className="text-muted-foreground">
                            {defaultModel ? `Default (${prettyModelName(defaultModel)})` : 'Select model\u2026'}
                          </span>
                        )}
                      </span>
                      <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start" collisionPadding={8}>
                    <Command>
                      <div className="flex items-center gap-1 px-1">
                        <CommandInput
                          placeholder="Search or type model name\u2026"
                          value={model}
                          onValueChange={setModel}
                          className="flex-1"
                        />
                        <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={(e) => { e.stopPropagation(); fetchModels(); }} disabled={modelsLoading}>
                          {modelsLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                        </Button>
                      </div>
                      <CommandList className="max-h-[240px]">
                        {modelsError && <p className="px-3 py-2 text-xs text-destructive">{modelsError}</p>}
                        {!modelsLoading && !modelsError && models.length === 0 && <CommandEmpty>Type a model name or click refresh</CommandEmpty>}
                        {models.length > 0 && (
                          <CommandGroup>
                            {models.map((m) => (
                              <CommandItem key={m} value={m} onSelect={(val) => { setModel(val); setModelPopoverOpen(false); }}>
                                <Check className={cn('mr-2 h-3.5 w-3.5', model === m ? 'opacity-100' : 'opacity-0')} />
                                <span className="truncate text-sm">{m}</span>
                              </CommandItem>
                            ))}
                          </CommandGroup>
                        )}
                      </CommandList>
                    </Command>
                  </PopoverContent>
                </Popover>
              )}
            </div>}

            {/* Thinking Effort — codex-acp with paid accounts */}
            {isCodexAgent && !connection.freeAccount && (() => {
              const EFFORT_OPTIONS: { value: ReasoningEffort | undefined; label: string }[] = [
                { value: undefined, label: 'Default' },
                { value: 'low', label: 'Low' },
                { value: 'medium', label: 'Medium' },
                { value: 'high', label: 'High' },
                { value: 'xhigh', label: 'Extra High' },
              ];
              const currentIndex = EFFORT_OPTIONS.findIndex((o) => o.value === reasoningEffort);
              return (
                <div className="rounded-lg border border-border p-3 space-y-2.5">
                  <div className="flex items-center gap-2">
                    <Brain className="h-3.5 w-3.5 text-muted-foreground" strokeWidth={1.5} />
                    <Label className="text-sm font-medium">Thinking Effort</Label>
                    <span className="text-xs text-muted-foreground ml-auto">
                      {EFFORT_OPTIONS[currentIndex]?.label ?? 'Default'}
                    </span>
                  </div>
                  <p className="text-[11px] text-muted-foreground leading-relaxed">
                    Controls how much reasoning the model does before responding. Higher effort produces more thorough answers but uses more tokens and takes longer.
                  </p>
                  <Slider
                    min={0}
                    max={EFFORT_OPTIONS.length - 1}
                    step={1}
                    value={[currentIndex >= 0 ? currentIndex : 0]}
                    onValueChange={([val]) => setReasoningEffort(EFFORT_OPTIONS[val].value)}
                  />
                  <div className="flex justify-between px-0.5">
                    {EFFORT_OPTIONS.map((opt) => (
                      <span
                        key={opt.label}
                        className="text-[10px] text-muted-foreground cursor-pointer hover:text-foreground transition-colors"
                        onClick={() => setReasoningEffort(opt.value)}
                      >
                        {opt.label}
                      </span>
                    ))}
                  </div>
                </div>
              );
            })()}

            {/* Temperature + Response Length — direct API and local_bundled */}
            {!isAgentManaged && (
              <>
                <div className="space-y-2.5">
                  <div className="flex items-center justify-between">
                    <Label className="text-sm">Creativity</Label>
                    <span className="text-xs text-muted-foreground">
                      {temperature !== null
                        ? `${getTemperatureLabel(temperature)} (${temperature.toFixed(1)})`
                        : 'Default'}
                    </span>
                  </div>
                  <Slider
                    min={0} max={2} step={0.1}
                    value={temperature !== null ? [temperature] : [1.0]}
                    onValueChange={([val]) => setTemperature(val)}
                    className={cn(temperature === null && 'opacity-40')}
                  />
                  <div className="flex justify-between px-0.5">
                    {TEMPERATURE_LABELS.map((t) => (
                      <span key={t.value} className="text-[10px] text-muted-foreground cursor-pointer hover:text-foreground transition-colors" onClick={() => setTemperature(t.value)}>
                        {t.label}
                      </span>
                    ))}
                  </div>
                </div>

                <div className="space-y-2.5">
                  <div className="flex items-center justify-between">
                    <Label className="text-sm">Response Length</Label>
                    <span className="text-xs text-muted-foreground">
                      {maxTokensIndex !== null
                        ? `${formatTokenCount(MAX_TOKEN_PRESETS[maxTokensIndex])} tokens`
                        : 'Default'}
                    </span>
                  </div>
                  <Slider
                    min={0} max={MAX_TOKEN_PRESETS.length - 1} step={1}
                    value={maxTokensIndex !== null ? [maxTokensIndex] : [4]}
                    onValueChange={([val]) => setMaxTokensIndex(val)}
                    className={cn(maxTokensIndex === null && 'opacity-40')}
                  />
                  <div className="flex justify-between px-0.5">
                    <span className="text-[10px] text-muted-foreground">Short</span>
                    <span className="text-[10px] text-muted-foreground">Medium</span>
                    <span className="text-[10px] text-muted-foreground">Long</span>
                  </div>
                </div>
              </>
            )}

            {/* Server settings — local_bundled */}
            {isLocalBundled && (
              <>
                <div className="flex items-center justify-between">
                  <Label className="text-sm">Context Length</Label>
                  <Select value={String(contextLength)} onValueChange={(v) => setContextLength(Number(v))}>
                    <SelectTrigger className="w-28 h-8 text-sm"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="2048">2,048</SelectItem>
                      <SelectItem value="4096">4,096</SelectItem>
                      <SelectItem value="8192">8,192</SelectItem>
                      <SelectItem value="16384">16,384</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex items-center justify-between">
                  <Label className="text-sm">GPU Layers</Label>
                  <Select value={String(gpuLayers)} onValueChange={(v) => setGpuLayers(Number(v))}>
                    <SelectTrigger className="w-28 h-8 text-sm"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="-1">Auto (all)</SelectItem>
                      <SelectItem value="0">CPU only</SelectItem>
                      <SelectItem value="16">16 layers</SelectItem>
                      <SelectItem value="32">32 layers</SelectItem>
                      <SelectItem value="48">48 layers</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </>
            )}

            {/* Base URL */}
            {showBaseUrl && (
              <div className="space-y-1.5">
                <Label className="text-sm">
                  Base URL
                  {connection.provider === 'openai_compatible' && <span className="text-destructive ml-1">*</span>}
                </Label>
                <Input
                  type="url"
                  placeholder={placeholderUrl || 'https://api.example.com'}
                  value={baseUrl}
                  onChange={(e) => setBaseUrl(e.target.value)}
                  className="w-full"
                />
              </div>
            )}

            {/* API Key */}
            {showApiKeyField && (
              <div className="space-y-1.5">
                <Label className="text-sm">API Key</Label>
                <div className="relative">
                  <Input
                    type={showApiKey ? 'text' : 'password'}
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    className="w-full pr-10"
                  />
                  <Button
                    type="button" variant="ghost" size="icon"
                    className="absolute right-0 top-0 h-full w-10 text-muted-foreground hover:text-foreground"
                    onClick={() => setShowApiKey(!showApiKey)}
                  >
                    {showApiKey ? <EyeOff className="h-4 w-4" strokeWidth={1.5} /> : <Eye className="h-4 w-4" strokeWidth={1.5} />}
                  </Button>
                </div>
              </div>
            )}
          </div>

          {/* ── Security Section ── */}
          {isAgentManaged && (
            <>
              <Separator />
              <div className="space-y-3">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Security</p>

                {/* Sandbox */}
                <div className="rounded-lg border border-border p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Shield className="h-3.5 w-3.5 text-muted-foreground" strokeWidth={1.5} />
                      <Label className="text-sm font-medium">Sandbox</Label>
                    </div>
                    <Switch
                      checked={sandboxEnabled}
                      onCheckedChange={(checked) => {
                        setSandboxEnabled(checked);
                        if (!checked) setNetworkSandbox(false);
                      }}
                    />
                  </div>
                  <p className="text-[11px] text-muted-foreground leading-relaxed">
                    Restricts agent file system access. The agent can only write to your project folders, temp directories, and its own config. Sensitive directories like ~/.ssh and ~/.aws are always blocked.
                  </p>
                  {sandboxEnabled && extraWritablePaths.length > 0 && (
                    <div className="space-y-1 pt-1">
                      <p className="text-[11px] font-medium text-muted-foreground">Extra writable paths</p>
                      {extraWritablePaths.map((p) => (
                        <div key={p} className="flex items-center gap-2 text-xs">
                          <span className="font-mono text-muted-foreground flex-1 truncate">{p}</span>
                          <button
                            className="text-muted-foreground hover:text-destructive transition-colors"
                            onClick={() => setExtraWritablePaths((prev) => prev.filter((x) => x !== p))}
                            title="Remove"
                          >
                            <XIcon className="h-3 w-3" strokeWidth={1.5} />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                  {sandboxEnabled && (
                    <div className="flex items-center gap-1.5">
                      <Input
                        type="text"
                        placeholder="Add writable path..."
                        value={newWritablePath}
                        onChange={(e) => setNewWritablePath(e.target.value)}
                        className="h-7 text-xs flex-1"
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && newWritablePath.trim()) {
                            setExtraWritablePaths((prev) => [...prev, newWritablePath.trim()]);
                            setNewWritablePath('');
                          }
                        }}
                      />
                      <Button
                        variant="ghost" size="icon" className="h-7 w-7 shrink-0"
                        onClick={() => {
                          if (newWritablePath.trim()) {
                            setExtraWritablePaths((prev) => [...prev, newWritablePath.trim()]);
                            setNewWritablePath('');
                          }
                        }}
                      >
                        <Plus className="h-3.5 w-3.5" strokeWidth={1.5} />
                      </Button>
                    </div>
                  )}
                </div>

                {/* Network Restriction */}
                {sandboxEnabled && (
                  <div className="rounded-lg border border-border p-3 space-y-2.5">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <GlobeLock className="h-3.5 w-3.5 text-muted-foreground" strokeWidth={1.5} />
                        <Label className="text-sm font-medium">Network Restriction</Label>
                      </div>
                      <Switch
                        checked={networkSandbox}
                        onCheckedChange={setNetworkSandbox}
                      />
                    </div>
                    <p className="text-[11px] text-muted-foreground leading-relaxed">
                      Routes all agent network traffic through a local proxy that filters by domain. Only approved domains can be reached. Requests to unknown domains require your explicit approval before they go through.
                    </p>
                    {networkSandbox && (
                      <div className="flex items-center justify-between pt-1">
                        <div>
                          <Label className="text-xs font-medium">Kernel enforcement</Label>
                          <p className="text-[10px] text-muted-foreground mt-0.5">
                            Blocks direct network at the OS level. Disable if agents fail to start.
                          </p>
                        </div>
                        <Switch
                          checked={kernelNetworkDeny}
                          onCheckedChange={setKernelNetworkDeny}
                        />
                      </div>
                    )}
                    {networkSandbox && (() => {
                      const ab = connection.credentials.type === 'agent_managed'
                        ? (connection.credentials as { agentBinary: string }).agentBinary
                        : '';
                      const provOpt = PROVIDER_OPTIONS.find(
                        (o) => o.agentBinary === ab || o.lspBinary === ab
                      );
                      const builtInDomains = provOpt?.installMeta?.allowedDomains ?? [];
                      const userDomains = domainAlwaysAllowed[connection.id] ?? [];
                      const hasTelemetryOption = ab === 'claude-agent-acp';
                      const telemetryEnabled = TELEMETRY_DOMAINS.some((d) =>
                        userDomains.includes(d)
                      );
                      const toggleTelemetry = (enabled: boolean) => {
                        const store = usePermissionStore.getState();
                        if (enabled) {
                          for (const d of TELEMETRY_DOMAINS) {
                            store.allowDomain(connection.id, d, 'always');
                          }
                        } else {
                          for (const d of TELEMETRY_DOMAINS) {
                            store.removeDomain(connection.id, d);
                          }
                        }
                      };
                      // Filter telemetry domains out of the visible domain list
                      const visibleUserDomains = userDomains.filter(
                        (d) => !TELEMETRY_DOMAINS.includes(d)
                      );

                      return (
                        <div className="space-y-2.5 pt-1">
                          {hasTelemetryOption && (
                            <>
                              <div className="flex items-center justify-between">
                                <div>
                                  <p className="text-[11px] font-medium text-foreground">Allow telemetry</p>
                                  <p className="text-[10px] text-muted-foreground">Let the agent send crash reports and usage data to its provider</p>
                                </div>
                                <Switch
                                  checked={telemetryEnabled}
                                  onCheckedChange={toggleTelemetry}
                                />
                              </div>
                              <Separator />
                            </>
                          )}
                          <p className="text-[11px] font-medium text-muted-foreground">Allowed domains</p>
                          <div className="space-y-1">
                            {builtInDomains.map((d) => (
                              <div key={d} className="flex items-center gap-2 text-xs">
                                <span className="font-mono text-muted-foreground flex-1 truncate">{d}</span>
                                <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground shrink-0">built-in</span>
                              </div>
                            ))}
                            {visibleUserDomains.map((d) => (
                              <div key={d} className="flex items-center gap-2 text-xs">
                                <span className="font-mono text-muted-foreground flex-1 truncate">{d}</span>
                                <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground shrink-0">always</span>
                                <button
                                  className="text-muted-foreground hover:text-destructive transition-colors"
                                  onClick={() => usePermissionStore.getState().removeDomain(connection.id, d)}
                                  title="Remove"
                                >
                                  <XIcon className="h-3 w-3" strokeWidth={1.5} />
                                </button>
                              </div>
                            ))}
                          </div>
                          <div className="flex items-center gap-1.5">
                            <Input
                              type="text"
                              placeholder="Add domain..."
                              value={newDomain}
                              onChange={(e) => setNewDomain(e.target.value)}
                              className="h-7 text-xs flex-1"
                              onKeyDown={(e) => {
                                if (e.key === 'Enter' && newDomain.trim()) {
                                  usePermissionStore.getState().allowDomain(connection.id, newDomain.trim(), 'always');
                                  setNewDomain('');
                                }
                              }}
                            />
                            <Button
                              variant="ghost" size="icon" className="h-7 w-7 shrink-0"
                              onClick={() => {
                                if (newDomain.trim()) {
                                  usePermissionStore.getState().allowDomain(connection.id, newDomain.trim(), 'always');
                                  setNewDomain('');
                                }
                              }}
                            >
                              <Plus className="h-3.5 w-3.5" strokeWidth={1.5} />
                            </Button>
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                )}
              </div>
            </>
          )}
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
