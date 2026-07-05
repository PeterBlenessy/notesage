import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import {
  decrementCustomizePopoverOpen,
  decrementOpenContextMenus,
  forceCloseAllPeeks,
  incrementCustomizePopoverOpen,
  incrementOpenContextMenus,
} from "@/lib/sidebar-context-menu-state";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
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
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
} from "@/components/ui/popover";
import { tauriApi } from "@/lib/tauri";
import { useFileOperations } from "@/hooks/useFileOperations";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { useQuietSidebarStore } from "@/stores/quiet-sidebar-store";
import { useGitStore } from "@/stores/git-store";
import { useDiffReviewStore } from "@/stores/diff-review-store";
import { useProjectMetadataStore } from "@/stores/project-metadata-store";
import { useSettingsStore } from "@/stores/settings-store";
import { BranchComparePopover } from "@/components/git/BranchComparePopover";
import type { FileEntry } from "@/lib/tauri";
import { copyToClipboard } from "@/components/sidebar/quiet/sidebar-clipboard";
import { FolderAppearancePicker } from "@/components/FolderAppearancePicker";
import { isSystemFolderName } from "@/components/sidebar/quiet/ProjectsSection";

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

/**
 * Density override (live-test 2026-04-26): the shadcn primitive defaults
 * `ContextMenuItem` / `ContextMenuSubTrigger` / `ContextMenuLabel` to
 * `text-sm` (14px). The cmd-bar pickers (`src/components/cmd/modes/*`)
 * landed on `text-[13px]` for the same row class, and the sidebar
 * context menu felt loose against them. Override the text size only
 * inside this menu — don't touch the shared primitive.
 */
const ITEM_DENSITY = "text-[13px]";

/** Event name dispatched when the user clicks the Rename menu item. */
export const SIDEBAR_ENTER_RENAME_MODE_EVENT = "sidebar:enter-rename-mode";

/**
 * App-level CustomEvents dispatched by the menu (#128). `App.tsx` subscribes
 * and proxies to the file-operation handlers so we don't have to
 * prop-drill through QuietSidebar → each section → SidebarContextMenu.
 * Mirrors the approach already used by `SIDEBAR_ENTER_RENAME_MODE_EVENT`
 * above.
 */
export const SIDEBAR_MAKE_PROJECT_EVENT = "sidebar:make-project";
export const SIDEBAR_COMMIT_FILE_EVENT = "sidebar:commit-file";
export const SIDEBAR_EXPORT_FILE_EVENT = "sidebar:export-file";

const IMAGE_EXTENSIONS = /\.(jpe?g|png|gif|webp|bmp|svg)$/i;
const MARKDOWN_EXTENSIONS = /\.md$/i;

function isImageFilename(name: string): boolean {
  return IMAGE_EXTENSIONS.test(name);
}

function isMarkdownFilename(name: string): boolean {
  return MARKDOWN_EXTENSIONS.test(name);
}

/**
 * Walks up `filePath` against the open projects to find the owning project
 * root (if any). Used for the "Commit…" gate (only tracked if the owning
 * project is a git repo) and as the working-copy root for export/commit
 * handlers dispatched to App.tsx.
 */
function findOwningProject(filePath: string, projects: Array<{ path: string }>): string | null {
  // Longest match wins — sort descending so nested projects pick the
  // closest ancestor rather than a top-level workspace entry.
  const sorted = [...projects].sort((a, b) => b.path.length - a.path.length);
  for (const p of sorted) {
    if (filePath === p.path || filePath.startsWith(p.path + "/")) {
      return p.path;
    }
  }
  return null;
}

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
  const [customizeOpen, setCustomizeOpen] = useState(false);
  const [compareOpen, setCompareOpen] = useState(false);
  const { openFile, deletePath, refreshFileTree, renamePath } = useFileOperations();
  const pinnedFiles = useWorkspaceStore((s) => s.pinnedFiles);
  const pinFile = useWorkspaceStore((s) => s.pinFile);
  const unpinFile = useWorkspaceStore((s) => s.unpinFile);
  const projects = useWorkspaceStore((s) => s.projects);
  const removeProject = useWorkspaceStore((s) => s.removeProject);
  const explorerFolders = useWorkspaceStore((s) => s.explorerFolders);
  const notesTree = useWorkspaceStore((s) => s.notesTree);
  const setPendingCreate = useQuietSidebarStore((s) => s.setPendingCreate);
  const metadataMap = useProjectMetadataStore((s) => s.metadataMap);
  const notesRootPath = useSettingsStore((s) => s.notesRootPath);

  const name = basename(filePath);
  const isPinned = pinnedFiles.includes(filePath);
  const isFile = kind === "file";
  const isFolder = kind === "folder";
  const isProject = kind === "project";
  const isContainer = isFolder || isProject;
  const isImage = isFile && isImageFilename(name);
  const isMarkdown = isFile && isMarkdownFilename(name);
  // System folders (`.notesage`, `.git`, `.config`, etc.) shouldn't be
  // renamed, deleted, customized, or moved from inside the sidebar — they
  // carry app or repo state. Hide the mutating menu items so the user
  // can't accidentally break a project. Read-only items (Open / Reveal
  // in Finder / Copy path / Copy filename) stay available.
  const isSystemFolder = isFolder && isSystemFolderName(name);

  // Owning project is used for git-status gating + export working dir.
  // Projects themselves own themselves; files walk up to find their project.
  const owningProject = isProject
    ? filePath
    : findOwningProject(filePath, projects);
  const repoState = useGitStore((s) =>
    owningProject ? s.getRepo(owningProject) : null,
  );
  const isTrackedUnderGit = Boolean(
    repoState?.isGitRepo && repoState.fileStatusMap?.has(filePath),
  );

  // Branch diff review — container rows that ARE a detected git repo root
  // (populated once per root by `useGitRepoDetection`) get the
  // "Compare branch…" action; while a review is active the same slot shows
  // "End branch review". Gated on `settings.gitEnabled` like every other
  // git affordance.
  const gitEnabled = useSettingsStore((s) => s.gitEnabled);
  const rowRepo = useGitStore((s) =>
    isContainer ? s.repos[filePath] : undefined,
  );
  const isRepoRoot = Boolean(gitEnabled && rowRepo?.isGitRepo);
  const reviewActive = useDiffReviewStore((s) => s.reviewActive);

  // #135 — "Move to…" destinations: Quick Notes root + every project +
  // every explorer folder, deduped, with the row's own path filtered
  // out for directory rows so a folder can't be moved into itself.
  // Computed once per render — the destination list is small.
  const currentParent = filePath.slice(0, filePath.lastIndexOf("/"));
  const moveDestinations = useMemo(() => {
    type Destination = {
      path: string;
      label: string;
      category: "notes" | "project" | "folder";
      tree: FileEntry[];
    };
    const destinations: Destination[] = [];
    if (notesRootPath && !notesRootPath.startsWith("~")) {
      destinations.push({
        path: notesRootPath,
        label: "Quick Notes",
        category: "notes",
        tree: notesTree,
      });
    }
    for (const project of projects) {
      destinations.push({
        path: project.path,
        label:
          metadataMap[project.path]?.name ??
          project.path.split("/").filter(Boolean).pop() ??
          "Project",
        category: "project",
        tree: project.fileTree,
      });
    }
    for (const folder of explorerFolders) {
      destinations.push({
        path: folder.path,
        label:
          folder.path.split("/").filter(Boolean).pop() ?? "Folder",
        category: "folder",
        tree: folder.fileTree,
      });
    }
    const seen = new Set<string>();
    const unique = destinations.filter((d) => {
      if (seen.has(d.path)) return false;
      seen.add(d.path);
      return true;
    });
    // A directory can't host itself.
    return unique.filter((d) => !(isContainer && d.path === filePath));
  }, [
    notesRootPath,
    notesTree,
    projects,
    explorerFolders,
    metadataMap,
    isContainer,
    filePath,
  ]);
  const hasMoveDestinations = moveDestinations.length > 0;
  const hasMixedCategories =
    new Set(moveDestinations.map((d) => d.category)).size > 1;

  const handleMoveTo = async (destFolderPath: string) => {
    if (destFolderPath === currentParent) return;
    if (
      isContainer &&
      (destFolderPath === filePath ||
        destFolderPath.startsWith(filePath + "/"))
    ) {
      toast.error("Cannot move a folder into itself");
      return;
    }
    const destPath = `${destFolderPath}/${name}`;
    try {
      const exists = await tauriApi.pathExists(destPath);
      if (exists) {
        toast.error(
          `A file named "${name}" already exists in the destination`,
        );
        return;
      }
      await renamePath(filePath, destPath);
      toast.success(`Moved "${name}"`);
    } catch (error) {
      toast.error(`Failed to move: ${error}`);
    }
  };

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

  // #128 — New File under this row. Files route the create to their
  // parent directory; folders/projects route to themselves.
  const handleNewFile = () => {
    const parentDir = isContainer
      ? filePath
      : filePath.slice(0, filePath.lastIndexOf("/")) || filePath;
    setPendingCreate({ parentDir });
  };

  // #128 — New Folder. Creates the directory immediately + refreshes the
  // tree. Uses a deterministic default name "Untitled Folder" with numeric
  // suffixes until a non-colliding path is found; rename follows up via
  // inline-rename if the user wants a different name. Skips the
  // confirmation dialog.
  const handleNewFolder = async () => {
    if (!isContainer) return;
    try {
      let candidate = `${filePath}/Untitled Folder`;
      let counter = 2;
      for (let i = 0; i < 100; i++) {
        const exists = await tauriApi.pathExists(candidate);
        if (!exists) break;
        candidate = `${filePath}/Untitled Folder ${counter}`;
        counter++;
      }
      await tauriApi.createDirectory(candidate);
      await refreshFileTree(filePath);
      toast.success(`Created "${basename(candidate)}"`);
    } catch (error) {
      toast.error(`Failed to create folder: ${error}`);
    }
  };

  // "Make Project" / "Manage with Notesage" used to live here for sub-folder
  // rows. The action was removed from sub-folder rows in favour of putting
  // it only on TOP-LEVEL external folder rows (FoldersSection's inline menu)
  // — sub-folders inside an already-managed folder shouldn't be promoted
  // separately. The `SIDEBAR_MAKE_PROJECT_EVENT` constant stays exported
  // because FoldersSection dispatches it.

  // #128 — Add to chat. Image files only. Compresses the bytes
  // client-side and hands off to the vision event bus so the command
  // bar attaches the image (same handler `FileTreeItem` uses).
  const handleAddToChat = async () => {
    if (!isImage) return;
    try {
      const { compressImage } = await import("@/lib/image-compress");
      const { sendImageToChat } = await import("@/lib/ai/vision");
      const bytes = await tauriApi.readBinaryFile(filePath);
      const ext = name.split(".").pop()?.toLowerCase() ?? "";
      const mimeMap: Record<string, string> = {
        jpg: "image/jpeg",
        jpeg: "image/jpeg",
        png: "image/png",
        gif: "image/gif",
        webp: "image/webp",
        bmp: "image/bmp",
        svg: "image/svg+xml",
      };
      const blob = new Blob([new Uint8Array(bytes)], {
        type: mimeMap[ext] ?? "image/png",
      });
      const attachment = await compressImage(blob, { name });
      sendImageToChat(attachment);
      toast.success("Image added to chat");
    } catch (error) {
      toast.error(`Failed to add image to chat: ${error}`);
    }
  };

  // #128 — Commit… Dispatches to App.tsx; gated by isTrackedUnderGit so
  // we don't surface it on files outside any git repo.
  const handleCommitFile = () => {
    window.dispatchEvent(
      new CustomEvent(SIDEBAR_COMMIT_FILE_EVENT, { detail: { filePath } }),
    );
  };

  // #128 — Export as… (submenu PDF/DOCX/PPTX/HTML). Dispatches with the
  // requested format so App.tsx can drive the existing `handleExportFile`.
  const handleExport = (format: "pdf" | "docx" | "pptx" | "html") => {
    window.dispatchEvent(
      new CustomEvent(SIDEBAR_EXPORT_FILE_EVENT, {
        detail: { filePath, format },
      }),
    );
  };

  // Live-test 2026-04-25 — track this menu's open state via a module-
  // level counter so `FilePreview` / `FolderPeek` can pause their hover
  // open / close logic while a context menu is up. Two issues this
  // resolves:
  //   - Right-clicking a button INSIDE the FolderPeek preview opens the
  //     menu, then the cursor leaving the preview triggers the preview's
  //     close timer, which unmounts the Radix Root that lives inside the
  //     preview portal — taking the menu down with it.
  //   - React's synthetic `onMouseEnter` bubbles through the React tree
  //     (including portals). Cursor entering the menu portal fires
  //     `mouseenter` on FilePreview's trigger ancestor in React's view,
  //     and after 220 ms the preview pops up over the menu.
  // The shared flag breaks both chains by freezing preview state while
  // any sidebar context menu is open.
  const wasOpenRef = useRef(false);
  useEffect(() => {
    // Cleanup on unmount — if this menu was open when its parent unmounts
    // (e.g. a row being deleted while the menu is up), decrement the
    // count so FilePreview/FolderPeek don't get stuck in the "menu open"
    // state forever.
    return () => {
      if (wasOpenRef.current) {
        decrementOpenContextMenus();
        wasOpenRef.current = false;
      }
    };
  }, []);
  const handleOpenChange = useCallback((nextOpen: boolean) => {
    if (nextOpen && !wasOpenRef.current) {
      incrementOpenContextMenus();
      wasOpenRef.current = true;
    } else if (!nextOpen && wasOpenRef.current) {
      decrementOpenContextMenus();
      wasOpenRef.current = false;
    }
  }, []);

  // The customize popover is anchored to the row itself via <PopoverAnchor>,
  // so the picker floats next to the right-clicked folder. The previous
  // sr-only PopoverTrigger placed the anchor at an unpredictable 1×1 box in
  // the document tree — leaving the popover off-screen for some users.
  const contextMenuTree = (
    <ContextMenu onOpenChange={handleOpenChange}>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent className="min-w-[14rem]">
          {/* Live-test 2026-04-25 — `Open` only renders for files /
              folders. Projects already open by clicking the row;
              `Open` in the context menu was confusing because it
              implies something different from the row click and
              wasn't actually doing anything project-specific. */}
          {!isProject && (
            <ContextMenuItem className={ITEM_DENSITY} onSelect={() => void handleOpen()}>
              Open
            </ContextMenuItem>
          )}
          {!isSystemFolder && (
            <ContextMenuItem className={ITEM_DENSITY} onSelect={handleRename}>
              Rename
              <ContextMenuShortcut>F2</ContextMenuShortcut>
            </ContextMenuItem>
          )}

          {/* #128 — New File / New Folder for container rows. Files get the
             *  New-File-in-parent-dir convenience too.
             *  System folders (`.notesage`, `.git`, etc.) hide both — users
             *  shouldn't be creating files inside app/repo state directories.
             */}
          {!isSystemFolder && (
            <>
              <ContextMenuSeparator />
              <ContextMenuItem className={ITEM_DENSITY} onSelect={handleNewFile}>
                New File
              </ContextMenuItem>
              {isContainer && (
                <ContextMenuItem className={ITEM_DENSITY} onSelect={() => void handleNewFolder()}>
                  New Folder
                </ContextMenuItem>
              )}
            </>
          )}

          {/* "Manage with Notesage" was previously offered on sub-folder
             *  rows here too. Removed: promoting a sub-folder inside an
             *  already-managed folder creates a confusing nested entry
             *  in the sidebar and overlapping content scope. The action
             *  now lives only on TOP-LEVEL folder rows in FoldersSection. */}

          {/* #140 — Customize folder appearance (icon + color). Shown for
             *  folder and project rows only. Standard folders only — the
             *  structural locked/external types are not customizable because
             *  their icons convey security/permission state. System folders
             *  hide too — their icons represent app/repo state, not user choice. */}
          {isContainer && !isSystemFolder && (
            <>
              <ContextMenuSeparator />
              <ContextMenuItem
                className={ITEM_DENSITY}
                onSelect={() => {
                  // Let the context menu close as normal. The popover is a
                  // sibling (rendered outside <ContextMenu>) so its content
                  // survives the menu's unmount. Defer one frame so the menu
                  // close animation completes before the popover paints —
                  // otherwise the popover's overlay can race the menu and the
                  // menu briefly stacks on top.
                  requestAnimationFrame(() => setCustomizeOpen(true));
                }}
              >
                Customize…
              </ContextMenuItem>
            </>
          )}

          <ContextMenuSeparator />

          {/* Live-test 2026-04-25 — Duplicate and Pin only render for
              files. Projects can't be duplicated through this UI, and
              pinning a project doesn't fit the "pinned files" model.
              Previously these rendered as DISABLED items; the user
              found the disabled-but-visible state confusing — they
              read as "should work but is broken". Hiding entirely
              for projects per Apple's HIG. */}
          {isFile && (
            <>
              <ContextMenuItem className={ITEM_DENSITY} onSelect={() => void handleDuplicate()}>
                Duplicate
                <ContextMenuShortcut>⌘D</ContextMenuShortcut>
              </ContextMenuItem>
              <ContextMenuItem className={ITEM_DENSITY} onSelect={handleTogglePin}>
                {isPinned ? "Unpin" : "Pin"}
              </ContextMenuItem>
            </>
          )}

          {/* #128 — Add to chat. Image files only; hands off to the vision
             *  event bus so the command bar attaches the image. */}
          {isImage && (
            <ContextMenuItem className={ITEM_DENSITY} onSelect={() => void handleAddToChat()}>
              Add to chat
            </ContextMenuItem>
          )}

          {/* Live-test 2026-04-26 — gate this separator on `isFile`. The
              previous group (Duplicate / Pin / Add to chat) only renders
              for files; on project / folder rows it's empty and the
              earlier separator (after New Folder / Make Project) already
              divides things. Without this guard, projects render two
              `ContextMenuSeparator`s back-to-back. */}
          {isFile && <ContextMenuSeparator />}

          <ContextMenuItem className={ITEM_DENSITY} onSelect={() => void handleRevealInFinder()}>
            Reveal in Finder
            {/* Shortcut hint only on file rows. The global `⌘⌥R` chord
                (registered in `useGlobalShortcuts`) acts on the active
                document — file rows get the hint as a confirmation that
                the same chord works from the editor. Project / folder
                rows hide it because the chord ignores them. */}
            {isFile && <ContextMenuShortcut>⌘⌥R</ContextMenuShortcut>}
          </ContextMenuItem>
          <ContextMenuItem className={ITEM_DENSITY} onSelect={handleCopyPath}>
            Copy path
            {isFile && <ContextMenuShortcut>⌘⌥P</ContextMenuShortcut>}
          </ContextMenuItem>
          <ContextMenuItem className={ITEM_DENSITY} onSelect={handleCopyFilename}>
            Copy filename
          </ContextMenuItem>

          {/* #128 — Export as… Markdown files only. Submenu fans out
             *  into the four export formats. */}
          {isMarkdown && (
            <>
              <ContextMenuSeparator />
              <ContextMenuSub>
                <ContextMenuSubTrigger className={ITEM_DENSITY}>Export as…</ContextMenuSubTrigger>
                <ContextMenuSubContent>
                  <ContextMenuItem className={ITEM_DENSITY} onSelect={() => handleExport("pdf")}>
                    PDF
                  </ContextMenuItem>
                  <ContextMenuItem className={ITEM_DENSITY} onSelect={() => handleExport("docx")}>
                    Word (.docx)
                  </ContextMenuItem>
                  <ContextMenuItem className={ITEM_DENSITY} onSelect={() => handleExport("pptx")}>
                    PowerPoint
                  </ContextMenuItem>
                  <ContextMenuItem className={ITEM_DENSITY} onSelect={() => handleExport("html")}>
                    HTML
                  </ContextMenuItem>
                </ContextMenuSubContent>
              </ContextMenuSub>
            </>
          )}

          {/* #128 — Commit… Only surfaces for files tracked under a git
             *  repo we know about. App.tsx handles the actual commit flow
             *  (same dialog Layout uses). */}
          {isTrackedUnderGit && (
            <>
              <ContextMenuSeparator />
              <ContextMenuItem className={ITEM_DENSITY} onSelect={handleCommitFile}>
                Commit…
              </ContextMenuItem>
            </>
          )}

          {/* Branch diff review — repo-backed project / folder rows only.
             *  "Compare branch…" opens the anchored branch picker (a sibling
             *  Popover, same deferred-open pattern as Customize…); selecting
             *  a branch starts an inline diff review of current-branch vs
             *  picked-branch in the editor. While a review is active the
             *  slot flips to "End branch review". */}
          {isContainer && isRepoRoot && (
            <>
              <ContextMenuSeparator />
              {reviewActive ? (
                <ContextMenuItem
                  className={ITEM_DENSITY}
                  onSelect={() => useDiffReviewStore.getState().endReview()}
                >
                  End branch review
                </ContextMenuItem>
              ) : (
                <ContextMenuItem
                  className={ITEM_DENSITY}
                  onSelect={() => {
                    // Same deferred-open dance as Customize… — let the menu
                    // close animation finish before the popover paints.
                    requestAnimationFrame(() => setCompareOpen(true));
                  }}
                >
                  Compare branch…
                </ContextMenuItem>
              )}
            </>
          )}

          {/* Skip the separator + Move-to… / Move-to-trash / Remove block
              entirely for system folders — every item below this point is
              gated on `!isSystemFolder`, so the separator would orphan. */}
          {!isSystemFolder && <ContextMenuSeparator />}

          {/* #135 — Move to… submenu. Pulls every workspace root +
             *  explorer folder from the stores and offers them as
             *  destinations. Categorised when more than one category
             *  is present (Quick Notes / Projects / Folders). The
             *  current parent + the entry itself (if a folder) are
             *  filtered out to prevent no-op / illegal moves.
             *
             *  Live-test 2026-04-25 — projects cannot be moved through
             *  this menu; hide the submenu for `kind === "project"`. */}
          {!isProject && !isSystemFolder && hasMoveDestinations ? (
            <ContextMenuSub>
              <ContextMenuSubTrigger className={ITEM_DENSITY}>Move to…</ContextMenuSubTrigger>
              <ContextMenuSubContent>
                {hasMixedCategories ? (
                  <>
                    {moveDestinations.some((d) => d.category === "notes") && (
                      <>
                        <ContextMenuLabel className="text-xs text-muted-foreground">
                          QUICK NOTES
                        </ContextMenuLabel>
                        {moveDestinations
                          .filter((d) => d.category === "notes")
                          .map((d) => (
                            <ContextMenuItem
                              key={d.path}
                              className={ITEM_DENSITY}
                              disabled={d.path === currentParent}
                              onSelect={() => void handleMoveTo(d.path)}
                            >
                              {d.label}
                              {d.path === currentParent && (
                                <span className="ml-1 text-xs text-muted-foreground">
                                  (current)
                                </span>
                              )}
                            </ContextMenuItem>
                          ))}
                      </>
                    )}
                    {moveDestinations.some((d) => d.category === "project") && (
                      <>
                        <ContextMenuLabel className="text-xs text-muted-foreground">
                          PROJECTS
                        </ContextMenuLabel>
                        {moveDestinations
                          .filter((d) => d.category === "project")
                          .map((d) => (
                            <ContextMenuItem
                              key={d.path}
                              className={ITEM_DENSITY}
                              disabled={d.path === currentParent}
                              onSelect={() => void handleMoveTo(d.path)}
                            >
                              {d.label}
                              {d.path === currentParent && (
                                <span className="ml-1 text-xs text-muted-foreground">
                                  (current)
                                </span>
                              )}
                            </ContextMenuItem>
                          ))}
                      </>
                    )}
                    {moveDestinations.some((d) => d.category === "folder") && (
                      <>
                        <ContextMenuLabel className="text-xs text-muted-foreground">
                          FOLDERS
                        </ContextMenuLabel>
                        {moveDestinations
                          .filter((d) => d.category === "folder")
                          .map((d) => (
                            <ContextMenuItem
                              key={d.path}
                              className={ITEM_DENSITY}
                              disabled={d.path === currentParent}
                              onSelect={() => void handleMoveTo(d.path)}
                            >
                              {d.label}
                              {d.path === currentParent && (
                                <span className="ml-1 text-xs text-muted-foreground">
                                  (current)
                                </span>
                              )}
                            </ContextMenuItem>
                          ))}
                      </>
                    )}
                  </>
                ) : (
                  moveDestinations.map((d) => (
                    <ContextMenuItem
                      key={d.path}
                      className={ITEM_DENSITY}
                      disabled={d.path === currentParent}
                      onSelect={() => void handleMoveTo(d.path)}
                    >
                      {d.label}
                      {d.path === currentParent && (
                        <span className="ml-1 text-xs text-muted-foreground">
                          (current)
                        </span>
                      )}
                    </ContextMenuItem>
                  ))
                )}
              </ContextMenuSubContent>
            </ContextMenuSub>
          ) : !isSystemFolder ? (
            <ContextMenuItem className={ITEM_DENSITY} disabled>Move to…</ContextMenuItem>
          ) : null}
          {!isSystemFolder && !isProject && (
            <ContextMenuItem
              className={ITEM_DENSITY}
              variant="destructive"
              onSelect={() => setConfirmOpen(true)}
            >
              Move to trash
              <ContextMenuShortcut>⌘⌫</ContextMenuShortcut>
            </ContextMenuItem>
          )}
          {/* Notesage project rows get a "Remove from sidebar" entry instead
              of "Move to trash". The action is non-destructive — files stay
              on disk; the project is just unregistered from the workspace.
              Same outcome as the explorer-folder menu's Remove entry, so
              the user only keeps the projects they actively work on open. */}
          {isProject && (
            <ContextMenuItem
              className={ITEM_DENSITY}
              onSelect={() => {
                const meta =
                  useProjectMetadataStore.getState().getMetadata(filePath);
                const projectName =
                  meta?.name || filePath.split("/").filter(Boolean).pop() || filePath;
                removeProject(filePath, projectName);
              }}
            >
              Remove from sidebar
            </ContextMenuItem>
          )}
        </ContextMenuContent>
      </ContextMenu>
  );

  // While the customize popover is open, set the shared flags so
  // FolderPeek hover-handlers and the QuietSidebar type-to-filter bail.
  //
  // Driven by `customizeOpen` (state) instead of Radix's `onOpenChange`.
  // Radix's controlled Popover does NOT fire `onOpenChange` when the
  // parent flips the `open` prop externally — only on user-initiated
  // dismissals (Esc, click outside). Our menu-item `onSelect` flips
  // customizeOpen via setState, so a callback hooked to onOpenChange
  // would silently miss the open transition. The useEffect on
  // customizeOpen catches every transition (open and close) regardless
  // of cause.
  useEffect(() => {
    if (!customizeOpen) return;
    forceCloseAllPeeks();
    incrementOpenContextMenus();
    incrementCustomizePopoverOpen();
    return () => {
      decrementOpenContextMenus();
      decrementCustomizePopoverOpen();
    };
  }, [customizeOpen]);

  // Same freeze for the branch-compare popover — its CommandInput must not
  // feed the sidebar type-to-filter, and FolderPeek must not pop over it.
  useEffect(() => {
    if (!compareOpen) return;
    forceCloseAllPeeks();
    incrementOpenContextMenus();
    incrementCustomizePopoverOpen();
    return () => {
      decrementOpenContextMenus();
      decrementCustomizePopoverOpen();
    };
  }, [compareOpen]);

  return (
    <>
      {isContainer ? (
        <Popover open={customizeOpen} onOpenChange={setCustomizeOpen}>
          <PopoverAnchor asChild>
            <span className="block">
              {/* Branch-compare picker is anchored to the same row. It only
                  renders content while open, so nesting the two anchors is
                  free for every other row interaction. */}
              <BranchComparePopover
                repoPath={filePath}
                open={compareOpen}
                onOpenChange={setCompareOpen}
              >
                {contextMenuTree}
              </BranchComparePopover>
            </span>
          </PopoverAnchor>
          <PopoverContent
            side="right"
            align="start"
            sideOffset={4}
            className="p-0 w-auto"
            // React synthetic events bubble through the REACT tree, even
            // across portals. PopoverContent is React-tree-inside `<Popover>`,
            // which is inside the QuietSidebar `<nav>`'s onKeyDown / inside
            // FolderPeek's onMouseEnter. Without these stoppers, typing in
            // the popover lands in the sidebar's type-to-filter, and
            // mouse-over the popover fires FolderPeek's hover-open. Stop
            // propagation at the popover boundary.
            onKeyDown={(e) => e.stopPropagation()}
            onMouseEnter={(e) => e.stopPropagation()}
            onMouseLeave={(e) => e.stopPropagation()}
            onMouseOver={(e) => e.stopPropagation()}
          >
            <FolderAppearancePicker
              folderPath={filePath}
              folderType="standard"
              isProject={isProject}
              onClose={() => setCustomizeOpen(false)}
            />
          </PopoverContent>
        </Popover>
      ) : (
        contextMenuTree
      )}

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
