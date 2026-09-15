import type { DragEvent } from "react";
import type { FileEntry } from "@/lib/tauri";
import { beginFileDrag, beginFolderDrag } from "./file-drag";

/**
 * Returns drag event props for a ProjectsSection child row.
 *
 * Files are draggable into the Pinned section (#44) and, since folder rows
 * became drop targets, into any folder.
 *
 * Directories are draggable too now. They were not, which made the sidebar
 * asymmetric in a way nobody could explain: a folder could receive a file but
 * could not be moved itself. Dropping a folder into its own descendant is
 * refused at the drop, not here — `useFolderDrop` already has the path to
 * compare against, and a drag that cannot start gives no feedback at all.
 *
 * The renaming state still suppresses drag: a dragging rename loses the input.
 */
export function useProjectRowDrag(
  entry: FileEntry | undefined,
  isRenaming: boolean,
): {
  draggable: boolean;
  onDragStart: ((e: DragEvent<HTMLDivElement>) => void) | undefined;
} {
  const draggable = !!entry && !isRenaming;
  const onDragStart =
    draggable && entry
      ? (e: DragEvent<HTMLDivElement>) =>
          entry.is_directory
            ? beginFolderDrag(e, entry.path)
            : beginFileDrag(e, entry.path)
      : undefined;
  return { draggable, onDragStart };
}
