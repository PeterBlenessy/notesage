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
import { Loader2, RefreshCw, ChevronsUpDown, Check, Eye, EyeOff } from 'lucide-react';
import { tauriApi } from '@/lib/tauri';
import { useConnectionsStore } from '@/stores/connections-store';
import { useLocalAIStore } from '@/stores/local-ai-store';
import { stopAcpAgent } from '@/hooks/useAIOperations';
import { stopTaskAgent } from '@/hooks/useAgentTaskOperations';
import type { Connection, ConnectionConfig } from '@/lib/ai/connections';
import { DEFAULT_MODELS } from '@/lib/ai/connections';
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

/** Model placeholder hints per provider for agent-managed connections */
const AGENT_MODEL_HINTS: Record<string, string> = {
  anthropic: 'e.g. sonnet, opus, haiku',
  openai: 'e.g. gpt-5.3-codex, gpt-5.2',
  github: 'e.g. claude-sonnet-4, gpt-5.2',
  google: 'e.g. gemini-2.5-pro, gemini-2.5-flash',
};

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

    const updates: Partial<Connection> = {
      config: Object.keys(config).length > 0 ? config : undefined,
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
      <DialogContent className="sm:max-w-[440px]">
        <DialogHeader>
          <DialogTitle className="text-base">
            Configure {connection.label}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Local AI model picker — shows downloaded models */}
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

          {/* Model — agent-managed: simple text input; API providers: combobox with fetch */}
          {!isLocalBundled && <div className="space-y-1.5">
            <Label className="text-sm">Model</Label>
            {isAgentManaged ? (
              <>
                <Input
                  placeholder={AGENT_MODEL_HINTS[connection.provider] ?? 'Model name or alias'}
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  className="w-full"
                />
                <p className="text-[11px] text-muted-foreground">
                  Passed as <code className="text-[10px] bg-muted px-1 py-0.5 rounded">--model</code> to the agent CLI. Leave blank for the agent's default.
                </p>
              </>
            ) : (
              <Popover open={modelPopoverOpen} onOpenChange={setModelPopoverOpen}>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    role="combobox"
                    aria-expanded={modelPopoverOpen}
                    className="w-full justify-between font-normal"
                  >
                    <span className="truncate">
                      {model || (
                        <span className="text-muted-foreground">
                          {defaultModel ? `Default (${defaultModel})` : 'Select model\u2026'}
                        </span>
                      )}
                    </span>
                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
                  <Command>
                    <div className="flex items-center gap-1 px-1">
                      <CommandInput
                        placeholder="Search or type model name\u2026"
                        value={model}
                        onValueChange={setModel}
                        className="flex-1"
                      />
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 shrink-0"
                        onClick={(e) => {
                          e.stopPropagation();
                          fetchModels();
                        }}
                        disabled={modelsLoading}
                      >
                        {modelsLoading ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <RefreshCw className="h-3.5 w-3.5" />
                        )}
                      </Button>
                    </div>
                    <CommandList>
                      {modelsError && (
                        <p className="px-3 py-2 text-xs text-destructive">
                          {modelsError}
                        </p>
                      )}
                      {!modelsLoading && !modelsError && models.length === 0 && (
                        <CommandEmpty>
                          Type a model name or click refresh
                        </CommandEmpty>
                      )}
                      {models.length > 0 && (
                        <CommandGroup>
                          {models.map((m) => (
                            <CommandItem
                              key={m}
                              value={m}
                              onSelect={(val) => {
                                setModel(val);
                                setModelPopoverOpen(false);
                              }}
                            >
                              <Check
                                className={cn(
                                  'mr-2 h-3.5 w-3.5',
                                  model === m ? 'opacity-100' : 'opacity-0'
                                )}
                              />
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

          {/* Temperature — for direct API and local_bundled connections */}
          {!isAgentManaged && (
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
                min={0}
                max={2}
                step={0.1}
                value={temperature !== null ? [temperature] : [1.0]}
                onValueChange={([val]) => setTemperature(val)}
                className={cn(temperature === null && 'opacity-40')}
              />
              <div className="flex justify-between px-0.5">
                {TEMPERATURE_LABELS.map((t) => (
                  <span
                    key={t.value}
                    className="text-[10px] text-muted-foreground cursor-pointer hover:text-foreground transition-colors"
                    onClick={() => setTemperature(t.value)}
                  >
                    {t.label}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Max Tokens (Response Length) — only for direct API connections */}
          {!isAgentManaged && (
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
                min={0}
                max={MAX_TOKEN_PRESETS.length - 1}
                step={1}
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
          )}

          {/* Server settings — local_bundled only */}
          {isLocalBundled && (
            <>
              <div className="flex items-center justify-between">
                <Label className="text-sm">Context Length</Label>
                <Select
                  value={String(contextLength)}
                  onValueChange={(v) => setContextLength(Number(v))}
                >
                  <SelectTrigger className="w-28 h-8 text-sm">
                    <SelectValue />
                  </SelectTrigger>
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
                <Select
                  value={String(gpuLayers)}
                  onValueChange={(v) => setGpuLayers(Number(v))}
                >
                  <SelectTrigger className="w-28 h-8 text-sm">
                    <SelectValue />
                  </SelectTrigger>
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
                {connection.provider === 'openai_compatible' && (
                  <span className="text-destructive ml-1">*</span>
                )}
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
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="absolute right-0 top-0 h-full w-10 text-muted-foreground hover:text-foreground"
                  onClick={() => setShowApiKey(!showApiKey)}
                >
                  {showApiKey ? (
                    <EyeOff className="h-4 w-4" strokeWidth={1.5} />
                  ) : (
                    <Eye className="h-4 w-4" strokeWidth={1.5} />
                  )}
                </Button>
              </div>
            </div>
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
