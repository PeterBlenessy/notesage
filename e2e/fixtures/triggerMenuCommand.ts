/**
 * triggerMenuCommand — dispatches a keyboard chord from the app command
 * manifest so e2e tests exercise the exact same code path as a real keystroke.
 *
 * Usage:
 *   await triggerMenuCommand(page, "open-command-palette");
 *   await triggerMenuCommand(page, "open-settings");
 */
import type { Page } from "@playwright/test";
import manifest from "../../src/shared/appCommandManifest.json";

type ChordDef = (typeof manifest.commands)[0]["chords"][0];

/**
 * Converts a ChordDef to a Playwright keyboard.press() string.
 *
 * Playwright accepts both `KeyboardEvent.key` values ("k", ",") and
 * `KeyboardEvent.code` values ("KeyK", "Comma") in its press() method.
 * We prefer `key` when present (matches how existing e2e tests are written),
 * and fall back to `code` for chords where `key` is absent — e.g. ⌘⌥C where
 * Option+C produces "ç" on macOS and we match by physical key position.
 *
 * Modifier mapping:
 *   mod   → "Meta"   (platform command key)
 *   ctrlKey → "Control"
 *   shiftKey → "Shift"
 *   altKey → "Alt"
 */
function chordToPressString(chord: ChordDef): string {
  const parts: string[] = [];
  if (chord.mod) parts.push("Meta");
  if ("metaKey" in chord && chord.metaKey) parts.push("Meta");
  if ("ctrlKey" in chord && chord.ctrlKey) parts.push("Control");
  if ("shiftKey" in chord && chord.shiftKey) parts.push("Shift");
  if ("altKey" in chord && chord.altKey) parts.push("Alt");
  const keyStr =
    "key" in chord && chord.key ? chord.key : (chord.code ?? "");
  parts.push(keyStr);
  return parts.join("+");
}

/**
 * Look up `commandId` in the app command manifest and press its first chord.
 *
 * Throws if the command is not found so tests fail loudly rather than
 * silently pressing nothing.
 */
export async function triggerMenuCommand(
  page: Page,
  commandId: string,
): Promise<void> {
  const command = manifest.commands.find((c) => c.id === commandId);
  if (!command) {
    throw new Error(
      `triggerMenuCommand: command "${commandId}" not found in appCommandManifest.json`,
    );
  }
  const pressStr = chordToPressString(command.chords[0]);
  await page.keyboard.press(pressStr);
}
