import { useEffect, useMemo, useState } from "react";
import { Settings2, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useConnectionsStore } from "@/stores/connections-store";
import { useLocalAIStore } from "@/stores/local-ai-store";
import { tauriApi } from "@/lib/tauri";
import { getAgentModels, prettyModelName } from "@/lib/ai/connections";
import { AGENT_KNOWN_MODELS } from "@/components/settings/connection/ModelSelectionForm";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { PickerItem } from "@/components/ui/picker-item";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { Connection } from "@/lib/ai/connections";

/**
 * Provider quick-config gear (live-test 2026-04-26 #53) — popover
 * containing per-provider config knobs that don't deserve a top-level
 * pill in the row. v1: model picker. Future config knobs (temperature
 * override, max tokens, etc.) plug into the same popover.
 *
 * Model list per connection type:
 *   - agent_managed (ACP): `AGENT_KNOWN_MODELS[agentBinary]` merged with
 *     dynamic `getAgentModels(connection.id)?.models` (probed from
 *     `available_commands_update` events).
 *   - local_bundled: downloaded models from `useLocalAIStore`.
 *   - api_key / openai_compatible: lazy-fetched via
 *     `tauriApi.listModels(provider, apiKey?, baseUrl?)` on first open.
 */
export function ProviderQuickConfig({ connection }: { connection: Connection }) {
  const updateConnection = useConnectionsStore((s) => s.updateConnection);
  const [open, setOpen] = useState(false);
  const [fetchedModels, setFetchedModels] = useState<string[]>([]);
  const [fetching, setFetching] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);

  const localModels = useLocalAIStore((s) => s.models);
  const downloadedLocalModels = useMemo(
    () => localModels.filter((m) => m.downloaded).map((m) => m.id),
    [localModels],
  );

  // Resolve the model list for this connection synchronously when
  // possible; fall back to async fetch on first open.
  const models = useMemo<string[]>(() => {
    if (connection.authMethod === "agent_managed") {
      const creds = connection.credentials as { agentBinary?: string };
      const agentBinary = creds.agentBinary ?? "";
      const known = (AGENT_KNOWN_MODELS[agentBinary] ?? []).map((m) => m.id);
      const dynamic =
        getAgentModels(connection.id)?.models.map((m) => m.modelId) ?? [];
      const knownSet = new Set(known);
      const merged = [...known];
      for (const id of dynamic) if (!knownSet.has(id)) merged.push(id);
      return merged;
    }
    if (connection.authMethod === "local_bundled") {
      return downloadedLocalModels;
    }
    return fetchedModels;
  }, [connection, downloadedLocalModels, fetchedModels]);

  // Lazy-fetch for API-key / OpenAI-compatible providers when the popover
  // opens. ACP and local_bundled are sync (handled above).
  const needsFetch =
    connection.authMethod !== "agent_managed" &&
    connection.authMethod !== "local_bundled";

  useEffect(() => {
    if (!open || !needsFetch || fetchedModels.length > 0 || fetching) return;
    let cancelled = false;
    setFetching(true);
    setFetchError(null);
    (async () => {
      try {
        const apiKey =
          connection.credentials.type === "api_key"
            ? connection.credentials.key
            : undefined;
        const baseUrl = connection.config?.baseUrl;
        const provider =
          connection.provider === "openai_compatible"
            ? "openai_compatible"
            : connection.provider;
        const result = await tauriApi.listModels(provider, apiKey, baseUrl);
        if (!cancelled) setFetchedModels(result);
      } catch (err) {
        if (!cancelled) setFetchError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) setFetching(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, needsFetch, fetchedModels.length, fetching, connection]);

  const currentModel = connection.config?.model;

  const handlePickModel = (modelId: string | undefined) => {
    updateConnection(connection.id, {
      config: { ...connection.config, model: modelId } as Connection["config"],
    });
  };

  const tooltipText = currentModel
    ? `Model: ${prettyModelName(currentModel)}`
    : "Default model — click to choose";

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <TooltipProvider delayDuration={300}>
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label="Provider quick config"
                className={cn(
                  "inline-flex items-center justify-center h-7 w-7 rounded-md shrink-0",
                  "text-muted-foreground border border-transparent",
                  "hover:text-foreground hover:bg-muted hover:border-border",
                  "transition-colors duration-150",
                  "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
                )}
              >
                <Settings2 className="h-3.5 w-3.5" strokeWidth={1.5} />
              </button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent side="top" className="text-xs max-w-[240px]">
            {tooltipText}
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
      <DropdownMenuContent
        side="top"
        align="start"
        className="w-64 max-h-[320px] overflow-y-auto p-1"
      >
        <div className="px-2 py-1 text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
          Model
        </div>
        <DropdownMenuRadioGroup
          value={currentModel ?? ""}
          onValueChange={(value) => {
            handlePickModel(value === "" ? undefined : value);
          }}
        >
          <PickerItem value="" label="Default" />
          {models.map((m) => (
            <PickerItem key={m} value={m} label={prettyModelName(m)} />
          ))}
        </DropdownMenuRadioGroup>
        {fetching ? (
          <div className="flex items-center justify-center py-2">
            <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
          </div>
        ) : null}
        {fetchError ? (
          <p className="px-2 py-1.5 text-[11px] text-destructive">
            {fetchError}
          </p>
        ) : null}
        {!fetching && !fetchError && models.length === 0 ? (
          <p className="px-2 py-1.5 text-[11px] text-muted-foreground italic">
            No models available
          </p>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
