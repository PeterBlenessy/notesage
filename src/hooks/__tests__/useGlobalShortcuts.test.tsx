// @vitest-environment jsdom

/**
 * Dispatch + regression tests for `useGlobalShortcuts` — the single App-root
 * keyboard-shortcut dispatcher. Exercises the real manifest + matcher; mocks
 * only the leaf side-effects (zoom, devtools gating).
 */
import "@/test/tauri-mock";
import { setMockInvokeHandler } from "@/test/tauri-mock";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { act } from "react";
import { renderHook } from "@testing-library/react";

import { useGlobalShortcuts } from "@/hooks/useGlobalShortcuts";
import type { ShortcutCallbacks } from "@/hooks/shortcuts/shortcutActions";
import { useCmdBarSummonStore } from "@/stores/cmd-bar-summon-store";
import { CYCLE_RECENT_EVENT, COPY_PATH_EVENT } from "@/lib/keyboard/shortcut-events";

const fireZoom = vi.fn();
vi.mock("@/hooks/useEditorZoom", () => ({
  fireZoom: (...args: unknown[]) => fireZoom(...args),
}));

let alpha = false;
vi.mock("@/lib/build-channel", () => ({
  isAlphaBuild: () => alpha,
  initBuildChannel: vi.fn(),
}));

function makeCallbacks(): ShortcutCallbacks {
  return {
    onFindOpen: vi.fn(),
    onFindReplaceOpen: vi.fn(),
    onOutlineOpen: vi.fn(),
    onSettingsOpen: vi.fn(),
    onExportOpen: vi.fn(),
    onNewProject: vi.fn(),
    onNewNote: vi.fn(),
    onOpenFolder: vi.fn(),
    onShortcutsOpen: vi.fn(),
    onToggleRecording: vi.fn(),
  };
}

function dispatchOn(target: EventTarget, init: KeyboardEventInit) {
  act(() => {
    target.dispatchEvent(
      new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init }),
    );
  });
}

beforeEach(() => {
  fireZoom.mockClear();
  alpha = false;
  useCmdBarSummonStore.setState({ pending: null });
  document.body.innerHTML = "";
});

describe("useGlobalShortcuts", () => {
  it("⌘K writes a summon to the durable store", () => {
    const cbs = makeCallbacks();
    renderHook(() => useGlobalShortcuts(cbs));
    dispatchOn(window, { key: "k", metaKey: true });
    expect(useCmdBarSummonStore.getState().pending?.prefix).toBeUndefined();
    expect(useCmdBarSummonStore.getState().pending?.nonce).toBeGreaterThan(0);
  });

  it("⌘1 summons with the '!' tasks prefix", () => {
    renderHook(() => useGlobalShortcuts(makeCallbacks()));
    dispatchOn(window, { key: "1", metaKey: true });
    expect(useCmdBarSummonStore.getState().pending?.prefix).toBe("!");
  });

  it("⌘⇧F summons with the ':file ' verb prefix", () => {
    renderHook(() => useGlobalShortcuts(makeCallbacks()));
    dispatchOn(window, { key: "f", metaKey: true, shiftKey: true });
    expect(useCmdBarSummonStore.getState().pending?.prefix).toBe(":file ");
  });

  it("⌘K fires even while typing (firesWhileTyping), ⌘N does not", () => {
    const cbs = makeCallbacks();
    renderHook(() => useGlobalShortcuts(cbs));

    const input = document.createElement("input");
    document.body.appendChild(input);

    // ⌘N from a text input → suppressed (firesWhileTyping:false).
    dispatchOn(input, { key: "n", metaKey: true });
    expect(cbs.onNewNote).not.toHaveBeenCalled();

    // ⌘K from the same input → still fires.
    dispatchOn(input, { key: "k", metaKey: true });
    expect(useCmdBarSummonStore.getState().pending).not.toBeNull();
  });

  it("⌘N fires when focus is not a typing target (capture phase)", () => {
    const cbs = makeCallbacks();
    renderHook(() => useGlobalShortcuts(cbs));
    dispatchOn(document.body, { key: "n", metaKey: true });
    expect(cbs.onNewNote).toHaveBeenCalledTimes(1);
  });

  it("⌘⇧N fires onNewProject; suppressed while typing", () => {
    const cbs = makeCallbacks();
    renderHook(() => useGlobalShortcuts(cbs));

    const input = document.createElement("input");
    document.body.appendChild(input);
    dispatchOn(input, { key: "n", metaKey: true, shiftKey: true });
    expect(cbs.onNewProject).not.toHaveBeenCalled();

    dispatchOn(document.body, { key: "n", metaKey: true, shiftKey: true });
    expect(cbs.onNewProject).toHaveBeenCalledTimes(1);
  });

  it("⌘+ and ⌘= zoom in; ⌘- out; ⌘0 reset (key-based, layout-stable)", () => {
    renderHook(() => useGlobalShortcuts(makeCallbacks()));
    dispatchOn(window, { key: "+", metaKey: true });
    dispatchOn(window, { key: "=", metaKey: true });
    dispatchOn(window, { key: "-", metaKey: true });
    dispatchOn(window, { key: "0", metaKey: true });
    expect(fireZoom.mock.calls.map((c) => c[0])).toEqual([
      "in",
      "in",
      "out",
      "reset",
    ]);
  });

  it("⌃Tab / ⌃⇧Tab dispatch cycle-recent with direction", () => {
    renderHook(() => useGlobalShortcuts(makeCallbacks()));
    const seen: string[] = [];
    const handler = (e: Event) =>
      seen.push((e as CustomEvent<{ direction: string }>).detail.direction);
    window.addEventListener(CYCLE_RECENT_EVENT, handler);
    dispatchOn(window, { key: "Tab", ctrlKey: true });
    dispatchOn(window, { key: "Tab", ctrlKey: true, shiftKey: true });
    window.removeEventListener(CYCLE_RECENT_EVENT, handler);
    expect(seen).toEqual(["next", "previous"]);
  });

  it("⌘⌥P dispatches the copy-path event (rebound from ⌘⌥C)", () => {
    renderHook(() => useGlobalShortcuts(makeCallbacks()));
    const handler = vi.fn();
    window.addEventListener(COPY_PATH_EVENT, handler);
    dispatchOn(window, { code: "KeyP", metaKey: true, altKey: true });
    window.removeEventListener(COPY_PATH_EVENT, handler);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("⌘⌥I devtools is gated on alpha/dev builds", async () => {
    const devtools = vi.fn(() => undefined);
    setMockInvokeHandler("open_devtools", devtools);
    renderHook(() => useGlobalShortcuts(makeCallbacks()));

    alpha = false;
    dispatchOn(window, { code: "KeyI", metaKey: true, altKey: true });
    // Flush the dynamic import()/.then microtasks the action would use.
    await act(async () => {});
    expect(devtools).not.toHaveBeenCalled();

    alpha = true;
    dispatchOn(window, { code: "KeyI", metaKey: true, altKey: true });
    await vi.waitFor(() => expect(devtools).toHaveBeenCalled());
  });

  it("Esc does not preventDefault (keeps the fall-through chain alive)", () => {
    renderHook(() => useGlobalShortcuts(makeCallbacks()));
    const event = new KeyboardEvent("keydown", {
      key: "Escape",
      bubbles: true,
      cancelable: true,
    });
    act(() => {
      window.dispatchEvent(event);
    });
    expect(event.defaultPrevented).toBe(false);
  });
});
