/**
 * Tiny pub/sub event bus for coordinating the AgentOrb popover.
 *
 * Mirror of `cmd-bar-events` — `useKeyboardShortcuts` (mounted at the app
 * root) emits a `toggle` intent when the user presses ⌘⇧A under the Quiet
 * Composer preview; `AgentOrb` subscribes and flips its local popover open
 * state in response.
 *
 * This bus exists so the keyboard hook does not need a ref into the orb
 * (which would couple them via React context) and so non-keyboard surfaces
 * — tray menu items, future remote triggers — can drive the orb through the
 * same channel.
 *
 * See the sibling `cmd-bar-events.ts` for the same pattern applied to the
 * FloatingCommandBar.
 */

export type AgentOrbEvent = { type: 'toggle' };

type Handler = (event: AgentOrbEvent) => void;

const handlers = new Set<Handler>();

/** Notify every subscriber of an agent-orb event. */
export function emitAgentOrbEvent(event: AgentOrbEvent): void {
  // Snapshot to a copy so handlers that unsubscribe themselves mid-emit
  // don't disturb the iteration order.
  for (const handler of [...handlers]) {
    handler(event);
  }
}

/**
 * Subscribe to agent-orb events. Returns an unsubscribe function.
 * Multiple subscribers are fine — every handler receives every event.
 */
export function subscribeToAgentOrbEvents(handler: Handler): () => void {
  handlers.add(handler);
  return () => {
    handlers.delete(handler);
  };
}
