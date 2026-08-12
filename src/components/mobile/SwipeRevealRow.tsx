import { useRef, useState, type ComponentType, type ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface SwipeRevealAction {
  id: string;
  label: string;
  icon: ComponentType<{ className?: string; strokeWidth?: number }>;
  onSelect: () => void;
  tone?: "default" | "destructive";
}

/** Width (px) of a single revealed action button. Fixed rather than
 *  measured — jsdom reports 0 for every layout box, so a measured width
 *  would make the reveal threshold untestable; a fixed width also keeps the
 *  gesture math identical on device. */
const ACTION_WIDTH = 72;
/** Extra leftward travel past the fully-revealed strip that commits the
 *  edge action (full-swipe-to-delete, #618) — the Mail/Notes gesture. */
const FULL_SWIPE_EXTRA = 96;
/** Pointer movement (px) before a press counts as a drag rather than a tap —
 *  keeps a few pixels of jitter from hijacking a normal row tap. */
const DRAG_THRESHOLD = 8;

interface DragState {
  startX: number;
  startOffset: number;
  isDrag: boolean;
  lastOffset: number;
}

/**
 * Swipe-to-reveal wrapper for a single list row (iOS folder view, issue
 * #618). Slides `children` (the row content) left on a leftward drag to
 * reveal `actions` behind it — the standard iOS list idiom. `actions` is a
 * plain array so a second action (Delete, #619) is an additional entry, not
 * a rewrite of the gesture handling below.
 */
export function SwipeRevealRow({
  actions,
  children,
}: {
  actions: SwipeRevealAction[];
  children: ReactNode;
}) {
  const revealWidth = actions.length * ACTION_WIDTH;
  const [open, setOpen] = useState(false);
  const [dragOffset, setDragOffset] = useState<number | null>(null);
  const dragRef = useRef<DragState | null>(null);
  // Set when a real drag (or a tap-to-close on an already-open row) just
  // resolved the gesture — the trailing native `click` that follows a real
  // pointerup must not also activate the row. Mirrors the suppressClick
  // idiom already used for the sidebar's long-press ancestor menu.
  const suppressClickRef = useRef(false);

  const offset = dragOffset ?? (open ? -revealWidth : 0);
  // 0 → fully closed, 1 → strip fully revealed. Drives BOTH polish effects
  // (#651, Notes reference): the action circles zoom in with the swipe (and
  // zoom back out on release/close), and the row content's trailing corners
  // round in step with the drag — never an instant square→rounded jump.
  const revealProgress = revealWidth > 0 ? Math.min(1, Math.abs(offset) / revealWidth) : 0;
  const animating = dragOffset === null;

  const onPointerDown = (e: React.PointerEvent) => {
    if (actions.length === 0) return;
    dragRef.current = {
      startX: e.clientX,
      startOffset: open ? -revealWidth : 0,
      isDrag: false,
      lastOffset: open ? -revealWidth : 0,
    };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const drag = dragRef.current;
    if (!drag) return;
    const delta = e.clientX - drag.startX;
    if (!drag.isDrag) {
      if (Math.abs(delta) < DRAG_THRESHOLD) return;
      drag.isDrag = true;
    }
    const next = Math.min(
      0,
      Math.max(-(revealWidth + FULL_SWIPE_EXTRA + 40), drag.startOffset + delta),
    );
    drag.lastOffset = next;
    setDragOffset(next);
  };

  const endDrag = () => {
    const drag = dragRef.current;
    dragRef.current = null;
    if (!drag) return;
    setDragOffset(null);
    if (drag.isDrag) {
      // Full swipe past the strip commits the edge action directly.
      if (
        actions.length > 0 &&
        Math.abs(drag.lastOffset) >= revealWidth + FULL_SWIPE_EXTRA
      ) {
        setOpen(false);
        suppressClickRef.current = true;
        actions[actions.length - 1].onSelect();
        return;
      }
      setOpen(Math.abs(drag.lastOffset) > revealWidth / 2);
      suppressClickRef.current = true;
    } else if (open) {
      // A plain tap on an already-revealed row closes it instead of
      // activating — the native iOS swipe-action idiom.
      setOpen(false);
      suppressClickRef.current = true;
    }
  };

  const onContentClickCapture = (e: React.MouseEvent) => {
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      e.preventDefault();
      e.stopPropagation();
    }
  };

  return (
    <div className="relative overflow-hidden">
      {actions.length > 0 && (
        <div
          className="absolute inset-y-0 right-0 flex"
          style={{ width: revealWidth }}
          aria-hidden={!open}
        >
          {/* Notes-style actions (Peter's reference): floating round icon
              buttons with small captions beneath — not full-height panes.
              Delete keeps the destructive red carve-out; everything else
              stays neutral per the strict palette. */}
          {actions.map((action) => {
            const Icon = action.icon;
            return (
              <button
                key={action.id}
                type="button"
                tabIndex={open ? 0 : -1}
                style={{ width: ACTION_WIDTH }}
                onClick={() => {
                  setOpen(false);
                  action.onSelect();
                }}
                className="ios-press-row flex h-full flex-col items-center justify-center gap-1"
              >
                <span
                  className={cn(
                    "flex h-11 w-11 items-center justify-center rounded-full",
                    action.tone === "destructive"
                      ? "bg-[var(--color-destructive)] text-white"
                      : "bg-[var(--color-primary)] text-[var(--color-primary-foreground)]",
                  )}
                  style={{
                    transform: `scale(${0.4 + 0.6 * revealProgress})`,
                    opacity: 0.2 + 0.8 * revealProgress,
                    transition: animating
                      ? "transform 260ms cubic-bezier(0.34, 1.4, 0.5, 1), opacity 200ms ease"
                      : "none",
                  }}
                >
                  <Icon strokeWidth={1.5} className="h-5 w-5" />
                </span>
                <span
                  className="text-[11px] font-medium text-muted-foreground"
                  style={{
                    opacity: revealProgress,
                    transition: animating ? "opacity 200ms ease" : "none",
                  }}
                >
                  {action.label}
                </span>
              </button>
            );
          })}
        </div>
      )}
      <div
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onClickCapture={onContentClickCapture}
        style={{
          transform: `translateX(${offset}px)`,
          borderTopRightRadius: 14 * revealProgress,
          borderBottomRightRadius: 14 * revealProgress,
          transition: animating
            ? "transform 240ms cubic-bezier(0.25, 0.8, 0.35, 1), border-top-right-radius 240ms ease, border-bottom-right-radius 240ms ease"
            : "none",
        }}
        className="relative overflow-hidden bg-background"
      >
        {children}
      </div>
    </div>
  );
}
