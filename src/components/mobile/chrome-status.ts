import { useSyncExternalStore } from "react";
import type { IosChromeStatus } from "@/lib/ios-api";

/**
 * The app-global passive status line, and the web side's single owner of it.
 *
 * # Why this is not a prop
 *
 * The bottom-centre slot has four occupants — the search pill, the read-aloud
 * transport, the recording island and this — and every one of them used to be
 * positioned by whoever happened to render it. That is how #995 happened: the
 * background sweep drew a React `<Island corner="bottom-center">` while the
 * native layer drew the search pill at the same coordinates, neither knowing
 * the other existed, and the result was "some kind of mini notification or
 * pill, I could not tell what it said" (Peter, device, build 60).
 *
 * The fix has two halves, and this is the web one:
 *
 *   - **Native** — `ChromeOverlay.layoutBottomColumn` is the single owner of
 *     the slot's GEOMETRY. Nothing else positions anything there.
 *   - **Web** — `useNativeChrome` is the single owner of the slot's
 *     DECLARATION. Every chrome push goes through it, so a new occupant
 *     cannot be added without the arbiter seeing it.
 *
 * That leaves one problem: `ios_set_chrome` replaces the whole spec, and the
 * spec is declared per SCREEN, while the sweep is app-global — it runs
 * whichever screen is up, and it starts from a share that may have arrived
 * while the app was closed. Threading it through every screen's spec would
 * make an app-global fact into a prop on each of them, and the next
 * app-global status would have to be threaded through again.
 *
 * So it lives here, and `useNativeChrome` merges it into whatever the current
 * screen declares. One line of state, read by the one place that talks to the
 * native layer.
 *
 * # Not a Zustand store
 *
 * It holds one nullable value with no persistence, no actions and no
 * selectors. `useSyncExternalStore` is the whole implementation.
 */

let status: IosChromeStatus | null = null;
const listeners = new Set<() => void>();

/**
 * Publish (or clear with `null`) the passive status line.
 *
 * Idempotent by value: the sweep re-publishes on every swept document, and an
 * unchanged object would otherwise re-declare the chrome — which in
 * `useNativeChrome` means an `ios_set_chrome` round trip per document.
 */
export function setChromeStatus(next: IosChromeStatus | null): void {
  const same =
    (next === null && status === null) ||
    (next !== null &&
      status !== null &&
      next.label === status.label &&
      next.busy === status.busy);
  if (same) return;
  status = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function snapshot(): IosChromeStatus | null {
  return status;
}

/** The current status line, re-rendering the caller when it changes. */
export function useChromeStatus(): IosChromeStatus | null {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

/** Test seam: forget any published status. */
export function resetChromeStatus(): void {
  status = null;
  for (const listener of listeners) listener();
}
