// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useFocusMode } from "../useFocusMode";

// ---------------------------------------------------------------------------
// matchMedia mock — mirrors the `useFadeOnType` test helper. The hook itself
// doesn't read matchMedia, but FocusPill and the sibling CSS do; keeping the
// mock ensures downstream code never throws in jsdom.
// ---------------------------------------------------------------------------

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

function installMatchMedia(mql: MockMediaQueryList) {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    configurable: true,
    value: vi.fn().mockReturnValue(mql),
  });
}

const originalMatchMedia = window.matchMedia;

// ---------------------------------------------------------------------------
// Test DOM helpers
// ---------------------------------------------------------------------------

function mountRoot(): HTMLElement {
  const root = document.createElement("div");
  root.setAttribute("data-quiet-layout-root", "");
  root.className = "app";
  document.body.appendChild(root);
  return root;
}

/** Emits a Radix-managed open-popover so the fall-through chain skips Esc. */
function mountOpenPopover(): HTMLElement {
  const wrapper = document.createElement("div");
  wrapper.setAttribute("data-radix-popper-content-wrapper", "");
  wrapper.setAttribute("data-state", "open");
  document.body.appendChild(wrapper);
  return wrapper;
}

/** Emits an expanded command bar so the fall-through chain skips Esc. */
function mountExpandedCmdBar(): HTMLElement {
  const bar = document.createElement("div");
  bar.setAttribute("data-cmd-bar", "");
  bar.setAttribute("data-expanded", "true");
  document.body.appendChild(bar);
  return bar;
}

/** Emits an inline-edit row so the fall-through chain skips Esc. */
function mountInlineEdit(): HTMLElement {
  const row = document.createElement("div");
  row.setAttribute("data-renaming", "true");
  document.body.appendChild(row);
  return row;
}

function fireKey(key: string, modifiers: { metaKey?: boolean } = {}) {
  const event = new KeyboardEvent("keydown", {
    key,
    metaKey: modifiers.metaKey ?? false,
    bubbles: true,
    cancelable: true,
  });
  window.dispatchEvent(event);
}

// ---------------------------------------------------------------------------

describe("useFocusMode", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    installMatchMedia(makeMql(false));
  });

  afterEach(() => {
    vi.useRealTimers();
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      configurable: true,
      value: originalMatchMedia,
    });
    document.body.innerHTML = "";
  });

  it("starts inactive", () => {
    mountRoot();
    const { result } = renderHook(() => useFocusMode());
    expect(result.current.active).toBe(false);
  });

  it("toggle() flips active on and off", () => {
    mountRoot();
    const { result } = renderHook(() => useFocusMode());

    act(() => {
      result.current.toggle();
    });
    expect(result.current.active).toBe(true);

    act(() => {
      result.current.toggle();
    });
    expect(result.current.active).toBe(false);
  });

  it("applies `.focus-mode` on the QuietLayout root while active", () => {
    const root = mountRoot();
    const { result } = renderHook(() => useFocusMode());

    act(() => {
      result.current.toggle();
    });
    expect(root.classList.contains("focus-mode")).toBe(true);

    act(() => {
      result.current.exit();
    });
    expect(root.classList.contains("focus-mode")).toBe(false);
  });

  it("⌘. toggles active", () => {
    mountRoot();
    const { result } = renderHook(() => useFocusMode());

    act(() => {
      fireKey(".", { metaKey: true });
    });
    expect(result.current.active).toBe(true);

    act(() => {
      fireKey(".", { metaKey: true });
    });
    expect(result.current.active).toBe(false);
  });

  it("Escape while active and nothing else open exits focus mode", () => {
    mountRoot();
    const { result } = renderHook(() => useFocusMode());

    act(() => {
      result.current.toggle();
    });
    expect(result.current.active).toBe(true);

    act(() => {
      fireKey("Escape");
    });
    expect(result.current.active).toBe(false);
  });

  it("Escape falls through to an open Radix popover (focus mode stays on)", () => {
    mountRoot();
    const { result } = renderHook(() => useFocusMode());

    act(() => {
      result.current.toggle();
    });
    expect(result.current.active).toBe(true);

    // Simulate an open popover — the hook must NOT exit.
    mountOpenPopover();

    act(() => {
      fireKey("Escape");
    });
    expect(result.current.active).toBe(true);
  });

  it("Escape falls through to an expanded command bar (focus mode stays on)", () => {
    mountRoot();
    const { result } = renderHook(() => useFocusMode());

    act(() => {
      result.current.toggle();
    });
    expect(result.current.active).toBe(true);

    mountExpandedCmdBar();

    act(() => {
      fireKey("Escape");
    });
    expect(result.current.active).toBe(true);
  });

  it("Escape falls through to an inline-edit row (focus mode stays on)", () => {
    mountRoot();
    const { result } = renderHook(() => useFocusMode());

    act(() => {
      result.current.toggle();
    });
    expect(result.current.active).toBe(true);

    mountInlineEdit();

    act(() => {
      fireKey("Escape");
    });
    expect(result.current.active).toBe(true);
  });

  it("appends a polite aria-live announcer on enter and removes it", () => {
    vi.useFakeTimers();
    mountRoot();
    const { result } = renderHook(() => useFocusMode());

    act(() => {
      result.current.toggle();
    });

    const announcer = document.querySelector<HTMLElement>(
      "[data-focus-mode-announcer]",
    );
    expect(announcer).not.toBeNull();
    expect(announcer!.getAttribute("aria-live")).toBe("polite");
    expect(announcer!.textContent).toMatch(/focus mode on/i);

    // TTL expires → announcer is removed.
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(document.querySelector("[data-focus-mode-announcer]")).toBeNull();
  });

  it("announces an exit message on deactivation", () => {
    mountRoot();
    const { result } = renderHook(() => useFocusMode());

    act(() => {
      result.current.toggle();
    });
    // Clear the enter announcer so we only see the exit one.
    document
      .querySelectorAll("[data-focus-mode-announcer]")
      .forEach((n) => n.parentNode?.removeChild(n));

    act(() => {
      result.current.exit();
    });

    const announcer = document.querySelector<HTMLElement>(
      "[data-focus-mode-announcer]",
    );
    expect(announcer).not.toBeNull();
    expect(announcer!.textContent).toMatch(/focus mode off/i);
  });

  it("cleans up `.focus-mode` from the root on unmount", () => {
    const root = mountRoot();
    const { result, unmount } = renderHook(() => useFocusMode());

    act(() => {
      result.current.toggle();
    });
    expect(root.classList.contains("focus-mode")).toBe(true);

    unmount();

    expect(root.classList.contains("focus-mode")).toBe(false);
    // No orphan announcers left behind.
    expect(document.querySelector("[data-focus-mode-announcer]")).toBeNull();
  });

  it("works under prefers-reduced-motion: reduce", () => {
    installMatchMedia(makeMql(true));
    const root = mountRoot();
    const { result } = renderHook(() => useFocusMode());

    act(() => {
      fireKey(".", { metaKey: true });
    });
    expect(result.current.active).toBe(true);
    expect(root.classList.contains("focus-mode")).toBe(true);

    act(() => {
      fireKey("Escape");
    });
    expect(result.current.active).toBe(false);
  });

  it("falls back to document.body when the root attribute is missing", () => {
    // Intentionally do NOT mount `[data-quiet-layout-root]`.
    const { result } = renderHook(() => useFocusMode());

    act(() => {
      result.current.toggle();
    });
    expect(document.body.classList.contains("focus-mode")).toBe(true);

    act(() => {
      result.current.exit();
    });
    expect(document.body.classList.contains("focus-mode")).toBe(false);
  });

  // -------------------------------------------------------------------------
  // Focus restoration (PRD #84: "Focus returns to pre-focus-mode element.")
  // -------------------------------------------------------------------------

  /** Flush one animation frame so the rAF-deferred focus restore runs. */
  async function flushRaf(): Promise<void> {
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => resolve());
    });
  }

  it("restores focus to the pre-focus-mode element on exit", async () => {
    mountRoot();
    const button = document.createElement("button");
    button.textContent = "Source";
    document.body.appendChild(button);
    button.focus();
    expect(document.activeElement).toBe(button);

    const { result } = renderHook(() => useFocusMode());

    // Enter focus mode — previous focus captured.
    act(() => {
      result.current.toggle();
    });
    // Simulate something else stealing focus while in focus mode.
    const other = document.createElement("input");
    document.body.appendChild(other);
    other.focus();
    expect(document.activeElement).toBe(other);

    // Exit focus mode — focus should return to the original button.
    act(() => {
      result.current.exit();
    });
    await act(async () => {
      await flushRaf();
    });
    expect(document.activeElement).toBe(button);
  });

  it("does not restore focus when the pre-focus element has been detached", async () => {
    mountRoot();
    const button = document.createElement("button");
    document.body.appendChild(button);
    button.focus();

    const { result } = renderHook(() => useFocusMode());

    act(() => {
      result.current.toggle();
    });

    // Detach the button before exit — restoration must be a no-op (no throw).
    button.remove();

    act(() => {
      result.current.exit();
    });
    await act(async () => {
      await flushRaf();
    });
    // Nothing to focus → activeElement falls back to body.
    expect(document.activeElement).toBe(document.body);
  });

  it("skips focus restoration when nothing was focused before entering", async () => {
    mountRoot();
    // Nothing focused: activeElement === body.
    expect(document.activeElement).toBe(document.body);

    const sibling = document.createElement("button");
    document.body.appendChild(sibling);

    const { result } = renderHook(() => useFocusMode());

    act(() => {
      result.current.toggle();
    });
    // Focus the sibling while focus mode is active.
    sibling.focus();
    expect(document.activeElement).toBe(sibling);

    act(() => {
      result.current.exit();
    });
    await act(async () => {
      await flushRaf();
    });
    // Because body was the "previous focus," ref was null — sibling keeps focus.
    expect(document.activeElement).toBe(sibling);
  });

  it("captures fresh previous-focus on re-entry", async () => {
    mountRoot();
    const first = document.createElement("button");
    first.textContent = "first";
    const second = document.createElement("button");
    second.textContent = "second";
    document.body.appendChild(first);
    document.body.appendChild(second);

    const { result } = renderHook(() => useFocusMode());

    // First cycle: focus `first`, enter, exit → should restore to `first`.
    first.focus();
    act(() => {
      result.current.toggle();
    });
    act(() => {
      result.current.exit();
    });
    await act(async () => {
      await flushRaf();
    });
    expect(document.activeElement).toBe(first);

    // Second cycle: focus `second`, enter, exit → should restore to `second`.
    second.focus();
    act(() => {
      result.current.toggle();
    });
    act(() => {
      result.current.exit();
    });
    await act(async () => {
      await flushRaf();
    });
    expect(document.activeElement).toBe(second);
  });
});
