// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { fireEvent } from "@testing-library/react";
import { renderWithProviders, screen } from "@/test/component-harness";
import {
  SwipeRevealRow,
  resolveDragAxis,
  actionRevealProgress,
  rowCornerRadius,
  type SwipeRevealAction,
} from "@/components/mobile/SwipeRevealRow";

function makeAction(overrides: Partial<SwipeRevealAction> = {}): SwipeRevealAction {
  return {
    id: "share",
    label: "Share",
    icon: () => null,
    onSelect: vi.fn(),
    ...overrides,
  };
}

function Row({
  actions,
  onRowClick,
}: {
  actions: SwipeRevealAction[];
  onRowClick: () => void;
}) {
  return (
    <SwipeRevealRow actions={actions}>
      <button type="button" onClick={onRowClick}>
        row content
      </button>
    </SwipeRevealRow>
  );
}

/** Simulate a horizontal drag from `from` to `to` on the given element. */
function swipe(el: HTMLElement, from: number, to: number, dy = 0) {
  fireEvent.pointerDown(el, { clientX: from, clientY: 0 });
  fireEvent.pointerMove(el, { clientX: to, clientY: dy });
  fireEvent.pointerUp(el, { clientX: to, clientY: dy });
}

describe("SwipeRevealRow: whose finger is this? (2026-09-06)", () => {
  it("ignores a second finger instead of letting it drive the row", () => {
    const onSelect = vi.fn();
    renderWithProviders(
      <Row actions={[makeAction(), makeAction({ id: "delete", label: "Delete", onSelect })]} onRowClick={vi.fn()} />,
    );
    const content = screen.getByText("row content");
    fireEvent.pointerDown(content, { pointerId: 1, clientX: 200, clientY: 0 });
    fireEvent.pointerMove(content, { pointerId: 1, clientX: 190, clientY: 0 });
    // A steadying thumb near the left edge. Measured from the first finger's
    // start that is -200px: past the two 72px actions plus the 96px overshoot,
    // which is the full-swipe that fires Delete outright.
    fireEvent.pointerMove(content, { pointerId: 2, clientX: 0, clientY: 0 });
    fireEvent.pointerUp(content, { pointerId: 2, clientX: 0, clientY: 0 });
    expect(onSelect).not.toHaveBeenCalled();
    // …and the first finger's own drag survived it: 10px is under half of one
    // action width, so the row snaps closed rather than opening.
    fireEvent.pointerUp(content, { pointerId: 1, clientX: 190, clientY: 0 });
    expect(screen.queryByRole("button", { name: "Delete" })).toBeNull();
  });

  it("gives up on a drag that goes silent, without firing its edge action", () => {
    // Same recovery as the reader's, and for the same reason: the event that
    // would tell us the touch is gone is exactly the one that goes missing.
    // A row abandoned mid-swipe must return to where it was — and must never
    // read as a Delete nobody asked for.
    vi.useFakeTimers();
    try {
      const onSelect = vi.fn();
      renderWithProviders(
        <Row actions={[makeAction({ id: "delete", label: "Delete", onSelect })]} onRowClick={vi.fn()} />,
      );
      const content = screen.getByText("row content");
      fireEvent.pointerDown(content, { pointerId: 1, clientX: 200, clientY: 0 });
      fireEvent.pointerMove(content, { pointerId: 1, clientX: 0, clientY: 0 }); // full swipe distance
      vi.advanceTimersByTime(4000);
      expect(onSelect).not.toHaveBeenCalled();
      expect(screen.queryByRole("button", { name: "Delete" })).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("recovers a captured drag when capture is lost with no pointerup", () => {
    const onSelect = vi.fn();
    renderWithProviders(<Row actions={[makeAction({ onSelect })]} onRowClick={vi.fn()} />);
    const content = screen.getByText("row content");
    fireEvent.pointerDown(content, { pointerId: 1, clientX: 200, clientY: 0 });
    fireEvent.pointerMove(content, { pointerId: 1, clientX: 100, clientY: 0 });
    fireEvent.lostPointerCapture(content, { pointerId: 1, clientX: 100, clientY: 0 });
    // Ended like any other lift: 100px is past half the action width, so the
    // row settles open rather than freezing mid-drag.
    expect(screen.getByRole("button", { name: "Share" })).toBeTruthy();
  });

  it("replaces a touch that never became a drag rather than being blocked by it", () => {
    // The other half: a press that stalled before the axis lock took no
    // capture and moved nothing, so nothing else can free it.
    renderWithProviders(<Row actions={[makeAction()]} onRowClick={vi.fn()} />);
    const content = screen.getByText("row content");
    fireEvent.pointerDown(content, { pointerId: 1, clientX: 200, clientY: 0 }); // never lifts
    swipe(content, 200, 100);
    expect(screen.getByRole("button", { name: "Share" })).toBeTruthy();
  });

  it("does not let a second touchdown restart the drag", () => {
    renderWithProviders(<Row actions={[makeAction()]} onRowClick={vi.fn()} />);
    const content = screen.getByText("row content");
    fireEvent.pointerDown(content, { pointerId: 1, clientX: 200, clientY: 0 });
    fireEvent.pointerMove(content, { pointerId: 1, clientX: 100, clientY: 0 });
    fireEvent.pointerDown(content, { pointerId: 2, clientX: 100, clientY: 0 });
    fireEvent.pointerUp(content, { pointerId: 1, clientX: 100, clientY: 0 });
    // Still the first finger's 100px drag, so the action is revealed.
    expect(screen.getByRole("button", { name: "Share" })).toBeTruthy();
  });
});

describe("SwipeRevealRow (issue #618)", () => {
  it("hides the action until the row is swiped", () => {
    renderWithProviders(<Row actions={[makeAction()]} onRowClick={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "Share" })).toBeNull();
  });

  it("reveals the action after a leftward swipe past the reveal threshold", () => {
    renderWithProviders(<Row actions={[makeAction()]} onRowClick={vi.fn()} />);
    const content = screen.getByText("row content");
    swipe(content, 200, 100); // -100px, past half of the single 72px action width
    expect(screen.getByRole("button", { name: "Share" })).toBeTruthy();
  });

  it("snaps back closed when the swipe distance stays under the reveal threshold", () => {
    renderWithProviders(<Row actions={[makeAction()]} onRowClick={vi.fn()} />);
    const content = screen.getByText("row content");
    swipe(content, 200, 190); // -10px, well under half of the 72px action width
    expect(screen.queryByRole("button", { name: "Share" })).toBeNull();
  });

  it("invokes the action's onSelect when tapped after reveal", () => {
    const onSelect = vi.fn();
    renderWithProviders(<Row actions={[makeAction({ onSelect })]} onRowClick={vi.fn()} />);
    const content = screen.getByText("row content");
    swipe(content, 200, 100);
    fireEvent.click(screen.getByRole("button", { name: "Share" }));
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it("supports a second action without any change to the gesture handling (extensibility for #619)", () => {
    const share = makeAction({ id: "share", label: "Share" });
    const del = makeAction({ id: "delete", label: "Delete", tone: "destructive" });
    renderWithProviders(<Row actions={[share, del]} onRowClick={vi.fn()} />);
    const content = screen.getByText("row content");
    swipe(content, 300, 100); // -200px, past half of the 144px two-action width
    expect(screen.getByRole("button", { name: "Share" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Delete" })).toBeTruthy();
  });

  it("a plain tap with no drag still fires the row's own click handler", () => {
    const onRowClick = vi.fn();
    renderWithProviders(<Row actions={[makeAction()]} onRowClick={onRowClick} />);
    const content = screen.getByText("row content");
    fireEvent.pointerDown(content, { clientX: 200 });
    fireEvent.pointerUp(content, { clientX: 200 });
    fireEvent.click(content);
    expect(onRowClick).toHaveBeenCalledTimes(1);
  });

  it("tapping an already-revealed row closes it and suppresses the row's click instead of activating", () => {
    const onRowClick = vi.fn();
    renderWithProviders(<Row actions={[makeAction()]} onRowClick={onRowClick} />);
    const content = screen.getByText("row content");
    swipe(content, 200, 100);
    expect(screen.getByRole("button", { name: "Share" })).toBeTruthy();

    // A plain tap (no drag) on the now-revealed row content.
    fireEvent.pointerDown(content, { clientX: 100 });
    fireEvent.pointerUp(content, { clientX: 100 });
    fireEvent.click(content);

    expect(onRowClick).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Share" })).toBeNull();
  });
});

describe("actionRevealProgress", () => {
  // Actions are uncovered right-to-left, so with [Share, Delete] the LAST
  // one is out before the first has begun (Peter's staggered-zoom request).
  it("gives the trailing action its whole ramp before the leading one starts", () => {
    expect(actionRevealProgress(-36, 1, 2)).toBeCloseTo(0.5); // Delete half out
    expect(actionRevealProgress(-36, 0, 2)).toBe(0); // Share not started
    expect(actionRevealProgress(-72, 1, 2)).toBe(1); // Delete fully out…
    expect(actionRevealProgress(-72, 0, 2)).toBe(0); // …exactly as Share starts
    expect(actionRevealProgress(-108, 0, 2)).toBeCloseTo(0.5);
    expect(actionRevealProgress(-144, 0, 2)).toBe(1);
  });

  it("clamps past full reveal so the overshoot of a full swipe doesn't overscale", () => {
    expect(actionRevealProgress(-400, 0, 2)).toBe(1);
    expect(actionRevealProgress(-400, 1, 2)).toBe(1);
  });

  it("ramps a lone action over its own width", () => {
    expect(actionRevealProgress(0, 0, 1)).toBe(0);
    expect(actionRevealProgress(-72, 0, 1)).toBe(1);
  });
});

describe("rowCornerRadius", () => {
  it("runs square → 14 over the first action, then creeps toward near-circular", () => {
    expect(rowCornerRadius(0, 2)).toBe(0);
    expect(rowCornerRadius(-36, 2)).toBeCloseTo(7);
    expect(rowCornerRadius(-72, 2)).toBeCloseTo(14);
    // Past the first action the growth is much slower — the "sticky" feel.
    expect(rowCornerRadius(-144, 2)).toBeGreaterThan(14);
    expect(rowCornerRadius(-144, 2)).toBeLessThan(22);
    expect(rowCornerRadius(-240, 2)).toBeCloseTo(26);
  });

  it("never exceeds the maximum, however far the row is dragged", () => {
    expect(rowCornerRadius(-9999, 2)).toBeCloseTo(26);
  });

  it("stays square when the row has no actions", () => {
    expect(rowCornerRadius(-100, 0)).toBe(0);
  });
});

describe("resolveDragAxis", () => {
  // The axis is decided once and locked, which is what lets a swipe survive
  // a thumb that arcs downward mid-gesture (Peter: swipes "didn't take").
  it("waits for real movement before committing to an axis", () => {
    expect(resolveDragAxis(0, 0)).toBe("undecided");
    expect(resolveDragAxis(-5, 3)).toBe("undecided");
  });

  it("reads a mostly-sideways gesture as a swipe, even at a healthy angle", () => {
    expect(resolveDragAxis(-30, 0)).toBe("swipe");
    expect(resolveDragAxis(-30, 20)).toBe("swipe"); // thumb arc
    expect(resolveDragAxis(-30, 39)).toBe("swipe"); // still inside the bias
  });

  it("hands a mostly-vertical gesture to the scroller", () => {
    expect(resolveDragAxis(0, -30)).toBe("scroll");
    expect(resolveDragAxis(-10, 40)).toBe("scroll");
  });
});

describe("axis locking", () => {
  it("does not drag when the gesture starts vertical, however far it later moves sideways", () => {
    renderWithProviders(<Row actions={[makeAction()]} onRowClick={vi.fn()} />);
    const content = screen.getByText("row content");
    fireEvent.pointerDown(content, { clientX: 200, clientY: 0 });
    fireEvent.pointerMove(content, { clientX: 198, clientY: 40 }); // scroll
    fireEvent.pointerMove(content, { clientX: 40, clientY: 60 }); // now sideways
    fireEvent.pointerUp(content, { clientX: 40, clientY: 60 });
    expect(screen.queryByRole("button", { name: "Share" })).toBeNull();
  });

  it("still reveals when the swipe carries vertical drift", () => {
    renderWithProviders(<Row actions={[makeAction()]} onRowClick={vi.fn()} />);
    const content = screen.getByText("row content");
    swipe(content, 200, 60, 30);
    expect(screen.getByRole("button", { name: "Share" })).toBeTruthy();
  });
});
