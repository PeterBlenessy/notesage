import { cn } from "@/lib/utils";

/**
 * Single source of truth for the Local AI status dot — shared by the
 * always-visible quiet status strip (`StatusBar`) and the StatusTray
 * `SessionGroup` so the two dots are guaranteed to show the same colour
 * for the same server state (issue #415).
 *
 * These are semantic status indicators (a traffic-light for the local
 * inference server), so they intentionally use chromatic status colours
 * rather than the strict-neutral UI palette — matching the always-visible
 * strip dot users already recognise:
 *   running  → green
 *   starting → amber, pulsing (pulse gated on reduced motion)
 *   error    → red
 *   stopped  → faint muted
 */
export function localAiDotClass(serverStatus: string, reducedMotion: boolean): string {
  return serverStatus === "running"
    ? "bg-green-500"
    : serverStatus === "starting"
      ? cn("bg-amber-500", !reducedMotion && "animate-pulse")
      : serverStatus === "error"
        ? "bg-red-500"
        : "bg-muted-foreground/30";
}

/** Human-readable status label for the Local AI dot tooltip / aria-label. */
export function localAiStatusLabel(serverStatus: string): string {
  return serverStatus === "running"
    ? "Running"
    : serverStatus === "starting"
      ? "Starting"
      : serverStatus === "error"
        ? "Error"
        : "Stopped";
}
