import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Search, X, ChevronUp, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * iOS 26-style chrome for the mobile shell (issue #581): floating glass
 * "button islands" pinned to the screen corners, with content scrolling
 * FULL-HEIGHT beneath them — Apple Notes' layout (nav island top-left,
 * actions top-right, status/actions along the bottom) and the mobile cousin
 * of the desktop Quiet Composer's content-under-chrome idea. There is no
 * full-width bar: each island is a self-contained translucent pill.
 *
 * Island metrics follow the platform: 44pt controls (HIG minimum) in a
 * ~48pt island — the height of iOS 26's floating bars — with the glass
 * approximated as a strongly translucent background + blur + saturation
 * boost (backdrop-saturate), so content color bleeds through the way the
 * native material lets it.
 *
 * Placement contract (keep this consistent across screens):
 *   top-left      navigation (back / context glyph)
 *   top-right     screen actions (refresh; later share / edit)
 *   bottom-center search (iOS 26 puts search at the bottom) + passive status
 *   bottom-left   navigation when a viewer owns the top row (the PDF pill)
 *   bottom-right  reserved: primary creation action (new note)
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

/** The shared glass recipe — one source so every island matches. */
export const ISLAND_GLASS =
  "rounded-full border border-border/60 bg-background/60 shadow-sm backdrop-blur-xl backdrop-saturate-150";

/**
 * A floating glass island holding one or more controls (~48pt tall).
 *
 * Portaled to document.body with `position: fixed` — the same treatment as
 * the desktop FloatingCommandBar. Islands are chrome, NOT page content: no
 * page layout, scroll container, zoom or clipping context may ever move,
 * resize or capture them.
 */
export function Island({
  corner,
  className,
  children,
}: {
  corner: IslandCorner;
  className?: string;
  children: ReactNode;
}) {
  return createPortal(
    <div
      className={cn(
        "fixed z-40 inline-flex items-center gap-0.5 px-0.5 py-0.5",
        ISLAND_GLASS,
        CORNER[corner],
        className,
      )}
    >
      {children}
    </div>,
    document.body,
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

/**
 * Bottom-center search island. Collapsed it shows the search glyph plus a
 * passive status (item count, Files-style); tapped, it expands into an input.
 * `matches` (current 1-based index, total, next/prev) adds find-navigation
 * controls for document search.
 */
export function SearchIsland({
  query,
  onQueryChange,
  placeholder,
  status,
  matches,
}: {
  query: string;
  onQueryChange: (q: string) => void;
  placeholder: string;
  status?: ReactNode;
  matches?: { current: number; total: number; onNext: () => void; onPrev: () => void };
}) {
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  const close = () => {
    onQueryChange("");
    setOpen(false);
  };

  if (!open) {
    return (
      <Island corner="bottom-center">
        <button
          type="button"
          aria-label="Search"
          onClick={() => setOpen(true)}
          className="flex h-11 items-center gap-2 rounded-full px-4 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <Search strokeWidth={1.5} className="h-4 w-4" />
          {status != null && <span className="text-xs">{status}</span>}
        </button>
      </Island>
    );
  }

  return (
    <Island corner="bottom-center" className="w-[calc(100vw-1.5rem)] max-w-96 px-2">
      <Search strokeWidth={1.5} className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
      <input
        ref={inputRef}
        type="search"
        value={query}
        onChange={(e) => onQueryChange(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        className="h-11 w-full min-w-0 flex-1 bg-transparent text-base text-foreground outline-none placeholder:text-muted-foreground"
      />
      {matches && matches.total > 0 && (
        <>
          <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
            {matches.current}/{matches.total}
          </span>
          <ChromeButton label="Previous match" onClick={matches.onPrev}>
            <ChevronUp strokeWidth={1.5} className="h-4 w-4" />
          </ChromeButton>
          <ChromeButton label="Next match" onClick={matches.onNext}>
            <ChevronDown strokeWidth={1.5} className="h-4 w-4" />
          </ChromeButton>
        </>
      )}
      <ChromeButton label="Close search" onClick={close}>
        <X strokeWidth={1.5} className="h-4 w-4" />
      </ChromeButton>
    </Island>
  );
}

/** Insets for full-height scrollers so content starts clear of the islands. */
export const CONTENT_INSETS: React.CSSProperties = {
  paddingTop: "calc(3.75rem + env(safe-area-inset-top))",
  paddingBottom: "calc(4.25rem + env(safe-area-inset-bottom))",
};
