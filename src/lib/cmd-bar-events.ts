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
  | {
      type: 'focus';
      prefix?: string;
      /**
       * Optional drilldown seed — when set, the bar should open with the
       * given prefix mode AND immediately drill into the named symbol.
       * Used by the sidebar TagsSection / MentionsSection to jump straight
       * from a row click to the level-2 occurrences view (live-test
       * 2026-04-26). Picker components consume `drilldown` via a prop
       * (TagMode `initialDrilldown`, ReferenceMode `initialPersonDrilldown`).
       */
      drilldown?: { kind: 'tag' | 'mention'; name: string };
    }
  | { type: 'dismiss' }
  // `toggle-pin` — fired by ⌘⇧C under Quiet Composer when the bar is already
  // expanded AND pinned. The bar's subscriber calls `setCmdBarPinned(false)`
  // to unpin (flipping it back to the floating overlay). When the bar is
  // collapsed or floating-but-expanded, the chord instead emits `focus` —
  // see `useKeyboardShortcuts` for the decision table.
  | { type: 'toggle-pin' }
  // `toggle-history` — fired by the clock icon in `CommandBarContext` (and
  // by `⌘⇧H` once the keyboard hook is wired) to flip the expanded bar
  // between "chat stream" mode and "history list" mode. The bar's
  // subscriber flips its local `chatView` state. Selecting a conversation
  // from the history list returns to chat via the `onSelectConversation`
  // callback, same as the legacy `ChatPanel` does (#118).
  | { type: 'toggle-history' }
  // `close` — fired by the X button in `CommandBarContext` (live-test
  // 2026-04-26). Unlike `dismiss`, this is an explicit user "close the
  // bar" intent and bypasses the multi-stage Esc semantics (prefix
  // clearing, edit-mode cancel, pin guard). The subscriber forces the
  // bar back to its compact pill state regardless of typed prefix or
  // pinned mode. Pinned mode is unpinned by the trigger before the
  // event fires so the bar has somewhere to collapse to.
  | { type: 'close' };

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
