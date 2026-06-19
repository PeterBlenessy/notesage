/**
 * useGlobalShortcuts — the single App-root keyboard-shortcut dispatcher.
 *
 * Mounted once in `App.tsx`. Replaces the former trio of hooks
 * (`useKeyboardShortcuts` + `useCommandBarShortcuts` + `useDoubleTapCmd`),
 * which each installed their own `window` keydown listener.
 *
 * How it works:
 *   - The manifest (`appCommandManifest.json` → `catalog`) is the source of
 *     truth for chords. For each command that has a `shortcutActions[id]`
 *     entry, this dispatcher matches the keydown via the shared, layout-safe
 *     `matchesChord()` and runs the action.
 *   - Commands with NO action are owned by another surface and ignored here:
 *     `toggle-focus-mode` / `exit-focus-mode` live in `useFocusMode` (capture
 *     phase); ⌘N / ⌘⇧N are preempted at capture phase by `QuietLayout` (this
 *     hook only provides their bubble-phase fallback via their actions).
 *   - `firesWhileTyping` gates whether a chord fires while focus is in a text
 *     surface (centralizes the guard previously duplicated across components).
 *
 * Bug fixes folded in vs the old hooks:
 *   - Summons write to a durable store (survive a command-bar crash).
 *   - All chords use `matchesChord` (key OR code) → Swedish/Nordic-safe.
 *   - One owner per chord → no double-handling.
 *   - `mod: true` (meta||ctrl) everywhere → no metaKey-only inconsistency.
 *
 * ⌘S (save) stays editor-owned (`Editor.tsx` / `CodeEditor.tsx`) so markdown
 * and code-file save paths can diverge — it has no action here.
 */
import { useEffect, useRef } from "react";

import { catalog, matchesChord, type AppCommand } from "@/lib/appCommandCatalog";
import { isTypingTarget } from "@/lib/keyboard/isTypingTarget";
import { emitCmdBarEvent } from "@/lib/cmd-bar-events";
import {
  shortcutActions,
  shortcutGuards,
  type ShortcutCallbacks,
} from "@/hooks/shortcuts/shortcutActions";

// Re-export the event-name constants from their stable home so existing
// importers (`useRecentDocumentCycle`) keep working through this hook too.
export {
  COPY_PATH_EVENT,
  REVEAL_IN_FINDER_EVENT,
  CYCLE_RECENT_EVENT,
} from "@/lib/keyboard/shortcut-events";

/** Maximum gap between two ⌘ presses to count as a double-tap, in ms. */
const DOUBLE_TAP_WINDOW_MS = 300;

/** Commands this dispatcher owns: a manifest entry that has a bound action. */
function dispatchableCommands(phase: "capture" | "bubble"): AppCommand[] {
  return Object.values(catalog).filter(
    (cmd) =>
      (cmd.scope ?? "global") === "global" &&
      shortcutActions[cmd.id] !== undefined &&
      (cmd.phase ?? "bubble") === phase,
  );
}

export function useGlobalShortcuts(callbacks: ShortcutCallbacks): void {
  // Keep the latest callbacks in a ref so the listener installs once.
  const callbacksRef = useRef(callbacks);
  callbacksRef.current = callbacks;

  // Double-tap ⌘ tracker (0 = no armed tap).
  const lastMetaPressRef = useRef<number>(0);

  useEffect(() => {
    const bubbleCommands = dispatchableCommands("bubble");
    const captureCommands = dispatchableCommands("capture");

    const run = (cmd: AppCommand, event: KeyboardEvent): boolean => {
      if (!cmd.firesWhileTyping && isTypingTarget(event.target)) return false;
      if (!cmd.chords.some((chord) => matchesChord(event, chord))) return false;
      // Optional guard (e.g. Esc only exits focus mode when nothing else wants
      // it). A false guard means "don't claim the key" → fall through.
      if (shortcutGuards[cmd.id] && !shortcutGuards[cmd.id]()) return false;
      if (cmd.preventDefault !== false) event.preventDefault();
      shortcutActions[cmd.id]?.({ callbacks: callbacksRef.current, event });
      return true;
    };

    const handleBubble = (event: KeyboardEvent) => {
      // Double-tap ⌘ → summon the command bar (alternate to ⌘K).
      if (event.key === "Meta") {
        const now = performance.now();
        const previous = lastMetaPressRef.current;
        if (previous !== 0 && now - previous < DOUBLE_TAP_WINDOW_MS) {
          lastMetaPressRef.current = 0;
          shortcutActions["open-command-palette"]?.({
            callbacks: callbacksRef.current,
            event,
          });
        } else {
          lastMetaPressRef.current = now;
        }
        return;
      }
      // Any non-Meta key breaks the consecutive-Meta requirement.
      lastMetaPressRef.current = 0;

      // Esc → command-bar dismiss intent. Emitted unconditionally and WITHOUT
      // preventDefault so the keydown keeps propagating through the documented
      // fall-through chain (FindBar → Radix popover → focus mode). The bar's
      // subscriber decides whether to act based on its own expanded state.
      if (event.key === "Escape") {
        emitCmdBarEvent({ type: "dismiss" });
        // fall through — Esc is not a dispatchable command here
      }

      for (const cmd of bubbleCommands) {
        if (run(cmd, event)) return;
      }
    };

    const handleCapture = (event: KeyboardEvent) => {
      for (const cmd of captureCommands) {
        if (run(cmd, event)) return;
      }
    };

    window.addEventListener("keydown", handleBubble);
    if (captureCommands.length > 0) {
      window.addEventListener("keydown", handleCapture, true);
    }
    return () => {
      window.removeEventListener("keydown", handleBubble);
      window.removeEventListener("keydown", handleCapture, true);
    };
  }, []);
}
