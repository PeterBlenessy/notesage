/**
 * Module-level "any sidebar context menu open" flag.
 *
 * Why this exists (live-test 2026-04-25, two issues):
 *
 *   1. `FolderPeek` / `FilePreview` portals are rendered as React children of
 *      their trigger wrapper. The Radix `<ContextMenu>` Root for sidebar
 *      rows lives INSIDE those wrappers (and for the FolderPeek child items,
 *      INSIDE the peek's own portal). When a user right-clicks an item in
 *      the FolderPeek preview the menu opens, then the cursor moving toward
 *      the menu fires `mouseleave` on the preview portal. The preview's
 *      grace timer closes the portal, which unmounts the Radix Root, which
 *      unmounts the MenuContent. Both popovers vanish.
 *
 *   2. React synthetic events bubble through the REACT tree, not the DOM
 *      tree. The menu portal at `document.body` is — in React's view — a
 *      descendant of the FilePreview trigger wrapper. When the cursor
 *      enters the menu portal, React fires `onMouseEnter` on the trigger
 *      wrapper, the openTimer schedules, and 220 ms later a preview pops
 *      up unexpectedly over the menu.
 *
 * The fix for both: a single shared flag the previews consult before
 * opening or closing themselves. While ANY sidebar context menu is open,
 * previews:
 *
 *   - Skip the openTimer firing (no spontaneous opens triggered by
 *     React's portal-traversing synthetic `mouseenter`).
 *   - Skip the closeTimer firing (so the FolderPeek portal stays mounted
 *     while a menu lives inside it).
 *
 * When the flag returns to zero, subscribers are notified so each
 * preview can re-evaluate its hover state — closing if the cursor is no
 * longer inside the trigger or popover.
 *
 * `SidebarContextMenu` calls `incrementOpenContextMenus` / `decrement…`
 * via Radix's `onOpenChange`. The previews subscribe via
 * `subscribeToOpenContextMenus`.
 */

let openCount = 0;
const subscribers = new Set<() => void>();

/** Increment the open-context-menu count and notify subscribers. */
export function incrementOpenContextMenus(): void {
  openCount += 1;
  for (const sub of [...subscribers]) sub();
}

/** Decrement the open-context-menu count and notify subscribers. */
export function decrementOpenContextMenus(): void {
  openCount = Math.max(0, openCount - 1);
  for (const sub of [...subscribers]) sub();
}

/** Read the current count synchronously. Safe to call from any handler. */
export function getOpenContextMenuCount(): number {
  return openCount;
}

/** True when at least one sidebar context menu is currently open. */
export function isAnyContextMenuOpen(): boolean {
  return openCount > 0;
}

/**
 * Subscribe to open-count changes. Returns an unsubscribe function.
 * Called whenever the count flips between 0 and >0 in either direction.
 */
export function subscribeToOpenContextMenus(handler: () => void): () => void {
  subscribers.add(handler);
  return () => {
    subscribers.delete(handler);
  };
}

/** Reset state. Used by tests; not for production code paths. */
export function __resetOpenContextMenusForTesting(): void {
  openCount = 0;
  subscribers.clear();
}
