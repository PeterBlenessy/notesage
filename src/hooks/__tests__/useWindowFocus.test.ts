// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, fireEvent } from "@testing-library/react";
import { useWindowFocus } from "../useWindowFocus";

/**
 * Tests for `useWindowFocus` — the macOS unfocused-window de-emphasis hook
 * (audit #17, 2026-04-27 quiet-composer-migration).
 *
 * The hook subscribes to `window` `blur` / `focus` events and writes
 * `data-window-inactive="true"` on the QuietLayout root identified by
 * `[data-quiet-layout-root]`. CSS in `globals.css` keys off the attribute
 * to swap `--accent` to the desaturated grey variant.
 */

const ATTR = "data-window-inactive";

function mountRoot(): HTMLElement {
  const root = document.createElement("div");
  root.setAttribute("data-quiet-layout-root", "");
  root.className = "app";
  document.body.appendChild(root);
  return root;
}

describe("useWindowFocus", () => {
  let originalHasFocus: typeof document.hasFocus;

  beforeEach(() => {
    document.body.innerHTML = "";
    originalHasFocus = document.hasFocus;
  });

  afterEach(() => {
    document.body.innerHTML = "";
    document.hasFocus = originalHasFocus;
  });

  function stubHasFocus(focused: boolean) {
    document.hasFocus = vi.fn(() => focused);
  }

  it("does not set data-window-inactive on mount when document is focused", () => {
    stubHasFocus(true);
    const root = mountRoot();
    renderHook(() => useWindowFocus());
    expect(root.getAttribute(ATTR)).toBeNull();
  });

  it("sets data-window-inactive on mount when document is not focused", () => {
    stubHasFocus(false);
    const root = mountRoot();
    renderHook(() => useWindowFocus());
    expect(root.getAttribute(ATTR)).toBe("true");
  });

  it("adds data-window-inactive when window fires blur", () => {
    stubHasFocus(true);
    const root = mountRoot();
    renderHook(() => useWindowFocus());
    expect(root.getAttribute(ATTR)).toBeNull();

    act(() => {
      fireEvent.blur(window);
    });

    expect(root.getAttribute(ATTR)).toBe("true");
  });

  it("removes data-window-inactive when window fires focus", () => {
    stubHasFocus(false);
    const root = mountRoot();
    renderHook(() => useWindowFocus());
    expect(root.getAttribute(ATTR)).toBe("true");

    act(() => {
      fireEvent.focus(window);
    });

    expect(root.getAttribute(ATTR)).toBeNull();
  });

  it("toggles correctly across multiple blur/focus cycles", () => {
    stubHasFocus(true);
    const root = mountRoot();
    renderHook(() => useWindowFocus());

    act(() => {
      fireEvent.blur(window);
    });
    expect(root.getAttribute(ATTR)).toBe("true");

    act(() => {
      fireEvent.focus(window);
    });
    expect(root.getAttribute(ATTR)).toBeNull();

    act(() => {
      fireEvent.blur(window);
    });
    expect(root.getAttribute(ATTR)).toBe("true");

    act(() => {
      fireEvent.focus(window);
    });
    expect(root.getAttribute(ATTR)).toBeNull();
  });

  it("cleans up listeners and clears the attribute on unmount", () => {
    stubHasFocus(true);
    const root = mountRoot();
    const { unmount } = renderHook(() => useWindowFocus());

    act(() => {
      fireEvent.blur(window);
    });
    expect(root.getAttribute(ATTR)).toBe("true");

    unmount();

    // Cleanup clears the stale attribute.
    expect(root.getAttribute(ATTR)).toBeNull();

    // Subsequent blur events no longer reach the root.
    act(() => {
      fireEvent.blur(window);
    });
    expect(root.getAttribute(ATTR)).toBeNull();
  });

  it("is a no-op when the QuietLayout root is not in the DOM", () => {
    stubHasFocus(true);
    // No root mounted — `[data-quiet-layout-root]` query returns null.
    const { unmount } = renderHook(() => useWindowFocus());

    // Hook should not throw; events should be safely ignored.
    expect(() => {
      act(() => {
        fireEvent.blur(window);
      });
    }).not.toThrow();

    expect(() => {
      act(() => {
        fireEvent.focus(window);
      });
    }).not.toThrow();

    expect(() => {
      unmount();
    }).not.toThrow();
  });

  it("does not require document.hasFocus to be implemented", () => {
    // Some environments lack hasFocus; the hook should default to "focused".
    document.hasFocus = undefined as unknown as typeof document.hasFocus;
    const root = mountRoot();

    expect(() => {
      renderHook(() => useWindowFocus());
    }).not.toThrow();

    // Defaults to focused → no attribute set.
    expect(root.getAttribute(ATTR)).toBeNull();
  });
});
