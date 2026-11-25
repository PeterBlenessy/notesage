import { describe, it, expect } from "vitest";
import {
  COMMAND_BAR_BREATHING_ROOM_PX,
  clearanceFor,
  scrollNeeded,
} from "@/components/editor/extensions/command-bar-clearance";

const container = { top: 0, bottom: 712, left: 252, right: 1280 };

describe("command bar clearance", () => {
  it("is the covered strip plus breathing room when the bar floats over the editor", () => {
    const bar = { top: 632, bottom: 680, left: 450, right: 930 };
    expect(clearanceFor(container, bar)).toBe(80 + COMMAND_BAR_BREATHING_ROOM_PX);
  });

  it("is nothing without a bar, or when the bar is not over the editor", () => {
    expect(clearanceFor(container, null)).toBe(0);
    // Beside the editor (pinned to the right of it).
    expect(clearanceFor(container, { top: 0, bottom: 712, left: 1280, right: 1600 })).toBe(0);
    // Below the scroll area.
    expect(clearanceFor(container, { top: 712, bottom: 760, left: 450, right: 930 })).toBe(0);
    // Above it.
    expect(clearanceFor(container, { top: -60, bottom: 0, left: 450, right: 930 })).toBe(0);
  });

  it("never claims more than half of a short window", () => {
    const short = { top: 0, bottom: 200, left: 0, right: 800 };
    const bar = { top: 60, bottom: 180, left: 100, right: 700 };
    expect(clearanceFor(short, bar)).toBe(100);
  });
});

describe("scroll needed to lift the caret above the cleared band", () => {
  it("is zero when the caret is already above it", () => {
    expect(scrollNeeded(500, 712, 128)).toBe(0);
    expect(scrollNeeded(579, 712, 128)).toBe(0);
  });

  it("is the overshoot when the caret is inside the band", () => {
    // Limit is 712 - 128 - 5 = 579.
    expect(scrollNeeded(707, 712, 128)).toBe(128);
  });

  it("is zero when there is nothing to clear", () => {
    expect(scrollNeeded(707, 712, 0)).toBe(0);
  });
});
