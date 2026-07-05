import { Lock } from "lucide-react";
import { cn } from "@/lib/utils";
import { ProviderLogo } from "@/components/ProviderLogo";
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

interface ProviderPillProps {
  connection: Connection | null;
  connections: Connection[];
  onPick: (connectionId: string) => void;
  /** True when the active conversation has at least one project with
   *  `aiLock`. Disables the picker dropdown — clicking the pill opens
   *  the explain-lock dialog instead. */
  locked: boolean;
  /** The locked connection (resolved from `aiLock.connectionId`).
   *  Used for the title / aria-label copy. */
  lockedConnection: Connection | null;
  /** Paths to pass to `onExplainLock` when the user clicks the pill in
   *  locked mode. */
  lockedProjectPaths: string[];
  /** Open the explain-lock dialog with the given locked paths. */
  onExplainLock: (paths: string[]) => void;
}

export function ProviderPill({
  connection,
  connections,
  onPick,
  locked,
  lockedConnection,
  lockedProjectPaths,
  onExplainLock,
}: ProviderPillProps) {
  const label = connection?.label ?? "No provider";
  const provider = connection?.provider ?? null;

  // Locked variant — single static button.
  // Click opens the explain-lock dialog.
  if (locked) {
    return (
      <button
        type="button"
        data-testid="cmd-bar-provider"
        data-locked="true"
        onClick={() => onExplainLock(lockedProjectPaths)}
        className={cn(
          "inline-flex items-center gap-1.5 h-7 px-2 rounded-md shrink-0",
          "text-xs font-medium text-foreground",
          "border border-transparent bg-muted",
          "transition-colors duration-150",
          "hover:border-border",
          "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
        )}
        title={`Locked to ${
          lockedConnection?.label ?? "a specific provider"
        } by project — click to learn more`}
        aria-label={`Provider locked to ${
          lockedConnection?.label ?? "a specific provider"
        }. Click to learn more.`}
      >
        {provider ? (
          <ProviderLogo provider={provider} className="w-3.5 h-3.5" bare />
        ) : null}
        <span>{label}</span>
        <Lock className="h-3 w-3 opacity-60" strokeWidth={1.5} aria-hidden="true" />
      </button>
    );
  }

  return (
    <DropdownMenu>
      <TooltipProvider delayDuration={300}>
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                data-testid="cmd-bar-provider"
                data-locked="false"
                className={cn(
                  // Live-test 2026-04-26 — picker rhythm (h-7, text-xs
                  // font-medium, transparent border, soft `bg-muted` fill
                  // — same as ProjectChip).
                  "inline-flex items-center gap-1.5 h-7 px-2 rounded-md shrink-0",
                  "text-xs font-medium text-foreground",
                  "border border-transparent bg-muted",
                  "transition-colors duration-150",
                  "hover:border-border",
                  "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
                )}
                aria-label={`Active provider: ${label}`}
              >
                {provider ? (
                  <ProviderLogo provider={provider} className="w-3.5 h-3.5" bare />
                ) : null}
                <span>{label}</span>
              </button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent side="top" className="text-xs max-w-[220px]">
            Active provider: {label}
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
      <DropdownMenuContent align="start" className="min-w-[200px] p-1">
        <DropdownMenuRadioGroup
          value={connection?.id ?? ""}
          onValueChange={(value) => {
            if (value && value !== connection?.id) onPick(value);
          }}
        >
          {connections.map((c) => (
            <PickerItem
              key={c.id}
              value={c.id}
              label={c.label}
              leading={<ProviderLogo provider={c.provider} className="w-4 h-4" bare />}
            />
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
