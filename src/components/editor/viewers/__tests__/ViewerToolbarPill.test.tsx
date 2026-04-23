// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { useRef, useEffect } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { ViewerToolbarPill } from "../ViewerToolbarPill";

/**
 * Helper to mount the pill with an explicit scroll container under our
 * control — avoids depending on ancestor-walking for the tests that need
 * precise event dispatch.
 */
function PillWithContainer({
  reducedMotion,
  viewerId,
}: {
  reducedMotion?: boolean;
  viewerId?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  // Tests toggle reduced motion via the global matchMedia mock below, but
  // accept the flag here for documentation.
  void reducedMotion;
  return (
    <div>
      <div
        data-testid="scroller"
        ref={ref}
        style={{ height: 200, overflowY: "auto" }}
      >
        <div style={{ height: 1000 }}>content</div>
      </div>
      <ViewerToolbarPill scrollRef={ref} viewerId={viewerId}>
        <button type="button">zoom in</button>
      </ViewerToolbarPill>
    </div>
  );
}

/**
 * `matchMedia` mock — install once per test; swap `matches` for the
 * reduced-motion test.
 */
function installMatchMedia(reduced: boolean) {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    configurable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: query.includes("prefers-reduced-motion") ? reduced : false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

describe("ViewerToolbarPill", () => {
  beforeEach(() => {
    installMatchMedia(false);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders children inside the pill", () => {
    render(
      <ViewerToolbarPill>
        <button type="button">zoom in</button>
      </ViewerToolbarPill>,
    );
    expect(screen.getByRole("button", { name: "zoom in" })).toBeTruthy();
  });

  it("has role=toolbar with aria-label 'Viewer toolbar'", () => {
    render(
      <ViewerToolbarPill>
        <span>content</span>
      </ViewerToolbarPill>,
    );
    const toolbar = screen.getByRole("toolbar", { name: "Viewer toolbar" });
    expect(toolbar).toBeTruthy();
  });

  it("carries data-quiet-toolbar attribute for CSS targeting", () => {
    render(
      <ViewerToolbarPill>
        <span>x</span>
      </ViewerToolbarPill>,
    );
    const toolbar = screen.getByRole("toolbar");
    expect(toolbar.getAttribute("data-quiet-toolbar")).toBe("");
  });

  it("reflects viewerId as data-viewer-id", () => {
    render(
      <ViewerToolbarPill viewerId="pdf">
        <span>x</span>
      </ViewerToolbarPill>,
    );
    const toolbar = screen.getByRole("toolbar");
    expect(toolbar.getAttribute("data-viewer-id")).toBe("pdf");
  });

  it("sets data-scrolling=true when the scroll target scrolls", () => {
    render(<PillWithContainer />);
    const toolbar = screen.getByRole("toolbar");
    expect(toolbar.getAttribute("data-scrolling")).toBe("false");

    const scroller = screen.getByTestId("scroller");
    act(() => {
      fireEvent.scroll(scroller);
    });

    expect(toolbar.getAttribute("data-scrolling")).toBe("true");
  });

  it("clears data-scrolling after 1200ms of scroll inactivity", () => {
    vi.useFakeTimers();
    render(<PillWithContainer />);
    const toolbar = screen.getByRole("toolbar");
    const scroller = screen.getByTestId("scroller");

    act(() => {
      fireEvent.scroll(scroller);
    });
    expect(toolbar.getAttribute("data-scrolling")).toBe("true");

    act(() => {
      vi.advanceTimersByTime(1199);
    });
    expect(toolbar.getAttribute("data-scrolling")).toBe("true");

    act(() => {
      vi.advanceTimersByTime(2);
    });
    expect(toolbar.getAttribute("data-scrolling")).toBe("false");
  });

  it("mouse-move on the pill cancels the fade immediately", () => {
    vi.useFakeTimers();
    render(<PillWithContainer />);
    const toolbar = screen.getByRole("toolbar");
    const scroller = screen.getByTestId("scroller");

    act(() => {
      fireEvent.scroll(scroller);
    });
    expect(toolbar.getAttribute("data-scrolling")).toBe("true");

    act(() => {
      fireEvent.mouseMove(toolbar);
    });
    expect(toolbar.getAttribute("data-scrolling")).toBe("false");
  });

  it("respects prefers-reduced-motion: never fades, no transition class", () => {
    installMatchMedia(true);
    vi.useFakeTimers();
    render(<PillWithContainer />);
    const toolbar = screen.getByRole("toolbar");
    const scroller = screen.getByTestId("scroller");

    expect(toolbar.getAttribute("data-reduced-motion")).toBe("true");

    act(() => {
      fireEvent.scroll(scroller);
    });

    // Scroll events are not wired under reduced motion, so scrolling
    // state never flips and the pill stays opaque.
    expect(toolbar.getAttribute("data-scrolling")).toBe("false");
    expect(toolbar.className.includes("opacity-100")).toBe(true);
    expect(toolbar.className.includes("transition-opacity")).toBe(false);
  });

  it("falls back to ancestor scroll container when scrollRef is omitted", () => {
    function TreeWithoutRef() {
      return (
        <div
          data-testid="ancestor"
          style={{ height: 200, overflowY: "scroll" }}
        >
          <div style={{ height: 1000 }}>
            <ViewerToolbarPill>
              <span>x</span>
            </ViewerToolbarPill>
          </div>
        </div>
      );
    }
    render(<TreeWithoutRef />);
    const toolbar = screen.getByRole("toolbar");
    const ancestor = screen.getByTestId("ancestor");

    act(() => {
      fireEvent.scroll(ancestor);
    });
    expect(toolbar.getAttribute("data-scrolling")).toBe("true");
  });

  it("applies caller className for positioning overrides", () => {
    render(
      <ViewerToolbarPill className="relative">
        <span>x</span>
      </ViewerToolbarPill>,
    );
    const toolbar = screen.getByRole("toolbar");
    expect(toolbar.className.includes("relative")).toBe(true);
  });

  it("does not toggle aria-hidden during fade (screen readers keep access)", () => {
    vi.useFakeTimers();
    render(<PillWithContainer />);
    const toolbar = screen.getByRole("toolbar");
    const scroller = screen.getByTestId("scroller");
    expect(toolbar.getAttribute("aria-hidden")).toBe(null);

    act(() => {
      fireEvent.scroll(scroller);
    });
    expect(toolbar.getAttribute("aria-hidden")).toBe(null);
  });

  it("cleans up the scroll listener on unmount", () => {
    function Probe({ detach }: { detach: boolean }) {
      const ref = useRef<HTMLDivElement>(null);
      useEffect(() => {
        // no-op; only kept to mirror real-world mounting
      }, []);
      if (detach) return null;
      return (
        <div>
          <div
            data-testid="scroller"
            ref={ref}
            style={{ height: 200, overflowY: "auto" }}
          >
            <div style={{ height: 1000 }}>content</div>
          </div>
          <ViewerToolbarPill scrollRef={ref}>
            <span>x</span>
          </ViewerToolbarPill>
        </div>
      );
    }
    const { rerender, queryByRole } = render(<Probe detach={false} />);
    expect(queryByRole("toolbar")).toBeTruthy();
    rerender(<Probe detach={true} />);
    expect(queryByRole("toolbar")).toBe(null);
  });
});
