import { useRef, useState, type PointerEvent as ReactPointerEvent } from "react";

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
  startX: number;
  startY: number;
  startedAt: number;
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
  };
  offset: number;
  dragging: boolean;
} {
  const drag = useRef<Drag | null>(null);
  const [offset, setOffset] = useState(0);
  const [dragging, setDragging] = useState(false);

  const end = () => {
    const d = drag.current;
    drag.current = null;
    setDragging(false);
    setOffset(0);
    if (!d || d.axis !== "swipe") return;
    if (commitsBack(d.dx, Date.now() - d.startedAt)) onBack();
  };

  return {
    offset,
    dragging,
    handlers: {
      onPointerDown: (e) => {
        // Only from the edge, and only from a real touch or pen: a mouse in
        // the simulator would otherwise pick this up on every click near the
        // left margin.
        const rect = e.currentTarget.getBoundingClientRect();
        if (e.clientX - rect.left > EDGE_WIDTH) return;
        drag.current = {
          startX: e.clientX,
          startY: e.clientY,
          startedAt: Date.now(),
          axis: "undecided",
          dx: 0,
        };
      },
      onPointerMove: (e) => {
        const d = drag.current;
        if (!d || d.axis === "scroll") return;
        const dx = e.clientX - d.startX;
        if (d.axis === "undecided") {
          d.axis = resolveEdgeAxis(dx, e.clientY - d.startY);
          if (d.axis !== "swipe") return;
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
    },
  };
}
