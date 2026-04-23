import { useState, type ReactNode } from "react";
import { toast } from "sonner";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { tauriApi } from "@/lib/tauri";
import { useFileOperations } from "@/hooks/useFileOperations";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { copyToClipboard } from "@/components/sidebar/quiet/sidebar-clipboard";

/**
 * SidebarContextMenu — shared right-click menu for sidebar file rows (task #45).
 *
 * Wraps arbitrary trigger children in a shadcn `ContextMenu` and renders a
 * consistent action set: Open / Rename / Duplicate / Pin / Reveal / Copy path /
 * Copy filename / Move to… / Move to trash. Presentational wrapper — it reads
 * the workspace store for pin state and calls `useFileOperations` for IO.
 *
 * Rename (#40) is stubbed: clicking Rename dispatches a
 * `sidebar:enter-rename-mode` custom event with the filePath as detail so the
 * row wiring can be landed independently. Move to… is rendered disabled until
 * a follow-up task wires it.
 *
 * Keyboard shortcuts shown in `ContextMenuShortcut` are visual only — the
 * actual row-level shortcuts will be wired in row components (not this menu).
 */

/** Event name dispatched when the user clicks the Rename menu item. */
export const SIDEBAR_ENTER_RENAME_MODE_EVENT = "sidebar:enter-rename-mode";

export interface SidebarContextMenuProps {
  /** Absolute path of the sidebar item. */
  filePath: string;
  /** What kind of row is wrapped — controls which actions are enabled. */
  kind: "file" | "folder" | "project";
  /** The trigger element (usually the sidebar row itself). */
  children: ReactNode;
  /**
   * Optional override for the Open action. When omitted, the fallback is
   * `useFileOperations.openFile(filePath, basename(filePath))`.
   */
  onOpen?: () => void;
}

function basename(path: string): string {
  return path.split("/").filter(Boolean).pop() ?? path;
}

function extension(name: string): { stem: string; ext: string } {
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return { stem: name, ext: "" };
  return { stem: name.slice(0, dot), ext: name.slice(dot) };
}

export function SidebarContextMenu({
  filePath,
  kind,
  children,
  onOpen,
}: SidebarContextMenuProps) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const { openFile, deletePath } = useFileOperations();
  const pinnedFiles = useWorkspaceStore((s) => s.pinnedFiles);
  const pinFile = useWorkspaceStore((s) => s.pinFile);
  const unpinFile = useWorkspaceStore((s) => s.unpinFile);

  const name = basename(filePath);
  const isPinned = pinnedFiles.includes(filePath);
  const isFile = kind === "file";

  const handleOpen = async () => {
    if (onOpen) {
      onOpen();
      return;
    }
    try {
      await openFile(filePath, name);
    } catch (error) {
      toast.error(`Failed to open: ${error}`);
    }
  };

  const handleRename = () => {
    // Task #40 wires the actual rename flow. We dispatch a DOM CustomEvent so
    // a row-level listener can pick it up without this component knowing about
    // the row's internal rename state.
    window.dispatchEvent(
      new CustomEvent(SIDEBAR_ENTER_RENAME_MODE_EVENT, {
        detail: { filePath },
      }),
    );
  };

  const handleDuplicate = async () => {
    // Only files are supported in this pass; folders/projects are disabled.
    if (!isFile) return;
    try {
      const parent = filePath.slice(0, filePath.lastIndexOf("/"));
      const { stem, ext } = extension(name);

      // Find a non-colliding "<stem> copy.<ext>" / "<stem> copy N.<ext>" path.
      let candidate = `${parent}/${stem} copy${ext}`;
      let counter = 2;
      // Limit retries to avoid pathological loops if path_exists misbehaves.
      // 100 copies is more than enough for any realistic workflow.
      for (let i = 0; i < 100; i++) {
        const exists = await tauriApi.pathExists(candidate);
        if (!exists) break;
        candidate = `${parent}/${stem} copy ${counter}${ext}`;
        counter++;
      }

      const content = await tauriApi.readFile(filePath);
      await tauriApi.writeFile(candidate, content);
      toast.success(`Duplicated to ${basename(candidate)}`);
    } catch (error) {
      toast.error(`Failed to duplicate: ${error}`);
    }
  };

  const handleTogglePin = () => {
    if (!isFile) return;
    if (isPinned) {
      unpinFile(filePath);
    } else {
      pinFile(filePath);
    }
  };

  const handleRevealInFinder = async () => {
    try {
      await tauriApi.revealInFinder(filePath);
    } catch (error) {
      toast.error(`Failed to reveal: ${error}`);
    }
  };

  const handleCopyPath = () => {
    void copyToClipboard(filePath, "Path copied");
  };

  const handleCopyFilename = () => {
    void copyToClipboard(name, "Filename copied");
  };

  const handleDeleteConfirm = async () => {
    setConfirmOpen(false);
    try {
      await deletePath(filePath);
      toast.success(`Moved "${name}" to trash`);
    } catch (error) {
      toast.error(`Failed to delete: ${error}`);
    }
  };

  return (
    <>
      <ContextMenu>
        <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
        <ContextMenuContent className="min-w-[14rem]">
          <ContextMenuItem onSelect={() => void handleOpen()}>
            Open
          </ContextMenuItem>
          <ContextMenuItem onSelect={handleRename}>
            Rename
            <ContextMenuShortcut>F2</ContextMenuShortcut>
          </ContextMenuItem>

          <ContextMenuSeparator />

          <ContextMenuItem
            onSelect={() => void handleDuplicate()}
            disabled={!isFile}
          >
            Duplicate
            <ContextMenuShortcut>⌘D</ContextMenuShortcut>
          </ContextMenuItem>
          <ContextMenuItem onSelect={handleTogglePin} disabled={!isFile}>
            {isPinned ? "Unpin" : "Pin"}
          </ContextMenuItem>

          <ContextMenuSeparator />

          <ContextMenuItem onSelect={() => void handleRevealInFinder()}>
            Reveal in Finder
            <ContextMenuShortcut>⌘⌥R</ContextMenuShortcut>
          </ContextMenuItem>
          <ContextMenuItem onSelect={handleCopyPath}>
            Copy path
            <ContextMenuShortcut>⌘⌥C</ContextMenuShortcut>
          </ContextMenuItem>
          <ContextMenuItem onSelect={handleCopyFilename}>
            Copy filename
          </ContextMenuItem>

          <ContextMenuSeparator />

          <ContextMenuItem disabled title="Coming soon">
            Move to…
          </ContextMenuItem>
          <ContextMenuItem
            variant="destructive"
            onSelect={() => setConfirmOpen(true)}
          >
            Move to trash
            <ContextMenuShortcut>⌘⌫</ContextMenuShortcut>
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Move to trash?</AlertDialogTitle>
            <AlertDialogDescription>
              &quot;{name}&quot; will be moved to the trash. You can restore it
              from the system trash until it is emptied.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => void handleDeleteConfirm()}
            >
              Move to trash
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
