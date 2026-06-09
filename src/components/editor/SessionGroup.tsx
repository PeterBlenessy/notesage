import { Cpu } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useLocalAIStore } from "@/stores/local-ai-store";
import { useConnectionsStore } from "@/stores/connections-store";
import { useReducedMotion } from "@/hooks/useReducedMotion";
import { localAiDotClass, localAiStatusLabel } from "./local-ai-dot";

// `SessionGroup` is kept as the export name to avoid touching the
// `StatusTrayGroup = "session"` deep-link key in StatusBar.
export function SessionGroup() {
  const serverStatus = useLocalAIStore((s) => s.serverStatus);
  const activeModelId = useLocalAIStore((s) => s.activeModelId);
  const setActiveModel = useLocalAIStore((s) => s.setActiveModel);
  const models = useLocalAIStore((s) => s.models);
  const connections = useConnectionsStore((s) => s.connections);
  const reducedMotion = useReducedMotion();

  const hasConnection = connections.some(
    (c) => c.provider === "local_ai" && c.authMethod === "local_bundled",
  );
  if (!hasConnection) return null;

  // Shared helper keeps this dot and the quiet status strip's dot in sync.
  const dot = localAiDotClass(serverStatus, reducedMotion);
  const statusLabel = localAiStatusLabel(serverStatus);

  const downloadedModels = models.filter((m) => m.downloaded);

  return (
    <section className="space-y-2" aria-label="Local AI">
      <div className="flex items-center gap-2">
        <Cpu className="h-3.5 w-3.5 shrink-0" strokeWidth={1.5} />
        <span className="text-xs font-medium">Local AI</span>
        <Tooltip>
          <TooltipTrigger asChild>
            <span
              className={cn("ml-auto h-1.5 w-1.5 rounded-full shrink-0", dot)}
              data-testid="local-ai-status-dot"
              data-server-status={serverStatus}
              role="status"
              aria-label={`Local AI ${statusLabel}`}
            />
          </TooltipTrigger>
          <TooltipContent side="top" className="text-xs max-w-[220px]">
            {statusLabel}
          </TooltipContent>
        </Tooltip>
      </div>

      <div className="flex items-center justify-between gap-2 px-2 min-h-0">
        <label
          htmlFor="status-tray-local-ai-model"
          className="text-xs text-muted-foreground"
        >
          Model
        </label>
        <Select
          value={activeModelId ?? undefined}
          onValueChange={setActiveModel}
          disabled={downloadedModels.length === 0}
        >
          <SelectTrigger
            id="status-tray-local-ai-model"
            className={cn(
              "h-5 w-[160px] max-w-[160px] text-[11px] leading-none",
              "px-1.5 py-0 gap-1 border-0 bg-muted/40 hover:bg-muted/70",
              "[&>svg]:size-2.5",
              "[&_[data-slot=select-value]]:truncate [&_[data-slot=select-value]]:min-w-0",
            )}
            aria-label="Active local AI model"
          >
            <SelectValue
              placeholder={
                downloadedModels.length === 0 ? "No models downloaded" : "Pick a model"
              }
            />
          </SelectTrigger>
          <SelectContent>
            {downloadedModels.map((m) => (
              <SelectItem key={m.id} value={m.id} className="text-xs">
                {m.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </section>
  );
}
