/**
 * useDoubleTapCmd — additive convenience shortcut for the floating
 * command bar (Quiet Composer UI, ui-refresh task #21).
 *
 * Detects two consecutive presses of the ⌘ (Meta) key within ~300 ms with
 * NO other key in between, and emits a focus intent on the
 * `cmd-bar-events` bus. This is an alternate path to ⌘K — it lets users
 * "summon" the command bar by tapping the Cmd key twice without needing
 * a chord. ⌘K remains the canonical entry point.
 *
 * Always active.
 *
 * Detection rules:
 *   1. Only `event.key === 'Meta'` events count as a "tap".
 *   2. Any other keystroke between two Meta taps resets the timer — only
 *      CONSECUTIVE Meta presses count. This means typing ⌘+K (which fires
 *      Meta then K) cleanly resets the tracker, so a stray Meta during a
 *      chord cannot accidentally arm a double-tap.
 *   3. Once a pair fires, the tracker resets so a triple-tap doesn't fire
 *      twice.
 *   4. Only `keydown` is observed — `keyup` is ignored to keep the logic
 *      simple. macOS auto-repeat does not auto-repeat the modifier keys.
 *
 * Cross-platform note: `event.key === 'Meta'` matches the macOS Cmd key.
 * On Windows the equivalent would be `'Control'` (and on Linux it's
 * traditionally Super/Meta as well, but Ctrl is the common chord modifier).
 * The codebase currently targets macOS so this hook is mac-only; a
 * Windows/Linux follow-up will need to either generalise the key match or
 * gate the binding on platform.
 *
 * Mounting: this hook should be mounted at the app root alongside
 * `useCommandBarShortcuts` (per the Startup Hooks rule in CLAUDE.md). The
 * actual mount happens in a separate task.
 */
import { useEffect, useRef } from 'react';

import { emitCmdBarEvent } from '@/lib/cmd-bar-events';

/** Maximum gap between two Meta presses to count as a double-tap, in ms. */
const DOUBLE_TAP_WINDOW_MS = 300;

export function useDoubleTapCmd(): void {
  // Timestamp of the most recent solo Meta keydown. `0` means "no armed
  // tap" — the initial state and the post-emission reset state both use
  // this sentinel so we don't have to thread an `Option`/null through.
  const lastMetaPressRef = useRef<number>(0);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Meta') {
        const now = performance.now();
        const previous = lastMetaPressRef.current;
        if (previous !== 0 && now - previous < DOUBLE_TAP_WINDOW_MS) {
          // Second tap inside the window — fire the focus intent and
          // reset so a third Meta press doesn't immediately re-pair with
          // this one.
          emitCmdBarEvent({ type: 'focus' });
          lastMetaPressRef.current = 0;
        } else {
          // First tap (or stale tap outside the window) — arm the tracker.
          lastMetaPressRef.current = now;
        }
        return;
      }

      // Any non-Meta keystroke breaks the consecutive-Meta requirement —
      // reset the tracker. This handles two cases cleanly:
      //   1. ⌘+K chords (Meta keydown, then K keydown) — the K event
      //      clears the armed Meta so a later Meta tap doesn't pair with
      //      the chord's Meta.
      //   2. The user types something between two Cmd taps — clearly not
      //      an intentional double-tap.
      lastMetaPressRef.current = 0;
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, []);
}
