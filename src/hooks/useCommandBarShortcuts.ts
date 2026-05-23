/**
 * useCommandBarShortcuts — global keyboard shortcuts for the floating
 * command bar. Emits intents on the `cmd-bar-events` bus; the
 * FloatingCommandBar subscribes and reacts.
 *
 * Bindings:
 *   ⌘K              → focus (no prefix)         — universal "open"
 *   ⌘1 / ⌘⇧1        → focus + prefill "!"       — Open Tasks
 *   ⌘2 / ⌘⇧2        → focus + prefill "@"       — References
 *   ⌘3 / ⌘⇧3        → focus + prefill "#"       — Tags
 *   ⌘4 / ⌘⇧4        → focus + prefill "?"       — Research
 *   ⌘⇧P             → focus + prefill ">"       — Palette
 *   Esc             → dismiss intent (always emits, regardless of focus
 *                     location — the bar's subscriber decides whether to
 *                     act based on its own expanded state)
 */
import { useEffect } from 'react';

import { emitCmdBarEvent } from '@/lib/cmd-bar-events';

// Map ⌘<digit> → prefix character. Both unshifted and shifted variants
// resolve to the same prefix because `event.key` returns the digit even
// when shift is held on number keys (the symbol is OS/keyboard-layout
// dependent, so the digit is the most reliable anchor).
const DIGIT_TO_PREFIX: Record<string, string> = {
  '1': '!',
  '2': '@',
  '3': '#',
  '4': '?',
};

export function useCommandBarShortcuts(): void {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const mod = event.metaKey;

      // ⌘K — universal "open command bar" gesture. Always fires, even
      // when typing in an unrelated input, because it's the single most
      // important muscle-memory binding in the new UI.
      if (mod && event.key.toLowerCase() === 'k' && !event.shiftKey && !event.altKey) {
        event.preventDefault();
        emitCmdBarEvent({ type: 'focus' });
        return;
      }

      // ⌘⇧P — palette prefix ">" (must come before the ⌘ digit branch
      // because P + Shift could otherwise look like a regular keystroke).
      if (mod && event.shiftKey && event.key.toLowerCase() === 'p') {
        event.preventDefault();
        emitCmdBarEvent({ type: 'focus', prefix: '>' });
        return;
      }
      // Note: ⌘⇧F is owned by `useKeyboardShortcuts` — it seeds `:file `
      // (PRD `2026-04-28-cmd-bar-verb-prefixes`, #11).

      // ⌘1 / ⌘⇧1, ⌘2 / ⌘⇧2, ⌘3 / ⌘⇧3, ⌘4 / ⌘⇧4 — prefix shortcuts.
      // Both shifted and unshifted variants land here because
      // `event.key` is the digit regardless of shift (the visual glyph
      // ⌘! / ⌘@ / ⌘# / ⌘? is what users see, but the key code is the
      // digit).
      if (mod && !event.altKey) {
        const prefix = DIGIT_TO_PREFIX[event.key];
        if (prefix) {
          event.preventDefault();
          emitCmdBarEvent({ type: 'focus', prefix });
          return;
        }
      }

      // Esc — dismiss intent. Emit unconditionally regardless of where
      // focus currently is (#114 fix). The FloatingCommandBar's subscriber
      // decides whether to act: if the bar is expanded it collapses,
      // otherwise it's a no-op. We deliberately do NOT preventDefault on
      // Esc so the keydown keeps propagating through the rest of the
      // chain (editor FindBar → Radix popover → focus mode → etc.) —
      // that's the documented fall-through behaviour in design-system.md
      // and it's what lets Esc stay useful everywhere else.
      if (event.key === 'Escape') {
        emitCmdBarEvent({ type: 'dismiss' });
        return;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, []);
}
