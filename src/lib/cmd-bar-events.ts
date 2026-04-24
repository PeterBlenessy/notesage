/**
 * Tiny pub/sub event bus for coordinating the floating command bar.
 *
 * `useCommandBarShortcuts` (mounted at the app root) emits focus / dismiss
 * intents on this bus; `FloatingCommandBar` subscribes and reacts (focus
 * its input, prefill a prefix, collapse, etc.).
 *
 * This bus exists so the keyboard hook does not need a ref into the bar
 * (which would couple them via React context) and so non-bar surfaces
 * — toolbar buttons, tray menu items, future remote triggers — can drive
 * the bar through the same channel.
 */

export type CmdBarEvent =
  | { type: 'focus'; prefix?: string }
  | { type: 'dismiss' }
  // `toggle-pin` — fired by ⌘⇧C under Quiet Composer when the bar is already
  // expanded AND pinned. The bar's subscriber calls `setCmdBarPinned(false)`
  // to unpin (flipping it back to the floating overlay). When the bar is
  // collapsed or floating-but-expanded, the chord instead emits `focus` —
  // see `useKeyboardShortcuts` for the decision table.
  | { type: 'toggle-pin' };

type Handler = (event: CmdBarEvent) => void;

const handlers = new Set<Handler>();

/** Notify every subscriber of a command-bar event. */
export function emitCmdBarEvent(event: CmdBarEvent): void {
  // Snapshot to a copy so handlers that unsubscribe themselves mid-emit
  // don't disturb the iteration order.
  for (const handler of [...handlers]) {
    handler(event);
  }
}

/**
 * Subscribe to command-bar events. Returns an unsubscribe function.
 * Multiple subscribers are fine — every handler receives every event.
 */
export function subscribeToCmdBarEvents(handler: Handler): () => void {
  handlers.add(handler);
  return () => {
    handlers.delete(handler);
  };
}
