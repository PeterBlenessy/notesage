/**
 * HTML5 drag-and-drop helpers for the quiet-composer sidebar (task #44).
 *
 * A single MIME type — `application/x-notesage-file` — identifies drags that
 * originate from a Notesage sidebar row and carry a single absolute file
 * path. Drop targets check `dataTransfer.types` to reject unrelated drags
 * (e.g., files dragged from Finder), so the payload surface stays narrow.
 */

import type { DragEvent as ReactDragEvent } from "react";

/**
 * Custom MIME type used for all file-row drags in the sidebar. The suffix
 * `notesage-file` makes the purpose obvious in devtools.
 */
export const FILE_DRAG_MIME = "application/x-notesage-file";
/** A multi-file selection (the Inbox drags its whole selection) — JSON array of paths. */
export const FILE_DRAG_PATHS_MIME = "application/x-notesage-inbox-paths";

/**
 * Is this a drag of Inbox items (the selection payload)? Project rows accept
 * only these: a Recent or Pinned row carries the single-file payload alone,
 * and dropping one of those on a project would silently MOVE a file that
 * already lives somewhere else.
 */
export function hasInboxDrag(event: { dataTransfer: DataTransfer }): boolean {
  return event.dataTransfer.types.includes(FILE_DRAG_PATHS_MIME);
}

/**
 * Every path a drop carries: the selection payload when present, else the
 * single-file payload. Always at least the single file, so a drop target
 * written against `FILE_DRAG_MIME` keeps working.
 */
export function droppedFilePaths(event: { dataTransfer: DataTransfer }): string[] {
  const single = event.dataTransfer.getData(FILE_DRAG_MIME);
  const many = event.dataTransfer.getData(FILE_DRAG_PATHS_MIME);
  if (many) {
    try {
      const parsed: unknown = JSON.parse(many);
      if (Array.isArray(parsed) && parsed.every((p) => typeof p === "string") && parsed.length > 0) {
        return parsed as string[];
      }
    } catch {
      // fall through to the single payload
    }
  }
  return single ? [single] : [];
}

/**
 * Stamps the drag event with the file path under `FILE_DRAG_MIME` and sets
 * `effectAllowed` so the browser paints the correct cursor (move for
 * reorder, copyMove for cross-section pin).
 */
export function beginFileDrag(
  event: ReactDragEvent<HTMLElement>,
  path: string,
): void {
  event.dataTransfer.effectAllowed = "copyMove";
  event.dataTransfer.setData(FILE_DRAG_MIME, path);
}

/**
 * True when the drag currently hovering a drop target carries our file MIME
 * — guards against Finder files and cross-app drags reaching our handlers.
 */
export function hasFileDrag(event: ReactDragEvent<HTMLElement>): boolean {
  return event.dataTransfer.types.includes(FILE_DRAG_MIME);
}

/**
 * Compute the final `to` index for `reorderPinnedFiles(from, to)` given an
 * intent expressed as "insert relative to row `rowIndex`, above or below
 * its midpoint." Returns `null` when the move would be a no-op (element
 * already lives at the target position).
 *
 * The store's reorder semantics are: splice remove at `from`, splice insert
 * at `to` in the post-removal array. So when `from < intendedTarget`, the
 * removal shifts `intendedTarget` down by 1.
 */
export function computeReorderTarget(
  from: number,
  rowIndex: number,
  insertAfter: boolean,
): number | null {
  const intendedTarget = insertAfter ? rowIndex + 1 : rowIndex;
  const to = from < intendedTarget ? intendedTarget - 1 : intendedTarget;
  if (to === from) return null;
  return to;
}

/**
 * True when the pointer sits below the vertical midpoint of the row — used
 * by the Pinned drop handlers to pick "insert before" vs. "insert after."
 */
export function isBelowMidpoint(
  event: ReactDragEvent<HTMLElement>,
  row: HTMLElement,
): boolean {
  const rect = row.getBoundingClientRect();
  return event.clientY > rect.top + rect.height / 2;
}
