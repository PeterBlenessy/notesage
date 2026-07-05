import { AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * CrossProjectScopePill — compact warning indicator that replaces the
 * legacy "Cross-project mode" banner (#73). Only rendered when
 * `settings-store.crossProjectMode` is true; clicking opens Settings >
 * Advanced so the user can toggle the mode off.
 */
export function CrossProjectScopePill() {
  const title =
    "Cross-project mode exposes all workspace folders to the agent. Click to open Settings > AI & Agents.";
  return (
    <button
      type="button"
      onClick={() => {
        window.dispatchEvent(
          new CustomEvent("notesage:open-settings", {
            detail: { tab: "ai" },
          }),
        );
      }}
      aria-label={title}
      title={title}
      className={cn(
        "inline-flex items-center gap-1 h-5 px-2 rounded-full shrink-0",
        "text-[11px] font-medium",
        "bg-destructive/10 text-destructive border border-destructive/30",
        "hover:bg-destructive/15 hover:border-destructive/40 transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive/40",
      )}
    >
      <AlertTriangle className="h-3 w-3 shrink-0" strokeWidth={1.8} aria-hidden />
      <span>Cross-project scope</span>
    </button>
  );
}
