// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fireEvent } from "@testing-library/react";
import { renderWithProviders, screen } from "@/test/component-harness";
import { useEdgeSwipeBack } from "@/components/mobile/useEdgeSwipeBack";

function Subject({ onBack }: { onBack: () => void }) {
  const swipe = useEdgeSwipeBack(onBack);
  return (
    <div
      data-testid="page"
      {...swipe.handlers}
      style={{ transform: `translateX(${swipe.offset}px)` }}
    />
  );
}

/** jsdom reports a zero rect for every box, so the element's left edge is 0
 *  and any small clientX counts as starting at the edge — which is what we
 *  want to exercise here. */
function page() {
  return screen.getByTestId("page");
}

describe("edge-swipe-back: whose finger is this? (2026-09-06)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-06T00:00:00Z"));
  });
  afterEach(() => vi.useRealTimers());

  it("ignores a second finger's movement instead of jumping to it", () => {
    const onBack = vi.fn();
    renderWithProviders(<Subject onBack={onBack} />);
    const el = page();
    fireEvent.pointerDown(el, { pointerId: 1, clientX: 4, clientY: 0 });
    fireEvent.pointerMove(el, { pointerId: 1, clientX: 30, clientY: 0 });
    // A thumb lands near the far edge to steady the phone. Its coordinates
    // must not become this drag's: measured from the first finger's start
    // they read as a 296px throw, which is a commit.
    fireEvent.pointerMove(el, { pointerId: 2, clientX: 300, clientY: 0 });
    expect(el.style.transform).toBe("translateX(26px)");
    fireEvent.pointerUp(el, { pointerId: 2, clientX: 300, clientY: 0 });
    expect(onBack).not.toHaveBeenCalled();
  });

  it("keeps the drag when the second finger lifts, and still commits on the first", () => {
    const onBack = vi.fn();
    renderWithProviders(<Subject onBack={onBack} />);
    const el = page();
    fireEvent.pointerDown(el, { pointerId: 1, clientX: 4, clientY: 0 });
    fireEvent.pointerMove(el, { pointerId: 1, clientX: 140, clientY: 0 });
    fireEvent.pointerUp(el, { pointerId: 2, clientX: 140, clientY: 0 });
    expect(onBack).not.toHaveBeenCalled();
    fireEvent.pointerUp(el, { pointerId: 1, clientX: 140, clientY: 0 });
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it("a second finger landing mid-drag does not take the gesture over", () => {
    const onBack = vi.fn();
    renderWithProviders(<Subject onBack={onBack} />);
    const el = page();
    fireEvent.pointerDown(el, { pointerId: 1, clientX: 4, clientY: 0 });
    fireEvent.pointerMove(el, { pointerId: 1, clientX: 60, clientY: 0 });
    fireEvent.pointerDown(el, { pointerId: 2, clientX: 2, clientY: 0 });
    // Carried through to a real lift, because the offset alone proves
    // nothing: a plain ref overwrite does not move the page until the NEXT
    // move event, so asserting the transform here passes either way. The
    // first finger still owns the drag, so its own lift still commits.
    fireEvent.pointerMove(el, { pointerId: 1, clientX: 200, clientY: 0 });
    fireEvent.pointerUp(el, { pointerId: 1, clientX: 200, clientY: 0 });
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it("recovers when the system steals a captured swipe and sends no pointerup", () => {
    // WebKit does not reliably deliver pointercancel when the OS takes a
    // captured touch — and the OS's own interactive-pop gesture lives in
    // exactly this strip. Capture IS released though, so that is the signal
    // worth listening to. Without it the page stays frozen mid-slide and the
    // gesture is dead until the reader remounts.
    const onBack = vi.fn();
    renderWithProviders(<Subject onBack={onBack} />);
    const el = page();
    fireEvent.pointerDown(el, { pointerId: 1, clientX: 4, clientY: 0 });
    fireEvent.pointerMove(el, { pointerId: 1, clientX: 60, clientY: 0 });
    expect(el.style.transform).toBe("translateX(56px)");
    fireEvent.lostPointerCapture(el, { pointerId: 1, clientX: 60, clientY: 0 });
    expect(el.style.transform).toBe("translateX(0px)");
    // …and the next touch is not refused.
    fireEvent.pointerDown(el, { pointerId: 2, clientX: 4, clientY: 0 });
    fireEvent.pointerMove(el, { pointerId: 2, clientX: 200, clientY: 0 });
    fireEvent.pointerUp(el, { pointerId: 2, clientX: 200, clientY: 0 });
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it("a touch that never became a swipe is replaced, not left to block the strip", () => {
    // The other half of the stranding problem: a drag that stalled before
    // the axis lock took no capture, so nothing above can free it. It has
    // moved nothing on screen either, which is what makes replacing it safe.
    const onBack = vi.fn();
    renderWithProviders(<Subject onBack={onBack} />);
    const el = page();
    fireEvent.pointerDown(el, { pointerId: 1, clientX: 4, clientY: 0 }); // never lifts
    fireEvent.pointerDown(el, { pointerId: 2, clientX: 4, clientY: 0 });
    fireEvent.pointerMove(el, { pointerId: 2, clientX: 200, clientY: 0 });
    fireEvent.pointerUp(el, { pointerId: 2, clientX: 200, clientY: 0 });
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it("times the flick from where it became a swipe, not from touchdown", () => {
    // Someone rests a finger on the edge while reading, then throws it. The
    // pause is not part of the throw: measured from touchdown a 4s rest makes
    // any flick look slow, and the gesture silently does nothing.
    const onBack = vi.fn();
    renderWithProviders(<Subject onBack={onBack} />);
    const el = page();
    fireEvent.pointerDown(el, { pointerId: 1, clientX: 4, clientY: 0 });
    vi.setSystemTime(new Date("2026-09-06T00:00:04Z")); // four seconds of rest
    fireEvent.pointerMove(el, { pointerId: 1, clientX: 24, clientY: 0 });
    vi.setSystemTime(new Date("2026-09-06T00:00:04.060Z"));
    fireEvent.pointerMove(el, { pointerId: 1, clientX: 60, clientY: 0 });
    fireEvent.pointerUp(el, { pointerId: 1, clientX: 60, clientY: 0 });
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});
