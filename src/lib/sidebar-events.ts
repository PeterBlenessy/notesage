/**
 * Tiny pub/sub event bus for coordinating the QuietSidebar's inline-expand
 * affordance.
 *
 * Mirrors the shape of `cmd-bar-events.ts`. Created as the foundation for
 * sidebar-simplification task #6 (FolderPeek rewire) — the hover-peek
 * popover dispatches an `expand-path` event to ask the parent
 * ProjectsSection (or future FoldersSection) to inline-expand to the
 * clicked subfolder.
 *
 * The bus exists so peripheral surfaces (FolderPeek, future right-click
 * menu actions, future drag-drop targets) can drive the sidebar without
 * coupling them to the section component's local state via React context.
 */

export type SidebarEvent = {
  type: 'expand-path';
  /**
   * Absolute path of the project (or future explorer-folder) root that
   * owns the target. The receiving section uses this to find the right
   * row to expand.
   */
  projectPath: string;
  /**
   * Absolute path inside the project that the user wants to reveal.
   * Today (sidebar #6) the receiver expands the project root and focuses
   * the matching first-level child. Future (sidebar #20+ multi-level
   * inline expand) will walk the path expanding each ancestor.
   */
  targetPath: string;
};

type Handler = (event: SidebarEvent) => void;

const handlers = new Set<Handler>();

/** Notify every subscriber of a sidebar event. */
export function emitSidebarEvent(event: SidebarEvent): void {
  // Snapshot to a copy so handlers that unsubscribe themselves mid-emit
  // don't disturb the iteration order.
  for (const handler of [...handlers]) {
    handler(event);
  }
}

/**
 * Subscribe to sidebar events. Returns an unsubscribe function. Multiple
 * subscribers are fine — every handler receives every event.
 */
export function subscribeToSidebarEvents(handler: Handler): () => void {
  handlers.add(handler);
  return () => {
    handlers.delete(handler);
  };
}
