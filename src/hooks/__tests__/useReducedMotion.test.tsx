// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useReducedMotion } from "../useReducedMotion";

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

describe("useReducedMotion", () => {
  beforeEach(() => {
    // Restore so individual tests can install their own mock or delete it.
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      configurable: true,
      value: originalMatchMedia,
    });
  });

  afterEach(() => {
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      configurable: true,
      value: originalMatchMedia,
    });
  });

  it("returns false when matchMedia reports matches: false", () => {
    const mql = makeMql(false);
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      configurable: true,
      value: vi.fn().mockReturnValue(mql),
    });

    const { result } = renderHook(() => useReducedMotion());
    expect(result.current).toBe(false);
  });

  it("returns true when matchMedia reports matches: true", () => {
    const mql = makeMql(true);
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      configurable: true,
      value: vi.fn().mockReturnValue(mql),
    });

    const { result } = renderHook(() => useReducedMotion());
    expect(result.current).toBe(true);
  });

  it("updates when the matchMedia listener fires", () => {
    const mql = makeMql(false);
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      configurable: true,
      value: vi.fn().mockReturnValue(mql),
    });

    const { result } = renderHook(() => useReducedMotion());
    expect(result.current).toBe(false);

    // Grab the listener registered by the hook and invoke it with a new matches value.
    const addCall = mql.addEventListener.mock.calls.find(([type]) => type === "change");
    expect(addCall).toBeDefined();
    const listener = addCall![1] as (event: { matches: boolean }) => void;

    act(() => {
      listener({ matches: true });
    });

    expect(result.current).toBe(true);

    act(() => {
      listener({ matches: false });
    });

    expect(result.current).toBe(false);
  });

  it("removes the change listener on unmount", () => {
    const mql = makeMql(false);
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      configurable: true,
      value: vi.fn().mockReturnValue(mql),
    });

    const { unmount } = renderHook(() => useReducedMotion());

    const addCall = mql.addEventListener.mock.calls.find(([type]) => type === "change");
    expect(addCall).toBeDefined();
    const addedHandler = addCall![1];

    unmount();

    const removeCall = mql.removeEventListener.mock.calls.find(([type]) => type === "change");
    expect(removeCall).toBeDefined();
    expect(removeCall![1]).toBe(addedHandler);
  });

  it("returns false and does not throw when window.matchMedia is unavailable", () => {
    // Why: matchMedia is undefined in SSR / non-browser environments — the hook
    // must degrade gracefully rather than crash the render.
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      configurable: true,
      value: undefined,
    });

    const { result } = renderHook(() => useReducedMotion());
    expect(result.current).toBe(false);
  });
});
