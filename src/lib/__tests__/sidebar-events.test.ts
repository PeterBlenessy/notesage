import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  emitSidebarEvent,
  subscribeToSidebarEvents,
  type SidebarEvent,
} from "@/lib/sidebar-events";

describe("sidebar-events bus (sidebar-simplification task #5)", () => {
  beforeEach(() => {
    // The module-level `handlers` Set isn't directly resettable, but
    // each test subscribes its own handler and unsubscribes via the
    // returned cleanup so cross-test bleed shouldn't happen. The
    // `vi.fn()` instances are scoped to each test.
  });

  it("delivers an emitted event to a single subscriber", () => {
    const handler = vi.fn();
    const unsub = subscribeToSidebarEvents(handler);

    const ev: SidebarEvent = {
      type: "expand-path",
      projectPath: "/Users/me/Notesage/alpha",
      targetPath: "/Users/me/Notesage/alpha/docs",
    };
    emitSidebarEvent(ev);

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith(ev);

    unsub();
  });

  it("delivers an event to every subscriber (multicast)", () => {
    const a = vi.fn();
    const b = vi.fn();
    const c = vi.fn();
    const unsubs = [
      subscribeToSidebarEvents(a),
      subscribeToSidebarEvents(b),
      subscribeToSidebarEvents(c),
    ];

    emitSidebarEvent({
      type: "expand-path",
      projectPath: "/p",
      targetPath: "/p/x",
    });

    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
    expect(c).toHaveBeenCalledTimes(1);

    unsubs.forEach((u) => u());
  });

  it("stops delivering after unsubscribe", () => {
    const handler = vi.fn();
    const unsub = subscribeToSidebarEvents(handler);

    emitSidebarEvent({
      type: "expand-path",
      projectPath: "/p",
      targetPath: "/p/x",
    });
    expect(handler).toHaveBeenCalledTimes(1);

    unsub();

    emitSidebarEvent({
      type: "expand-path",
      projectPath: "/p",
      targetPath: "/p/y",
    });
    expect(handler).toHaveBeenCalledTimes(1); // unchanged
  });

  it("a handler that unsubscribes itself mid-emit doesn't disturb other handlers", () => {
    // Snapshot pattern guarantee — verifies the bus iterates a copy of
    // the subscribers set so a self-unsubscribe doesn't skip later
    // handlers in the same emit cycle.
    const after = vi.fn();
    let unsubFirst: (() => void) | null = null;
    const first = vi.fn(() => {
      unsubFirst?.();
    });
    unsubFirst = subscribeToSidebarEvents(first);
    const unsubAfter = subscribeToSidebarEvents(after);

    emitSidebarEvent({
      type: "expand-path",
      projectPath: "/p",
      targetPath: "/p/x",
    });

    expect(first).toHaveBeenCalledTimes(1);
    expect(after).toHaveBeenCalledTimes(1); // still fired despite first's unsub

    unsubAfter();
  });
});
