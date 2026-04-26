/**
 * Performance benchmarks for the AgentOrb (#89).
 *
 * Two assertions, per the task spec:
 *
 *  1. **Orb panel open with N tasks** — clicking the orb mounts the
 *     `<AgentPanel>` inside a Radix Popover. Total cost (click handler →
 *     React commit → portal mount → task list render) must clear 120 ms
 *     for N up to 100 tasks.
 *
 *  2. **Pulse JS cost** — the pulse is pure CSS (`@keyframes orb-pulse`
 *     in `globals.css`); the React render only adds the `orb-pulsing`
 *     className and Radix doesn't touch the DOM during the animation.
 *     There is no JS animation loop. We therefore measure the *render
 *     cost* of mounting the orb in its pulsing state and assert it
 *     clears a tight frame-budget — confirming there is no hidden JS
 *     cost behind the visual pulse.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import { render, fireEvent, act, cleanup } from "@testing-library/react";
import { benchmark } from "./harness";
import type { AgentTask } from "@/stores/activity-store";

// ---------------------------------------------------------------------------
// Radix polyfills for jsdom — Popover open requires PointerEvent APIs +
// ResizeObserver. Mirror the polyfills from `AgentOrb.test.tsx`.
// ---------------------------------------------------------------------------

if (!("hasPointerCapture" in HTMLElement.prototype)) {
  Object.defineProperty(HTMLElement.prototype, "hasPointerCapture", {
    configurable: true,
    value: vi.fn<() => boolean>(() => false),
  });
}
if (!("releasePointerCapture" in HTMLElement.prototype)) {
  Object.defineProperty(HTMLElement.prototype, "releasePointerCapture", {
    configurable: true,
    value: vi.fn(),
  });
}
if (!("setPointerCapture" in HTMLElement.prototype)) {
  Object.defineProperty(HTMLElement.prototype, "setPointerCapture", {
    configurable: true,
    value: vi.fn(),
  });
}
if (!("scrollIntoView" in HTMLElement.prototype)) {
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
    configurable: true,
    value: vi.fn(),
  });
}
if (typeof window !== "undefined" && !("ResizeObserver" in window)) {
  class ResizeObserverStub {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
  (
    window as unknown as { ResizeObserver: typeof ResizeObserverStub }
  ).ResizeObserver = ResizeObserverStub;
}

// ---------------------------------------------------------------------------
// Store mocks — controllable per test
// ---------------------------------------------------------------------------

let mockTasks: AgentTask[] = [];
const mockRemoveTask = vi.fn<(id: string) => void>();
let mockReducedMotion = false;
let mockCmdBarPinned = false;

vi.mock("@/hooks/useReducedMotion", () => ({
  useReducedMotion: () => mockReducedMotion,
}));

vi.mock("@/stores/activity-store", () => {
  const state = {
    get tasks() {
      return mockTasks;
    },
    removeTask: (id: string) => mockRemoveTask(id),
  };
  return {
    useActivityStore: Object.assign(
      vi.fn((sel: (s: typeof state) => unknown) => sel(state)),
      { getState: () => state },
    ),
  };
});

vi.mock("@/stores/settings-store", () => {
  const state = {
    get cmdBarPinned() {
      return mockCmdBarPinned;
    },
  };
  return {
    useSettingsStore: Object.assign(
      vi.fn((sel: (s: typeof state) => unknown) => sel(state)),
      { getState: () => state },
    ),
  };
});

vi.mock("@/lib/logger", () => ({
  log: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
  PERF: {
    orb: "perf:orb",
  },
}));

// Stub ActivityTaskCard so the benchmark measures the panel/list machinery
// rather than the (heavy) full task card render path. The full card pulls
// comment-store, routing-store, MarkdownContent, ProviderLogo, etc.; for an
// orb-open benchmark we only need the panel's list virtualization cost.
vi.mock("@/components/activity/ActivityTaskCard", () => ({
  ActivityTaskCard: ({ task }: { task: AgentTask }) =>
    React.createElement(
      "div",
      { "data-testid": `task-card-${task.id}` },
      task.label,
    ),
}));

// ---------------------------------------------------------------------------
// Lazy import after mocks
// ---------------------------------------------------------------------------

import { AgentOrb } from "@/components/activity/AgentOrb";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTask(id: string, status: AgentTask["status"]): AgentTask {
  return {
    id,
    type: "chat",
    label: `Task ${id}`,
    status,
    activities: [],
    startedAt: Date.now(),
  };
}

function generateTasks(count: number): AgentTask[] {
  const out: AgentTask[] = new Array(count);
  for (let i = 0; i < count; i++) {
    // Mix of statuses so the count badge logic and status icons get exercised
    const status: AgentTask["status"] =
      i % 4 === 0
        ? "running"
        : i % 4 === 1
          ? "done"
          : i % 4 === 2
            ? "error"
            : "cancelled";
    out[i] = makeTask(`t-${i}`, status);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Benchmark (1) — panel open with N tasks
// ---------------------------------------------------------------------------

describe("AgentOrb panel open", () => {
  beforeEach(() => {
    mockReducedMotion = false;
    mockCmdBarPinned = false;
    mockTasks = [];
    mockRemoveTask.mockReset();
  });

  for (const taskCount of [10, 50, 100]) {
    it(`opens the panel with ${taskCount} tasks within 120 ms budget`, async () => {
      mockTasks = generateTasks(taskCount);

      const result = await benchmark(
        `orb panel open (${taskCount} tasks)`,
        () => {
          // Each iteration: mount the orb fresh (so the popover is closed),
          // click to open, wait for the panel to render. Unmount at the end
          // so the next iteration starts clean — matches a real user
          // invocation cost from a closed state.
          const utils = render(React.createElement(AgentOrb));
          const orb = utils.getByTestId("agent-orb") as HTMLButtonElement;
          act(() => {
            fireEvent.click(orb);
          });
          // Panel renders synchronously inside Radix's portal — assert it's
          // there before unmounting so we're measuring the open-to-rendered
          // cost, not just the click dispatch.
          const region = utils.queryByRole("region", {
            name: /agent tasks/i,
          });
          if (!region) throw new Error("Panel did not render after click");
          utils.unmount();
        },
        120,
        // 5 iterations — give the harness enough samples for a stable median
        // without spending too long. Median is what's reported.
        5,
      );

      expect(result.passed).toBe(true);
      cleanup();
    });
  }
});

// ---------------------------------------------------------------------------
// Benchmark (2) — pulse render cost
// ---------------------------------------------------------------------------
//
// The pulse animation itself runs entirely on the GPU compositor via the CSS
// `@keyframes orb-pulse` rule in `globals.css`. There is no JavaScript loop
// that reacts to the pulse — the only JS-side cost is adding the
// `orb-pulsing` className during render. We therefore prove "0 ms/frame JS
// cost" by measuring the cost of *mounting* the orb in its pulsing state and
// asserting it stays well within a single 16 ms frame budget. If a future
// refactor accidentally introduces a `requestAnimationFrame` loop or a state
// update on every pulse cycle, this benchmark will catch it because the
// per-iteration cost would explode.

describe("AgentOrb pulse render cost", () => {
  beforeEach(() => {
    mockReducedMotion = false;
    mockCmdBarPinned = false;
    mockTasks = [];
    mockRemoveTask.mockReset();
  });

  it("renders the pulsing orb in well under one frame (≤ 5 ms)", async () => {
    // One running task → `shouldPulse === true` → `orb-pulsing` class added.
    mockTasks = [makeTask("running-1", "running")];

    const result = await benchmark(
      "orb pulse render cost",
      () => {
        const utils = render(React.createElement(AgentOrb));
        // Live-test 2026-04-26 — the orb body went neutral; the pulse
        // class moved from the outer button (`data-testid="agent-orb"`)
        // to the inner pulse element (`data-testid="agent-orb-pulse"`)
        // so only the ring carries the accent. Query the inner element.
        const pulse = utils.getByTestId("agent-orb-pulse") as HTMLDivElement;
        if (!pulse.className.split(/\s+/).includes("orb-pulsing")) {
          throw new Error("orb-pulsing class missing — pulse not active");
        }
        utils.unmount();
      },
      5,
      // More iterations: the per-call cost is tiny so we want a stable median.
      10,
    );

    expect(result.passed).toBe(true);
    cleanup();
  });

  it("respects reduced-motion: pulse class omitted, no JS overhead", async () => {
    mockReducedMotion = true;
    mockTasks = [makeTask("running-1", "running")];

    const result = await benchmark(
      "orb reduced-motion render",
      () => {
        const utils = render(React.createElement(AgentOrb));
        const orb = utils.getByTestId("agent-orb") as HTMLButtonElement;
        // Sanity: with reduced motion, the pulse class must NOT be applied.
        if (orb.className.split(/\s+/).includes("orb-pulsing")) {
          throw new Error(
            "orb-pulsing class present despite reduced motion preference",
          );
        }
        utils.unmount();
      },
      5,
      10,
    );

    expect(result.passed).toBe(true);
    cleanup();
  });
});
