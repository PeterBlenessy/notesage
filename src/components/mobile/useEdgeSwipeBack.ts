import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";

/**
 * Swipe in from the left edge to go back — the gesture iOS gives every
 * navigation stack, which a web view has to supply for itself (Peter,
 * 2026-09-05: "I want right swipe in a document to close it and go back to
 * inbox").
 *
 * It starts ONLY near the left edge. That is what keeps it out of the way of
 * everything else the reader does horizontally: a wide table or code block
 * scrolls inside itself, text selection drags, the speech highlight. A
 * gesture that could begin anywhere would have to arbitrate with all of them
 * on every touch; one that begins in a 24pt strip almost never meets them.
 */
export const EDGE_WIDTH = 24;
/** Travel before the gesture is a swipe rather than a jittery tap. */
const DRAG_THRESHOLD = 8;
/** How much more horizontal than vertical, to lock as a swipe. Mirrors
 *  `resolveDragAxis` in `SwipeRevealRow`: a thumb arcs, so this is forgiving,
 *  but a deliberate scroll still wins. */
const HORIZONTAL_BIAS = 0.75;
/** Travel that commits the back. Roughly a third of a phone's width. */
export const COMMIT_DISTANCE = 96;
/** …or less travel, thrown fast. px per ms. */
export const COMMIT_VELOCITY = 0.5;
/**
 * A live drag that goes this long with no news at all is abandoned.
 *
 * The recovery of last resort, and the only one that depends on no event
 * arriving. `lostpointercapture` is the obvious candidate, but the spec fires
 * it as a CONSEQUENCE of pointerup/pointercancel — so in the case worth
 * recovering from, where WebKit delivers no terminator because the system
 * took the touch, there is no reason to expect it either. Both are handled
 * (they cost nothing when they do arrive); this is what makes the recovery
 * unconditional.
 *
 * Four seconds is far longer than any swipe and long enough that a finger
 * genuinely held mid-drag is not cut off in normal use. The penalty if it
 * ever is: the page springs back and the swipe can be made again.
 */
const STALE_MS = 4000;

export type EdgeAxis = "undecided" | "swipe" | "scroll";

/** Decide the axis once, from the movement so far. Pure, so the tolerance is
 *  testable rather than something to re-derive on a phone. */
export function resolveEdgeAxis(dx: number, dy: number): EdgeAxis {
  const [ax, ay] = [Math.abs(dx), Math.abs(dy)];
  if (Math.max(ax, ay) < DRAG_THRESHOLD) return "undecided";
  // Leftward never counts: this gesture only ever goes back.
  if (dx <= 0) return "scroll";
  return ax >= ay * HORIZONTAL_BIAS ? "swipe" : "scroll";
}

/** Does a finished drag mean "go back"? Distance OR a fast flick, because a
 *  quick short throw is how most people actually do this. */
export function commitsBack(dx: number, elapsedMs: number): boolean {
  if (dx >= COMMIT_DISTANCE) return true;
  return elapsedMs > 0 && dx > DRAG_THRESHOLD && dx / elapsedMs >= COMMIT_VELOCITY;
}

interface Drag {
  /** Which finger owns this drag. Without it a second touch anywhere in the
   *  reader feeds its own coordinates into the same drag — a tap near the
   *  right edge reads as a 300 px rightward throw and closes the document. */
  pointerId: number;
  startX: number;
  startY: number;
  /** When the gesture became a swipe, NOT when the finger landed. Velocity
   *  measured from touchdown counts a pause before the flick as travel time,
   *  so a finger that rests on the edge and then throws reads as slow. */
  swipeAt: number;
  axis: EdgeAxis;
  dx: number;
}

/**
 * Handlers for the element that should follow the finger, plus the live
 * offset to translate it by. The offset is what makes the gesture legible:
 * without the page moving, a swipe that does not commit gives no sign it was
 * seen at all.
 */
export function useEdgeSwipeBack(onBack: () => void): {
  handlers: {
    onPointerDown: (e: ReactPointerEvent) => void;
    onPointerMove: (e: ReactPointerEvent) => void;
    onPointerUp: (e: ReactPointerEvent) => void;
    onPointerCancel: (e: ReactPointerEvent) => void;
    onLostPointerCapture: (e: ReactPointerEvent) => void;
  };
  offset: number;
  dragging: boolean;
} {
  const drag = useRef<Drag | null>(null);
  const stale = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [offset, setOffset] = useState(0);
  const [dragging, setDragging] = useState(false);

  // A drag can outlive the reader (the document closes while a finger is
  // down), and a timer firing into an unmounted component is a console
  // warning at best.
  useEffect(
    () => () => {
      if (stale.current) clearTimeout(stale.current);
    },
    [],
  );

  const end = (e?: ReactPointerEvent) => {
    const d = drag.current;
    // Lifting the other finger must not end — or commit — a drag it never
    // owned.
    if (d && e && d.pointerId !== e.pointerId) return;
    if (stale.current) clearTimeout(stale.current);
    stale.current = null;
    drag.current = null;
    setDragging(false);
    setOffset(0);
    if (!d || d.axis !== "swipe") return;
    if (commitsBack(d.dx, Date.now() - d.swipeAt)) onBack();
  };

  /** Restart the abandonment timer. Every sign of life postpones it; only
   *  silence lets it fire. */
  const arm = () => {
    if (stale.current) clearTimeout(stale.current);
    stale.current = setTimeout(() => {
      stale.current = null;
      // Only a LOCKED swipe can strand anything: an undecided drag has moved
      // nothing on screen and blocks no later touch, since the touchdown
      // guard only refuses while a real swipe is in flight.
      if (drag.current?.axis !== "swipe") return;
      // Abandoned, so it must not COMMIT — a gesture nobody finished is not
      // a request to close the document.
      drag.current = null;
      setDragging(false);
      setOffset(0);
    }, STALE_MS);
  };

  return {
    offset,
    dragging,
    handlers: {
      onPointerDown: (e) => {
        // Only from the edge. (Not gated on `pointerType`: a mouse drag from
        // the left margin in the simulator is a fine way to exercise this,
        // and on device there is no mouse.)
        // A drag already owned by another finger keeps it — but ONLY while it
        // is a real swipe. Refusing every second touchdown outright trades a
        // corrupted gesture for a stranded one: if the owning pointer's
        // pointerup/pointercancel never arrives (WebKit does not reliably
        // deliver one when the system steals a captured touch, and the OS's
        // own interactive-pop lives in exactly this strip), the ref stays
        // set for ever and every later touch is refused. An undecided drag
        // has taken no capture and moved nothing on screen, so replacing it
        // costs nothing and heals that case; a locked swipe is recovered by
        // `onLostPointerCapture` below.
        if (drag.current?.axis === "swipe") return;
        const rect = e.currentTarget.getBoundingClientRect();
        if (e.clientX - rect.left > EDGE_WIDTH) return;
        drag.current = {
          pointerId: e.pointerId,
          startX: e.clientX,
          startY: e.clientY,
          swipeAt: Date.now(),
          axis: "undecided",
          dx: 0,
        };
        arm();
      },
      onPointerMove: (e) => {
        const d = drag.current;
        if (!d || d.pointerId !== e.pointerId || d.axis === "scroll") return;
        arm();
        const dx = e.clientX - d.startX;
        if (d.axis === "undecided") {
          d.axis = resolveEdgeAxis(dx, e.clientY - d.startY);
          if (d.axis !== "swipe") return;
          d.swipeAt = Date.now();
          setDragging(true);
          try {
            (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
          } catch {
            // jsdom, and any view without capture: the gesture still works,
            // it is just less forgiving of a finger that wanders off.
          }
        }
        d.dx = Math.max(0, dx);
        // Resisted past the commit point, so the page keeps answering the
        // finger without sliding off the screen.
        setOffset(d.dx <= COMMIT_DISTANCE ? d.dx : COMMIT_DISTANCE + (d.dx - COMMIT_DISTANCE) * 0.3);
      },
      onPointerUp: end,
      onPointerCancel: end,
      // The recovery signal for a captured swipe. When the system takes the
      // touch away, capture is released even where the pointer event that
      // should follow it is not delivered — so this is the one notification
      // that always arrives. Without it a stolen touch leaves the page
      // frozen mid-slide with the gesture dead until the reader remounts.
      onLostPointerCapture: end,
    },
  };
}
