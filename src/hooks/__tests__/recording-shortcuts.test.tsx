// @vitest-environment jsdom

/**
 * The recording chords through the real dispatcher and the real manifest
 * (U7, U10): ⌘⇧R toggles, ⌘⇧U pauses or resumes, and a held key does not
 * fire again.
 */
import "@/test/tauri-mock";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act } from "react";
import { renderHook } from "@testing-library/react";

import { useGlobalShortcuts } from "@/hooks/useGlobalShortcuts";
import type { ShortcutCallbacks } from "@/hooks/shortcuts/shortcutActions";
import { catalog } from "@/lib/appCommandCatalog";

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

function press(init: KeyboardEventInit, target: EventTarget = window): KeyboardEvent {
  const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init });
  act(() => {
    target.dispatchEvent(event);
  });
  return event;
}

const TOGGLE = { key: "R", code: "KeyR", metaKey: true, shiftKey: true };
const PAUSE = { key: "U", code: "KeyU", metaKey: true, shiftKey: true };

describe("recording shortcuts", () => {
  let pauseEvents: number;
  const onPause = () => {
    pauseEvents += 1;
  };

  beforeEach(() => {
    pauseEvents = 0;
    window.addEventListener("notesage:toggle-recording-pause", onPause);
  });
  afterEach(() => {
    window.removeEventListener("notesage:toggle-recording-pause", onPause);
  });

  it("the manifest lists both chords, so the shortcuts dialog and the docs show them", () => {
    expect(catalog["toggle-recording"].display).toBe("⌘⇧R");
    expect(catalog["toggle-recording-pause"].display).toBe("⌘⇧U");
    expect(catalog["toggle-recording-pause"].firesWhileTyping).toBe(true);
    // No chord is shared with another command.
    const displays = Object.values(catalog).map((c) => c.display);
    expect(displays.filter((d) => d === "⌘⇧U")).toHaveLength(1);
    expect(displays.filter((d) => d === "⌘⇧R")).toHaveLength(1);
  });

  it("⌘⇧R toggles once per press; auto-repeat while the key is held is ignored", () => {
    const callbacks = makeCallbacks();
    renderHook(() => useGlobalShortcuts(callbacks));

    const first = press(TOGGLE);
    expect(callbacks.onToggleRecording).toHaveBeenCalledTimes(1);
    expect(first.defaultPrevented).toBe(true);

    // The key is held: the OS repeats the keydown.
    for (let i = 0; i < 5; i++) {
      const repeat = press({ ...TOGGLE, repeat: true });
      // Still claimed (no browser reload on ⌘⇧R), but not acted on.
      expect(repeat.defaultPrevented).toBe(true);
    }
    expect(callbacks.onToggleRecording).toHaveBeenCalledTimes(1);

    // A second, separate press toggles again.
    press(TOGGLE);
    expect(callbacks.onToggleRecording).toHaveBeenCalledTimes(2);
  });

  it("⌘⇧U asks for pause/resume, once per press, and does not toggle the recording", () => {
    const callbacks = makeCallbacks();
    renderHook(() => useGlobalShortcuts(callbacks));

    press(PAUSE);
    press({ ...PAUSE, repeat: true });
    expect(pauseEvents).toBe(1);
    expect(callbacks.onToggleRecording).not.toHaveBeenCalled();
  });

  it("both work while typing in a text field", () => {
    const callbacks = makeCallbacks();
    renderHook(() => useGlobalShortcuts(callbacks));
    const input = document.createElement("textarea");
    document.body.appendChild(input);
    input.focus();

    press(TOGGLE, input);
    press(PAUSE, input);
    expect(callbacks.onToggleRecording).toHaveBeenCalledTimes(1);
    expect(pauseEvents).toBe(1);
    input.remove();
  });

  it("⌘U and ⌘R alone are left to the editor and the browser", () => {
    const callbacks = makeCallbacks();
    renderHook(() => useGlobalShortcuts(callbacks));
    press({ key: "u", code: "KeyU", metaKey: true });
    press({ key: "r", code: "KeyR", metaKey: true });
    expect(pauseEvents).toBe(0);
    expect(callbacks.onToggleRecording).not.toHaveBeenCalled();
  });
});
