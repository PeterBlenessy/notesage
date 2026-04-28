import { useState, useEffect, useCallback, useMemo } from 'react';
import { useConnectionsStore } from '@/stores/connections-store';
import { useRoutingStore } from '@/stores/routing-store';
import { useLocalAIStore } from '@/stores/local-ai-store';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Settings2, Loader2, Check } from 'lucide-react';
import type { AICapability, Connection } from '@/lib/ai/connections';
import { ROUTING_SLOT_LABELS, prettyModelName, getAgentModels } from '@/lib/ai/connections';
import { AGENT_KNOWN_MODELS } from '@/components/settings/connection/ModelSelectionForm';
import { tauriApi } from '@/lib/tauri';
import { cn } from '@/lib/utils';

const USE_CASES: AICapability[] = ['interactive', 'agent_tasks', 'inline_completion'];

/** Sentinel value for the "Not configured" select option */
const NONE = '__none__';

function ModelPopover({ useCase, connection }: { useCase: AICapability; connection: Connection }) {
  const currentModel = useRoutingStore((s) => s.routing[useCase]?.model);
  const setUseCaseModel = useRoutingStore((s) => s.setUseCaseModel);

  const isLocalBundled = connection.authMethod === 'local_bundled';
  const isAgentManaged = connection.authMethod === 'agent_managed';
  const isCopilotLsp = isAgentManaged && connection.credentials && 'agentBinary' in connection.credentials && connection.credentials.agentBinary === 'copilot-language-server';

  // For local_bundled, use downloaded models from local-ai-store
  const localModels = useLocalAIStore((s) => s.models);
  const localModelNames = useMemo(
    () => localModels.filter((m) => m.downloaded).map((m) => m.id),
    [localModels]
  );

  const [open, setOpen] = useState(false);
  const [models, setModels] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const agentBinary = isAgentManaged && connection.credentials.type === 'agent_managed'
    ? connection.credentials.agentBinary
    : '';

  const agentMergedModels = useMemo(() => {
    if (!isAgentManaged) return [];

    if (isCopilotLsp) {
      // LSP: use only models from copilot/models API.
      // Hardcoded models may be rejected by the conversation API.
      return models.length > 0
        ? models
        : (AGENT_KNOWN_MODELS[agentBinary] ?? []).map((m) => m.id);
    }

    // ACP agents: hardcoded list as base, enriched with dynamic cache
    const known = AGENT_KNOWN_MODELS[agentBinary] ?? [];
    const knownIds = new Set(known.map((m) => m.id));
    const dynamic = getAgentModels(connection.id)?.models.map((m) => m.modelId) ?? [];

    const merged = known.map((m) => m.id);
    for (const id of dynamic) {
      if (!knownIds.has(id)) merged.push(id);
    }
    return merged;
  }, [isAgentManaged, isCopilotLsp, agentBinary, connection.id, models]);

  // Resolve display models: local > agent merged > API-fetched
  const displayModels = isLocalBundled
    ? localModelNames
    : isAgentManaged
      ? agentMergedModels
      : models;

  // Can fetch = API key, Ollama, OpenAI-compatible, Copilot LSP
  const canFetchModels = !isLocalBundled && (!isAgentManaged || isCopilotLsp);

  const fetchModels = useCallback(async () => {
    if (!canFetchModels) return;
    setLoading(true);
    setError(null);
    try {
      if (isCopilotLsp) {
        const result = await tauriApi.copilotLspConversationModels();
        setModels(result.map((m: { id: string }) => m.id));
      } else {
        // Post-keychain migration, credentials.key is always undefined here
        // (only credentialStored: true is persisted). The Rust list_models
        // command resolves the key from the keychain via connectionId.
        const apiKey = connection.credentials.type === 'api_key' ? connection.credentials.key : undefined;
        const baseUrl = connection.config?.baseUrl;
        const provider = connection.provider === 'openai_compatible' ? 'openai_compatible' : connection.provider;
        const result = await tauriApi.listModels(provider, apiKey, baseUrl);
        setModels(result);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setModels([]);
    } finally {
      setLoading(false);
    }
  }, [connection, canFetchModels, isCopilotLsp]);

  useEffect(() => {
    if (open && canFetchModels && models.length === 0 && !loading && !error) {
      fetchModels();
    }
  }, [open, canFetchModels, models.length, loading, error, fetchModels]);

  return (
    <DropdownMenu
      open={open}
      onOpenChange={(isOpen) => setOpen(isOpen)}
    >
      <TooltipProvider delayDuration={300}>
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <button
                className={cn(
                  'h-7 w-7 inline-flex items-center justify-center rounded-md transition-colors duration-150',
                  'hover:bg-muted text-muted-foreground hover:text-foreground',
                  'outline-none focus-visible:[outline:1px_solid_var(--color-accent-primary)] focus-visible:[outline-offset:2px]',
                  currentModel && 'text-foreground',
                )}
              >
                <Settings2 className="h-3.5 w-3.5" strokeWidth={1.5} />
              </button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent side="top" className="text-xs">
            {currentModel ? `Model: ${prettyModelName(currentModel)}` : 'Override model'}
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
      <DropdownMenuContent align="end" className="w-56 max-h-80 overflow-y-auto">
        <DropdownMenuItem
          onSelect={() => setUseCaseModel(useCase, undefined)}
        >
          <span className="flex-1 text-muted-foreground">Default</span>
          {!currentModel && <Check className="h-3.5 w-3.5 ml-2 shrink-0" />}
        </DropdownMenuItem>
        {loading && (
          <div className="flex items-center justify-center py-2">
            <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
          </div>
        )}
        {error && (
          <p className="px-2 py-1.5 text-[11px] text-destructive">{error}</p>
        )}
        {displayModels.map((m) => (
          <DropdownMenuItem
            key={m}
            onSelect={() => setUseCaseModel(useCase, m)}
          >
            <span className="flex-1 truncate">{prettyModelName(m)}</span>
            {currentModel === m && <Check className="h-3.5 w-3.5 ml-2 shrink-0" />}
          </DropdownMenuItem>
        ))}
        {!loading && displayModels.length === 0 && !error && (
          <p className="px-2 py-1.5 text-[11px] text-muted-foreground italic">
            No models available
          </p>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function UseCaseRoutingSettings() {
  const connections = useConnectionsStore((s) => s.connections);
  const routing = useRoutingStore((s) => s.routing);
  const setRouting = useRoutingStore((s) => s.setRouting);
  const getConnectionForUseCase = useRoutingStore((s) => s.getConnectionForUseCase);

  return (
    // Live-test 2026-04-26 — flattened from `rounded-lg border` cards
    // to flat divide-y rows so the section reads in the same visual
    // language as every other group in AI / Appearance (SettingsGroup
    // primitive). The bordered cards were carrying no real meaning —
    // the actual control is the Select on the right.
    <div className="divide-y divide-border/60">
      {USE_CASES.map((useCase) => {
        const meta = ROUTING_SLOT_LABELS[useCase];
        const currentId = routing[useCase]?.connectionId ?? null;
        const compatible = connections.filter((c) =>
          c.capabilities.includes(useCase),
        );
        const currentConnection = currentId
          ? getConnectionForUseCase(useCase)
          : null;

        return (
          // Stacked layout (live-test 2026-04-26) — matches the
          // refactored `SettingsRow` so the description doesn't get
          // squeezed by the 208 px Select on the right.
          <div key={useCase} className="px-0 py-3">
            <div className="flex items-center gap-4 min-h-[28px]">
              <div className="min-w-0 flex-1">
                <span className="text-[13px] font-medium text-foreground">
                  {meta.label}
                </span>
              </div>
              <div className="shrink-0 flex items-center gap-1">
                <Select
                  value={currentId ?? NONE}
                  onValueChange={(val) =>
                    setRouting(useCase, val === NONE ? null : val)
                  }
                >
                  <SelectTrigger className="w-[200px] text-left">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>
                      <span className="text-muted-foreground">
                        Not configured
                      </span>
                    </SelectItem>
                    {compatible.map((conn) => (
                      <SelectItem key={conn.id} value={conn.id}>
                        <span className="flex items-center gap-1.5">
                          <span
                            className={`h-1.5 w-1.5 rounded-full shrink-0 ${
                              conn.status === 'connected'
                                ? 'bg-green-500'
                                : conn.status === 'error'
                                  ? 'bg-destructive'
                                  : 'bg-muted-foreground'
                            }`}
                          />
                          {conn.label}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {currentConnection && (
                  <ModelPopover
                    useCase={useCase}
                    connection={currentConnection}
                  />
                )}
              </div>
            </div>
            <p className="text-[12px] text-muted-foreground mt-1 leading-relaxed">
              {meta.description}
            </p>
          </div>
        );
      })}
    </div>
  );
}
