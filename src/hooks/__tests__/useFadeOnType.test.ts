// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useFadeOnType } from "../useFadeOnType";

// ---------------------------------------------------------------------------
// matchMedia mock — replicate the MediaQueryList surface so the hook can
// read and subscribe to the `prefers-reduced-motion: reduce` preference.
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
// Test DOM — a `[data-quiet-layout-root]` element stands in for the
// QuietLayout shell. The hook should find this node and toggle `.typing`
// on its classList.
// ---------------------------------------------------------------------------

function mountRoot(): HTMLElement {
  const root = document.createElement("div");
  root.setAttribute("data-quiet-layout-root", "");
  root.className = "app";
  document.body.appendChild(root);
  return root;
}

function mountCmdBar(parent: HTMLElement): HTMLElement {
  const bar = document.createElement("div");
  bar.setAttribute("data-cmd-bar", "");
  parent.appendChild(bar);
  const input = document.createElement("input");
  bar.appendChild(input);
  return input;
}

function fireKeydown(target: EventTarget) {
  const event = new KeyboardEvent("keydown", {
    key: "a",
    bubbles: true,
    cancelable: true,
  });
  target.dispatchEvent(event);
}

function fireMousemove() {
  const event = new MouseEvent("mousemove", { bubbles: true });
  document.dispatchEvent(event);
}

function fireWheel() {
  const event = new WheelEvent("wheel", { bubbles: true });
  document.dispatchEvent(event);
}

function fireFocusin() {
  const event = new FocusEvent("focusin", { bubbles: true });
  document.dispatchEvent(event);
}

// ---------------------------------------------------------------------------

describe("useFadeOnType", () => {
  beforeEach(() => {
    // Fresh DOM for every test so previous `.typing` state doesn't leak.
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

  it("does not add `.typing` to the root on mount", () => {
    const root = mountRoot();
    renderHook(() => useFadeOnType());
    expect(root.classList.contains("typing")).toBe(false);
  });

  it("adds `.typing` on keydown anywhere in the document", () => {
    const root = mountRoot();
    renderHook(() => useFadeOnType());

    act(() => {
      fireKeydown(document.body);
    });

    expect(root.classList.contains("typing")).toBe(true);
  });

  it("removes `.typing` immediately when the mouse moves", () => {
    const root = mountRoot();
    renderHook(() => useFadeOnType());

    act(() => {
      fireKeydown(document.body);
    });
    expect(root.classList.contains("typing")).toBe(true);

    act(() => {
      fireMousemove();
    });
    expect(root.classList.contains("typing")).toBe(false);
  });

  it("auto-removes `.typing` after 1200 ms of inactivity", () => {
    vi.useFakeTimers();
    const root = mountRoot();
    renderHook(() => useFadeOnType());

    act(() => {
      fireKeydown(document.body);
    });
    expect(root.classList.contains("typing")).toBe(true);

    // 1199 ms — still typing.
    act(() => {
      vi.advanceTimersByTime(1199);
    });
    expect(root.classList.contains("typing")).toBe(true);

    // Crossing the 1200 ms boundary removes the class.
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(root.classList.contains("typing")).toBe(false);
  });

  it("removes `.typing` on wheel and focusin events", () => {
    const root = mountRoot();
    renderHook(() => useFadeOnType());

    act(() => {
      fireKeydown(document.body);
    });
    expect(root.classList.contains("typing")).toBe(true);

    act(() => {
      fireWheel();
    });
    expect(root.classList.contains("typing")).toBe(false);

    // Re-trigger and test focusin cancel path.
    act(() => {
      fireKeydown(document.body);
    });
    expect(root.classList.contains("typing")).toBe(true);

    act(() => {
      fireFocusin();
    });
    expect(root.classList.contains("typing")).toBe(false);
  });

  it("cleans up the class and listeners on unmount", () => {
    const root = mountRoot();
    const { unmount } = renderHook(() => useFadeOnType());

    act(() => {
      fireKeydown(document.body);
    });
    expect(root.classList.contains("typing")).toBe(true);

    unmount();

    // After unmount the class is removed …
    expect(root.classList.contains("typing")).toBe(false);

    // … and subsequent keydown events no longer re-flip it.
    act(() => {
      fireKeydown(document.body);
    });
    expect(root.classList.contains("typing")).toBe(false);
  });

  it("is a no-op when prefers-reduced-motion is set", () => {
    installMatchMedia(makeMql(true));
    const root = mountRoot();
    renderHook(() => useFadeOnType());

    act(() => {
      fireKeydown(document.body);
    });

    // Typing events don't install listeners, so the class is never added.
    expect(root.classList.contains("typing")).toBe(false);
  });

  it("does not add `.typing` when typing inside the command bar", () => {
    const root = mountRoot();
    const cmdInput = mountCmdBar(root);
    renderHook(() => useFadeOnType());

    act(() => {
      fireKeydown(cmdInput);
    });

    expect(root.classList.contains("typing")).toBe(false);
  });

  it("reacts to live changes in prefers-reduced-motion", () => {
    const mql = makeMql(false);
    installMatchMedia(mql);
    const root = mountRoot();
    renderHook(() => useFadeOnType());

    // Initially active — typing flips the class.
    act(() => {
      fireKeydown(document.body);
    });
    expect(root.classList.contains("typing")).toBe(true);

    // User enables reduce-motion; hook should disable itself.
    const addCall = mql.addEventListener.mock.calls.find(
      ([type]) => type === "change",
    );
    expect(addCall).toBeDefined();
    const listener = addCall![1] as (event: { matches: boolean }) => void;

    act(() => {
      listener({ matches: true });
    });
    expect(root.classList.contains("typing")).toBe(false);

    // Further typing events no longer add the class.
    act(() => {
      fireKeydown(document.body);
    });
    expect(root.classList.contains("typing")).toBe(false);
  });

  it("falls back to document.body when the root attribute is missing", () => {
    // Intentionally do NOT mount `[data-quiet-layout-root]`.
    renderHook(() => useFadeOnType());

    act(() => {
      fireKeydown(document.body);
    });

    expect(document.body.classList.contains("typing")).toBe(true);

    // Cleanup so later tests aren't affected.
    document.body.classList.remove("typing");
  });
});
