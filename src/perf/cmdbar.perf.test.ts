/**
 * Performance benchmarks for the FloatingCommandBar (PRD `2026-04-21-ui-refresh`).
 *
 * Five benchmarks covering the hot interactive paths the UI Refresh PRD calls
 * out as user-perceptible:
 *   1. Focus       — compact pill click → expanded state visible       ≤ 100 ms
 *   2. Dismiss     — Escape on expanded input → compact pill back      ≤  80 ms
 *   3. Prefix morph — typing "/" → SkillMode picker mounted             ≤  50 ms
 *   4. Chip add    — picking a reference → AttachmentChips re-renders  ≤  30 ms
 *   5. Context row — initial render with 3 projects                    ≤  20 ms
 *
 * Heavy dependencies (AcpModePicker, useAIOperations, tauri-mock IPC, etc.)
 * are stubbed so we measure the React render + state-update cost in isolation,
 * not the cost of hypothetical session/IPC work that doesn't happen on
 * production hot paths either.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import React from "react";
import { render, fireEvent, cleanup, act } from "@testing-library/react";
import { benchmark } from "./harness";

// ---------------------------------------------------------------------------
// Mocks — the same shape as FloatingCommandBar.test.tsx so the bar mounts
// in jsdom without dragging the full provider/credentials/tauri stack in.
// ---------------------------------------------------------------------------

// useReducedMotion: always false (full transitions enabled — same as production)
vi.mock("@/hooks/useReducedMotion", () => ({
  useReducedMotion: () => false,
}));

// settings-store: fixed values; setters are no-ops (we don't measure them)
vi.mock("@/stores/settings-store", () => {
  const state = {
    cmdBarPinned: false,
    cmdBarPinnedWidth: 400,
    crossProjectMode: false,
    setCmdBarPinned: () => {},
    setCmdBarPinnedWidth: () => {},
  };
  return {
    useSettingsStore: Object.assign(
      vi.fn((sel: (s: typeof state) => unknown) => sel(state)),
      { getState: () => state },
    ),
  };
});

// AttachmentChips: lightweight stub that exposes the current chip count so
// we can verify the (b) chip-add benchmark actually re-renders.
vi.mock("@/components/cmd/AttachmentChips", () => ({
  __esModule: true,
  default: ({ chips }: { chips: Array<{ id: string }> }) =>
    React.createElement("div", {
      "data-testid": "chips-stub",
      "data-chip-count": chips.length,
    }),
}));

// CommandBarStream: noop placeholder — its own render cost is measured
// elsewhere, and rendering it here would require seeding chat-store messages.
vi.mock("@/components/cmd/CommandBarStream", () => ({
  default: () => React.createElement("div", { "data-testid": "stream-stub" }),
}));

// Mode picker stubs — minimal, but ReferenceMode exposes an "add chip" button
// so the chip-add benchmark can drive a state transition with one click.
vi.mock("@/components/cmd/modes/SkillMode", () => ({
  default: ({ listboxId }: { listboxId?: string }) =>
    React.createElement("div", {
      "data-testid": "skill-mode-stub",
      id: listboxId ?? "cmd-skill-listbox",
      role: "listbox",
    }),
}));
vi.mock("@/components/cmd/modes/ReferenceMode", () => ({
  default: ({
    onPick,
  }: {
    filter: string;
    onPick: (chip: { id: string; kind: "file"; name: string }) => void;
  }) =>
    React.createElement(
      "div",
      { "data-testid": "reference-mode-stub" },
      React.createElement(
        "button",
        {
          type: "button",
          "data-testid": "reference-mode-add-chip",
          onClick: () =>
            onPick({ id: `chip-${Math.random()}`, kind: "file", name: "notes.md" }),
        },
        "add chip",
      ),
    ),
}));
vi.mock("@/components/cmd/modes/TagMode", () => ({
  default: () => React.createElement("div", { "data-testid": "tag-mode-stub" }),
}));
vi.mock("@/components/cmd/modes/TaskMode", () => ({
  default: () => React.createElement("div", { "data-testid": "task-mode-stub" }),
}));
vi.mock("@/components/cmd/modes/ResearchMode", () => ({
  default: () =>
    React.createElement("div", { "data-testid": "research-mode-stub" }),
}));
vi.mock("@/components/cmd/modes/PaletteMode", () => ({
  default: () =>
    React.createElement("div", { "data-testid": "palette-mode-stub" }),
}));

// useAIOperations + chat-store: bare-minimum stubs so FloatingCommandBar's
// `selectMessages` and `sendChatMessage` calls don't blow up.
vi.mock("@/hooks/useAIOperations", () => ({
  useAIOperations: () => ({
    sendChatMessage: vi.fn(() => Promise.resolve()),
    generateText: vi.fn(),
    cancelChat: vi.fn(),
  }),
}));

// Mutable chat-store state shared between the global mock and the
// context-row benchmark below. Defaults to "no active conversation" so the
// FloatingCommandBar benchmarks render an empty chips list. The context-row
// scenario flips it to a 3-project conversation in its `beforeEach`.
const __chatStoreState = {
  isLoading: false as boolean,
  activeConversationId: null as string | null,
  conversations: [] as unknown[],
  toggleProjectPath: (() => {}) as (path: string) => void,
};

vi.mock("@/stores/chat-store", () => {
  function useChatStore<T>(selector: (state: typeof __chatStoreState) => T): T {
    return selector(__chatStoreState);
  }
  return {
    useChatStore,
    selectMessages: () => [],
  };
});

// CommandBarContext is tested as its own scenario below — for the
// FloatingCommandBar-level benchmarks (focus / dismiss / morph / chip add)
// we stub it to keep variance low and isolate the bar's chrome cost.
vi.mock("@/components/cmd/CommandBarContext", () => ({
  default: () => React.createElement("div", { "data-testid": "ctx-stub" }),
}));

// ---------------------------------------------------------------------------
// Imports come AFTER the mocks above so vi.mock hoists correctly.
// ---------------------------------------------------------------------------

import FloatingCommandBar from "@/components/cmd/FloatingCommandBar";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Click the compact pill and return the expanded input element. */
function expandBar(): HTMLInputElement {
  const compact = document.body.querySelector(
    '[data-cmd-bar] button',
  ) as HTMLButtonElement | null;
  if (!compact) throw new Error("compact pill not found");
  act(() => {
    fireEvent.click(compact);
  });
  const input = document.body.querySelector(
    'input[role="combobox"]',
  ) as HTMLInputElement | null;
  if (!input) throw new Error("expanded input not found");
  return input;
}

/** Reset jsdom + portal state between iterations. */
function resetDOM() {
  cleanup();
  document.body.innerHTML = "";
  document.documentElement.style.removeProperty("--cmd-bar-pinned-width");
}

beforeEach(() => {
  resetDOM();
});

afterEach(() => {
  resetDOM();
});

// ---------------------------------------------------------------------------
// (1) cmdbar focus — compact → expanded ≤ 100 ms
// ---------------------------------------------------------------------------

describe("cmdbar focus (compact→expanded)", () => {
  it("expands within budget", async () => {
    const result = await benchmark(
      "cmdbar focus (compact→expanded)",
      () => {
        // Each iteration starts from a clean compact bar.
        resetDOM();
        act(() => {
          render(React.createElement(FloatingCommandBar));
        });

        // Measured work: the click → React state flip → expanded DOM mount.
        const compact = document.body.querySelector(
          '[data-cmd-bar] button',
        ) as HTMLButtonElement;
        act(() => {
          fireEvent.click(compact);
        });

        // Sanity: input must be present so the budget reflects real work.
        const input = document.body.querySelector('input[role="combobox"]');
        if (!input) throw new Error("expand failed — input not in DOM");
      },
      100,
    );

    expect(result.passed).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// (2) cmdbar dismiss — Esc on expanded → compact ≤ 80 ms
// ---------------------------------------------------------------------------

describe("cmdbar dismiss", () => {
  it("collapses within budget", async () => {
    const result = await benchmark(
      "cmdbar dismiss",
      () => {
        // Pre-arrange: expanded bar.
        resetDOM();
        act(() => {
          render(React.createElement(FloatingCommandBar));
        });
        const input = expandBar();

        // Measured work: Esc → React state flip → compact DOM remount.
        act(() => {
          fireEvent.keyDown(input, { key: "Escape" });
        });

        // Sanity: combobox is gone, compact pill is back.
        if (document.body.querySelector('input[role="combobox"]')) {
          throw new Error("dismiss failed — input still in DOM");
        }
      },
      80,
    );

    expect(result.passed).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// (3) cmdbar prefix morph — type "/" → SkillMode picker mounts ≤ 50 ms
// ---------------------------------------------------------------------------

describe("cmdbar prefix morph", () => {
  it("morphs into the skill picker within budget", async () => {
    const result = await benchmark(
      "cmdbar prefix morph",
      () => {
        // Pre-arrange: expanded bar with empty input.
        resetDOM();
        act(() => {
          render(React.createElement(FloatingCommandBar));
        });
        const input = expandBar();

        // Measured work: change event → activePrefix detect → picker mount.
        act(() => {
          fireEvent.change(input, { target: { value: "/" } });
        });

        // Sanity: picker stub mounted, badge present.
        if (!document.body.querySelector('[data-testid="skill-mode-stub"]')) {
          throw new Error("prefix morph failed — skill picker not mounted");
        }
      },
      50,
    );

    expect(result.passed).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// (4) cmdbar attachment-chip add ≤ 30 ms
// ---------------------------------------------------------------------------

describe("cmdbar attachment-chip add", () => {
  it("adds a chip within budget", async () => {
    const result = await benchmark(
      "cmdbar attachment-chip add",
      () => {
        // Pre-arrange: expanded bar with the @ reference picker open.
        resetDOM();
        act(() => {
          render(React.createElement(FloatingCommandBar));
        });
        const input = expandBar();
        act(() => {
          fireEvent.change(input, { target: { value: "@" } });
        });
        const addBtn = document.body.querySelector(
          '[data-testid="reference-mode-add-chip"]',
        ) as HTMLButtonElement | null;
        if (!addBtn) throw new Error("reference picker stub not mounted");

        // Measured work: click → chip state appended → AttachmentChips re-renders.
        act(() => {
          fireEvent.click(addBtn);
        });

        // Sanity: chips strip reflects 1 chip (active prefix is also cleared).
        const chips = document.body.querySelector(
          '[data-testid="chips-stub"]',
        ) as HTMLElement | null;
        if (!chips || chips.getAttribute("data-chip-count") !== "1") {
          throw new Error(
            `chip add failed — chip count = ${chips?.getAttribute("data-chip-count")}`,
          );
        }
      },
      30,
    );

    expect(result.passed).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// (5) Context row initial render with 3 projects ≤ 20 ms
//
// CommandBarContext is a separate component — we measure ITS mount cost in
// isolation against a seeded conversation that selects three project paths,
// so the chips row paints three chips on first render.
//
// Heavy children (AcpModePicker, ExplainLockDialog, ProviderLogo) are stubbed
// to keep the budget reflective of the row's own work, not their internals.
// ---------------------------------------------------------------------------

vi.mock("@/components/chat/AcpSessionControls", () => ({
  AcpModePicker: () =>
    React.createElement("div", { "data-testid": "acp-mode-picker-stub" }),
}));

vi.mock("@/components/chat/ExplainLockDialog", () => ({
  ExplainLockDialog: () => null,
}));

vi.mock("@/components/ProviderLogo", () => ({
  ProviderLogo: () =>
    React.createElement("span", { "data-testid": "provider-logo-stub" }),
}));

// connections-store, routing-store, project-metadata-store, workspace-store
// — seed each with the minimum the row needs for a 3-project render.
vi.mock("@/stores/connections-store", () => {
  const state = {
    connections: [
      {
        id: "conn-anthropic",
        label: "Claude",
        provider: "anthropic",
        capabilities: ["interactive", "agent_tasks"],
      },
      {
        id: "conn-openai",
        label: "GPT-4o",
        provider: "openai",
        capabilities: ["interactive"],
      },
    ],
  };
  return {
    useConnectionsStore: Object.assign(
      vi.fn((sel: (s: typeof state) => unknown) => sel(state)),
      { getState: () => state },
    ),
  };
});

vi.mock("@/stores/routing-store", () => {
  const state = {
    getConnectionForUseCase: () => ({
      id: "conn-anthropic",
      label: "Claude",
      provider: "anthropic",
      capabilities: ["interactive", "agent_tasks"],
    }),
    setRouting: () => {},
  };
  return {
    useRoutingStore: Object.assign(
      vi.fn((sel: (s: typeof state) => unknown) => sel(state)),
      { getState: () => state },
    ),
  };
});

vi.mock("@/stores/workspace-store", () => {
  const state = {
    projects: [
      { path: "/Users/me/projects/alpha", fileTree: [] },
      { path: "/Users/me/projects/bravo", fileTree: [] },
      { path: "/Users/me/projects/charlie", fileTree: [] },
      { path: "/Users/me/projects/delta", fileTree: [] }, // addable
    ],
  };
  return {
    useWorkspaceStore: Object.assign(
      vi.fn((sel: (s: typeof state) => unknown) => sel(state)),
      { getState: () => state },
    ),
  };
});

vi.mock("@/stores/project-metadata-store", () => {
  const state = {
    metadataMap: {
      "/Users/me/projects/alpha": {},
      "/Users/me/projects/bravo": {},
      "/Users/me/projects/charlie": {},
    },
  };
  return {
    useProjectMetadataStore: Object.assign(
      vi.fn((sel: (s: typeof state) => unknown) => sel(state)),
      { getState: () => state },
    ),
  };
});

describe("cmdbar context row initial render with 3 projects", () => {
  beforeEach(() => {
    // Flip the shared chat-store state to a 3-project conversation so the
    // row paints three chips on the first render. The other mocked stores
    // (workspace / connections / routing / project-metadata) are already
    // seeded at module top.
    __chatStoreState.activeConversationId = "conv-1";
    __chatStoreState.conversations = [
      {
        id: "conv-1",
        projectPaths: [
          "/Users/me/projects/alpha",
          "/Users/me/projects/bravo",
          "/Users/me/projects/charlie",
        ],
      },
    ];
  });

  afterEach(() => {
    // Restore the empty default so subsequent test files (or re-runs) don't
    // see leaked state. Vitest isolates files but not within-file ordering.
    __chatStoreState.activeConversationId = null;
    __chatStoreState.conversations = [];
  });

  it("renders within budget", async () => {
    // The global `vi.mock("@/components/cmd/CommandBarContext")` above swaps
    // the row out for a stub so the FloatingCommandBar benchmarks stay
    // focused on the bar's chrome cost. For THIS scenario we want to
    // measure the real row, so we pull the actual implementation via
    // `vi.importActual` (bypassing the registered mock).
    const mod = (await vi.importActual(
      "@/components/cmd/CommandBarContext",
    )) as { default: React.ComponentType };
    const Ctx = mod.default;

    const result = await benchmark(
      "cmdbar context row (3 projects)",
      () => {
        resetDOM();
        // Measured work: mount the row from scratch — provider pill,
        // 3 project chips, "+ project" popover trigger, mode pill stub,
        // history + pin icons.
        act(() => {
          render(React.createElement(Ctx));
        });

        // Sanity: the row's outer wrapper mounted AND three chips are
        // present (so the benchmark really exercised the 3-project path).
        const root = document.body.querySelector("[data-cmd-context]");
        if (!root) {
          throw new Error("context row not mounted");
        }
        const text = root.textContent ?? "";
        // Each chip renders the project basename (alpha / bravo / charlie).
        if (
          !text.includes("alpha") ||
          !text.includes("bravo") ||
          !text.includes("charlie")
        ) {
          throw new Error(
            `expected 3 project chips, got text=${text.slice(0, 200)}`,
          );
        }
      },
      20,
    );

    expect(result.passed).toBe(true);
  });
});
