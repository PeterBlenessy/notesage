// @vitest-environment jsdom

/**
 * Unit tests for `useA11yPrefs` — the `notesage:a11y` bridge hook that
 * tracks the device's Dynamic Type size + Bold Text accessibility settings
 * for the mobile folder-view surfaces (issue #617).
 */

import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useA11yPrefs } from "@/components/mobile/useNativeChrome";

function dispatchA11y(detail: unknown) {
  window.dispatchEvent(new CustomEvent("notesage:a11y", { detail }));
}

describe("useA11yPrefs", () => {
  it("defaults to scale 1 and bold false before any native event arrives", () => {
    const { result } = renderHook(() => useA11yPrefs());
    expect(result.current).toEqual({ scale: 1, bold: false });
  });

  it("adopts the scale and bold flag from a notesage:a11y event", () => {
    const { result } = renderHook(() => useA11yPrefs());
    act(() => {
      dispatchA11y({ scale: 1.3, bold: true });
    });
    expect(result.current).toEqual({ scale: 1.3, bold: true });
  });

  it("falls back to scale 1 for a non-positive scale value", () => {
    const { result } = renderHook(() => useA11yPrefs());
    act(() => {
      dispatchA11y({ scale: 0, bold: false });
    });
    expect(result.current.scale).toBe(1);
  });

  it("treats a missing bold field as false", () => {
    const { result } = renderHook(() => useA11yPrefs());
    act(() => {
      dispatchA11y({ scale: 1.2 });
    });
    expect(result.current.bold).toBe(false);
  });

  it("updates again on a later event, reflecting a setting going back to default", () => {
    const { result } = renderHook(() => useA11yPrefs());
    act(() => {
      dispatchA11y({ scale: 1.4, bold: true });
    });
    expect(result.current).toEqual({ scale: 1.4, bold: true });
    act(() => {
      dispatchA11y({ scale: 1, bold: false });
    });
    expect(result.current).toEqual({ scale: 1, bold: false });
  });

  it("removes its event listener on unmount", () => {
    const { unmount } = renderHook(() => useA11yPrefs());
    unmount();
    // Dispatching after unmount must not throw (no stale listener referencing torn-down state).
    expect(() => dispatchA11y({ scale: 1.5, bold: true })).not.toThrow();
  });
});
