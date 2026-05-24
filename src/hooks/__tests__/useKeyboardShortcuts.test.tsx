// @vitest-environment jsdom

/**
 * Unit tests for useKeyboardShortcuts (post-Classic-removal).
 *
 * Focus areas:
 *   - Cmd-bar focus chords (⌘K, ⌘1–4, ⌘⇧P, ⌘⇧F) emit on the cmd-bar bus.
 *   - Agent-orb toggle (⌘⇧A) emits on the agent-orb bus.
 *   - Other shell chords fire (⌘⇧H, ⌘⇧K, ⌘⇧R, ⌘⇧C cmd-bar focus, ⌘⇧E, ⌘,, ⌘T).
 *   - Scaffold bindings for ⌃Tab/⌃⇧Tab (MRU cycling) dispatch a custom event.
 *   - Sidebar event chords (⌘⌥C, ⌘⌥R) dispatch named DOM events.
 *   - Listener is removed on unmount.
 *   - Editor zoom chords: ⌘+/⌘=, ⌘-, ⌘0.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook } from "@testing-library/react";

import {
  subscribeToCmdBarEvents,
  type CmdBarEvent,
} from "@/lib/cmd-bar-events";
import {
  subscribeToAgentOrbEvents,
  type AgentOrbEvent,
} from "@/lib/agent-orb-events";

// ---------------------------------------------------------------------------
// Settings-store mock — the minimal set referenced by the hook.
// ---------------------------------------------------------------------------

const mockSettings: {
  sidebarPinned: boolean;
  theme: "light" | "dark" | "system";
  setTheme: ReturnType<typeof vi.fn>;
  setSidebarPinned: ReturnType<typeof vi.fn>;
} = {
  sidebarPinned: false,
  theme: "light",
  setTheme: vi.fn(),
  setSidebarPinned: vi.fn(),
};

vi.mock("@/stores/settings-store", () => {
  const useSettingsStore = Object.assign(
    vi.fn((selector?: (s: typeof mockSettings) => unknown) => {
      if (typeof selector === "function") {
        return selector(mockSettings);
      }
      return mockSettings;
    }),
    { getState: () => mockSettings },
  );
  return { useSettingsStore };
});

// ---------------------------------------------------------------------------
// Editor-store mock. Mirrors the shape the hook reads via destructuring and
// via `.getState()` calls.
// ---------------------------------------------------------------------------

const mockEditorState: {
  openDocuments: Array<{ id: string; isDirty: boolean }>;
  activeTabId: string | null;
  closeTab: ReturnType<typeof vi.fn>;
  setPendingCloseTabId: ReturnType<typeof vi.fn>;
} = {
  openDocuments: [],
  activeTabId: null,
  closeTab: vi.fn(),
  setPendingCloseTabId: vi.fn(),
};

vi.mock("@/stores/editor-store", () => {
  const useEditorStore = Object.assign(
    vi.fn((selector?: (s: typeof mockEditorState) => unknown) => {
      if (typeof selector === "function") {
        return selector(mockEditorState);
      }
      return mockEditorState;
    }),
    { getState: () => mockEditorState },
  );
  return { useEditorStore };
});

// ---------------------------------------------------------------------------
// Zoom hook mock — intercepts calls to increaseZoom / decreaseZoom / resetZoom.
// vi.hoisted() is required because vi.mock() factories are hoisted to the top
// of the file by Vitest's transform; plain `const` declarations wouldn't be
// initialized yet when the factory runs.
// ---------------------------------------------------------------------------

const { mockIncreaseZoom, mockDecreaseZoom, mockResetZoom } = vi.hoisted(() => ({
  mockIncreaseZoom: vi.fn(),
  mockDecreaseZoom: vi.fn(),
  mockResetZoom: vi.fn(),
}));

vi.mock("@/hooks/useEditorZoom", () => ({
  increaseZoom: mockIncreaseZoom,
  decreaseZoom: mockDecreaseZoom,
  resetZoom: mockResetZoom,
  // After #188, the keyboard hook calls `fireZoom` instead of the bare action
  // functions so viewers (PDF / EPUB / HTML) can register their own zoom
  // controllers. The default fallback is the markdown editor zoom — the test
  // mock routes `fireZoom` straight to the action mocks to preserve assertions.
  fireZoom: (action: "in" | "out" | "reset") => {
    if (action === "in") mockIncreaseZoom();
    else if (action === "out") mockDecreaseZoom();
    else mockResetZoom();
  },
  registerZoomController: () => () => {},
  useEditorZoom: () => ({
    zoom: 1.0,
    increaseZoom: mockIncreaseZoom,
    decreaseZoom: mockDecreaseZoom,
    resetZoom: mockResetZoom,
  }),
}));

// ---------------------------------------------------------------------------
// Import the hook AFTER the mocks above.
// ---------------------------------------------------------------------------

import {
  useKeyboardShortcuts,
  COPY_PATH_EVENT,
  REVEAL_IN_FINDER_EVENT,
  CYCLE_RECENT_EVENT,
} from "@/hooks/useKeyboardShortcuts";

// ---------------------------------------------------------------------------
// Callbacks factory.
// ---------------------------------------------------------------------------

function makeCallbacks(overrides: Partial<Parameters<typeof useKeyboardShortcuts>[0]> = {}) {
  const base = {
    onFindOpen: vi.fn(),
    onFindReplaceOpen: vi.fn(),
    onToggleFocusMode: vi.fn(),
    onExitFocusMode: vi.fn(),
    onOutlineOpen: vi.fn(),
    onSettingsOpen: vi.fn(),
    onExportOpen: vi.fn(),
    onNewProject: vi.fn(),
    onNewNote: vi.fn(),
    onOpenFolder: vi.fn(),
    onShortcutsOpen: vi.fn(),
    onToggleRecording: vi.fn(),
    focusMode: false,
  };
  return { ...base, ...overrides };
}

// ---------------------------------------------------------------------------
// Test helpers.
// ---------------------------------------------------------------------------

function dispatchKey(
  key: string,
  options: KeyboardEventInit & { target?: EventTarget } = {},
) {
  const { target, ...init } = options;
  const event = new KeyboardEvent("keydown", {
    bubbles: true,
    cancelable: true,
    key,
    ...init,
  });
  if (target) {
    target.dispatchEvent(event);
  } else {
    window.dispatchEvent(event);
  }
  return event;
}

let capturedBarEvents: CmdBarEvent[];
let unsubscribeBar: () => void;
let capturedOrbEvents: AgentOrbEvent[];
let unsubscribeOrb: () => void;

beforeEach(() => {
  // Reset settings state.
  mockSettings.sidebarPinned = false;
  mockSettings.theme = "light";
  mockSettings.setTheme.mockReset();
  mockSettings.setSidebarPinned.mockReset();

  // Reset editor state.
  mockEditorState.openDocuments = [];
  mockEditorState.activeTabId = null;
  mockEditorState.closeTab.mockReset();
  mockEditorState.setPendingCloseTabId.mockReset();

  // Reset zoom mocks.
  mockIncreaseZoom.mockReset();
  mockDecreaseZoom.mockReset();
  mockResetZoom.mockReset();

  capturedBarEvents = [];
  unsubscribeBar = subscribeToCmdBarEvents((e) => {
    capturedBarEvents.push(e);
  });
  capturedOrbEvents = [];
  unsubscribeOrb = subscribeToAgentOrbEvents((e) => {
    capturedOrbEvents.push(e);
  });

  document.body.innerHTML = "";
});

afterEach(() => {
  unsubscribeBar();
  unsubscribeOrb();
});

// ===========================================================================
// Cmd-bar focus chords — owned by the composed useCommandBarShortcuts hook.
// useKeyboardShortcuts mounts the composed hook so the chords flow through.
// ===========================================================================

describe("useKeyboardShortcuts (cmd-bar focus chords)", () => {
  it("⌘K emits cmd-bar focus with no prefix", () => {
    renderHook(() => useKeyboardShortcuts(makeCallbacks()));

    dispatchKey("k", { metaKey: true });

    expect(capturedBarEvents).toEqual([{ type: "focus" }]);
  });

  it.each<[string, string]>([
    ["1", "!"],
    ["2", "@"],
    ["3", "#"],
    ["4", "?"],
  ])("⌘%s emits cmd-bar focus with prefix %s", (digit, prefix) => {
    renderHook(() => useKeyboardShortcuts(makeCallbacks()));

    dispatchKey(digit, { metaKey: true });

    expect(capturedBarEvents).toEqual([{ type: "focus", prefix }]);
  });

  it("⌘⇧P emits cmd-bar focus with prefix '>'", () => {
    renderHook(() => useKeyboardShortcuts(makeCallbacks()));

    dispatchKey("P", { metaKey: true, shiftKey: true });

    expect(capturedBarEvents).toEqual([{ type: "focus", prefix: ">" }]);
  });

  it("⌘⇧F emits cmd-bar focus with `:file ` prefix (PRD verb-prefixes #11)", () => {
    renderHook(() => useKeyboardShortcuts(makeCallbacks()));

    dispatchKey("F", { metaKey: true, shiftKey: true });

    // Trailing space in the prefix is intentional — the cursor lands
    // in the verb's filter slot so the user can type the query
    // immediately.
    expect(capturedBarEvents).toEqual([{ type: "focus", prefix: ":file " }]);
  });

  it("⌘. does NOT toggle focus mode (useFocusMode owns it)", () => {
    const callbacks = makeCallbacks();
    renderHook(() => useKeyboardShortcuts(callbacks));

    dispatchKey(".", { metaKey: true });

    expect(callbacks.onToggleFocusMode).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// Shell-level chords.
// ===========================================================================

describe("useKeyboardShortcuts (shell chords)", () => {
  it("⌘⇧H opens find-replace", () => {
    const callbacks = makeCallbacks();
    renderHook(() => useKeyboardShortcuts(callbacks));

    dispatchKey("H", { metaKey: true, shiftKey: true });

    expect(callbacks.onFindReplaceOpen).toHaveBeenCalledTimes(1);
  });

  it("⌘F opens find", () => {
    const callbacks = makeCallbacks();
    renderHook(() => useKeyboardShortcuts(callbacks));

    dispatchKey("f", { metaKey: true });

    expect(callbacks.onFindOpen).toHaveBeenCalledTimes(1);
  });

  it("⌘⇧K opens the Keyboard Shortcuts dialog", () => {
    const callbacks = makeCallbacks();
    renderHook(() => useKeyboardShortcuts(callbacks));

    dispatchKey("K", { metaKey: true, shiftKey: true });

    expect(callbacks.onShortcutsOpen).toHaveBeenCalledTimes(1);
  });

  it("⌘⇧C emits cmd-bar focus when the bar is collapsed", () => {
    renderHook(() => useKeyboardShortcuts(makeCallbacks()));

    dispatchKey("c", { metaKey: true, shiftKey: true });

    // No data-cmd-bar element in the DOM → treated as collapsed → focus.
    expect(capturedBarEvents).toEqual([{ type: "focus" }]);
  });

  it("⌘⇧A emits a toggle on the agent-orb bus", () => {
    renderHook(() => useKeyboardShortcuts(makeCallbacks()));

    dispatchKey("a", { metaKey: true, shiftKey: true });

    expect(capturedOrbEvents).toEqual([{ type: "toggle" }]);
  });

  it("⌘⇧R toggles recording", () => {
    const callbacks = makeCallbacks();
    renderHook(() => useKeyboardShortcuts(callbacks));

    dispatchKey("r", { metaKey: true, shiftKey: true });

    expect(callbacks.onToggleRecording).toHaveBeenCalledTimes(1);
  });

  it("⌘⇧E opens the export dialog when a tab is active", () => {
    mockEditorState.activeTabId = "tab-1";
    const callbacks = makeCallbacks();
    renderHook(() => useKeyboardShortcuts(callbacks));

    dispatchKey("e", { metaKey: true, shiftKey: true });

    expect(callbacks.onExportOpen).toHaveBeenCalledTimes(1);
  });

  it("⌘, opens settings", () => {
    const callbacks = makeCallbacks();
    renderHook(() => useKeyboardShortcuts(callbacks));

    dispatchKey(",", { metaKey: true });

    expect(callbacks.onSettingsOpen).toHaveBeenCalledTimes(1);
  });

  it("⌘T toggles theme via settings store", () => {
    const callbacks = makeCallbacks();
    renderHook(() => useKeyboardShortcuts(callbacks));

    dispatchKey("t", { metaKey: true });

    expect(mockSettings.setTheme).toHaveBeenCalledWith("dark");
  });
});

// ===========================================================================
// Close-tab behaviour.
// ===========================================================================

describe("useKeyboardShortcuts (⌘W tab close)", () => {
  it("closes a clean tab immediately", () => {
    mockEditorState.activeTabId = "tab-1";
    mockEditorState.openDocuments = [{ id: "tab-1", isDirty: false }];
    const callbacks = makeCallbacks();
    renderHook(() => useKeyboardShortcuts(callbacks));

    dispatchKey("w", { metaKey: true });

    expect(mockEditorState.closeTab).toHaveBeenCalledWith("tab-1");
    expect(mockEditorState.setPendingCloseTabId).not.toHaveBeenCalled();
  });

  it("asks for confirmation on a dirty tab", () => {
    mockEditorState.activeTabId = "tab-1";
    mockEditorState.openDocuments = [{ id: "tab-1", isDirty: true }];
    const callbacks = makeCallbacks();
    renderHook(() => useKeyboardShortcuts(callbacks));

    dispatchKey("w", { metaKey: true });

    expect(mockEditorState.setPendingCloseTabId).toHaveBeenCalledWith("tab-1");
    expect(mockEditorState.closeTab).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// Scaffold bindings for task #77 and sidebar chords.
// ===========================================================================

describe("useKeyboardShortcuts (scaffold bindings)", () => {
  // ⌃Tab / ⌃⇧Tab — MRU document cycle. Replaced ⌘⇧[ / ⌘⇧] in
  // 2026-04-28 because brackets require Option on Swedish (and many
  // European) keyboards, making the chord physically awkward even
  // with an event.code fallback. Tab is a dedicated physical key on
  // every keyboard. Mirrors VS Code's MRU-cycle convention.
  it("⌃Tab dispatches cycle-recent 'next'", () => {
    const callbacks = makeCallbacks();
    renderHook(() => useKeyboardShortcuts(callbacks));

    const listener = vi.fn<(e: Event) => void>();
    window.addEventListener(CYCLE_RECENT_EVENT, listener);
    try {
      const event = dispatchKey("Tab", { ctrlKey: true });

      expect(event.defaultPrevented).toBe(true);
      expect(listener).toHaveBeenCalledTimes(1);
      const detail = (listener.mock.calls[0]![0] as CustomEvent).detail;
      expect(detail).toEqual({ direction: "next" });
    } finally {
      window.removeEventListener(CYCLE_RECENT_EVENT, listener);
    }
  });

  it("⌃⇧Tab dispatches cycle-recent 'previous'", () => {
    const callbacks = makeCallbacks();
    renderHook(() => useKeyboardShortcuts(callbacks));

    const listener = vi.fn<(e: Event) => void>();
    window.addEventListener(CYCLE_RECENT_EVENT, listener);
    try {
      const event = dispatchKey("Tab", { ctrlKey: true, shiftKey: true });

      expect(event.defaultPrevented).toBe(true);
      expect(listener).toHaveBeenCalledTimes(1);
      const detail = (listener.mock.calls[0]![0] as CustomEvent).detail;
      expect(detail).toEqual({ direction: "previous" });
    } finally {
      window.removeEventListener(CYCLE_RECENT_EVENT, listener);
    }
  });

  it("plain Tab does NOT dispatch cycle-recent (would break editor indent)", () => {
    const callbacks = makeCallbacks();
    renderHook(() => useKeyboardShortcuts(callbacks));

    const listener = vi.fn<(e: Event) => void>();
    window.addEventListener(CYCLE_RECENT_EVENT, listener);
    try {
      dispatchKey("Tab", {});
      expect(listener).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener(CYCLE_RECENT_EVENT, listener);
    }
  });

  it("⌘Tab does NOT dispatch cycle-recent (macOS app-switcher must pass through)", () => {
    // Defense in depth: never intercept ⌘Tab. macOS uses it for the
    // app-switcher and that gesture is sacrosanct.
    const callbacks = makeCallbacks();
    renderHook(() => useKeyboardShortcuts(callbacks));

    const listener = vi.fn<(e: Event) => void>();
    window.addEventListener(CYCLE_RECENT_EVENT, listener);
    try {
      const event = dispatchKey("Tab", { metaKey: true });
      expect(listener).not.toHaveBeenCalled();
      expect(event.defaultPrevented).toBe(false);
    } finally {
      window.removeEventListener(CYCLE_RECENT_EVENT, listener);
    }
  });

  it("⌘⌥C dispatches COPY_PATH_EVENT", () => {
    const callbacks = makeCallbacks();
    renderHook(() => useKeyboardShortcuts(callbacks));

    const listener = vi.fn();
    window.addEventListener(COPY_PATH_EVENT, listener);
    try {
      // macOS gotcha: Option+C produces `ç` not `c`, so the handler keys
      // off `e.code === "KeyC"` (physical key) instead of `e.key`. The
      // test mirrors what an actual macOS keystroke would produce.
      dispatchKey("ç", { code: "KeyC", metaKey: true, altKey: true });
      expect(listener).toHaveBeenCalledTimes(1);
    } finally {
      window.removeEventListener(COPY_PATH_EVENT, listener);
    }
  });

  it("⌘⌥R dispatches REVEAL_IN_FINDER_EVENT", () => {
    const callbacks = makeCallbacks();
    renderHook(() => useKeyboardShortcuts(callbacks));

    const listener = vi.fn();
    window.addEventListener(REVEAL_IN_FINDER_EVENT, listener);
    try {
      // Same `e.code` rationale as ⌘⌥C — Option+R produces `®` not `r`.
      dispatchKey("®", { code: "KeyR", metaKey: true, altKey: true });
      expect(listener).toHaveBeenCalledTimes(1);
    } finally {
      window.removeEventListener(REVEAL_IN_FINDER_EVENT, listener);
    }
  });
});

// ===========================================================================
// Editor zoom chords — ⌘+ / ⌘= / ⌘- / ⌘0 (issue #162).
//
// These chords control a transient view-zoom multiplier that is NOT stored in
// editor-styles-store. The hook delegates to module-level functions from
// useEditorZoom so the state outlives any individual component.
// ===========================================================================

describe("useKeyboardShortcuts (editor zoom chords)", () => {
  it("⌘+ calls increaseZoom", () => {
    const callbacks = makeCallbacks();
    renderHook(() => useKeyboardShortcuts(callbacks));

    dispatchKey("+", { metaKey: true, shiftKey: true });

    expect(mockIncreaseZoom).toHaveBeenCalledTimes(1);
    expect(mockDecreaseZoom).not.toHaveBeenCalled();
    expect(mockResetZoom).not.toHaveBeenCalled();
  });

  it("⌘= also calls increaseZoom (same physical key as + without Shift)", () => {
    const callbacks = makeCallbacks();
    renderHook(() => useKeyboardShortcuts(callbacks));

    dispatchKey("=", { metaKey: true });

    expect(mockIncreaseZoom).toHaveBeenCalledTimes(1);
  });

  it("⌘- calls decreaseZoom", () => {
    const callbacks = makeCallbacks();
    renderHook(() => useKeyboardShortcuts(callbacks));

    dispatchKey("-", { metaKey: true });

    expect(mockDecreaseZoom).toHaveBeenCalledTimes(1);
    expect(mockIncreaseZoom).not.toHaveBeenCalled();
    expect(mockResetZoom).not.toHaveBeenCalled();
  });

  it("⌘0 calls resetZoom", () => {
    const callbacks = makeCallbacks();
    renderHook(() => useKeyboardShortcuts(callbacks));

    dispatchKey("0", { metaKey: true });

    expect(mockResetZoom).toHaveBeenCalledTimes(1);
    expect(mockIncreaseZoom).not.toHaveBeenCalled();
    expect(mockDecreaseZoom).not.toHaveBeenCalled();
  });

  it("zoom chords preventDefault so the browser does not open find/etc", () => {
    const callbacks = makeCallbacks();
    renderHook(() => useKeyboardShortcuts(callbacks));

    const evPlus = dispatchKey("+", { metaKey: true, shiftKey: true });
    const evMinus = dispatchKey("-", { metaKey: true });
    const evZero = dispatchKey("0", { metaKey: true });

    expect(evPlus.defaultPrevented).toBe(true);
    expect(evMinus.defaultPrevented).toBe(true);
    expect(evZero.defaultPrevented).toBe(true);
  });
});

// ===========================================================================
// Cleanup.
// ===========================================================================

describe("useKeyboardShortcuts (cleanup)", () => {
  it("removes the listener on unmount", () => {
    const callbacks = makeCallbacks();
    const { unmount } = renderHook(() => useKeyboardShortcuts(callbacks));

    // ⌘K emits a cmd-bar focus event while mounted.
    dispatchKey("k", { metaKey: true });
    expect(capturedBarEvents).toHaveLength(1);

    unmount();

    // Post-unmount: chords should not emit anything new on either bus
    // and shell callbacks should not fire.
    dispatchKey("k", { metaKey: true });
    dispatchKey("H", { metaKey: true, shiftKey: true });
    dispatchKey("a", { metaKey: true, shiftKey: true });

    expect(capturedBarEvents).toHaveLength(1);
    expect(capturedOrbEvents).toHaveLength(0);
    expect(callbacks.onFindReplaceOpen).not.toHaveBeenCalled();
  });
});
