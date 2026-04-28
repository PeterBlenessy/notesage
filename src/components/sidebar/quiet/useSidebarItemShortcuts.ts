import { useCallback, type KeyboardEvent } from "react";
import { toast } from "sonner";

import { tauriApi } from "@/lib/tauri";
import { copyToClipboard } from "@/components/sidebar/quiet/sidebar-clipboard";

/**
 * Dispatch a synthetic `contextmenu` event on the given element so Radix's
 * ContextMenu opens from a keyboard action (#80). The macOS Menu key and
 * Shift+F10 both map to `KeyboardEvent.key === "ContextMenu"`; we also wire
 * ⌘⇧, as a fallback that users can press without a dedicated key.
 *
 * The event is bubbling + cancelable so Radix's listener on the
 * ContextMenuTrigger picks it up. `button: 2` mirrors the right-click path.
 */
export function openContextMenuOnElement(element: HTMLElement): void {
  const rect = element.getBoundingClientRect();
  // Center-ish point inside the row — gives Radix a sensible anchor for the
  // popover, avoiding a 0,0 origin that would drift into the viewport corner.
  const clientX = rect.left + Math.min(rect.width / 2, 32);
  const clientY = rect.top + rect.height / 2;
  const ev = new MouseEvent("contextmenu", {
    bubbles: true,
    cancelable: true,
    button: 2,
    clientX,
    clientY,
  });
  element.dispatchEvent(ev);
}

/**
 * True when the event represents an "open the context menu" keyboard gesture:
 *
 *   - `KeyboardEvent.key === "ContextMenu"` — the macOS Menu key and the
 *     Windows Application key surface as this. Shift+F10 also reports
 *     `key === "ContextMenu"` in most browsers.
 *   - `⌘⇧,` / `Ctrl+Shift+,` — user-pressable fallback that doesn't require
 *     a dedicated key. Matches `metaKey || ctrlKey` to stay consistent with
 *     the rest of the sidebar's key handling.
 *
 * Cross-keyboard layout safety: `event.key` reports the produced
 * character, which depends on the user's keyboard layout. On Swedish
 * (and many European) layouts `Shift+,` produces `;`, not `,`, so
 * checking `event.key === ","` alone misses the chord. We also check
 * `event.code === "Comma"` which reports the physical key position
 * regardless of layout. The OR keeps the helper layout-tolerant —
 * neither check fights the other. See `docs/keyboard-shortcuts.md`
 * "Cross-keyboard layout safety" for the project rule.
 */
export function isContextMenuKey(event: KeyboardEvent<HTMLElement>): boolean {
  if (event.key === "ContextMenu") return true;
  const mod = event.metaKey || event.ctrlKey;
  if (mod && event.shiftKey && (event.key === "," || event.code === "Comma")) {
    return true;
  }
  return false;
}

/**
 * useSidebarItemShortcuts — row-level keyboard shortcuts for the quiet-
 * composer sidebar (task #46).
 *
 * Returns an `onKeyDown` handler that reacts to two combos while a sidebar
 * row has focus:
 *
 *   ⌘⌥C (or Ctrl+Alt+C) → Copy absolute path to clipboard + toast
 *   ⌘⌥R (or Ctrl+Alt+R) → Reveal in Finder + error toast on failure
 *
 * The handler accepts `metaKey || ctrlKey` to match the rest of the app's
 * keymap (`useKeyboardShortcuts`, `useEditorKeyBindings`), so the same
 * shortcut works on macOS (Cmd) and non-macOS (Ctrl). The codebase is
 * currently macOS-only but this keeps the door open for Windows/Linux
 * WebView targets without a platform check.
 *
 * Other keys are ignored — `preventDefault` / `stopPropagation` are only
 * called when we actually handle a combo so the row's existing handlers
 * (Enter/Space to open) keep working. The hook is expected to be *chained*
 * with an existing `onKeyDown`: call sites should run this handler first
 * and fall through to their own handler when `event.defaultPrevented` is
 * still `false`.
 */
export interface UseSidebarItemShortcutsOptions {
  /** Absolute path shown to the user when copying or revealing. */
  filePath: string;
  /**
   * Kind of row. Currently only affects the toast label ("Path copied" is
   * the same wording the right-click menu uses for files, folders, and
   * projects). Accepted values mirror `SidebarContextMenuProps.kind` so
   * future per-kind divergence (e.g. projects copy the folder path) is a
   * drop-in change.
   */
  kind: "file" | "folder" | "project";
}

export interface UseSidebarItemShortcutsResult {
  /**
   * Handler to spread onto the row. Mark the event as handled via
   * `event.preventDefault()` so chained handlers can short-circuit on
   * `event.defaultPrevented`.
   */
  onKeyDown: (event: KeyboardEvent<HTMLElement>) => void;
}

export function useSidebarItemShortcuts(
  options: UseSidebarItemShortcutsOptions,
): UseSidebarItemShortcutsResult {
  const { filePath } = options;

  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLElement>) => {
      // Accept Cmd (macOS) OR Ctrl (non-macOS) + Alt + letter. Match the
      // rest of the app's `metaKey || ctrlKey` convention.
      const mod = event.metaKey || event.ctrlKey;
      if (!mod || !event.altKey) return;

      const key = event.key.toLowerCase();

      if (key === "c") {
        event.preventDefault();
        event.stopPropagation();
        void copyToClipboard(filePath, "Path copied");
        return;
      }

      if (key === "r") {
        event.preventDefault();
        event.stopPropagation();
        void (async () => {
          try {
            await tauriApi.revealInFinder(filePath);
          } catch (error) {
            toast.error(`Failed to reveal: ${error}`);
          }
        })();
        return;
      }
    },
    [filePath],
  );

  return { onKeyDown };
}

/**
 * Small helper for composing multiple React keyboard handlers on a single
 * element. Each handler is invoked in order; if an earlier handler calls
 * `event.preventDefault()` the remaining handlers are skipped so they
 * don't double-act on the same keystroke.
 *
 * Exported so row components can chain the shortcut handler with their
 * existing Enter/Space open handler:
 *
 * ```tsx
 * const { onKeyDown: shortcuts } = useSidebarItemShortcuts({ filePath, kind });
 * const onKeyDown = chainKeyHandlers(shortcuts, (e) => {
 *   if (e.key === "Enter") openFile();
 * });
 * ```
 */
export function chainKeyHandlers<E extends KeyboardEvent<HTMLElement>>(
  ...handlers: Array<((event: E) => void) | undefined>
): (event: E) => void {
  return (event: E) => {
    for (const handler of handlers) {
      if (!handler) continue;
      handler(event);
      if (event.defaultPrevented) return;
    }
  };
}
