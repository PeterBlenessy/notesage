import { describe, it, expect } from "vitest";
import {
  COMMIT_DISTANCE,
  commitsBack,
  resolveEdgeAxis,
} from "@/components/mobile/useEdgeSwipeBack";

describe("edge-swipe-back gesture (2026-09-05)", () => {
  it("waits before deciding, so a jittery tap is not a swipe", () => {
    expect(resolveEdgeAxis(3, 2)).toBe("undecided");
  });

  it("locks as a swipe on a rightward drag, forgiving the arc of a thumb", () => {
    expect(resolveEdgeAxis(40, 10)).toBe("swipe");
    expect(resolveEdgeAxis(30, 35)).toBe("swipe");
  });

  it("hands a deliberate vertical drag back to the scroller", () => {
    expect(resolveEdgeAxis(10, 60)).toBe("scroll");
  });

  it("never reads a leftward drag as going back", () => {
    // Back is one direction. A leftward drag from the edge is someone
    // reaching for something else, and must not close their document.
    expect(resolveEdgeAxis(-60, 5)).toBe("scroll");
  });

  it("commits on distance", () => {
    expect(commitsBack(COMMIT_DISTANCE, 5000)).toBe(true);
    expect(commitsBack(COMMIT_DISTANCE - 1, 5000)).toBe(false);
  });

  it("commits on a fast flick that never travelled far", () => {
    // How most people actually do this: a short, quick throw.
    expect(commitsBack(40, 60)).toBe(true);
    expect(commitsBack(40, 400)).toBe(false);
  });

  it("does not commit on no movement at all, however fast", () => {
    expect(commitsBack(0, 1)).toBe(false);
  });
});
