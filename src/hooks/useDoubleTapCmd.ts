/**
 * useDoubleTapCmd — convenience shortcut for the floating command bar.
 *
 * Detects two consecutive presses of the ⌘ (Meta) key within ~300 ms with
 * NO other key in between, and emits a focus intent on the
 * `cmd-bar-events` bus. Alternate path to ⌘K.
 *
 * Detection rules:
 *   1. Only `event.key === 'Meta'` events count as a "tap".
 *   2. Any other keystroke between two Meta taps resets the timer.
 *   3. Once a pair fires, the tracker resets so a triple-tap doesn't fire twice.
 *   4. Only `keydown` is observed — `keyup` is ignored.
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
