import type { ReactNode } from "react";

/**
 * iOS-style floating bottom bar (issue #581). Follows the iOS 26 pattern:
 * a pill-shaped, translucent container floating above the content — inset
 * from the screen edges and the home indicator — rather than a full-width
 * bar glued to the bottom. Content scrolls beneath it, so scroll containers
 * behind this bar must reserve `MOBILE_BOTTOM_BAR_CLEARANCE` of bottom
 * padding.
 *
 * The glass look is approximated with a translucent theme background +
 * backdrop blur (the web has no Liquid Glass material); every color rides
 * the neutral token palette so light/dark both work.
 */
export function BottomBar({ children }: { children: ReactNode }) {
  return (
    <div
      className="pointer-events-none fixed inset-x-0 z-40 flex justify-center"
      style={{ bottom: "calc(0.75rem + env(safe-area-inset-bottom))" }}
    >
      <div
        className="pointer-events-auto flex h-12 max-w-[calc(100vw-2.5rem)] items-center gap-1 rounded-full border border-border bg-background/80 px-2 shadow-lg backdrop-blur-xl"
        role="toolbar"
      >
        {children}
      </div>
    </div>
  );
}

/** Bottom padding that scroll containers need so content clears the bar. */
export const MOBILE_BOTTOM_BAR_CLEARANCE = "calc(4.75rem + env(safe-area-inset-bottom))";

/** A round 44pt icon button for the bottom bar. */
export function BarButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
    >
      {children}
    </button>
  );
}
