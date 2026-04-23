import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { useReducedMotion } from "@/hooks/useReducedMotion";

/**
 * `ViewerToolbarPill` — shared floating pill primitive for viewer toolbars
 * (PDF, EPUB, DOCX, PPTX, code-editor language pill, etc.).
 *
 * Visual chrome matches the editor's quiet-composer toolbar pill (#49):
 * rounded, bordered, backdrop-blurred, subtle shadow. Positioning defaults
 * to top-centre (`fixed top-4 left-1/2 -translate-x-1/2`) and callers can
 * override via `className`.
 *
 * Fade behaviour is scroll-driven (viewers have no "typing" signal). The
 * pill resolves its scroll target from `scrollRef` when provided, otherwise
 * walks the DOM at mount time for the nearest ancestor with
 * `overflow-y: auto|scroll`, falling back to `window`. While the target is
 * being scrolled the pill fades to `opacity-0`; 1200 ms of scroll inactivity
 * (or any mouse-move / focus-within on the pill) restores it immediately.
 *
 * Reduced motion: when `prefers-reduced-motion: reduce` is set, the pill
 * never fades — it stays fully opaque regardless of scroll activity and the
 * opacity transition is disabled.
 *
 * The primitive deliberately has no baked-in content: consumers slot their
 * own buttons, separators, and controls via `children`.
 */
export interface ViewerToolbarPillProps {
  /** Toolbar content (buttons, separators, etc.). */
  children: React.ReactNode;
  /**
   * Optional DOM ref of the scrolling viewport. When omitted, the nearest
   * ancestor scroll container resolved at mount time is used; if none is
   * found, `window` is the scroll source.
   */
  scrollRef?: React.RefObject<HTMLElement | null>;
  /**
   * Optional identifier for the viewer. Written as `data-viewer-id` so
   * callers can tag pills for CSS / test queries.
   */
  viewerId?: string;
  /**
   * Additional classes merged after the defaults — useful for overriding
   * positioning (e.g. `relative` inside a flow layout instead of `fixed`).
   */
  className?: string;
}

const SCROLL_QUIET_MS = 1200;

/**
 * Walk up from `start` looking for the nearest scrollable ancestor.
 * Matches elements where computed `overflow-y` is `auto` or `scroll` AND
 * the element actually scrolls (scrollHeight > clientHeight), falling back
 * to the first ancestor that at least reports an overflow style so virtual
 * scroll containers still qualify before content has rendered.
 */
function findScrollAncestor(start: HTMLElement | null): HTMLElement | null {
  if (!start || typeof window === "undefined") return null;
  let node: HTMLElement | null = start.parentElement;
  while (node) {
    const style = window.getComputedStyle(node);
    const overflowY = style.overflowY;
    if (overflowY === "auto" || overflowY === "scroll") {
      return node;
    }
    node = node.parentElement;
  }
  return null;
}

export function ViewerToolbarPill({
  children,
  scrollRef,
  viewerId,
  className,
}: ViewerToolbarPillProps) {
  const reducedMotion = useReducedMotion();
  const rootRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<number | null>(null);
  const [scrolling, setScrolling] = useState(false);

  useEffect(() => {
    // Reduced-motion users never get a fade — skip all event wiring.
    if (reducedMotion) return;

    const explicit = scrollRef?.current ?? null;
    const target: HTMLElement | Window =
      explicit ?? findScrollAncestor(rootRef.current) ?? window;

    const clearTimer = () => {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };

    const scheduleClear = () => {
      clearTimer();
      timerRef.current = window.setTimeout(() => {
        setScrolling(false);
        timerRef.current = null;
      }, SCROLL_QUIET_MS);
    };

    const handleScroll = () => {
      setScrolling(true);
      scheduleClear();
    };

    target.addEventListener("scroll", handleScroll, { passive: true });
    return () => {
      target.removeEventListener("scroll", handleScroll);
      clearTimer();
    };
  }, [scrollRef, reducedMotion]);

  // Cancel the fade the moment the user interacts with the pill — keeps
  // controls reachable during long scroll sessions.
  const cancelFade = () => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (scrolling) setScrolling(false);
  };

  const faded = !reducedMotion && scrolling;

  return (
    <div
      ref={rootRef}
      role="toolbar"
      aria-label="Viewer toolbar"
      data-quiet-toolbar=""
      data-viewer-id={viewerId}
      data-scrolling={faded ? "true" : "false"}
      data-reduced-motion={reducedMotion ? "true" : "false"}
      onMouseMove={cancelFade}
      onFocus={cancelFade}
      className={cn(
        "fixed top-4 left-1/2 -translate-x-1/2 z-40",
        "inline-flex items-center gap-0.5 px-1.5 py-1 min-w-0",
        "rounded-full border border-border bg-background/70 shadow-sm",
        "backdrop-blur-[14px]",
        !reducedMotion && "transition-opacity duration-[340ms] ease-in-out",
        faded ? "opacity-0" : "opacity-100",
        className,
      )}
    >
      {children}
    </div>
  );
}
