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
import { Loader2, RefreshCw, ChevronsUpDown, Check } from 'lucide-react';
import { useState, useEffect, useCallback } from 'react';
import type { Connection, ReasoningEffort } from '@/lib/ai/connections';
import { getAgentModels, prettyModelName } from '@/lib/ai/connections';
import { tauriApi } from '@/lib/tauri';
import { cn } from '@/lib/utils';
import { t, type MessageKey } from '@/lib/i18n';

// --- Constants ---

// Labels are held as message KEYS, not as resolved strings: this array is
// built once at module load, so a `t()` here would freeze the English text
// for the life of the process and never follow a language change.
const TEMPERATURE_LABELS: { value: number; labelKey: MessageKey }[] = [
  { value: 0, labelKey: "temp.precise" },
  { value: 0.5, labelKey: "temp.balanced" },
  { value: 1.0, labelKey: "temp.creative" },
  { value: 1.5, labelKey: "temp.experimental" },
  { value: 2.0, labelKey: "temp.wild" },
];

function temperatureLabelKey(value: number): MessageKey {
  if (value <= 0.25) return "temp.precise";
  if (value <= 0.75) return "temp.balanced";
  if (value <= 1.25) return "temp.creative";
  if (value <= 1.75) return "temp.experimental";
  return "temp.wild";
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
export interface AgentModelOption {
  id: string;
  label: string;
  /** Free text supplied by the agent at runtime — already in the agent's own words. */
  note?: string;
  /** Note for a statically-listed model. A key, not a string: these tables are
   *  built at module load, so a resolved `t()` would never follow a language change. */
  noteKey?: MessageKey;
}

const COPILOT_MODELS: AgentModelOption[] = [
  { id: 'claude-sonnet-4.6', label: 'Claude Sonnet 4.6' },
  { id: 'claude-sonnet-4.5', label: 'Claude Sonnet 4.5' },
  { id: 'claude-sonnet-4', label: 'Claude Sonnet 4', noteKey: "model.noteDefault" },
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
];

export const AGENT_KNOWN_MODELS: Record<string, AgentModelOption[]> = {
  'claude-agent-acp': [
    { id: 'sonnet', label: 'Claude Sonnet', noteKey: "model.noteSonnet" },
    { id: 'opus', label: 'Claude Opus', noteKey: "model.noteOpus" },
    { id: 'haiku', label: 'Claude Haiku', noteKey: "model.noteHaiku" },
  ],
  'codex-acp': [
    { id: 'gpt-5.2-codex', label: 'GPT-5.2 Codex', noteKey: "model.noteCodexRecommended" },
    { id: 'gpt-5.3-codex', label: 'GPT-5.3 Codex', noteKey: "model.notePaidPlan" },
    { id: 'gpt-5.4', label: 'GPT-5.4', noteKey: "model.noteFlagshipPaid" },
    { id: 'o4-mini', label: 'o4-mini', noteKey: "model.noteFastReasoning" },
  ],
  'copilot': COPILOT_MODELS,
  'copilot-language-server': COPILOT_MODELS,
  'gemini': [
    { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro', noteKey: "model.noteGeminiPro" },
    { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash', noteKey: "model.noteGeminiFlash" },
  ],
};

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
  /** @deprecated Kept for interface compat — thinking effort now managed via ACP config options */
  reasoningEffort?: ReasoningEffort | undefined;
  /** @deprecated */
  onReasoningEffortChange?: (value: ReasoningEffort | undefined) => void;
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
  // reasoningEffort and onReasoningEffortChange deprecated — thinking effort via ACP config options
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
    ? connection.credentials.agentBinary
    : '';
  const isCopilotLsp = agentBinary === 'copilot-language-server';

  // Fetch models from Copilot LSP for copilot-language-server connections
  const [copilotModels, setCopilotModels] = useState<Array<{ id: string; name: string }>>([]);
  const [copilotModelsLoading, setCopilotModelsLoading] = useState(false);

  const fetchCopilotModels = useCallback(async () => {
    if (!isCopilotLsp) return;
    setCopilotModelsLoading(true);
    try {
      const result = await tauriApi.copilotLspConversationModels();
      setCopilotModels(result);
    } catch {
      // LSP not running or doesn't support copilot/models — keep fallback
    } finally {
      setCopilotModelsLoading(false);
    }
  }, [isCopilotLsp]);

  useEffect(() => {
    if (isCopilotLsp && copilotModels.length === 0 && !copilotModelsLoading) {
      fetchCopilotModels();
    }
  }, [isCopilotLsp, copilotModels.length, copilotModelsLoading, fetchCopilotModels]);

  return (
    <div className="space-y-3">
      {/* Local AI model picker */}
      {isLocalBundled && (
        <div className="space-y-1.5">
          <Label className="text-sm">{t("conn.model")}</Label>
          {downloadedLocalModels.length > 0 ? (
            <Select
              value={localModelId ?? ''}
              onValueChange={onLocalModelIdChange}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder={t("conn.selectModel")} />
              </SelectTrigger>
              <SelectContent>
                {downloadedLocalModels.map((localModel) => (
                  <SelectItem key={localModel.id} value={localModel.id}>
                    <span className="flex items-center gap-2">
                      <span>{localModel.name}</span>
                      {localModel.size_bytes > 0 && (
                        <span className="text-xs text-muted-foreground">
                          {localModel.size_bytes < 1_000_000_000
                            ? `${(localModel.size_bytes / 1_000_000).toFixed(0)} MB`
                            : `${(localModel.size_bytes / 1_000_000_000).toFixed(1)} GB`}
                        </span>
                      )}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <p className="text-xs text-muted-foreground">
              {t("model.noneDownloaded")}{' '}
              {onNavigateToTab ? (
                <button
                  className="underline hover:text-foreground transition-colors"
                  onClick={() => {
                    onCloseDialog();
                    onNavigateToTab('local-ai');
                  }}
                >
                  {t("model.localAiTab")}
                </button>
              ) : (
                t("model.localAiTab")
              )}.
            </p>
          )}
        </div>
      )}

      {/* Agent-managed or API model picker */}
      {!isLocalBundled && <div className="space-y-1.5">
        <Label className="text-sm">{t("conn.model")}</Label>
        {isAgentManaged ? (() => {
          let currentModel: string | null = null;
          let defaultLabel: string;
          let displayModels: AgentModelOption[];

          if (isCopilotLsp) {
            // Copilot LSP: use only models from copilot/models API.
            // The API returns the actual models available for the user's plan.
            // Hardcoded models may not work (the conversation API rejects
            // model IDs not returned by copilot/models).
            displayModels = copilotModels.length > 0
              ? copilotModels.map((m) => ({ id: m.id, label: m.name }))
              : (AGENT_KNOWN_MODELS[agentBinary] ?? []);
            defaultLabel = t("model.serverDefault");
          } else {
            // ACP agents: hardcoded list as base, enriched with dynamic models
            const knownModels = AGENT_KNOWN_MODELS[agentBinary] ?? [];
            const knownIds = new Set(knownModels.map((m) => m.id));
            const dynamicModels: AgentModelOption[] = getAgentModels(connection.id)?.models.map((m) => ({
              id: m.modelId,
              label: m.name,
              note: m.description ?? undefined,
            })) ?? [];

            displayModels = [...knownModels];
            for (const dm of dynamicModels) {
              if (!knownIds.has(dm.id)) displayModels.push(dm);
            }

            currentModel = getAgentModels(connection.id)?.currentModel ?? null;
            defaultLabel = currentModel
              ? t("model.agentDefaultNamed", { name: prettyModelName(currentModel) })
              : t("model.agentDefault");
          }

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
                  {displayModels.map((agentModel) => (
                    <SelectItem key={agentModel.id} value={agentModel.id}>
                      <span className="flex items-center gap-2">
                        <span>{prettyModelName(agentModel.id)}</span>
                        {currentModel === agentModel.id && (
                          <span className="text-[10px] text-muted-foreground">{t("model.current")}</span>
                        )}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {displayModels.length === 0 && (
                <p className="text-[11px] text-muted-foreground italic">
                  {t("model.sendFirst")}
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
                      {defaultModel
                        ? t("model.defaultNamed", { name: prettyModelName(defaultModel) })
                        : t("model.selectModel")}
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
                    placeholder={t("conn.searchModelPlaceholder")}
                    value={model}
                    onValueChange={onModelChange}
                    className="flex-1"
                  />
                  <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" aria-label={modelsLoading ? t("model.loading") : t("model.refresh")} title={t("conn.refreshModels")} onClick={(e) => { e.stopPropagation(); onFetchModels(); }} disabled={modelsLoading}>
                    {modelsLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                  </Button>
                </div>
                <CommandList className="max-h-[240px]">
                  {modelsError && <p className="px-3 py-2 text-xs text-destructive">{modelsError}</p>}
                  {!modelsLoading && !modelsError && models.length === 0 && <CommandEmpty>{t("conn.typeOrRefresh")}</CommandEmpty>}
                  {models.length > 0 && (
                    <CommandGroup>
                      {models.map((modelId) => (
                        <CommandItem
                          key={modelId}
                          value={modelId}
                          onSelect={(val) => { onModelChange(val); onModelPopoverOpenChange(false); }}
                          className="flex items-center justify-between gap-2"
                        >
                          <span className="truncate text-sm">{modelId}</span>
                          {model === modelId && (
                            <Check
                              data-picker-check
                              className="h-3.5 w-3.5 shrink-0 text-[var(--color-accent-primary)]"
                              strokeWidth={2.5}
                            />
                          )}
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

      {/* Temperature + Response Length — direct API and local_bundled */}
      {!isAgentManaged && (
        <>
          <div className="space-y-2.5">
            <div className="flex items-center justify-between">
              <Label className="text-sm">{t("conn.creativity")}</Label>
              <span className="text-xs text-muted-foreground">
                {temperature !== null
                  ? `${t(temperatureLabelKey(temperature))} (${temperature.toFixed(1)})`
                  : t("model.default")}
              </span>
            </div>
            <Slider
              min={0} max={2} step={0.1}
              value={temperature !== null ? [temperature] : [1.0]}
              onValueChange={([val]) => onTemperatureChange(val)}
              className={cn(temperature === null && 'opacity-40')}
            />
            <div className="flex justify-between px-0.5">
              {TEMPERATURE_LABELS.map((stop) => (
                <span key={stop.value} className="text-[10px] text-muted-foreground cursor-pointer hover:text-foreground transition-colors" onClick={() => onTemperatureChange(stop.value)}>
                  {t(stop.labelKey)}
                </span>
              ))}
            </div>
          </div>

          <div className="space-y-2.5">
            <div className="flex items-center justify-between">
              <Label className="text-sm">{t("conn.responseLength")}</Label>
              <span className="text-xs text-muted-foreground">
                {maxTokensIndex !== null
                  ? t("conn.tokensSuffix", { n: formatTokenCount(MAX_TOKEN_PRESETS[maxTokensIndex]) })
                  : t("model.default")}
              </span>
            </div>
            <Slider
              min={0} max={MAX_TOKEN_PRESETS.length - 1} step={1}
              value={maxTokensIndex !== null ? [maxTokensIndex] : [4]}
              onValueChange={([val]) => onMaxTokensIndexChange(val)}
              className={cn(maxTokensIndex === null && 'opacity-40')}
            />
            <div className="flex justify-between px-0.5">
              <span className="text-[10px] text-muted-foreground">{t("conn.lengthShort")}</span>
              <span className="text-[10px] text-muted-foreground">{t("conn.lengthMedium")}</span>
              <span className="text-[10px] text-muted-foreground">{t("conn.lengthLong")}</span>
            </div>
          </div>
        </>
      )}

      {/* Server settings — local_bundled */}
      {isLocalBundled && (
        <>
          <div className="flex items-center justify-between">
            <Label className="text-sm">{t("conn.contextLength")}</Label>
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
            <Label className="text-sm">{t("conn.gpuLayers")}</Label>
            <Select value={String(gpuLayers)} onValueChange={(v) => onGpuLayersChange(Number(v))}>
              <SelectTrigger className="w-28 h-8 text-sm"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="-1">{t("model.layersAuto")}</SelectItem>
                <SelectItem value="0">{t("conn.cpuOnly")}</SelectItem>
                <SelectItem value="16">{t("model.layers", { n: 16 })}</SelectItem>
                <SelectItem value="32">{t("model.layers", { n: 32 })}</SelectItem>
                <SelectItem value="48">{t("model.layers", { n: 48 })}</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </>
      )}
    </div>
  );
}
