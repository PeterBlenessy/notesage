import { useState, useEffect, useCallback, useMemo } from 'react';
import { useConnectionsStore } from '@/stores/connections-store';
import { useRoutingStore } from '@/stores/routing-store';
import { useLocalAIStore } from '@/stores/local-ai-store';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
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
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Button } from '@/components/ui/button';
import { ChevronRight, Settings2, Check, Loader2, RefreshCw } from 'lucide-react';
import type { AICapability, Connection } from '@/lib/ai/connections';
import { ROUTING_SLOT_LABELS } from '@/lib/ai/connections';
import { tauriApi } from '@/lib/tauri';
import { cn } from '@/lib/utils';

const USE_CASES: AICapability[] = ['interactive', 'agent_tasks', 'inline_completion'];

/** Sentinel value for the "Not configured" select option */
const NONE = '__none__';

function ModelPopover({ useCase, connection }: { useCase: AICapability; connection: Connection }) {
  const currentModel = useRoutingStore((s) => s.routing[useCase]?.model);
  const setUseCaseModel = useRoutingStore((s) => s.setUseCaseModel);

  const isLocalBundled = connection.authMethod === 'local_bundled';
  const canListModels = connection.authMethod !== 'agent_managed' && !isLocalBundled;

  // For local_bundled, use downloaded models from local-ai-store
  const localModels = useLocalAIStore((s) => s.models);
  const localModelNames = useMemo(
    () => localModels.filter((m) => m.downloaded).map((m) => m.id),
    [localModels]
  );

  const [open, setOpen] = useState(false);
  const [inputValue, setInputValue] = useState(currentModel ?? '');
  const [models, setModels] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Use local models for local_bundled, fetched models for others
  const displayModels = isLocalBundled ? localModelNames : models;

  useEffect(() => {
    setInputValue(currentModel ?? '');
  }, [currentModel]);

  const fetchModels = useCallback(async () => {
    if (!canListModels) return;
    setLoading(true);
    setError(null);
    try {
      const apiKey = connection.credentials.type === 'api_key' ? connection.credentials.key : undefined;
      const baseUrl = connection.config?.baseUrl;
      const provider = connection.provider === 'openai_compatible' ? 'openai_compatible' : connection.provider;
      const result = await tauriApi.listModels(provider, apiKey, baseUrl);
      setModels(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setModels([]);
    } finally {
      setLoading(false);
    }
  }, [connection, canListModels]);

  useEffect(() => {
    if (open && canListModels && models.length === 0 && !loading && !error) {
      fetchModels();
    }
  }, [open, canListModels, models.length, loading, error, fetchModels]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <TooltipProvider delayDuration={300}>
        <Tooltip>
          <TooltipTrigger asChild>
            <PopoverTrigger asChild>
              <button
                className={cn(
                  'h-7 w-7 inline-flex items-center justify-center rounded-md transition-colors duration-150',
                  'hover:bg-muted text-muted-foreground hover:text-foreground',
                  currentModel && 'text-foreground',
                )}
              >
                <Settings2 className="h-3.5 w-3.5" strokeWidth={1.5} />
              </button>
            </PopoverTrigger>
          </TooltipTrigger>
          <TooltipContent side="top" className="text-xs">
            {currentModel ? `Model: ${currentModel}` : 'Override model'}
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
      <PopoverContent className="w-56 p-0" align="end">
        <Command>
          <div className="flex items-center gap-1 px-1">
            <CommandInput
              placeholder={canListModels ? "Search or type\u2026" : "Type model name\u2026"}
              value={inputValue}
              onValueChange={setInputValue}
              className="flex-1 h-8 text-xs"
            />
            {canListModels && (
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 shrink-0"
                onClick={(e) => {
                  e.stopPropagation();
                  fetchModels();
                }}
                disabled={loading}
              >
                {loading ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <RefreshCw className="h-3 w-3" />
                )}
              </Button>
            )}
          </div>
          <CommandList>
            {error && (
              <p className="px-3 py-1.5 text-[11px] text-destructive">{error}</p>
            )}
            <CommandGroup>
              <CommandItem
                value="__default__"
                onSelect={() => {
                  setUseCaseModel(useCase, undefined);
                  setInputValue('');
                  setOpen(false);
                }}
              >
                <Check
                  className={cn('mr-2 h-3 w-3', !currentModel ? 'opacity-100' : 'opacity-0')}
                />
                <span className="text-xs text-muted-foreground">Default</span>
              </CommandItem>
            </CommandGroup>
            {!isLocalBundled && canListModels && !loading && !error && displayModels.length === 0 && (
              <CommandEmpty className="text-xs">
                Type a model name or click refresh
              </CommandEmpty>
            )}
            {displayModels.length > 0 && (
              <CommandGroup>
                {displayModels.map((m) => (
                  <CommandItem
                    key={m}
                    value={m}
                    onSelect={(val) => {
                      setUseCaseModel(useCase, val);
                      setInputValue(val);
                      setOpen(false);
                    }}
                  >
                    <Check
                      className={cn('mr-2 h-3 w-3', currentModel === m ? 'opacity-100' : 'opacity-0')}
                    />
                    <span className="truncate text-xs">{m}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
            {inputValue.trim() && !displayModels.includes(inputValue.trim()) && inputValue.trim() !== '__default__' && (
              <CommandGroup>
                <CommandItem
                  value={`custom-${inputValue.trim()}`}
                  onSelect={() => {
                    setUseCaseModel(useCase, inputValue.trim());
                    setOpen(false);
                  }}
                >
                  <Check className="mr-2 h-3 w-3 opacity-0" />
                  <span className="text-xs">Use &quot;{inputValue.trim()}&quot;</span>
                </CommandItem>
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

export function UseCaseRoutingSettings() {
  const connections = useConnectionsStore((s) => s.connections);
  const routing = useRoutingStore((s) => s.routing);
  const setRouting = useRoutingStore((s) => s.setRouting);
  const getConnectionForUseCase = useRoutingStore((s) => s.getConnectionForUseCase);

  return (
    <Collapsible>
      <CollapsibleTrigger className="group flex items-center gap-2 w-full text-left py-2 text-sm font-semibold text-muted-foreground hover:text-foreground transition-colors duration-150">
        <ChevronRight className="h-4 w-4 shrink-0 transition-transform duration-200 group-data-[state=open]:rotate-90" strokeWidth={1.5} />
        Advanced Routing
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="pt-2 pb-1 space-y-2">
          <p className="text-xs text-muted-foreground mb-3">
            Override which connection handles each use case. By default,
            connections are auto-assigned when added.
          </p>
          {USE_CASES.map((useCase) => {
            const meta = ROUTING_SLOT_LABELS[useCase];
            const currentId = routing[useCase]?.connectionId ?? null;
            const compatible = connections.filter((c) =>
              c.capabilities.includes(useCase)
            );
            const currentConnection = currentId ? getConnectionForUseCase(useCase) : null;

            return (
              <div
                key={useCase}
                className="px-4 py-3 rounded-lg border border-border hover:border-muted-foreground/50 transition-colors duration-150"
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <span className="text-sm font-medium">{meta.label}</span>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {meta.description}
                    </p>
                  </div>

                  <div className="flex items-center gap-1 shrink-0">
                    <Select
                      value={currentId ?? NONE}
                      onValueChange={(val) =>
                        setRouting(useCase, val === NONE ? null : val)
                      }
                    >
                      <SelectTrigger className="w-44 text-left">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={NONE}>
                          <span className="text-muted-foreground">Not configured</span>
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
                      <ModelPopover useCase={useCase} connection={currentConnection} />
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
