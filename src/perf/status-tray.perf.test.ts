/**
 * Performance benchmarks for the StatusTray popover (task #53).
 *
 * Three surfaces are measured:
 *
 *   1. Popover open — time from setting `open=true` to the popover content
 *      being rendered into the DOM. Budget: 150 ms (from task #90 spec).
 *
 *   2. Comments list expand — time to handle a click on the "View open
 *      comments" affordance, which is the in-tray expand for the comments
 *      group. Budget: 80 ms (proposed; the click only mutates a callback
 *      and dispatches a CustomEvent — the heavy CommentListPopover lives
 *      outside the tray).
 *
 *   3. Segmented picker click — time to flip the active completion
 *      provider in the radiogroup. Updates two Zustand stores and
 *      re-renders the picker. Budget: 50 ms (proposed).
 *
 * Budgets are intentionally conservative for the first measurement pass.
 * Adjust in `docs/performance-baseline.md` once we have median data from
 * `pnpm test:perf` runs in dev and CI.
 *
 * @vitest-environment jsdom
 */

// Tauri mock + jsdom localStorage polyfill must load before any store import.
import "@/test/tauri-mock";

import React from "react";
import { describe, it, expect, beforeEach, beforeAll } from "vitest";
import { benchmark } from "./harness";
import {
  renderWithProviders,
  fireEvent,
  act,
  registerDefaultHandlers,
} from "@/test/component-harness";
import { StatusTray } from "@/components/editor/StatusTray";
import type { Comment } from "@/stores/comment-store";
import { useSettingsStore } from "@/stores/settings-store";
import { useRoutingStore } from "@/stores/routing-store";
import { useConnectionsStore } from "@/stores/connections-store";
import { useLocalAIStore } from "@/stores/local-ai-store";
import { useRecordingStore } from "@/stores/recording-store";
import type { Connection } from "@/lib/ai/connections";

// ---------------------------------------------------------------------------
// Test harness — mirrors the patterns in StatusTray.test.tsx
// ---------------------------------------------------------------------------

function resetStores() {
  useSettingsStore.setState({
    inlineCompletionsDisabled: false,
    toolCallingEnabled: true,
  });
  useRoutingStore.setState({
    routing: {
      interactive: { connectionId: null },
      agent_tasks: { connectionId: null },
      inline_completion: { connectionId: null },
    },
  });
  useConnectionsStore.setState({ connections: [] });
  useLocalAIStore.setState({
    serverStatus: "stopped",
    activeModelId: null,
    models: [],
  });
  useRecordingStore.setState({
    isRecording: false,
    isDictating: false,
  });
}

function addConnection(
  partial: Partial<Connection> &
    Pick<Connection, "id" | "provider" | "authMethod" | "label">,
): Connection {
  const conn: Connection = {
    status: "connected",
    credentials: { type: "local_bundled" } as Connection["credentials"],
    capabilities: ["inline_completion"],
    createdAt: Date.now(),
    ...partial,
  } as Connection;
  useConnectionsStore.setState((s) => ({ connections: [...s.connections, conn] }));
  return conn;
}

/**
 * Stateful host: provides a real DOM anchor element so Radix Popover can
 * position itself, and exposes a function to flip `open` from outside (so
 * one benchmark iteration can render closed → open → close → repeat).
 */
function makeControlledHost(
  props: Omit<
    React.ComponentProps<typeof StatusTray>,
    "anchor" | "open" | "onOpenChange"
  >,
  setterRef: { current: ((next: boolean) => void) | null },
) {
  return React.createElement(function ControlledHost() {
    const [open, setOpen] = React.useState(false);
    const ref = React.useRef<HTMLDivElement | null>(null);
    React.useEffect(() => {
      setterRef.current = setOpen;
      return () => {
        setterRef.current = null;
      };
    }, []);
    return React.createElement(
      "div",
      null,
      React.createElement("div", { ref, "data-testid": "anchor" }),
      React.createElement(StatusTray, {
        ...props,
        open,
        onOpenChange: setOpen,
        anchor: ref,
      }),
    );
  });
}

// jsdom does not implement scrollIntoView; the tray's deep-link effect
// references it indirectly. Stub once per test so nothing throws.
beforeAll(() => {
  Element.prototype.scrollIntoView = () => {};
});

beforeEach(() => {
  registerDefaultHandlers();
  resetStores();
});

// ---------------------------------------------------------------------------
// (a) Popover open — time from open=true to popover content in the DOM.
// ---------------------------------------------------------------------------

describe("status-tray popover open", () => {
  it("opens within 150 ms budget", async () => {
    // We re-mount the host each iteration so the benchmark measures the
    // worst-case "first paint" cost — Radix Popover keeps content out of
    // the tree until open=true, so this captures the full mount + portal.
    const result = await benchmark(
      "status-tray popover open",
      async () => {
        const setterRef: { current: ((n: boolean) => void) | null } = {
          current: null,
        };
        const view = renderWithProviders(
          makeControlledHost(
            {
              wordCount: 450,
              comments: [],
            },
            setterRef,
          ),
        );

        await act(async () => {
          setterRef.current?.(true);
          // Flush microtasks so Radix can mount the portal content.
          await Promise.resolve();
        });

        // Sanity check — the content is actually in the DOM.
        if (!(document.body.textContent ?? "").includes("Completions")) {
          throw new Error("popover did not mount within iteration");
        }

        view.unmount();
      },
      150,
      5,
    );

    expect(result.passed).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// (b) Comments list expand — clicking "View open comments" inside the tray.
//     The tray fires a notesage:open-comment-list CustomEvent and closes
//     itself. We measure the click → state update cycle.
// ---------------------------------------------------------------------------

describe("status-tray comments list expand", () => {
  it("expand click handles within 80 ms budget", async () => {
    const comments: Comment[] = Array.from({ length: 10 }, (_, i) => ({
      id: `c-${i}`,
      documentId: "doc-1",
      anchorText: `anchor ${i}`,
      from: 0,
      to: 0,
      body: `comment body ${i}`,
      author: "user",
      createdAt: 0,
      updatedAt: 0,
      status: i % 2 === 0 ? "open" : "done",
    }) as Comment);

    // Pre-mount once and reuse — open the tray, click "View open comments",
    // re-open, repeat. This isolates the click cost from the mount cost
    // (which is already covered by benchmark (a)).
    const setterRef: { current: ((n: boolean) => void) | null } = {
      current: null,
    };
    const view = renderWithProviders(
      makeControlledHost({ comments }, setterRef),
    );

    // Open once so the button exists in the DOM for the first iteration.
    await act(async () => {
      setterRef.current?.(true);
      await Promise.resolve();
    });

    const result = await benchmark(
      "status-tray comments list expand",
      async () => {
        // Find the freshly-rendered "View open comments" button each time.
        const btn = Array.from(document.querySelectorAll("button")).find((b) =>
          b.textContent?.includes("View open comments"),
        ) as HTMLButtonElement | undefined;

        if (!btn) {
          throw new Error('"View open comments" button not found');
        }

        await act(async () => {
          fireEvent.click(btn);
          await Promise.resolve();
        });

        // The click closes the tray; re-open for the next iteration.
        await act(async () => {
          setterRef.current?.(true);
          await Promise.resolve();
        });
      },
      80,
      10,
    );

    view.unmount();
    expect(result.passed).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// (c) Segmented picker click — clicking a radio in the completion picker.
//     Routes inline_completion to that connection and re-renders the picker.
// ---------------------------------------------------------------------------

describe("status-tray segmented picker click", () => {
  it("picker click handles within 50 ms budget", async () => {
    // Seed a routable Ollama connection so the "Ollama" radio is enabled.
    const ollama = addConnection({
      id: "c-ollama",
      provider: "ollama",
      authMethod: "local",
      label: "Ollama",
    });

    const setterRef: { current: ((n: boolean) => void) | null } = {
      current: null,
    };
    const view = renderWithProviders(
      makeControlledHost({}, setterRef),
    );

    await act(async () => {
      setterRef.current?.(true);
      await Promise.resolve();
    });

    // We toggle between "Off" and "Ollama" each iteration so the picker
    // actually changes state on every click — otherwise the second click
    // would be a no-op since the radio is already active.
    let toggle = false;

    const result = await benchmark(
      "status-tray segmented picker click",
      async () => {
        const wantedLabel = toggle ? "Off" : "Ollama";
        toggle = !toggle;

        const btn = Array.from(
          document.querySelectorAll('[role="radio"]'),
        ).find(
          (b) => b.getAttribute("aria-label") === wantedLabel,
        ) as HTMLButtonElement | undefined;

        if (!btn) {
          throw new Error(`radio "${wantedLabel}" not found`);
        }

        await act(async () => {
          fireEvent.click(btn);
          await Promise.resolve();
        });

        // Sanity check — the click actually flipped the routing/disable
        // flag, so we know the re-render path was exercised.
        const state = useSettingsStore.getState();
        const routing = useRoutingStore.getState().routing;
        if (wantedLabel === "Off") {
          if (!state.inlineCompletionsDisabled) {
            throw new Error("Off click did not disable completions");
          }
        } else {
          if (
            state.inlineCompletionsDisabled ||
            routing.inline_completion.connectionId !== ollama.id
          ) {
            throw new Error("Ollama click did not route to Ollama");
          }
        }
      },
      50,
      10,
    );

    view.unmount();
    expect(result.passed).toBe(true);
  });
});
