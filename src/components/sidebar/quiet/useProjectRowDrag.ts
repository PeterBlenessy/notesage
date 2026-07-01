import type { DragEvent } from "react";
import type { FileEntry } from "@/lib/tauri";
import { beginFileDrag } from "./file-drag";

/**
 * Returns drag event props for a ProjectsSection child row.
 *
 * Files are draggable into the Pinned section (#44). Directories and the
 * renaming state both suppress drag — a dragging rename would lose the input.
 */
export function useProjectRowDrag(
  entry: FileEntry | undefined,
  isRenaming: boolean,
): {
  draggable: boolean;
  onDragStart: ((e: DragEvent<HTMLDivElement>) => void) | undefined;
} {
  const draggable = !!entry && !entry.is_directory && !isRenaming;
  const onDragStart =
    draggable && entry
      ? (e: DragEvent<HTMLDivElement>) => beginFileDrag(e, entry.path)
      : undefined;
  return { draggable, onDragStart };
}
