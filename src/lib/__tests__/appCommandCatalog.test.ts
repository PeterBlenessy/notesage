// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { catalog, matchesChord } from "@/lib/appCommandCatalog";

// Minimum number of entries expected in the manifest (from the JSDoc
// SHORTCUT table in useKeyboardShortcuts.ts).
const MIN_COMMANDS = 20;

// Command IDs that must be present — one per shortcut from the JSDoc table.
const REQUIRED_IDS = [
  "open-command-palette",
  "open-tasks",
  "open-mentions",
  "open-tags",
  "open-research",
  "open-commands-palette",
  "find-replace",
  "find-files",
  "find-in-document",
  "close-active-document",
  "toggle-focus-mode",
  "export-document",
  "open-document-outline",
  "toggle-sidebar",
  "toggle-activity-agent",
  "toggle-chat-panel",
  "toggle-recording",
  "keyboard-shortcuts",
  "open-settings",
  "toggle-theme",
  "new-note",
  "new-project",
  "open-folder",
  "cycle-recent-next",
  "cycle-recent-previous",
  "copy-document-path",
  "reveal-in-finder",
  "exit-focus-mode",
  "open-devtools",
];

describe("appCommandCatalog structure", () => {
  it("exports a non-empty catalog with at least MIN_COMMANDS entries", () => {
    expect(Object.keys(catalog).length).toBeGreaterThanOrEqual(MIN_COMMANDS);
  });

  it("every command has id, label, display, and at least one chord", () => {
    for (const cmd of Object.values(catalog)) {
      expect(typeof cmd.id).toBe("string");
      expect(cmd.id.length).toBeGreaterThan(0);
      expect(typeof cmd.label).toBe("string");
      expect(cmd.label.length).toBeGreaterThan(0);
      expect(typeof cmd.display).toBe("string");
      expect(cmd.display.length).toBeGreaterThan(0);
      expect(Array.isArray(cmd.chords)).toBe(true);
      expect(cmd.chords.length).toBeGreaterThan(0);
    }
  });

  it("every chord has at least one of key or code", () => {
    for (const cmd of Object.values(catalog)) {
      for (const chord of cmd.chords) {
        expect(
          chord.key !== undefined || chord.code !== undefined,
          `command ${cmd.id} has a chord with neither key nor code`,
        ).toBe(true);
      }
    }
  });

  it("punctuation chords carry both key and code for layout safety", () => {
    const PUNCTUATION_KEYS = [",", ".", "[", "]", ";", "'", "\\", "/", "-", "="];
    for (const cmd of Object.values(catalog)) {
      for (const chord of cmd.chords) {
        if (chord.key !== undefined && PUNCTUATION_KEYS.includes(chord.key)) {
          expect(
            chord.code,
            `command ${cmd.id} chord with key="${chord.key}" is missing code (required for cross-keyboard-layout safety)`,
          ).toBeDefined();
        }
      }
    }
  });

  it.each(REQUIRED_IDS)("catalog has required command '%s'", (id) => {
    expect(catalog[id]).toBeDefined();
  });
});

describe("matchesChord", () => {
  it("returns true when key and mod match", () => {
    const chord = { key: "k", code: "KeyK", mod: true, shiftKey: false, altKey: false };
    const event = new KeyboardEvent("keydown", { key: "k", code: "KeyK", metaKey: true });
    expect(matchesChord(event, chord)).toBe(true);
  });

  it("returns false when mod is required but not present", () => {
    const chord = { key: "k", code: "KeyK", mod: true, shiftKey: false, altKey: false };
    const event = new KeyboardEvent("keydown", { key: "k", code: "KeyK" });
    expect(matchesChord(event, chord)).toBe(false);
  });

  it("returns false when key does not match", () => {
    const chord = { key: "k", code: "KeyK", mod: true, shiftKey: false, altKey: false };
    const event = new KeyboardEvent("keydown", { key: "j", code: "KeyJ", metaKey: true });
    expect(matchesChord(event, chord)).toBe(false);
  });

  it("matches by code even when key differs (Option+C → ç)", () => {
    const chord = { code: "KeyC", mod: true, altKey: true };
    const event = new KeyboardEvent("keydown", { key: "ç", code: "KeyC", metaKey: true, altKey: true });
    expect(matchesChord(event, chord)).toBe(true);
  });

  it("matches ctrlKey-only chord (⌃Tab)", () => {
    const chord = { key: "Tab", code: "Tab", ctrlKey: true, metaKey: false, shiftKey: false, altKey: false };
    const event = new KeyboardEvent("keydown", { key: "Tab", code: "Tab", ctrlKey: true });
    expect(matchesChord(event, chord)).toBe(true);
  });

  it("rejects ⌘Tab when ctrlKey chord requires ctrlKey but not metaKey", () => {
    const chord = { key: "Tab", code: "Tab", ctrlKey: true, metaKey: false, shiftKey: false, altKey: false };
    const event = new KeyboardEvent("keydown", { key: "Tab", code: "Tab", metaKey: true });
    expect(matchesChord(event, chord)).toBe(false);
  });

  it("matches punctuation chord via key OR code", () => {
    const chord = { key: ",", code: "Comma", mod: true };
    const eventByKey = new KeyboardEvent("keydown", { key: ",", code: "Comma", metaKey: true });
    const eventByCode = new KeyboardEvent("keydown", { key: ";", code: "Comma", metaKey: true });
    expect(matchesChord(eventByKey, chord)).toBe(true);
    expect(matchesChord(eventByCode, chord)).toBe(true);
  });
});
