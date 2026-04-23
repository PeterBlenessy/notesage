import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useReducedMotion } from "@/hooks/useReducedMotion";

export interface FocusPillProps {
  active: boolean;
  onExit: () => void;
}

export function FocusPill({ active, onExit }: FocusPillProps) {
  const reducedMotion = useReducedMotion();

  if (!active) {
    return null;
  }

  // NOTE: The outer container is intentionally NOT `role="status"` /
  // `aria-live="polite"`. The `useFocusMode` hook appends its own short-lived
  // aria-live announcer on enter/exit with the canonical wording from the
  // 2026-04-21 UI-refresh PRD ("Focus mode on. Press Command period to exit.").
  // Duplicating the live region here would cause the announcement to fire
  // twice and would also re-announce the pill's hint text on every re-render.
  //
  // The decorative hint `<span>` is `aria-hidden="true"` — the announcement
  // does the work for AT, the pill is visual-only chrome for sighted users.
  // The exit `<Button>` remains in the accessibility tree with its
  // `aria-label` so keyboard / AT users can still trigger exit (beyond the
  // global ⌘. shortcut).
  return (
    <div
      data-focus-pill="true"
      className={cn(
        "fixed top-4 left-1/2 -translate-x-1/2 z-50",
        "px-3 py-1.5 flex items-center gap-2",
        "rounded-full border border-border bg-background/70 shadow-sm backdrop-blur-[14px]",
        "text-xs text-foreground",
        !reducedMotion &&
          "animate-in fade-in-0 slide-in-from-top-1 duration-[180ms] ease-out",
      )}
    >
      <span aria-hidden="true">
        Focus ·{" "}
        <kbd className="font-mono text-muted-foreground">⌘.</kbd>
        {" "}to exit
      </span>
      <Button
        variant="ghost"
        size="icon-xs"
        aria-label="Exit focus mode"
        onClick={onExit}
      >
        <X className="h-3 w-3" strokeWidth={1.5} />
      </Button>
    </div>
  );
}
