import { useEffect, useRef, useState, type ComponentType, type ReactNode } from "react";
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
 *  keeps a few pixels of jitter from hijacking a normal row tap, and is the
 *  point at which the gesture's axis is decided. */
const DRAG_THRESHOLD = 8;
/** How much more vertical than horizontal a gesture must be before it is
 *  handed to the scroller. Slightly forgiving (a thumb swipe arcs, so it
 *  always carries some vertical), but nowhere near enough to hijack a
 *  deliberate scroll. */
const HORIZONTAL_BIAS = 0.75;
/** Trailing corner radius once the FIRST action has fully emerged. */
const RADIUS_REVEALED = 14;
/** Trailing corner radius at maximum drag — near-circular on a ~60 px row,
 *  deliberately short of a true pill so the row still reads as a row. */
const RADIUS_MAX = 26;
/** A live drag that goes this long with no news at all is abandoned — the
 *  one recovery that depends on no event arriving. See the matching constant
 *  in `useEdgeSwipeBack` for why `lostpointercapture` alone is not enough:
 *  the spec fires it as a consequence of the very terminator that goes
 *  missing. The penalty if it ever cuts off a real drag is a row that snaps
 *  back to where it was. */
const STALE_MS = 4000;

/**
 * How far action `index` of `count` has emerged, 0 → 1.
 *
 * The strip is pinned to the right edge and the row slides left over it, so
 * actions are uncovered RIGHT TO LEFT: the last action (Delete) is out before
 * the one before it (Share) has begun. Each action therefore gets its own
 * progress over its own 72 px of travel rather than sharing one global ramp —
 * Delete finishes zooming in as Share starts, which is the Notes cadence.
 */
export function actionRevealProgress(offsetPx: number, index: number, count: number): number {
  const start = (count - 1 - index) * ACTION_WIDTH;
  return Math.max(0, Math.min(1, (Math.abs(offsetPx) - start) / ACTION_WIDTH));
}

/**
 * Trailing corner radius for the row content at a given drag distance.
 *
 * Two phases, which is what gives it the "sticky" feel: square → 14 px over
 * the first action's reveal (quick, so the row detaches from the edge as soon
 * as anything shows), then a slow creep 14 → 26 px across the rest of the
 * travel, including the full-swipe overshoot.
 */
export function rowCornerRadius(offsetPx: number, count: number): number {
  if (count <= 0) return 0;
  const dragged = Math.abs(offsetPx);
  if (dragged <= ACTION_WIDTH) {
    return RADIUS_REVEALED * (dragged / ACTION_WIDTH);
  }
  const tail = count * ACTION_WIDTH + FULL_SWIPE_EXTRA - ACTION_WIDTH;
  const t = tail > 0 ? Math.min(1, (dragged - ACTION_WIDTH) / tail) : 1;
  return RADIUS_REVEALED + (RADIUS_MAX - RADIUS_REVEALED) * t;
}

/**
 * Which way a gesture went, decided ONCE at `DRAG_THRESHOLD` and then locked.
 *
 * The lock is what makes a swipe survive a thumb that arcs: after the axis is
 * horizontal, later vertical movement is ignored entirely instead of
 * gradually turning the gesture into a scroll. `scroll` is terminal too — a
 * gesture that started vertical never becomes a swipe, however far it later
 * travels sideways.
 */
export type DragAxis = "undecided" | "swipe" | "scroll";

/** Decide the axis from the movement so far. Pure, so the angle tolerance is
 *  testable rather than something to re-derive on a phone. */
export function resolveDragAxis(dx: number, dy: number): DragAxis {
  const [ax, ay] = [Math.abs(dx), Math.abs(dy)];
  if (Math.max(ax, ay) < DRAG_THRESHOLD) return "undecided";
  return ax >= ay * HORIZONTAL_BIAS ? "swipe" : "scroll";
}

interface DragState {
  /** Which finger owns this drag. A second touch anywhere on the row
   *  otherwise feeds ITS coordinates into the same drag: the row jumps to
   *  wherever the new finger landed, and letting go of either finger can
   *  commit the full-swipe Delete the user never made. */
  pointerId: number;
  startX: number;
  startY: number;
  axis: DragAxis;
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
  const staleRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Set when a real drag (or a tap-to-close on an already-open row) just
  // resolved the gesture — the trailing native `click` that follows a real
  // pointerup must not also activate the row. Mirrors the suppressClick
  // idiom already used for the sidebar's long-press ancestor menu.
  const suppressClickRef = useRef(false);
  // Every pointer whose drag the watchdog gave up on and which might still
  // be down. A SET, not one slot: once a drag is abandoned the touchdown
  // guard stops refusing second fingers, so a row can abandon two in a row —
  // and with one slot the second overwrote the first, leaving the first
  // finger's real lift unsuppressed and opening the document. See `endDrag`
  // for why the suppression waits for the lift.
  const abandonedRef = useRef<Set<number>>(new Set());

  // A row is unmounted by any listing refresh, which a finger being down does
  // nothing to prevent.
  useEffect(() => () => {
    if (staleRef.current) clearTimeout(staleRef.current);
  }, []);

  /** Restart the abandonment timer. Every sign of life postpones it. */
  const arm = () => {
    if (staleRef.current) clearTimeout(staleRef.current);
    staleRef.current = setTimeout(() => {
      staleRef.current = null;
      const drag = dragRef.current;
      // Only a LOCKED drag can strand anything. A press that never became
      // one holds no capture, has moved nothing, and blocks no later touch
      // — and dropping it would break tap-to-close for a finger that simply
      // rests on an open row before lifting.
      if (!drag?.isDrag) return;
      // Abandoned, so it must not COMMIT: an unfinished drag is not a
      // request to delete anything. The row returns to where it was.
      dragRef.current = null;
      setDragOffset(null);
      // The finger may still be down — the whole point is that we never
      // heard it go — so a native click may still follow when it lifts, and
      // it must not open the document the user was swiping away from.
      // Remembered, NOT suppressed here: arming the flag now would leave it
      // armed for ever in the case this whole mechanism exists for, where
      // the touch really was stolen and no lift and no click ever arrive.
      // It would then swallow the user's next, unrelated tap on this row.
      abandonedRef.current.add(drag.pointerId);
    }, STALE_MS);
  };

  const offset = dragOffset ?? (open ? -revealWidth : 0);
  const animating = dragOffset === null;

  const onPointerDown = (e: React.PointerEvent) => {
    if (actions.length === 0) return;
    // A drag already owned by another finger keeps it — but ONLY while it is
    // a real swipe. Refusing every second touchdown outright trades a
    // corrupted gesture for a stranded one: if the owning pointer's
    // pointerup/pointercancel never arrives (WebKit does not reliably
    // deliver one when the system steals a captured touch), the ref stays
    // set for ever and every later touch on this row is refused. A drag that
    // never locked has taken no capture and moved nothing, so replacing it
    // costs nothing; a locked one is recovered by `onLostPointerCapture`.
    if (dragRef.current?.isDrag) return;
    // Pointer ids are reused once released. A fresh press under an id we
    // were still waiting on is a new finger, not the old one coming back.
    abandonedRef.current.delete(e.pointerId);
    dragRef.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      axis: "undecided",
      startOffset: open ? -revealWidth : 0,
      isDrag: false,
      lastOffset: open ? -revealWidth : 0,
    };
    arm();
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== e.pointerId || drag.axis === "scroll") return;
    arm();
    const delta = e.clientX - drag.startX;
    if (drag.axis === "undecided") {
      drag.axis = resolveDragAxis(delta, e.clientY - drag.startY);
      if (drag.axis !== "swipe") return;
      drag.isDrag = true;
      // Capture the pointer so the row keeps receiving moves even if the
      // finger wanders off it — without this a thumb that drifts a few pixels
      // onto the next row silently ends the swipe mid-gesture.
      try {
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      } catch {
        // Not all environments implement capture (jsdom); the gesture still
        // works, it is just less forgiving.
      }
    }
    const next = Math.min(
      0,
      Math.max(-(revealWidth + FULL_SWIPE_EXTRA + 40), drag.startOffset + delta),
    );
    drag.lastOffset = next;
    setDragOffset(next);
  };

  const endDrag = (e?: React.PointerEvent) => {
    const drag = dragRef.current;
    // Lifting the OTHER finger must not end a drag it never owned.
    if (drag && e && drag.pointerId !== e.pointerId) return;
    if (staleRef.current) clearTimeout(staleRef.current);
    staleRef.current = null;
    dragRef.current = null;
    if (!drag) {
      // News of a drag the watchdog already gave up on. Nothing left to
      // settle, and the pointer is accounted for either way — but ONLY a
      // pointerup is followed by a native click. `pointercancel` never is,
      // by spec, and `lostpointercapture` is not a termination at all; both
      // are in fact the likely shape of a genuinely stolen touch, which is
      // the case this whole mechanism is about. Arming on those would set a
      // flag no click ever consumes, and the next thing it swallowed would
      // be the user's next unrelated tap — the very bug this branch exists
      // to avoid, walked back in through a different door.
      if (e && abandonedRef.current.delete(e.pointerId) && e.type === "pointerup") {
        suppressClickRef.current = true;
      }
      return;
    }
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
          {actions.map((action, index) => {
            const Icon = action.icon;
            // Per-action, not shared: see `actionRevealProgress`.
            const progress = actionRevealProgress(offset, index, actions.length);
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
                    transform: `scale(${0.4 + 0.6 * progress})`,
                    opacity: 0.2 + 0.8 * progress,
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
                    opacity: progress,
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
        // The recovery signal for a captured drag. When the system takes the
        // touch away, capture is released even where the pointer event that
        // should follow it is not delivered — so this is the one
        // notification that always arrives. Without it a stolen touch leaves
        // the row stuck half-revealed with its swipe dead until it remounts.
        onLostPointerCapture={endDrag}
        onClickCapture={onContentClickCapture}
        style={{
          // Tell WebKit we own horizontal panning and it owns vertical. This
          // is the difference between a swipe that works and one that gets
          // cancelled the instant the browser decides the gesture is a
          // scroll — the reason swipes "sometimes didn't take".
          touchAction: "pan-y",
          transform: `translateX(${offset}px)`,
          borderTopRightRadius: rowCornerRadius(offset, actions.length),
          borderBottomRightRadius: rowCornerRadius(offset, actions.length),
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
