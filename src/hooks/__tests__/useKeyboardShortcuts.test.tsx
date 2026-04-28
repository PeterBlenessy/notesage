// @vitest-environment jsdom

/**
 * Unit tests for useKeyboardShortcuts (post-consolidation, ui-refresh #76).
 *
 * Focus areas:
 *   - `uiPreview: "legacy"` runs the legacy palette path (⌘K, ⌘1–4, ⌘⇧P).
 *   - `uiPreview: "quiet-composer"` skips legacy palette handlers for those
 *     chords (the cmd bar hook owns them) and instead emits cmd-bar events.
 *   - uiPreview-agnostic chords fire in both modes (⌘⇧H, ⌘⇧O, ⌘⇧K, ⌘⇧R).
 *   - Scaffold bindings for ⌘⇧[/⌘⇧] (MRU cycling, task #77) dispatch a
 *     custom event and preventDefault.
 *   - Sidebar event chords (⌘⌥C, ⌘⌥R) dispatch named DOM events.
 *   - Listener is removed on unmount.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook } from "@testing-library/react";

import {
  subscribeToCmdBarEvents,
  type CmdBarEvent,
} from "@/lib/cmd-bar-events";

// ---------------------------------------------------------------------------
// Settings-store mock. `uiPreview` is mutable so each `describe` block can
// flip it. Other fields are the minimal set referenced by the hook.
// ---------------------------------------------------------------------------

type UiPreview = "legacy" | "quiet-composer";

const mockSettings: {
  uiPreview: UiPreview;
  sidebarPinned: boolean;
  chatPanelOpen: boolean;
  theme: "light" | "dark" | "system";
  setTheme: ReturnType<typeof vi.fn>;
  setSidebarPinned: ReturnType<typeof vi.fn>;
  setChatPanelOpen: ReturnType<typeof vi.fn>;
} = {
  uiPreview: "legacy",
  sidebarPinned: false,
  chatPanelOpen: false,
  theme: "light",
  setTheme: vi.fn(),
  setSidebarPinned: vi.fn(),
  setChatPanelOpen: vi.fn(),
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
// Import the hook AFTER the mocks above.
// ---------------------------------------------------------------------------

import {
  useKeyboardShortcuts,
  COPY_PATH_EVENT,
  REVEAL_IN_FINDER_EVENT,
  CYCLE_RECENT_EVENT,
} from "@/hooks/useKeyboardShortcuts";
import type { PaletteMode } from "@/lib/command-palette";

// ---------------------------------------------------------------------------
// Callbacks factory.
// ---------------------------------------------------------------------------

function makeCallbacks(overrides: Partial<Parameters<typeof useKeyboardShortcuts>[0]> = {}) {
  const base = {
    onPaletteOpen: vi.fn<(mode: PaletteMode) => void>(),
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
    onToggleActivityStrip: vi.fn(),
    onToggleRecording: vi.fn(),
    onOpenActions: vi.fn(),
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

beforeEach(() => {
  // Reset settings state.
  mockSettings.uiPreview = "legacy";
  mockSettings.sidebarPinned = false;
  mockSettings.chatPanelOpen = false;
  mockSettings.theme = "light";
  mockSettings.setTheme.mockReset();
  mockSettings.setSidebarPinned.mockReset();
  mockSettings.setChatPanelOpen.mockReset();

  // Reset editor state.
  mockEditorState.openDocuments = [];
  mockEditorState.activeTabId = null;
  mockEditorState.closeTab.mockReset();
  mockEditorState.setPendingCloseTabId.mockReset();

  capturedBarEvents = [];
  unsubscribeBar = subscribeToCmdBarEvents((e) => {
    capturedBarEvents.push(e);
  });

  document.body.innerHTML = "";
});

afterEach(() => {
  unsubscribeBar();
});

// ===========================================================================
// Legacy palette path.
// ===========================================================================

describe("useKeyboardShortcuts (legacy palette path)", () => {
  it("⌘K opens the legacy command palette in default mode", () => {
    const callbacks = makeCallbacks();
    renderHook(() => useKeyboardShortcuts(callbacks));

    dispatchKey("k", { metaKey: true });

    expect(callbacks.onPaletteOpen).toHaveBeenCalledWith("default");
    expect(callbacks.onPaletteOpen).toHaveBeenCalledTimes(1);
  });

  it("⌘1 opens the actions dashboard (legacy)", () => {
    const callbacks = makeCallbacks();
    renderHook(() => useKeyboardShortcuts(callbacks));

    dispatchKey("1", { metaKey: true });

    expect(callbacks.onOpenActions).toHaveBeenCalledTimes(1);
    expect(callbacks.onPaletteOpen).not.toHaveBeenCalled();
  });

  it.each<[string, PaletteMode]>([
    ["2", "mentions"],
    ["3", "tags"],
    ["4", "research"],
  ])("⌘%s opens the palette in %s mode (legacy)", (key, mode) => {
    const callbacks = makeCallbacks();
    renderHook(() => useKeyboardShortcuts(callbacks));

    dispatchKey(key, { metaKey: true });

    expect(callbacks.onPaletteOpen).toHaveBeenCalledWith(mode);
  });

  it("⌘⇧P opens the palette in commands mode (legacy)", () => {
    const callbacks = makeCallbacks();
    renderHook(() => useKeyboardShortcuts(callbacks));

    dispatchKey("P", { metaKey: true, shiftKey: true });

    expect(callbacks.onPaletteOpen).toHaveBeenCalledWith("commands");
  });

  it("⌘⇧F opens the palette in files mode (legacy)", () => {
    const callbacks = makeCallbacks();
    renderHook(() => useKeyboardShortcuts(callbacks));

    dispatchKey("F", { metaKey: true, shiftKey: true });

    expect(callbacks.onPaletteOpen).toHaveBeenCalledWith("files");
    expect(capturedBarEvents).toEqual([]);
  });
});

// ===========================================================================
// Quiet-composer path — palette family should be owned by the cmd-bar hook
// and NOT trigger the legacy palette callbacks.
// ===========================================================================

describe("useKeyboardShortcuts (quiet-composer path)", () => {
  beforeEach(() => {
    mockSettings.uiPreview = "quiet-composer";
  });

  it("⌘K does NOT open the legacy palette (cmd bar owns it)", () => {
    const callbacks = makeCallbacks();
    renderHook(() => useKeyboardShortcuts(callbacks));

    dispatchKey("k", { metaKey: true });

    expect(callbacks.onPaletteOpen).not.toHaveBeenCalled();
    // The composed useCommandBarShortcuts emits the focus event — assert
    // the cmd-bar bus saw it so we know "something" happened.
    expect(capturedBarEvents).toEqual([{ type: "focus" }]);
  });

  it.each<[string, string]>([
    ["1", "!"],
    ["2", "@"],
    ["3", "#"],
    ["4", "?"],
  ])("⌘%s emits cmd-bar focus with prefix %s", (digit, prefix) => {
    const callbacks = makeCallbacks();
    renderHook(() => useKeyboardShortcuts(callbacks));

    dispatchKey(digit, { metaKey: true });

    expect(callbacks.onPaletteOpen).not.toHaveBeenCalled();
    expect(callbacks.onOpenActions).not.toHaveBeenCalled();
    expect(capturedBarEvents).toEqual([{ type: "focus", prefix }]);
  });

  it("⌘⇧P emits cmd-bar focus with prefix '>'", () => {
    const callbacks = makeCallbacks();
    renderHook(() => useKeyboardShortcuts(callbacks));

    dispatchKey("P", { metaKey: true, shiftKey: true });

    expect(callbacks.onPaletteOpen).not.toHaveBeenCalled();
    expect(capturedBarEvents).toEqual([{ type: "focus", prefix: ">" }]);
  });

  it("⌘⇧F emits cmd-bar focus with `:file ` prefix (PRD verb-prefixes #11)", () => {
    const callbacks = makeCallbacks();
    renderHook(() => useKeyboardShortcuts(callbacks));

    dispatchKey("F", { metaKey: true, shiftKey: true });

    expect(callbacks.onPaletteOpen).not.toHaveBeenCalled();
    // Trailing space in the prefix is intentional — the cursor lands
    // in the verb's filter slot so the user can type the query
    // immediately. The bar's `focus` subscriber treats this prefix
    // as chord-seeded so the first Esc collapses the bar.
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
// uiPreview-agnostic chords. Same behaviour in both modes.
// ===========================================================================

describe("useKeyboardShortcuts (uiPreview-agnostic chords)", () => {
  it.each<UiPreview>(["legacy", "quiet-composer"])(
    "⌘⇧H opens find-replace under uiPreview=%s",
    (preview) => {
      mockSettings.uiPreview = preview;
      const callbacks = makeCallbacks();
      renderHook(() => useKeyboardShortcuts(callbacks));

      dispatchKey("H", { metaKey: true, shiftKey: true });

      expect(callbacks.onFindReplaceOpen).toHaveBeenCalledTimes(1);
    },
  );

  it.each<UiPreview>(["legacy", "quiet-composer"])(
    "⌘F opens find under uiPreview=%s",
    (preview) => {
      mockSettings.uiPreview = preview;
      const callbacks = makeCallbacks();
      renderHook(() => useKeyboardShortcuts(callbacks));

      dispatchKey("f", { metaKey: true });

      expect(callbacks.onFindOpen).toHaveBeenCalledTimes(1);
    },
  );

  it.each<UiPreview>(["legacy", "quiet-composer"])(
    "⌘⇧K opens the Keyboard Shortcuts dialog under uiPreview=%s",
    (preview) => {
      mockSettings.uiPreview = preview;
      const callbacks = makeCallbacks();
      renderHook(() => useKeyboardShortcuts(callbacks));

      dispatchKey("K", { metaKey: true, shiftKey: true });

      expect(callbacks.onShortcutsOpen).toHaveBeenCalledTimes(1);
    },
  );

  // ⌘7 was removed live-test 2026-04-26 — ⌘⇧K is the canonical
  // Keyboard Shortcuts dialog binding now (see useKeyboardShortcuts.ts).
  // The ⌘⇧K coverage above is the only remaining assertion.

  it("⌘⇧C toggles the chat panel", () => {
    const callbacks = makeCallbacks();
    renderHook(() => useKeyboardShortcuts(callbacks));

    dispatchKey("c", { metaKey: true, shiftKey: true });

    expect(mockSettings.setChatPanelOpen).toHaveBeenCalledWith(true);
  });

  it("⌘⇧A toggles the activity strip", () => {
    const callbacks = makeCallbacks();
    renderHook(() => useKeyboardShortcuts(callbacks));

    dispatchKey("a", { metaKey: true, shiftKey: true });

    expect(callbacks.onToggleActivityStrip).toHaveBeenCalledTimes(1);
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
// Cleanup.
// ===========================================================================

describe("useKeyboardShortcuts (cleanup)", () => {
  it("removes the listener on unmount", () => {
    const callbacks = makeCallbacks();
    const { unmount } = renderHook(() => useKeyboardShortcuts(callbacks));

    dispatchKey("k", { metaKey: true });
    expect(callbacks.onPaletteOpen).toHaveBeenCalledTimes(1);

    unmount();

    dispatchKey("k", { metaKey: true });
    dispatchKey("7", { metaKey: true });
    dispatchKey("H", { metaKey: true, shiftKey: true });

    // Same call count as before unmount.
    expect(callbacks.onPaletteOpen).toHaveBeenCalledTimes(1);
  });
});
