import { useCallback, useState } from "react";
import type { DragEvent } from "react";
import { toast } from "sonner";

import { useFileOperations } from "@/hooks/useFileOperations";
import { useInboxActions } from "@/components/inbox/useInboxActions";
import { tauriApi } from "@/lib/tauri";
import { droppedMovablePaths, hasFileDrag, hasFolderDrag, hasInboxDrag } from "./file-drag";

/** Basename of a path, with no trailing-slash surprises. */
function basename(path: string): string {
  return path.replace(/\/+$/, "").split("/").pop() ?? path;
}

/** Parent directory of a path. */
function parentOf(path: string): string {
  const trimmed = path.replace(/\/+$/, "");
  return trimmed.slice(0, trimmed.lastIndexOf("/"));
}

/**
 * Move dropped paths into a folder.
 *
 * Shared by every folder row in the sidebar, because until now only ONE row
 * kind accepted a drop at all — a top-level project — and it accepted only
 * Inbox drags. A file in a project sub-folder could be picked up and had
 * nowhere to land; the "Move to…" menu offered roots only. So a file could be
 * moved out of the Inbox and never between two folders.
 *
 * Everything routes through `renamePath`, which is the app's one move
 * primitive and now carries the tab/pin/recent bookkeeping with it.
 */
export function useMoveIntoFolder(): (
  paths: string[],
  destFolder: string,
  opts?: { fromInbox?: boolean },
) => Promise<void> {
  const { renamePath } = useFileOperations();
  const { fileTo } = useInboxActions();
  return useCallback(
    async (paths: string[], destFolder: string, opts?: { fromInbox?: boolean }) => {
      // An Inbox drag is not a plain move and must not become one. `fileTo`
      // carries the item's reading progress into the destination's own
      // sidecar, dedupes the name the way the phone does, evicts the
      // thumbnail and retires the row from the Inbox list — none of which a
      // rename does. Routing every drop through the generic path silently
      // dropped all of it, which is why this branch exists rather than one
      // tidy code path.
      if (opts?.fromInbox) {
        await fileTo(paths, destFolder);
        return;
      }
      let moved = 0;
      let skipped = 0;
      for (const path of paths) {
        // Already there — not a failure, just nothing to do.
        if (parentOf(path) === destFolder) continue;
        // A folder cannot host itself or anything inside it.
        if (destFolder === path || destFolder.startsWith(`${path}/`)) {
          toast.error(`Cannot move "${basename(path)}" into itself`);
          skipped += 1;
          continue;
        }
        const dest = `${destFolder}/${basename(path)}`;
        try {
          if (await tauriApi.pathExists(dest)) {
            toast.error(
              `"${basename(path)}" already exists in ${basename(destFolder)}`,
            );
            skipped += 1;
            continue;
          }
          await renamePath(path, dest);
          moved += 1;
        } catch (error) {
          toast.error(`Failed to move "${basename(path)}": ${String(error)}`);
          skipped += 1;
        }
      }
      // One summary for a multi-file drop; silence when a drop was a no-op, so
      // dropping a row back where it came from says nothing rather than
      // claiming success.
      if (moved === 1 && skipped === 0) {
        toast.success(`Moved to ${basename(destFolder)}`);
      } else if (moved > 1) {
        toast.success(`Moved ${moved} items to ${basename(destFolder)}`);
      }
    },
    [renamePath, fileTo],
  );
}

/**
 * Drop-target props for a folder row.
 *
 * Accepts BOTH payloads: the Inbox's multi-path selection and the single-file
 * payload every other sidebar row carries. `file-drag.ts` used to warn that
 * accepting the single-file payload on a project would "silently MOVE a file
 * that already lives somewhere else" — which was right while moving was not a
 * thing you could do here. Now that dropping on a folder means exactly that,
 * it is the gesture rather than a side effect, and the guard would only block
 * the thing the drag is for.
 */
export function useFolderDropTarget(
  destFolder: string | undefined,
  moveInto: (
    paths: string[],
    destFolder: string,
    opts?: { fromInbox?: boolean },
  ) => Promise<void>,
  enabled = true,
): {
  dropActive: boolean;
  dragOver: (e: DragEvent<HTMLElement>) => void;
  dragLeave: (e: DragEvent<HTMLElement>) => void;
  drop: (e: DragEvent<HTMLElement>) => void;
} {
  const [dropActive, setDropActive] = useState(false);
  const accepts = (e: DragEvent<HTMLElement>): boolean =>
    Boolean(enabled && destFolder) &&
    (hasFileDrag(e) || hasInboxDrag(e) || hasFolderDrag(e));

  const dragOver = (event: DragEvent<HTMLElement>) => {
    if (!accepts(event)) return;
    event.preventDefault();
    // Stop the row's own ancestors claiming the same drop — a child row sits
    // inside the project row that also accepts drops, and the innermost
    // folder is the one the cursor is actually over.
    event.stopPropagation();
    event.dataTransfer.dropEffect = "move";
    setDropActive(true);
  };

  const dragLeave = (event: DragEvent<HTMLElement>) => {
    const next = event.relatedTarget as Node | null;
    if (next && event.currentTarget.contains(next)) return;
    setDropActive(false);
  };

  const drop = (event: DragEvent<HTMLElement>) => {
    if (!accepts(event) || !destFolder) return;
    event.preventDefault();
    event.stopPropagation();
    setDropActive(false);
    const fromInbox = hasInboxDrag(event);
    const paths = droppedMovablePaths(event);
    // `void` alone leaves a rejection unhandled. `moveInto` reports every
    // failure it can name with a toast, so anything arriving here is one it
    // could not — a missing command, a backend that went away. Unhandled,
    // that is a console error in the app, and in CI it fails the run while
    // every test still reports as passed.
    if (paths.length > 0) {
      void moveInto(paths, destFolder, { fromInbox }).catch((error: unknown) => {
        console.error("[sidebar] move failed:", error);
      });
    }
  };

  return { dropActive, dragOver, dragLeave, drop };
}
