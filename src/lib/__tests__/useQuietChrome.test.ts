// @vitest-environment jsdom
/**
 * jsdom integration tests for `useQuietChrome` — verifies the hook writes
 * the correct `data-quiet-chrome-*` attributes onto the `[data-quiet-layout-root]`
 * element in response to settings-store changes.
 *
 * Covers:
 * - Preset "aggressive" → every target fades.
 * - Switch to "relaxed"  → sidebar and orb go back to stay.
 * - Preset "custom" + bespoke overrides → attributes mirror the overrides.
 *
 * The settings-store is mocked so we don't have to drag in the Zustand
 * persist middleware (and its localStorage backing) just to flip two
 * slices during test.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import type { QuietChromePreset, QuietChromeTargets } from "../quiet-chrome";

interface MockSettings {
  quietChromePreset: QuietChromePreset | "custom";
  quietChromeOverrides: QuietChromeTargets;
}

const state: MockSettings = {
  quietChromePreset: "default",
  quietChromeOverrides: {
    toolbar: true,
    status: true,
    docHead: true,
    sidebar: false,
    orb: false,
    titlebar: false,
    cmdbar: false,
  },
};

vi.mock("@/stores/settings-store", () => ({
  useSettingsStore: <T>(selector: (s: MockSettings) => T): T => selector(state),
}));

// Import AFTER the mock is registered.
import { useQuietChrome } from "../quiet-chrome";

function mountRoot(): HTMLElement {
  const root = document.createElement("div");
  root.setAttribute("data-quiet-layout-root", "");
  root.className = "app";
  document.body.appendChild(root);
  return root;
}

function getAttrs(root: HTMLElement) {
  return {
    toolbar: root.getAttribute("data-quiet-chrome-toolbar"),
    status: root.getAttribute("data-quiet-chrome-status"),
    docHead: root.getAttribute("data-quiet-chrome-dochead"),
    sidebar: root.getAttribute("data-quiet-chrome-sidebar"),
    orb: root.getAttribute("data-quiet-chrome-orb"),
    titlebar: root.getAttribute("data-quiet-chrome-titlebar"),
    cmdbar: root.getAttribute("data-quiet-chrome-cmdbar"),
  };
}

describe("useQuietChrome", () => {
  beforeEach(() => {
    state.quietChromePreset = "default";
    state.quietChromeOverrides = {
      toolbar: true,
      status: true,
      docHead: true,
      sidebar: false,
      orb: false,
      titlebar: false,
      cmdbar: false,
    };
  });

  afterEach(() => {
    document.body.innerHTML = "";
    // The hook also writes `data-quiet-chrome-cmdbar` to <html> for the
    // portal'd FloatingCommandBar — clean it up between tests.
    document.documentElement.removeAttribute("data-quiet-chrome-cmdbar");
  });

  it('writes "fade" for every target when preset is "aggressive"', () => {
    const root = mountRoot();
    state.quietChromePreset = "aggressive";
    state.quietChromeOverrides = {
      toolbar: true,
      status: true,
      docHead: true,
      sidebar: true,
      orb: true,
      titlebar: true,
      cmdbar: true,
    };

    renderHook(() => useQuietChrome());

    expect(getAttrs(root)).toEqual({
      toolbar: "fade",
      status: "fade",
      docHead: "fade",
      sidebar: "fade",
      orb: "fade",
      titlebar: "fade",
      cmdbar: "fade",
    });
  });

  it('writes the default mapping when preset is "default" (titlebar/cmdbar/sidebar/orb stay)', () => {
    const root = mountRoot();
    state.quietChromePreset = "default";

    renderHook(() => useQuietChrome());

    expect(getAttrs(root)).toEqual({
      toolbar: "fade",
      status: "fade",
      docHead: "fade",
      sidebar: "stay",
      orb: "stay",
      titlebar: "stay",
      cmdbar: "stay",
    });
  });

  it('writes the relaxed mapping when preset is "relaxed"', () => {
    const root = mountRoot();
    state.quietChromePreset = "relaxed";

    renderHook(() => useQuietChrome());

    expect(getAttrs(root)).toEqual({
      toolbar: "fade",
      status: "fade",
      docHead: "stay",
      sidebar: "stay",
      orb: "stay",
      titlebar: "stay",
      cmdbar: "stay",
    });
  });

  it("updates data attributes when preset changes", () => {
    const root = mountRoot();
    state.quietChromePreset = "aggressive";
    state.quietChromeOverrides = {
      toolbar: true,
      status: true,
      docHead: true,
      sidebar: true,
      orb: true,
      titlebar: true,
      cmdbar: true,
    };

    const { rerender } = renderHook(() => useQuietChrome());
    expect(getAttrs(root).sidebar).toBe("fade");
    expect(getAttrs(root).titlebar).toBe("fade");
    expect(getAttrs(root).cmdbar).toBe("fade");

    // Flip preset to relaxed — sidebar/titlebar/cmdbar should switch back.
    state.quietChromePreset = "relaxed";
    rerender();

    expect(getAttrs(root)).toEqual({
      toolbar: "fade",
      status: "fade",
      docHead: "stay",
      sidebar: "stay",
      orb: "stay",
      titlebar: "stay",
      cmdbar: "stay",
    });
  });

  it('mirrors data-quiet-chrome-cmdbar to <html> so the portal\'d cmd bar can match', () => {
    // The FloatingCommandBar portals to document.body and is a sibling of
    // [data-quiet-layout-root]. A selector keyed on `.app[data-quiet-chrome-cmdbar]`
    // cannot reach a sibling — so the hook ALSO writes the attribute to
    // <html> for the cmd bar's CSS rule to consume.
    mountRoot();
    state.quietChromePreset = "aggressive";
    state.quietChromeOverrides = {
      toolbar: true,
      status: true,
      docHead: true,
      sidebar: true,
      orb: true,
      titlebar: true,
      cmdbar: true,
    };

    renderHook(() => useQuietChrome());

    expect(document.documentElement.getAttribute("data-quiet-chrome-cmdbar")).toBe(
      "fade",
    );

    // Flipping to a preset that disables the cmd bar fade flips the html mirror.
    state.quietChromePreset = "default";
    renderHook(() => useQuietChrome());
    expect(document.documentElement.getAttribute("data-quiet-chrome-cmdbar")).toBe(
      "stay",
    );
  });

  it('writes overrides verbatim when preset is "custom"', () => {
    const root = mountRoot();
    state.quietChromePreset = "custom";
    state.quietChromeOverrides = {
      toolbar: false,
      status: true,
      docHead: false,
      sidebar: true,
      orb: false,
      titlebar: true,
      cmdbar: false,
    };

    renderHook(() => useQuietChrome());

    expect(getAttrs(root)).toEqual({
      toolbar: "stay",
      status: "fade",
      docHead: "stay",
      sidebar: "fade",
      orb: "stay",
      titlebar: "fade",
      cmdbar: "stay",
    });
  });
});
