import { cn } from "@/lib/utils";

/**
 * Single source of truth for the Local AI status dot — shared by the
 * always-visible quiet status strip (`StatusBar`) and the StatusTray
 * `SessionGroup` so the two dots are guaranteed to show the same colour
 * for the same server state (issue #415).
 *
 * These are semantic status indicators (a traffic-light for the local
 * inference server), so they intentionally use chromatic status colours
 * rather than the strict-neutral UI palette — via the audited status tokens
 * in `globals.css` (`--color-status-ok` / `--color-status-warn`) and
 * `--color-destructive`, never hardcoded Tailwind hues:
 *   running  → green
 *   starting → amber, pulsing (pulse gated on reduced motion)
 *   error    → red
 *   stopped  → faint muted
 */
export function localAiDotClass(serverStatus: string, reducedMotion: boolean): string {
  return serverStatus === "running"
    ? "bg-[var(--color-status-ok)]"
    : serverStatus === "starting"
      ? cn("bg-[var(--color-status-warn)]", !reducedMotion && "animate-pulse")
      : serverStatus === "error"
        ? "bg-destructive"
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
