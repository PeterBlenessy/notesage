/**
 * useCommandBarShortcuts — global keyboard shortcuts for the floating
 * command bar (Quiet Composer UI, ui-refresh task #20).
 *
 * Active only when `settings-store.uiPreview === "quiet-composer"` so
 * the legacy code path is unaffected. Emits intents on the
 * `cmd-bar-events` bus; the FloatingCommandBar subscribes and reacts.
 *
 * Bindings (per `docs/prds/2026-04-21-ui-refresh.md` §"Keyboard
 * shortcuts — consolidated"):
 *
 *   ⌘K              → focus (no prefix)         — universal "open"
 *   ⌘1 / ⌘⇧1        → focus + prefill "!"       — Open Tasks
 *   ⌘2 / ⌘⇧2        → focus + prefill "@"       — References
 *   ⌘3 / ⌘⇧3        → focus + prefill "#"       — Tags
 *   ⌘4 / ⌘⇧4        → focus + prefill "?"       — Research
 *   ⌘⇧P             → focus + prefill ">"       — Palette
 *   Esc             → dismiss intent (always emits, regardless of focus
 *                     location — the bar's subscriber decides whether to
 *                     act based on its own expanded state, and we never
 *                     preventDefault so Esc continues to propagate to the
 *                     editor / popover / focus-mode chain per the
 *                     documented fall-through order)
 *
 * Input-skip rule: when the user is typing in a regular `<input>` or
 * `<textarea>` that's NOT inside `[data-cmd-bar]`, none of the prefix
 * shortcuts fire — they would otherwise hijack a "1" or "2" mid-edit.
 * ⌘K is the single exception: it always fires, even mid-typing, because
 * it's the universal "summon the bar" gesture.
 *
 * Cross-platform note: today the codebase targets macOS, so this hook
 * uses `event.metaKey` exclusively (matching the rest of the keymap
 * which also uses `metaKey || ctrlKey`). Windows/Linux Ctrl support is
 * tracked in the Phase 1 risks ("⌘1–4 collisions on Windows/Linux
 * WebView2/WebKitGTK") and will be revisited if/when those targets are
 * formally supported.
 */
import { useEffect } from 'react';

import { useSettingsStore } from '@/stores/settings-store';
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

/** Returns true when the event target is an editable surface OUTSIDE the
 * floating command bar. Matches `<input>`, `<textarea>`, and any element
 * with `contenteditable=""` / `="true"` / `="plaintext-only"`. */
function isOutsideCmdBarTextEntry(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;

  const tag = target.tagName;
  const isTextInput =
    tag === 'INPUT' ||
    tag === 'TEXTAREA' ||
    target.isContentEditable;

  if (!isTextInput) return false;

  // Inside the cmd bar — let the bar's own handlers see the keystroke.
  return target.closest('[data-cmd-bar]') === null;
}

export function useCommandBarShortcuts(): void {
  const uiPreview = useSettingsStore((s) => s.uiPreview);

  useEffect(() => {
    // Hard short-circuit on legacy: register no listener at all so the
    // legacy keymap (useKeyboardShortcuts) is the sole source of truth.
    if (uiPreview !== 'quiet-composer') return;

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

      // Everything below is suppressed when the user is typing in a
      // non-bar text-entry surface (the editor, a settings field, etc.).
      const skipBecauseTyping = isOutsideCmdBarTextEntry(event.target);

      // ⌘⇧P — palette prefix ">" (must come before the ⌘ digit branch
      // because P + Shift could otherwise look like a regular keystroke).
      if (mod && event.shiftKey && event.key.toLowerCase() === 'p') {
        if (skipBecauseTyping) return;
        event.preventDefault();
        emitCmdBarEvent({ type: 'focus', prefix: '>' });
        return;
      }

      // ⌘1 / ⌘⇧1, ⌘2 / ⌘⇧2, ⌘3 / ⌘⇧3, ⌘4 / ⌘⇧4 — prefix shortcuts.
      // Both shifted and unshifted variants land here because
      // `event.key` is the digit regardless of shift (the visual glyph
      // ⌘! / ⌘@ / ⌘# / ⌘? is what users see, but the key code is the
      // digit).
      if (mod && !event.altKey) {
        const prefix = DIGIT_TO_PREFIX[event.key];
        if (prefix) {
          if (skipBecauseTyping) return;
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
  }, [uiPreview]);
}
