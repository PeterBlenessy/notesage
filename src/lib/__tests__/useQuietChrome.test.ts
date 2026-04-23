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
    };
  });

  afterEach(() => {
    document.body.innerHTML = "";
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
    };

    renderHook(() => useQuietChrome());

    expect(getAttrs(root)).toEqual({
      toolbar: "fade",
      status: "fade",
      docHead: "fade",
      sidebar: "fade",
      orb: "fade",
    });
  });

  it('writes the default mapping when preset is "default" (sidebar/orb stay)', () => {
    const root = mountRoot();
    state.quietChromePreset = "default";

    renderHook(() => useQuietChrome());

    expect(getAttrs(root)).toEqual({
      toolbar: "fade",
      status: "fade",
      docHead: "fade",
      sidebar: "stay",
      orb: "stay",
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
    };

    const { rerender } = renderHook(() => useQuietChrome());
    expect(getAttrs(root).sidebar).toBe("fade");

    // Flip preset to relaxed — sidebar should switch back to stay.
    state.quietChromePreset = "relaxed";
    rerender();

    expect(getAttrs(root)).toEqual({
      toolbar: "fade",
      status: "fade",
      docHead: "stay",
      sidebar: "stay",
      orb: "stay",
    });
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
    };

    renderHook(() => useQuietChrome());

    expect(getAttrs(root)).toEqual({
      toolbar: "stay",
      status: "fade",
      docHead: "stay",
      sidebar: "fade",
      orb: "stay",
    });
  });
});
