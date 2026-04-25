import { toast } from "sonner";

/**
 * Shared clipboard helper for the quiet-composer sidebar (tasks #45, #46).
 *
 * Writes text to the system clipboard. Used by `SidebarContextMenu`
 * (right-click menu) and `useSidebarItemShortcuts` (⌘⌥C keyboard shortcut)
 * so both paths show the same toast text — the affordance should feel
 * identical whether the user invoked it via menu or keyboard.
 *
 * Live-test 2026-04-25 — iCloud paths contain `~apple~` (e.g.
 * `/Users/.../com~apple~CloudDocs/...`). When the path was copied as
 * plain text and the user pasted it into the editor, Tiptap's Subscript
 * mark (configured to parse `~text~` as `<sub>text</sub>`) rendered
 * `apple` as subscript. The fix: write the path as BOTH `text/plain`
 * (so terminals / shells / file dialogs get the literal path) AND
 * `text/html` with the path wrapped in a `<span>` (so the editor's
 * paste handler uses the HTML branch, which Tiptap renders without
 * running markdown-it on it — tildes stay literal). Falls back to
 * `writeText` when `ClipboardItem` isn't available (older WebKit).
 */
export async function copyToClipboard(text: string, label: string): Promise<void> {
  try {
    if (typeof ClipboardItem !== "undefined" && navigator.clipboard?.write) {
      const escaped = text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
      const item = new ClipboardItem({
        "text/plain": new Blob([text], { type: "text/plain" }),
        "text/html": new Blob([`<span>${escaped}</span>`], { type: "text/html" }),
      });
      await navigator.clipboard.write([item]);
    } else {
      await navigator.clipboard.writeText(text);
    }
    toast.success(label);
  } catch (error) {
    toast.error(`Failed to copy: ${error}`);
  }
}
