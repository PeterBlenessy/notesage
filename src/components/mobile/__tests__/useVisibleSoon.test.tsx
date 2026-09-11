// @vitest-environment jsdom

/**
 * The prefetch predicate shared by the gallery cards and both list rows.
 *
 * The behaviour worth pinning is not "it observes" but the three decisions
 * that make it a prefetch rather than a lazy load: the lead, the latch, and
 * the fallback for an engine with no observer.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useVisibleSoon } from "@/components/mobile/useVisibleSoon";

class FakeObserver {
  static instances: FakeObserver[] = [];
  callback: IntersectionObserverCallback;
  options: IntersectionObserverInit | undefined;
  observed: Element[] = [];
  disconnected = false;

  constructor(callback: IntersectionObserverCallback, options?: IntersectionObserverInit) {
    this.callback = callback;
    this.options = options;
    FakeObserver.instances.push(this);
  }
  observe(el: Element) {
    this.observed.push(el);
  }
  unobserve(el: Element) {
    this.observed = this.observed.filter((o) => o !== el);
  }
  disconnect() {
    this.disconnected = true;
    this.observed = [];
  }
  trigger(el: Element, isIntersecting: boolean) {
    this.callback(
      [{ target: el, isIntersecting } as IntersectionObserverEntry],
      this as unknown as IntersectionObserver,
    );
  }
}

/** Attach the hook's ref to a real node, the way a component would. */
function mount(enabled = true) {
  const node = document.createElement("div");
  document.body.appendChild(node);
  const view = renderHook(({ on }: { on: boolean }) => useVisibleSoon<HTMLDivElement>(on), {
    initialProps: { on: enabled },
  });
  act(() => view.result.current[0](node));
  return { node, view };
}

beforeEach(() => {
  FakeObserver.instances = [];
  vi.stubGlobal("IntersectionObserver", FakeObserver);
});
afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

describe("useVisibleSoon", () => {
  it("starts false — nothing is fetched for a row nobody is near", () => {
    const { view } = mount();
    expect(view.result.current[1]).toBe(false);
  });

  it("watches a full viewport in each direction, which is the prefetch", () => {
    // Asked AT the edge, the generation still has to run before the picture
    // exists, so it necessarily lands after the row. A screen of lead is what
    // turns a lazy load into a prefetch.
    mount();
    expect(FakeObserver.instances[0].options?.rootMargin).toBe("100% 0px");
  });

  it("turns true when the element comes within the lead", () => {
    const { node, view } = mount();
    act(() => FakeObserver.instances[0].trigger(node, true));
    expect(view.result.current[1]).toBe(true);
  });

  it("ignores a callback that reports no intersection", () => {
    const { node, view } = mount();
    act(() => FakeObserver.instances[0].trigger(node, false));
    expect(view.result.current[1]).toBe(false);
  });

  it("latches, so scrolling back and forth never re-queues the work", () => {
    // A fetched thumbnail is cached; there is nothing to reclaim by watching
    // an element leave, and un-latching would put the same job back in a
    // queue that runs two at a time.
    const { node, view } = mount();
    act(() => FakeObserver.instances[0].trigger(node, true));
    expect(view.result.current[1]).toBe(true);

    act(() => view.rerender({ on: true }));
    expect(view.result.current[1]).toBe(true);
    // …and it stopped watching once it had its answer.
    expect(FakeObserver.instances[0].disconnected).toBe(true);
  });

  it("observes nothing while disabled — a directory card never asks", () => {
    mount(false);
    expect(FakeObserver.instances).toHaveLength(0);
  });

  it("treats an engine without IntersectionObserver as already visible", () => {
    // jsdom, and any WebKit old enough to lack it: showing thumbnails
    // immediately is strictly better than showing none.
    vi.unstubAllGlobals();
    vi.stubGlobal("IntersectionObserver", undefined);
    const { view } = mount();
    expect(view.result.current[1]).toBe(true);
  });

  it("disconnects on unmount, leaving no observer behind", () => {
    const { view } = mount();
    expect(FakeObserver.instances[0].disconnected).toBe(false);
    act(() => view.unmount());
    expect(FakeObserver.instances[0].disconnected).toBe(true);
  });
});
