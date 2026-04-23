import { toast } from "sonner";

/**
 * Shared clipboard helper for the quiet-composer sidebar (tasks #45, #46).
 *
 * Writes text to the system clipboard via `navigator.clipboard.writeText` and
 * surfaces a sonner toast on success (the provided label) or failure
 * ("Failed to copy: …"). Used by `SidebarContextMenu` (right-click menu) and
 * `useSidebarItemShortcuts` (⌘⌥C keyboard shortcut) so both paths show the
 * same toast text — the affordance should feel identical whether the user
 * invoked it via menu or keyboard.
 */
export async function copyToClipboard(text: string, label: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(label);
  } catch (error) {
    toast.error(`Failed to copy: ${error}`);
  }
}
