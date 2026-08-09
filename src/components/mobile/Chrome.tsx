import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * iOS 26-style chrome for the mobile shell (issue #581): floating glass
 * "button islands" pinned to the screen corners, with content scrolling
 * FULL-HEIGHT beneath them — Apple Notes' layout (nav island top-left,
 * actions top-right, status/actions along the bottom) and the mobile cousin
 * of the desktop Quiet Composer's content-under-chrome idea. There is no
 * full-width bar: each island is a self-contained translucent pill.
 *
 * Placement contract (keep this consistent across screens):
 *   top-left      navigation (back / context glyph)
 *   top-right     screen actions (refresh; later share / edit)
 *   bottom-center passive status (item count)
 *   bottom-left   navigation when the top row is owned by a viewer's own
 *                 toolbar (the PDF viewer's pill) — never both
 *   bottom-right  primary creation action (later: new note)
 */

export type IslandCorner =
  | "top-left"
  | "top-right"
  | "top-center"
  | "bottom-left"
  | "bottom-right"
  | "bottom-center";

const CORNER: Record<IslandCorner, string> = {
  "top-left": "left-3 top-[max(0.5rem,env(safe-area-inset-top))]",
  "top-right": "right-3 top-[max(0.5rem,env(safe-area-inset-top))]",
  "top-center": "left-1/2 -translate-x-1/2 top-[max(0.5rem,env(safe-area-inset-top))]",
  "bottom-left": "left-3 bottom-[max(0.75rem,env(safe-area-inset-bottom))]",
  "bottom-right": "right-3 bottom-[max(0.75rem,env(safe-area-inset-bottom))]",
  "bottom-center": "left-1/2 -translate-x-1/2 bottom-[max(0.75rem,env(safe-area-inset-bottom))]",
};

/** A floating glass island holding one or more controls. */
export function Island({
  corner,
  className,
  children,
}: {
  corner: IslandCorner;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "absolute z-40 inline-flex items-center gap-0.5 rounded-full border border-border bg-background/75 px-1 py-1 shadow-sm backdrop-blur-xl",
        CORNER[corner],
        className,
      )}
    >
      {children}
    </div>
  );
}

/** A 44pt icon button for an island. */
export function ChromeButton({
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

/** Insets for full-height scrollers so content starts clear of the islands. */
export const CONTENT_INSETS: React.CSSProperties = {
  paddingTop: "calc(3.75rem + env(safe-area-inset-top))",
  paddingBottom: "calc(4rem + env(safe-area-inset-bottom))",
};

/** Top offset for viewers that own their toolbar row (PDF). */
export const TOP_CHROME_CLEARANCE = "0px";
