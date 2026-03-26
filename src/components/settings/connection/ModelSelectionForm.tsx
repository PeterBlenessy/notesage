import { Button } from '@/components/ui/button';
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
import { Loader2, RefreshCw, ChevronsUpDown, Check, Brain } from 'lucide-react';
import type { Connection, ReasoningEffort } from '@/lib/ai/connections';
import { getAgentModels, prettyModelName } from '@/lib/ai/connections';
import { cn } from '@/lib/utils';

// --- Constants ---

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

export const MAX_TOKEN_PRESETS = [256, 512, 1024, 2048, 4096, 8192, 16384, 32768] as const;

export function nearestPresetIndex(tokens: number): number {
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

export function formatTokenCount(tokens: number): string {
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

// --- Local model type ---

interface LocalModel {
  id: string;
  name: string;
  size_bytes: number;
  downloaded: boolean;
}

// --- Props ---

interface ModelSelectionFormProps {
  connection: Connection;
  model: string;
  onModelChange: (value: string) => void;
  temperature: number | null;
  onTemperatureChange: (value: number | null) => void;
  maxTokensIndex: number | null;
  onMaxTokensIndexChange: (value: number | null) => void;
  reasoningEffort: ReasoningEffort | undefined;
  onReasoningEffortChange: (value: ReasoningEffort | undefined) => void;
  /** Local AI model state */
  localModelId: string | null;
  onLocalModelIdChange: (value: string | null) => void;
  downloadedLocalModels: LocalModel[];
  contextLength: number;
  onContextLengthChange: (value: number) => void;
  gpuLayers: number;
  onGpuLayersChange: (value: number) => void;
  /** Model list fetching */
  models: string[];
  modelsLoading: boolean;
  modelsError: string | null;
  modelPopoverOpen: boolean;
  onModelPopoverOpenChange: (open: boolean) => void;
  onFetchModels: () => void;
  /** Default model for placeholder */
  defaultModel: string;
  /** Navigate to settings tab callback (for "download model" link) */
  onNavigateToTab?: (tab: string) => void;
  onCloseDialog: () => void;
}

export function ModelSelectionForm({
  connection,
  model,
  onModelChange,
  temperature,
  onTemperatureChange,
  maxTokensIndex,
  onMaxTokensIndexChange,
  reasoningEffort,
  onReasoningEffortChange,
  localModelId,
  onLocalModelIdChange,
  downloadedLocalModels,
  contextLength,
  onContextLengthChange,
  gpuLayers,
  onGpuLayersChange,
  models,
  modelsLoading,
  modelsError,
  modelPopoverOpen,
  onModelPopoverOpenChange,
  onFetchModels,
  defaultModel,
  onNavigateToTab,
  onCloseDialog,
}: ModelSelectionFormProps) {
  const isLocalBundled = connection.authMethod === 'local_bundled';
  const isAgentManaged = connection.authMethod === 'agent_managed';
  const agentBinary = connection.credentials.type === 'agent_managed'
    ? (connection.credentials as { agentBinary: string }).agentBinary
    : '';
  const isCodexAgent = agentBinary === 'codex-acp';

  return (
    <div className="space-y-3">
      {/* Local AI model picker */}
      {isLocalBundled && (
        <div className="space-y-1.5">
          <Label className="text-sm">Model</Label>
          {downloadedLocalModels.length > 0 ? (
            <Select
              value={localModelId ?? ''}
              onValueChange={onLocalModelIdChange}
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
                    onCloseDialog();
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
          const cached = getAgentModels(connection.id);
          const dynamicModels = cached?.models.map((m) => ({
            id: m.modelId,
            label: m.name,
            note: m.description ?? undefined,
          })) ?? [];
          const fallbackModels = AGENT_KNOWN_MODELS[agentBinary] ?? [];
          const displayModels = dynamicModels.length > 0 ? dynamicModels : fallbackModels;
          const currentModel = cached?.currentModel;
          const defaultLabel = currentModel
            ? `Agent default (${prettyModelName(currentModel)})`
            : 'Agent default';

          return (
            <>
              <Select
                value={model || '__default__'}
                onValueChange={(val) => onModelChange(val === '__default__' ? '' : val)}
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
          <Popover open={modelPopoverOpen} onOpenChange={onModelPopoverOpenChange}>
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
                    onValueChange={onModelChange}
                    className="flex-1"
                  />
                  <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={(e) => { e.stopPropagation(); onFetchModels(); }} disabled={modelsLoading}>
                    {modelsLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                  </Button>
                </div>
                <CommandList className="max-h-[240px]">
                  {modelsError && <p className="px-3 py-2 text-xs text-destructive">{modelsError}</p>}
                  {!modelsLoading && !modelsError && models.length === 0 && <CommandEmpty>Type a model name or click refresh</CommandEmpty>}
                  {models.length > 0 && (
                    <CommandGroup>
                      {models.map((m) => (
                        <CommandItem key={m} value={m} onSelect={(val) => { onModelChange(val); onModelPopoverOpenChange(false); }}>
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
              onValueChange={([val]) => onReasoningEffortChange(EFFORT_OPTIONS[val].value)}
            />
            <div className="flex justify-between px-0.5">
              {EFFORT_OPTIONS.map((opt) => (
                <span
                  key={opt.label}
                  className="text-[10px] text-muted-foreground cursor-pointer hover:text-foreground transition-colors"
                  onClick={() => onReasoningEffortChange(opt.value)}
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
              onValueChange={([val]) => onTemperatureChange(val)}
              className={cn(temperature === null && 'opacity-40')}
            />
            <div className="flex justify-between px-0.5">
              {TEMPERATURE_LABELS.map((t) => (
                <span key={t.value} className="text-[10px] text-muted-foreground cursor-pointer hover:text-foreground transition-colors" onClick={() => onTemperatureChange(t.value)}>
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
              onValueChange={([val]) => onMaxTokensIndexChange(val)}
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
            <Select value={String(contextLength)} onValueChange={(v) => onContextLengthChange(Number(v))}>
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
            <Select value={String(gpuLayers)} onValueChange={(v) => onGpuLayersChange(Number(v))}>
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
    </div>
  );
}
