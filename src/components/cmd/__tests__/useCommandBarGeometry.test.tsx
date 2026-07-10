// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";
import "@/test/tauri-mock";
import {
  useCommandBarGeometry,
  PINNED_WIDTH_DEFAULT,
  EXPANDED_WIDTH_DEFAULT,
  EXPANDED_HEIGHT_DEFAULT,
  PINNED_WIDTH_MIN,
  PINNED_WIDTH_MAX,
  EXPANDED_WIDTH_MIN,
  EXPANDED_WIDTH_MAX,
  EXPANDED_HEIGHT_MIN,
  EXPANDED_HEIGHT_MAX,
  type CommandBarGeometryArgs,
} from "@/components/cmd/useCommandBarGeometry";
import { useSettingsStore } from "@/stores/settings-store";

/**
 * Tests for `useCommandBarGeometry` — the FloatingCommandBar's visual-chrome
 * state machine. The hook is pure derivation over (isPinned, expanded,
 * effectiveExpanded), the reduced-motion preference, and the
 * `quietChromeTransparent` setting. We assert the exact class list and inline
 * style branches rather than smoke-testing.
 */

interface MockMediaQueryList {
  matches: boolean;
  media: string;
  onchange: null;
  addListener: ReturnType<typeof vi.fn>;
  removeListener: ReturnType<typeof vi.fn>;
  addEventListener: ReturnType<typeof vi.fn>;
  removeEventListener: ReturnType<typeof vi.fn>;
  dispatchEvent: ReturnType<typeof vi.fn>;
}

function makeMql(matches: boolean): MockMediaQueryList {
  return {
    matches,
    media: "(prefers-reduced-motion: reduce)",
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  };
}

const originalMatchMedia = window.matchMedia;

function setReducedMotion(matches: boolean) {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    configurable: true,
    value: vi.fn().mockReturnValue(makeMql(matches)),
  });
}

function render(args: CommandBarGeometryArgs) {
  return renderHook(() => useCommandBarGeometry(args)).result.current;
}

describe("useCommandBarGeometry", () => {
  beforeEach(() => {
    setReducedMotion(false);
    useSettingsStore.setState({ quietChromeTransparent: false });
  });

  afterEach(() => {
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      configurable: true,
      value: originalMatchMedia,
    });
  });

  describe("width clamping constants", () => {
    it("keeps min < default < max for every axis", () => {
      expect(PINNED_WIDTH_MIN).toBeLessThan(PINNED_WIDTH_DEFAULT);
      expect(PINNED_WIDTH_DEFAULT).toBeLessThan(PINNED_WIDTH_MAX);
      expect(EXPANDED_WIDTH_MIN).toBeLessThan(EXPANDED_WIDTH_DEFAULT);
      expect(EXPANDED_WIDTH_DEFAULT).toBeLessThan(EXPANDED_WIDTH_MAX);
      expect(EXPANDED_HEIGHT_MIN).toBeLessThan(EXPANDED_HEIGHT_DEFAULT);
      expect(EXPANDED_HEIGHT_DEFAULT).toBeLessThan(EXPANDED_HEIGHT_MAX);
    });
  });

  describe("pinned mode", () => {
    const args: CommandBarGeometryArgs = {
      isPinned: true,
      expanded: true,
      effectiveExpanded: true,
    };

    it("fixes to the right edge, full height, and rounds only the left corners", () => {
      const { barClassName } = render(args);
      expect(barClassName).toContain("fixed top-0 right-0 h-screen");
      expect(barClassName).toContain("rounded-l-2xl rounded-r-none");
      // Pinned sits behind floating overlays.
      expect(barClassName).toContain("z-30");
      expect(barClassName).not.toContain("z-40");
    });

    it("drives width via the pinned CSS variable and sets no height", () => {
      const { inlineStyle } = render(args);
      expect(inlineStyle.width).toBe(
        `var(--cmd-bar-pinned-width, ${PINNED_WIDTH_DEFAULT}px)`,
      );
      expect(inlineStyle.height).toBeUndefined();
    });

    it("never lifts even when expanded (pinned is permanent docking)", () => {
      const { barClassName } = render(args);
      expect(barClassName).not.toContain("-translate-y-[14px]");
    });

    it("stays opaque even when quietChromeTransparent is on", () => {
      useSettingsStore.setState({ quietChromeTransparent: true });
      const { barClassName } = render(args);
      expect(barClassName).toContain("bg-popover backdrop-blur-md");
      expect(barClassName).not.toContain("bg-popover/70");
    });
  });

  describe("floating expanded mode", () => {
    const args: CommandBarGeometryArgs = {
      isPinned: false,
      expanded: true,
      effectiveExpanded: true,
    };

    it("centres over the doc area and rounds all corners", () => {
      const { barClassName } = render(args);
      expect(barClassName).toContain(
        "fixed bottom-10 left-[calc(50%+var(--quiet-sidebar-width,0px)/2)] -translate-x-1/2",
      );
      expect(barClassName).toContain("rounded-2xl");
      expect(barClassName).toContain("z-40");
    });

    it("drives both width and height via expanded CSS variables", () => {
      const { inlineStyle } = render(args);
      expect(inlineStyle.width).toBe(
        `var(--cmd-bar-expanded-width, ${EXPANDED_WIDTH_DEFAULT}px)`,
      );
      expect(inlineStyle.height).toBe(
        `var(--cmd-bar-expanded-height, ${EXPANDED_HEIGHT_DEFAULT}px)`,
      );
    });

    it("applies the 14px focus lift when expanded and motion is allowed", () => {
      const { barClassName } = render(args);
      expect(barClassName).toContain("-translate-y-[14px]");
    });

    it("applies the transition utility when motion is allowed", () => {
      const { barClassName } = render(args);
      expect(barClassName).toContain("transition-all duration-200 ease-out");
    });

    it("stays opaque regardless of quietChromeTransparent", () => {
      useSettingsStore.setState({ quietChromeTransparent: true });
      const { barClassName } = render(args);
      expect(barClassName).toContain("bg-popover backdrop-blur-md");
      expect(barClassName).not.toContain("bg-popover/70");
    });
  });

  describe("floating compact (collapsed pill)", () => {
    const args: CommandBarGeometryArgs = {
      isPinned: false,
      expanded: false,
      effectiveExpanded: false,
    };

    it("uses the fixed-width pill classes and h-12 height", () => {
      const { barClassName } = render(args);
      expect(barClassName).toContain("w-[480px] max-w-[90vw]");
      expect(barClassName).toContain("h-12");
      expect(barClassName).toContain("rounded-xl");
    });

    it("supplies no inline width/height (Tailwind class owns the size)", () => {
      const { inlineStyle } = render(args);
      expect(inlineStyle).toEqual({});
    });

    it("does not lift when not expanded", () => {
      const { barClassName } = render(args);
      expect(barClassName).not.toContain("-translate-y-[14px]");
    });

    it("goes translucent only when quietChromeTransparent is on", () => {
      const opaque = render(args);
      expect(opaque.barClassName).toContain("bg-popover backdrop-blur-md");

      useSettingsStore.setState({ quietChromeTransparent: true });
      const transparent = render(args);
      expect(transparent.barClassName).toContain(
        "bg-popover/70 backdrop-blur-[14px]",
      );
      expect(transparent.barClassName).not.toContain("backdrop-blur-md");
    });
  });

  describe("reduced motion", () => {
    it("strips the lift and the transition utility", () => {
      setReducedMotion(true);
      const { barClassName } = render({
        isPinned: false,
        expanded: true,
        effectiveExpanded: true,
      });
      expect(barClassName).not.toContain("-translate-y-[14px]");
      expect(barClassName).not.toContain("transition-all");
    });
  });
});
