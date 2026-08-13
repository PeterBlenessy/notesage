// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import "@/test/tauri-mock";
import {
  setMockInvokeHandler,
  clearMockInvokeHandlers,
} from "@/test/tauri-mock";
import {
  setupShowWindowWhenReady,
  SHOW_WINDOW_FALLBACK_DEADLINE_MS,
} from "@/App";
import { log } from "@/lib/logger";
import { invoke } from "@tauri-apps/api/core";

// ---------------------------------------------------------------------------
// requestAnimationFrame mock (pattern mirrors useEditorResize.test.ts)
// ---------------------------------------------------------------------------

let rafCallbacks: Array<{ id: number; cb: FrameRequestCallback }> = [];
let rafId = 0;
let cancelledRafIds: number[] = [];

function mockRaf(callback: FrameRequestCallback): number {
  const id = ++rafId;
  rafCallbacks.push({ id, cb: callback });
  return id;
}

function mockCancelRaf(id: number): void {
  cancelledRafIds.push(id);
  rafCallbacks = rafCallbacks.filter((entry) => entry.id !== id);
}

// Flush one round of pending rAF callbacks.
function flushRaf() {
  const pending = rafCallbacks.splice(0);
  pending.forEach((entry) => entry.cb(performance.now()));
}

describe("setupShowWindowWhenReady (#679)", () => {
  beforeEach(() => {
    clearMockInvokeHandlers();
    vi.mocked(invoke).mockClear();
    setMockInvokeHandler("show_main_window_command", () => undefined);
    rafCallbacks = [];
    rafId = 0;
    cancelledRafIds = [];
    vi.useFakeTimers();
    globalThis.requestAnimationFrame = mockRaf as unknown as typeof requestAnimationFrame;
    globalThis.cancelAnimationFrame = mockCancelRaf as unknown as typeof cancelAnimationFrame;
    // Readiness never resolves by default: no theme class, no computed bg.
    document.documentElement.className = "";
    document.body.style.backgroundColor = "";
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("shows the window unconditionally once the fallback deadline elapses, even when the readiness check never resolves", async () => {
    setupShowWindowWhenReady();

    // Drain a few rAF ticks — readiness never becomes true, so the poll loop
    // just keeps re-scheduling itself indefinitely (the pre-fix behavior).
    for (let i = 0; i < 5; i++) flushRaf();
    expect(invoke).not.toHaveBeenCalledWith("show_main_window_command");

    // Advance past the fallback deadline.
    await vi.advanceTimersByTimeAsync(SHOW_WINDOW_FALLBACK_DEADLINE_MS);

    expect(invoke).toHaveBeenCalledWith("show_main_window_command");
  });

  it("cancels the pending rAF loop on unmount — no leaked rAF callbacks", () => {
    const cleanup = setupShowWindowWhenReady();

    // The initial rAF tick has been scheduled but not yet flushed.
    expect(rafCallbacks.length).toBe(1);
    const scheduledId = rafCallbacks[0].id;

    cleanup();

    expect(cancelledRafIds).toContain(scheduledId);
    expect(rafCallbacks.length).toBe(0);
  });

  it("cancels the fallback timer on unmount — the window is not shown after cleanup", async () => {
    const cleanup = setupShowWindowWhenReady();

    cleanup();

    await vi.advanceTimersByTimeAsync(SHOW_WINDOW_FALLBACK_DEADLINE_MS + 1000);

    expect(invoke).not.toHaveBeenCalledWith("show_main_window_command");
  });

  it("logs the fallback firing for observability, distinct from the normal ready-and-shown path", async () => {
    const warnSpy = vi.spyOn(log, "warn");
    setupShowWindowWhenReady();

    await vi.advanceTimersByTimeAsync(SHOW_WINDOW_FALLBACK_DEADLINE_MS);

    expect(warnSpy).toHaveBeenCalledWith(
      "perf:startup",
      expect.stringContaining("fallback"),
    );
  });

  it("does NOT log a fallback warning when the readiness check resolves normally in time", async () => {
    const warnSpy = vi.spyOn(log, "warn");

    document.documentElement.className = "dark";
    document.body.style.backgroundColor = "rgb(24, 24, 24)";

    setupShowWindowWhenReady();

    // First poll tick observes readiness and schedules the show-window rAF.
    flushRaf();
    // Second tick actually shows the window.
    flushRaf();

    expect(invoke).toHaveBeenCalledWith("show_main_window_command");

    // Even after the fallback deadline elapses, no fallback warning fires —
    // the window was already shown via the normal ready path.
    await vi.advanceTimersByTimeAsync(SHOW_WINDOW_FALLBACK_DEADLINE_MS);
    expect(warnSpy).not.toHaveBeenCalledWith(
      "perf:startup",
      expect.stringContaining("fallback"),
    );
  });
});
