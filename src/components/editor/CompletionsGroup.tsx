import { useMemo } from "react";
import { cn } from "@/lib/utils";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useSettingsStore } from "@/stores/settings-store";
import { trackSettingToggle } from "@/lib/telemetry";
import { useRoutingStore } from "@/stores/routing-store";
import { useConnectionsStore } from "@/stores/connections-store";

/** Italic T with sparkle trail — mirrors the icon in StatusBar.tsx. */
function InlineCompletionIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" className={className}>
      <line x1="2" y1="3" x2="8.5" y2="3" strokeWidth="1.5" strokeLinecap="round" />
      <line x1="6.5" y1="3" x2="3.5" y2="13" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M9 9 L9.7 11.8 L12 13 L9.7 14.2 L9 17 L8.3 14.2 L6 13 L8.3 11.8 Z" fill="currentColor" stroke="none" />
      <path d="M13.5 2 L14.55 6.2 L18 8 L14.55 9.8 L13.5 14 L12.45 9.8 L9 8 L12.45 6.2 Z" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function CompletionsGroup() {
  const inlineCompletionsDisabled = useSettingsStore((s) => s.inlineCompletionsDisabled);
  const setInlineCompletionsDisabled = useSettingsStore(
    (s) => s.setInlineCompletionsDisabled,
  );
  const routing = useRoutingStore((s) => s.routing);
  const setRouting = useRoutingStore((s) => s.setRouting);
  const connections = useConnectionsStore((s) => s.connections);

  const compatibleConnections = useMemo(
    () => connections.filter((c) => c.capabilities.includes("inline_completion")),
    [connections],
  );

  const currentConnectionId = routing.inline_completion?.connectionId ?? null;

  const isOff =
    inlineCompletionsDisabled ||
    !currentConnectionId ||
    !compatibleConnections.some((c) => c.id === currentConnectionId);

  // Sentinel value meaning "no provider / disabled" — matches the NONE
  // constant in UseCaseRoutingSettings so the two surfaces share vocabulary.
  const OFF = "__off__";
  const selectValue = isOff ? OFF : (currentConnectionId ?? OFF);

  return (
    <section className="space-y-2" aria-label="Completions">
      <div className="flex items-center gap-2">
        <InlineCompletionIcon className="h-3.5 w-3.5 shrink-0" />
        <span className="text-xs font-medium">Completions</span>
      </div>

      <Select
        value={selectValue}
        onValueChange={(val) => {
          if (val === OFF) setInlineCompletionsDisabled(true);
          else {
            setInlineCompletionsDisabled(false);
            setRouting("inline_completion", val);
          }
          trackSettingToggle("inline_completions", val !== OFF);
        }}
      >
        <SelectTrigger aria-label="Completion provider" className="w-full h-8 text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={OFF}>
            <span className="text-muted-foreground">Off</span>
          </SelectItem>
          {compatibleConnections.map((conn) => (
            <SelectItem key={conn.id} value={conn.id}>
              <span className="flex items-center gap-1.5">
                <span
                  className={cn(
                    "h-1.5 w-1.5 rounded-full shrink-0",
                    conn.status === "connected"
                      ? "bg-foreground/60"
                      : conn.status === "error"
                        ? "bg-destructive"
                        : "bg-foreground/40",
                  )}
                />
                {conn.label}
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {compatibleConnections.length === 0 && (
        <p className="text-[10px] text-muted-foreground/60 leading-tight px-2">
          No inline completion provider configured.{" "}
          <button
            type="button"
            onClick={() =>
              window.dispatchEvent(new CustomEvent("notesage:open-settings"))
            }
            className="underline hover:text-foreground transition-colors"
          >
            Configure in Settings…
          </button>
        </p>
      )}
    </section>
  );
}
