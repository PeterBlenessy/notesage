// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, fireEvent, act, cleanup } from "@testing-library/react";
import "@/test/tauri-mock";
import { PinnedResizeHandle } from "@/components/cmd/resize/PinnedResizeHandle";
import { ExpandedResizeHandle } from "@/components/cmd/resize/ExpandedResizeHandle";
import { TopResizeHandle } from "@/components/cmd/resize/TopResizeHandle";
import {
  PINNED_WIDTH_MIN,
  PINNED_WIDTH_MAX,
  EXPANDED_WIDTH_MIN,
  EXPANDED_WIDTH_MAX,
  EXPANDED_HEIGHT_MIN,
  EXPANDED_HEIGHT_MAX,
} from "@/components/cmd/useCommandBarGeometry";
import { useSettingsStore } from "@/stores/settings-store";

/**
 * Tests for the three FloatingCommandBar resize handles. Each is a
 * `role="slider"` div that writes width/height to a CSS variable on <html>
 * during drag/keyboard adjust (clamped to min/max) and persists the final
 * value to `settings-store` on pointerup / keyup. We assert clamping, the CSS
 * variable writes, the mount-sync effect, and the store persistence.
 */

function cssVar(name: string): string {
  return document.documentElement.style.getPropertyValue(name);
}

function dispatchPointer(type: "pointermove" | "pointerup", clientX = 0, clientY = 0) {
  act(() => {
    window.dispatchEvent(new MouseEvent(type, { clientX, clientY }));
  });
}

beforeEach(() => {
  // jsdom lacks pointer-capture — stub so the handlers don't throw.
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
  // Reset the persisted widths/height to known defaults.
  useSettingsStore.setState({
    cmdBarPinnedWidth: 400,
    cmdBarExpandedWidth: 640,
    cmdBarExpandedHeight: 480,
  });
  // Clear CSS variables between tests.
  document.documentElement.style.removeProperty("--cmd-bar-pinned-width");
  document.documentElement.style.removeProperty("--cmd-bar-expanded-width");
  document.documentElement.style.removeProperty("--cmd-bar-expanded-height");
  document.documentElement.removeAttribute("data-cmd-bar-resizing");
});

afterEach(() => {
  cleanup();
});

// jsdom default window.innerWidth is 1024 — assert so the pinned math is stable.
const INNER_WIDTH = 1024;

describe("PinnedResizeHandle", () => {
  it("exposes slider a11y attributes bound to the store value", () => {
    useSettingsStore.setState({ cmdBarPinnedWidth: 350 });
    const { getByRole } = render(<PinnedResizeHandle />);
    const slider = getByRole("slider");
    expect(slider.getAttribute("aria-valuemin")).toBe(String(PINNED_WIDTH_MIN));
    expect(slider.getAttribute("aria-valuemax")).toBe(String(PINNED_WIDTH_MAX));
    expect(slider.getAttribute("aria-valuenow")).toBe("350");
    expect(slider.getAttribute("aria-label")).toBe("Resize chat panel");
  });

  it("syncs the persisted width to the CSS variable on mount", () => {
    useSettingsStore.setState({ cmdBarPinnedWidth: 512 });
    render(<PinnedResizeHandle />);
    expect(cssVar("--cmd-bar-pinned-width")).toBe("512px");
  });

  it("ArrowLeft widens the panel by the keyboard step and persists it", () => {
    const { getByRole } = render(<PinnedResizeHandle />);
    act(() => {
      fireEvent.keyDown(getByRole("slider"), { key: "ArrowLeft" });
    });
    // ArrowLeft grows the right-docked panel by +20.
    expect(useSettingsStore.getState().cmdBarPinnedWidth).toBe(420);
    expect(cssVar("--cmd-bar-pinned-width")).toBe("420px");
  });

  it("ArrowRight shrinks the panel by the keyboard step", () => {
    const { getByRole } = render(<PinnedResizeHandle />);
    act(() => {
      fireEvent.keyDown(getByRole("slider"), { key: "ArrowRight" });
    });
    expect(useSettingsStore.getState().cmdBarPinnedWidth).toBe(380);
  });

  it("clamps keyboard growth to the max width", () => {
    useSettingsStore.setState({ cmdBarPinnedWidth: PINNED_WIDTH_MAX - 5 });
    const { getByRole } = render(<PinnedResizeHandle />);
    act(() => {
      fireEvent.keyDown(getByRole("slider"), { key: "ArrowLeft" });
    });
    expect(useSettingsStore.getState().cmdBarPinnedWidth).toBe(PINNED_WIDTH_MAX);
    expect(cssVar("--cmd-bar-pinned-width")).toBe(`${PINNED_WIDTH_MAX}px`);
  });

  it("ignores non-arrow keys", () => {
    const { getByRole } = render(<PinnedResizeHandle />);
    act(() => {
      fireEvent.keyDown(getByRole("slider"), { key: "Enter" });
    });
    expect(useSettingsStore.getState().cmdBarPinnedWidth).toBe(400);
  });

  it("drag writes the CSS variable live and persists only on pointerup", () => {
    const { getByRole } = render(<PinnedResizeHandle />);
    const slider = getByRole("slider");
    fireEvent.pointerDown(slider, { clientX: 700, pointerId: 1 });
    expect(document.documentElement.getAttribute("data-cmd-bar-resizing")).toBe(
      "true",
    );

    // width = innerWidth - clientX = 1024 - 724 = 300.
    dispatchPointer("pointermove", INNER_WIDTH - 300);
    expect(cssVar("--cmd-bar-pinned-width")).toBe("300px");
    // Store is untouched during the move.
    expect(useSettingsStore.getState().cmdBarPinnedWidth).toBe(400);

    // pointerup at width = 1024 - 574 = 450.
    dispatchPointer("pointerup", INNER_WIDTH - 450);
    expect(useSettingsStore.getState().cmdBarPinnedWidth).toBe(450);
    expect(document.documentElement.getAttribute("data-cmd-bar-resizing")).toBeNull();
  });

  it("clamps a drag beyond the max width", () => {
    const { getByRole } = render(<PinnedResizeHandle />);
    fireEvent.pointerDown(getByRole("slider"), { clientX: 700, pointerId: 1 });
    // width target 900 (> max 800) → clamped.
    dispatchPointer("pointermove", INNER_WIDTH - 900);
    expect(cssVar("--cmd-bar-pinned-width")).toBe(`${PINNED_WIDTH_MAX}px`);
  });
});

describe("ExpandedResizeHandle", () => {
  it("exposes slider a11y attributes for the expanded width axis", () => {
    useSettingsStore.setState({ cmdBarExpandedWidth: 700 });
    const { getByRole } = render(<ExpandedResizeHandle side="right" />);
    const slider = getByRole("slider");
    expect(slider.getAttribute("aria-valuemin")).toBe(String(EXPANDED_WIDTH_MIN));
    expect(slider.getAttribute("aria-valuemax")).toBe(String(EXPANDED_WIDTH_MAX));
    expect(slider.getAttribute("aria-valuenow")).toBe("700");
  });

  it("syncs the persisted width to the CSS variable on mount", () => {
    useSettingsStore.setState({ cmdBarExpandedWidth: 900 });
    render(<ExpandedResizeHandle side="right" />);
    expect(cssVar("--cmd-bar-expanded-width")).toBe("900px");
  });

  it("ArrowRight grows and ArrowLeft shrinks regardless of side", () => {
    const { getByRole, rerender } = render(<ExpandedResizeHandle side="right" />);
    act(() => {
      fireEvent.keyDown(getByRole("slider"), { key: "ArrowRight" });
    });
    expect(useSettingsStore.getState().cmdBarExpandedWidth).toBe(660);

    useSettingsStore.setState({ cmdBarExpandedWidth: 640 });
    rerender(<ExpandedResizeHandle side="left" />);
    act(() => {
      fireEvent.keyDown(getByRole("slider"), { key: "ArrowLeft" });
    });
    expect(useSettingsStore.getState().cmdBarExpandedWidth).toBe(620);
  });

  it("clamps keyboard shrink to the min width", () => {
    useSettingsStore.setState({ cmdBarExpandedWidth: EXPANDED_WIDTH_MIN + 5 });
    const { getByRole } = render(<ExpandedResizeHandle side="right" />);
    act(() => {
      fireEvent.keyDown(getByRole("slider"), { key: "ArrowLeft" });
    });
    expect(useSettingsStore.getState().cmdBarExpandedWidth).toBe(
      EXPANDED_WIDTH_MIN,
    );
  });

  it("right-edge drag grows the width at double the cursor delta", () => {
    const { getByRole } = render(<ExpandedResizeHandle side="right" />);
    fireEvent.pointerDown(getByRole("slider"), { clientX: 100, pointerId: 1 });
    // deltaX = 150 - 100 = 50 → width = 640 + 2*50 = 740.
    dispatchPointer("pointermove", 150);
    expect(cssVar("--cmd-bar-expanded-width")).toBe("740px");
    expect(useSettingsStore.getState().cmdBarExpandedWidth).toBe(640);

    // pointerup deltaX = 200 - 100 = 100 → width = 640 + 200 = 840.
    dispatchPointer("pointerup", 200);
    expect(useSettingsStore.getState().cmdBarExpandedWidth).toBe(840);
  });

  it("left-edge drag grows the width when the cursor moves left", () => {
    const { getByRole } = render(<ExpandedResizeHandle side="left" />);
    fireEvent.pointerDown(getByRole("slider"), { clientX: 200, pointerId: 1 });
    // sign = -1, deltaX = 150 - 200 = -50 → width = 640 + 2*(-1)*(-50) = 740.
    dispatchPointer("pointermove", 150);
    expect(cssVar("--cmd-bar-expanded-width")).toBe("740px");
  });

  it("clamps a drag beyond the max width", () => {
    const { getByRole } = render(<ExpandedResizeHandle side="right" />);
    fireEvent.pointerDown(getByRole("slider"), { clientX: 100, pointerId: 1 });
    // Huge rightward delta → clamp to max.
    dispatchPointer("pointermove", 5000);
    expect(cssVar("--cmd-bar-expanded-width")).toBe(`${EXPANDED_WIDTH_MAX}px`);
  });
});

describe("TopResizeHandle", () => {
  it("exposes slider a11y attributes for the expanded height axis", () => {
    useSettingsStore.setState({ cmdBarExpandedHeight: 520 });
    const { getByRole } = render(<TopResizeHandle />);
    const slider = getByRole("slider");
    expect(slider.getAttribute("aria-valuemin")).toBe(String(EXPANDED_HEIGHT_MIN));
    expect(slider.getAttribute("aria-valuemax")).toBe(String(EXPANDED_HEIGHT_MAX));
    expect(slider.getAttribute("aria-valuenow")).toBe("520");
    expect(slider.getAttribute("aria-label")).toBe("Resize command bar height");
  });

  it("syncs the persisted height to the CSS variable on mount", () => {
    useSettingsStore.setState({ cmdBarExpandedHeight: 333 });
    render(<TopResizeHandle />);
    expect(cssVar("--cmd-bar-expanded-height")).toBe("333px");
  });

  it("ArrowUp grows and ArrowDown shrinks the height", () => {
    const { getByRole } = render(<TopResizeHandle />);
    act(() => {
      fireEvent.keyDown(getByRole("slider"), { key: "ArrowUp" });
    });
    expect(useSettingsStore.getState().cmdBarExpandedHeight).toBe(500);
    act(() => {
      fireEvent.keyDown(getByRole("slider"), { key: "ArrowDown" });
    });
    expect(useSettingsStore.getState().cmdBarExpandedHeight).toBe(480);
  });

  it("clamps keyboard growth to the max height", () => {
    useSettingsStore.setState({ cmdBarExpandedHeight: EXPANDED_HEIGHT_MAX - 5 });
    const { getByRole } = render(<TopResizeHandle />);
    act(() => {
      fireEvent.keyDown(getByRole("slider"), { key: "ArrowUp" });
    });
    expect(useSettingsStore.getState().cmdBarExpandedHeight).toBe(
      EXPANDED_HEIGHT_MAX,
    );
  });

  it("drag computes height from the bar bottom minus the pointer Y", () => {
    // Stub the parent bar's rect so barBottom is deterministic.
    const rectSpy = vi
      .spyOn(HTMLElement.prototype, "getBoundingClientRect")
      .mockReturnValue({
        bottom: 700,
        top: 220,
        left: 0,
        right: 0,
        width: 0,
        height: 480,
        x: 0,
        y: 220,
        toJSON: () => ({}),
      } as DOMRect);

    const { getByRole } = render(<TopResizeHandle />);
    fireEvent.pointerDown(getByRole("slider"), { clientX: 0, clientY: 300, pointerId: 1 });
    // height = barBottom(700) - clientY(300) = 400.
    dispatchPointer("pointermove", 0, 300);
    expect(cssVar("--cmd-bar-expanded-height")).toBe("400px");
    expect(useSettingsStore.getState().cmdBarExpandedHeight).toBe(480);

    // pointerup at clientY = 200 → height = 500.
    dispatchPointer("pointerup", 0, 200);
    expect(useSettingsStore.getState().cmdBarExpandedHeight).toBe(500);

    rectSpy.mockRestore();
  });
});
