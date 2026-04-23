import { useCallback, type KeyboardEvent } from "react";
import { toast } from "sonner";

import { tauriApi } from "@/lib/tauri";
import { copyToClipboard } from "@/components/sidebar/quiet/sidebar-clipboard";

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
