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

  it("a second finger landing mid-drag does not restart the gesture", () => {
    const onBack = vi.fn();
    renderWithProviders(<Subject onBack={onBack} />);
    const el = page();
    fireEvent.pointerDown(el, { pointerId: 1, clientX: 4, clientY: 0 });
    fireEvent.pointerMove(el, { pointerId: 1, clientX: 60, clientY: 0 });
    fireEvent.pointerDown(el, { pointerId: 2, clientX: 2, clientY: 0 });
    // Still the first finger's drag: 56px, not reset to 0.
    expect(el.style.transform).toBe("translateX(56px)");
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
