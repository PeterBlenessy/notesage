// @vitest-environment jsdom

/**
 * Composition test for task #120 — entering focus mode collapses the
 * expanded FloatingCommandBar via the cmd-bar-events bus.
 *
 * OUTCOME-SHAPED: renders the real `<FloatingCommandBar />` AND mounts
 * `useFocusMode()` in the same tree. Dispatches real ⌘. keyboard events
 * at the window and asserts both (a) the focus-mode class lands on the
 * layout root and (b) the bar's `data-expanded` attribute flips to false.
 *
 * This is the ONLY way to catch the class of regression where the hook
 * emits on the bus but nothing subscribes — the composition IS the feature.
 *
 * Modelled on `cmd-bar-keyboard-composition.test.tsx` (#114), with the
 * same mocking strategy. We deliberately do NOT mock `cmd-bar-events` —
 * the point is to exercise the real bus end-to-end.
 */

import "@/test/tauri-mock";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { act } from "react";
import { renderWithProviders } from "@/test/component-harness";
import FloatingCommandBar from "@/components/cmd/FloatingCommandBar";
import { useFocusMode } from "@/hooks/useFocusMode";
import { emitCmdBarEvent } from "@/lib/cmd-bar-events";

// ---------------------------------------------------------------------------
// matchMedia mock — useFocusMode itself doesn't read matchMedia, but
// FocusPill / the sibling CSS pipeline might. Mirrors the useFocusMode unit
// test harness so jsdom never throws.
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

Object.defineProperty(window, "matchMedia", {
  writable: true,
  configurable: true,
  value: vi.fn().mockReturnValue(makeMql(false)),
});

// ---------------------------------------------------------------------------
// Mocks — same minimal surface as the #114 composition test.
// ---------------------------------------------------------------------------

vi.mock("@/hooks/useReducedMotion", () => ({
  useReducedMotion: () => false,
}));

let mockCmdBarPinned = false;
vi.mock("@/stores/settings-store", () => {
  const state = {
    get cmdBarPinned() {
      return mockCmdBarPinned;
    },
    cmdBarPinnedWidth: 400,
    setCmdBarPinned: vi.fn(),
    setCmdBarPinnedWidth: vi.fn(),
  };
  return {
    useSettingsStore: Object.assign(
      vi.fn((sel: (s: typeof state) => unknown) => sel(state)),
      { getState: () => state },
    ),
  };
});

vi.mock("@/components/cmd/AttachmentChips", () => ({
  __esModule: true,
  default: () => <div data-testid="chips-stub" />,
}));

vi.mock("@/components/cmd/CommandBarContext", () => ({
  __esModule: true,
  default: () => <div data-testid="context-stub" />,
}));

vi.mock("@/components/cmd/CommandBarStream", () => ({
  __esModule: true,
  default: () => <div data-testid="stream-stub" />,
}));

vi.mock("@/components/cmd/modes/SkillMode", () => ({
  __esModule: true,
  default: () => <div data-testid="skill-mode-stub" />,
}));

vi.mock("@/components/cmd/modes/ReferenceMode", () => ({
  __esModule: true,
  default: () => <div data-testid="reference-mode-stub" />,
}));

vi.mock("@/components/cmd/modes/TagMode", () => ({
  __esModule: true,
  default: () => <div data-testid="tag-mode-stub" />,
}));

vi.mock("@/components/cmd/modes/TaskMode", () => ({
  __esModule: true,
  default: () => <div data-testid="task-mode-stub" />,
}));

vi.mock("@/components/cmd/modes/ResearchMode", () => ({
  __esModule: true,
  default: () => <div data-testid="research-mode-stub" />,
}));

vi.mock("@/components/cmd/modes/PaletteMode", () => ({
  __esModule: true,
  default: () => <div data-testid="palette-mode-stub" />,
}));

vi.mock("@/hooks/useAIOperations", () => ({
  useAIOperations: () => ({ sendChatMessage: vi.fn() }),
}));

vi.mock("@/stores/chat-store", () => ({
  useChatStore: Object.assign(
    vi.fn(() => []),
    { getState: () => ({ setActiveConversation: vi.fn() }) },
  ),
  selectMessages: vi.fn(() => []),
  selectProjectPaths: vi.fn(() => []),
  selectPendingProjectSwitch: vi.fn(() => null),
  selectPendingAgentSwitch: vi.fn(() => null),
}));

vi.mock("@/hooks/useChatSwitchPrompts", () => ({
  useChatSwitchPrompts: () => undefined,
}));

vi.mock("@/components/chat/ChatHistoryView", () => ({
  ChatHistoryView: () => <div data-testid="chat-history-stub" />,
}));

// ---------------------------------------------------------------------------
// Harness — mount the bar AND the focus-mode hook in the same tree so the
// real cmd-bar-events bus connects end-to-end. We also mount the canonical
// `[data-quiet-layout-root]` element so the hook's DOM side-effects land
// somewhere observable.
// ---------------------------------------------------------------------------

let focusModeResult: ReturnType<typeof useFocusMode> | null = null;

function Harness({ pinned = false }: { pinned?: boolean } = {}) {
  const focusMode = useFocusMode();
  focusModeResult = focusMode;
  return <FloatingCommandBar isPinned={pinned} />;
}

function getBar(): HTMLElement | null {
  return document.querySelector("[data-cmd-bar]") as HTMLElement | null;
}

function getLayoutRoot(): HTMLElement | null {
  return document.querySelector(
    "[data-quiet-layout-root]",
  ) as HTMLElement | null;
}

function dispatchKey(init: KeyboardEventInit) {
  act(() => {
    window.dispatchEvent(
      new KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        ...init,
      }),
    );
  });
}

/** Expand the bar by emitting a `focus` event directly on the bus — avoids
 * coupling this test to the keyboard hook, which already has its own suite. */
function expandBar() {
  act(() => {
    emitCmdBarEvent({ type: "focus" });
  });
}

beforeEach(() => {
  mockCmdBarPinned = false;
  focusModeResult = null;
  document.body.innerHTML = "";
  // Canonical QuietLayout root so `useFocusMode` has somewhere to apply
  // the `.focus-mode` class.
  const root = document.createElement("div");
  root.setAttribute("data-quiet-layout-root", "");
  root.className = "app";
  document.body.appendChild(root);
});

describe("#120 composition — entering focus mode collapses the expanded cmd bar", () => {
  it("⌘. while bar is expanded collapses it AND activates focus mode", () => {
    renderWithProviders(<Harness />);

    // 1) Expand the bar — data-expanded="true".
    expandBar();
    expect(getBar()?.getAttribute("data-expanded")).toBe("true");

    // 2) Dispatch ⌘. at window level → focus mode enters.
    dispatchKey({ key: ".", metaKey: true });

    // 3) Focus mode class landed on the layout root.
    expect(getLayoutRoot()?.classList.contains("focus-mode")).toBe(true);

    // 4) AND the bar collapsed via the dismiss event on the bus.
    expect(getBar()?.getAttribute("data-expanded")).toBe("false");
  });

  it("⌘. to EXIT focus mode does NOT re-expand the bar (collapsed is the safe default)", () => {
    renderWithProviders(<Harness />);

    // Enter focus mode with the bar expanded — bar collapses.
    expandBar();
    dispatchKey({ key: ".", metaKey: true });
    expect(getLayoutRoot()?.classList.contains("focus-mode")).toBe(true);
    expect(getBar()?.getAttribute("data-expanded")).toBe("false");

    // Exit focus mode — bar must stay collapsed. Exiting focus mode
    // restores your editor context; it does NOT repaint the composer.
    dispatchKey({ key: ".", metaKey: true });
    expect(getLayoutRoot()?.classList.contains("focus-mode")).toBe(false);
    expect(getBar()?.getAttribute("data-expanded")).toBe("false");
  });

  it("⌘. while bar is ALREADY collapsed just toggles focus mode (no error, no side effects)", () => {
    renderWithProviders(<Harness />);
    // Bar starts collapsed.
    expect(getBar()?.getAttribute("data-expanded")).toBe("false");

    // Enter focus mode with the bar already collapsed.
    dispatchKey({ key: ".", metaKey: true });
    expect(getLayoutRoot()?.classList.contains("focus-mode")).toBe(true);
    expect(getBar()?.getAttribute("data-expanded")).toBe("false");

    // Exit — still no error, still collapsed.
    dispatchKey({ key: ".", metaKey: true });
    expect(getLayoutRoot()?.classList.contains("focus-mode")).toBe(false);
    expect(getBar()?.getAttribute("data-expanded")).toBe("false");

    // Sanity: the focus-mode hook is still reactive.
    expect(focusModeResult?.active).toBe(false);
  });
});
