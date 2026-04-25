import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { Folder } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";
import { useEditorStore } from "@/stores/editor-store";
import { parseFrontmatter } from "@/lib/frontmatter";
import { getFileType, isBinaryFileType } from "@/lib/file-utils";
import { useReducedMotion } from "@/hooks/useReducedMotion";
import { log, PERF } from "@/lib/logger";
import type { FileEntry } from "@/lib/tauri";
import { cn } from "@/lib/utils";
import { SidebarRowIndicators } from "./SidebarRowIndicators";
import { SidebarContextMenu } from "@/components/sidebar/quiet/SidebarContextMenu";
import { FileIcon } from "@/components/sidebar/FileIcon";
import {
  isAnyContextMenuOpen,
  subscribeToOpenContextMenus,
} from "@/lib/sidebar-context-menu-state";

/**
 * Hover-triggered popover that previews one level of a project's contents.
 *
 * Timing:
 * - 220 ms hover delay before opening (Task #36 spec).
 * - 150 ms grace period on mouse-leave so the cursor can cross the gap
 *   between the trigger and the popover content without the popover closing.
 *
 * Keyboard users: the project row itself is not hover-triggered by this
 * component — #37 will add `→` inline-expand parity. The `data-peek-trigger`
 * attribute is placed on the wrapper so #37 can find triggers deterministically.
 *
 * Positioned manually (portal + viewport-relative `position: fixed`) rather
 * than through Radix Popover because we need pointer-events coordination
 * between the trigger element and the popover content so the grace window
 * works — Radix's `onPointerLeaveCapture` semantics coupled with portal
 * re-parenting make that coordination surprisingly fiddly here.
 */

export interface FolderPeekProps {
  /** Absolute path of the folder to peek into. */
  projectPath: string;
  /** Already-loaded tree from `workspace-store`. */
  fileTree: FileEntry[];
  /** The trigger element — typically the project row. */
  children: ReactNode;
  /**
   * Optional callback for the footer "See full tree" link and for
   * folder-row clicks. Phase 1 keeps the signature zero-arg; task #38
   * (TreeOverlay) may extend it with a target path.
   */
  onOpenTreeOverlay?: () => void;
}

const HOVER_DELAY_MS = 220;
const CLOSE_GRACE_MS = 150;

const MAX_FOLDERS = 8;
const MAX_FILES = 6;

/** Last path segment (basename). */
function projectBasename(path: string): string {
  const parts = path.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

/**
 * Children derivation output — the one-level preview that both the hover
 * popover and the inline keyboard expansion (#37) render. Folders come
 * first, files second, each sorted alphabetically (case-insensitive) and
 * capped. Overflow counts surface as "+N more…" hints in both surfaces.
 */
export interface PeekChildren {
  folders: FileEntry[];
  files: FileEntry[];
  folderOverflow: number;
  fileOverflow: number;
  isEmpty: boolean;
}

/**
 * Pure helper shared by `FolderPeek` (hover popover) and
 * `ProjectsSection` (inline keyboard expansion for task #37). Hidden
 * entries and `.DS_Store` are filtered out; caps are applied after
 * sorting so the visible slice is always the alphabetical head.
 */
export function derivePeekChildren(tree: FileEntry[]): PeekChildren {
  const folders: FileEntry[] = [];
  const files: FileEntry[] = [];
  for (const entry of tree) {
    if (entry.hidden || entry.name === ".DS_Store") continue;
    if (entry.is_directory) folders.push(entry);
    else files.push(entry);
  }
  const byName = (a: FileEntry, b: FileEntry) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
  folders.sort(byName);
  files.sort(byName);
  const visibleFolders = folders.slice(0, MAX_FOLDERS);
  const visibleFiles = files.slice(0, MAX_FILES);
  return {
    folders: visibleFolders,
    files: visibleFiles,
    folderOverflow: Math.max(0, folders.length - visibleFolders.length),
    fileOverflow: Math.max(0, files.length - visibleFiles.length),
    isEmpty: visibleFolders.length === 0 && visibleFiles.length === 0,
  };
}

export function FolderPeek({
  projectPath,
  fileTree,
  children,
  onOpenTreeOverlay,
}: FolderPeekProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [position, setPosition] = useState<{ top: number; left: number } | null>(
    null,
  );
  const openTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const triggerRef = useRef<HTMLDivElement | null>(null);
  const reducedMotion = useReducedMotion();
  const openTab = useEditorStore((s) => s.openTab);

  const projectName = useMemo(() => projectBasename(projectPath), [projectPath]);
  const { folders, files, folderOverflow, fileOverflow, isEmpty } = useMemo(
    () => derivePeekChildren(fileTree),
    [fileTree],
  );

  const clearOpenTimer = useCallback(() => {
    if (openTimerRef.current) {
      clearTimeout(openTimerRef.current);
      openTimerRef.current = null;
    }
  }, []);

  const clearCloseTimer = useCallback(() => {
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  }, []);

  const computePosition = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return null;
    const rect = trigger.getBoundingClientRect();
    // Right side, aligned to the top of the row.
    return { top: rect.top, left: rect.right + 8 };
  }, []);

  // Live-test 2026-04-25 — track live cursor position so the global
  // open-context-menu subscriber can re-evaluate close logic when a
  // context menu dismisses, without forcing the user to wiggle the
  // mouse to retrigger mouseleave.
  const cursorInsideRef = useRef(false);

  const handleMouseEnter = useCallback(() => {
    cursorInsideRef.current = true;
    clearCloseTimer();
    if (isOpen) return;
    // Don't open while a sidebar context menu is up — React's portal-
    // traversing synthetic `mouseenter` would otherwise fire on this
    // trigger when the cursor enters the menu portal.
    if (isAnyContextMenuOpen()) return;
    clearOpenTimer();
    openTimerRef.current = setTimeout(() => {
      // Re-check at fire time — a menu may have opened during the delay.
      if (isAnyContextMenuOpen()) return;
      const next = computePosition();
      if (next) setPosition(next);
      setIsOpen(true);
      log.debug(PERF.peek, "open", { projectPath });
    }, HOVER_DELAY_MS);
  }, [clearCloseTimer, clearOpenTimer, computePosition, isOpen, projectPath]);

  const handleMouseLeave = useCallback(() => {
    cursorInsideRef.current = false;
    clearOpenTimer();
    if (!isOpen) return;
    // Don't close while a context menu is open inside (or adjacent to)
    // the peek — closing the peek would unmount the Radix Root that
    // hosts the menu and dismiss the menu itself.
    if (isAnyContextMenuOpen()) return;
    clearCloseTimer();
    closeTimerRef.current = setTimeout(() => {
      setIsOpen(false);
      log.debug(PERF.peek, "close", { projectPath });
    }, CLOSE_GRACE_MS);
  }, [clearCloseTimer, clearOpenTimer, isOpen, projectPath]);

  // When all context menus close, re-evaluate: if the cursor is no
  // longer inside the trigger or popover, close the peek now.
  useEffect(() => {
    return subscribeToOpenContextMenus(() => {
      if (isAnyContextMenuOpen()) return;
      if (!isOpen) return;
      if (cursorInsideRef.current) return;
      clearCloseTimer();
      closeTimerRef.current = setTimeout(() => {
        setIsOpen(false);
        log.debug(PERF.peek, "close", { projectPath });
      }, CLOSE_GRACE_MS);
    });
  }, [clearCloseTimer, isOpen, projectPath]);

  // Live-test 2026-04-25 (#140 — final). Three earlier approaches all
  // lost:
  //   1. Synchronous `setIsOpen(false)` — both popovers vanished. The
  //      shared React commit raced the peek-portal unmount with the
  //      Radix ContextMenu mount (likely a focus / DismissableLayer
  //      interaction).
  //   2. `requestAnimationFrame(() => setIsOpen(false))` — menu opened
  //      but peek visibly covered it for one paint frame.
  //   3. `flushSync(() => setIsOpen(false))` — flushSync flushes ALL
  //      pending updates including Radix's queued setOpen(true), so
  //      the race remained.
  //
  // Final approach: do NOT close the peek from this handler. Just
  // cancel pending hover-open timers (so a delayed open doesn't fire
  // while the menu is up). The peek closes naturally via its
  // mouseleave grace timer when the user moves the cursor toward the
  // just-opened menu items. The z-index of the SidebarContextMenu is
  // bumped above the peek's `z-50` (see globals.css) so even when both
  // are momentarily visible, the menu sits on top instead of being
  // obscured. This trades a clean close for a robust open — the user
  // sees the menu immediately and the peek fades out as their cursor
  // exits the row, no React state updates fighting Radix.
  const handleContextMenu = useCallback(() => {
    clearOpenTimer();
    clearCloseTimer();
  }, [clearOpenTimer, clearCloseTimer]);

  const openFile = useCallback(
    async (entry: FileEntry) => {
      try {
        // Live-test 2026-04-25 — guard against binary types (PDF,
        // EPUB, DOCX, images). The previous implementation always
        // called the UTF-8 `read_file`, which fails with "stream did
        // not contain valid UTF-8" on binary content.
        const fileType = getFileType(entry.name);
        if (fileType === "image" || isBinaryFileType(fileType)) {
          openTab(entry.path, entry.name, "", null, fileType);
          return;
        }
        const raw = await invoke<string>("read_file", { path: entry.path });
        if (fileType === "markdown") {
          const { frontmatter, content } = parseFrontmatter(raw);
          openTab(entry.path, entry.name, content, frontmatter, fileType);
        } else {
          openTab(entry.path, entry.name, raw, null, fileType);
        }
      } catch (error) {
        toast.error(`Failed to open file: ${String(error)}`);
      }
    },
    [openTab],
  );

  const handleFileClick = useCallback(
    (entry: FileEntry) => {
      setIsOpen(false);
      void openFile(entry);
    },
    [openFile],
  );

  const handleFolderClick = useCallback(() => {
    setIsOpen(false);
    onOpenTreeOverlay?.();
  }, [onOpenTreeOverlay]);

  const handleTreeOverlay = useCallback(() => {
    setIsOpen(false);
    onOpenTreeOverlay?.();
  }, [onOpenTreeOverlay]);

  const handleItemKeyDown = useCallback(
    (event: KeyboardEvent<HTMLButtonElement>, action: () => void) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        action();
      }
    },
    [],
  );

  // Radix-style data-state so the same Tailwind animation classes used
  // across the codebase pick up fade-in/fade-out. Reduced motion: we strip
  // the class entirely (defence-in-depth — globals.css also guards).
  const animationClasses = reducedMotion
    ? ""
    : "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0 data-[state=open]:duration-120 data-[state=closed]:duration-100";

  return (
    <>
      <div
        ref={triggerRef}
        data-peek-trigger="true"
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        onContextMenu={handleContextMenu}
      >
        {children}
      </div>
      {isOpen && position
        ? createPortal(
            <div
              role="dialog"
              aria-label={`Folder peek — ${projectName}`}
              data-state={isOpen ? "open" : "closed"}
              data-testid="folder-peek-content"
              onMouseEnter={() => clearCloseTimer()}
              onMouseLeave={handleMouseLeave}
              style={{
                position: "fixed",
                top: position.top,
                left: position.left,
                maxHeight: "40vh",
              }}
              // Live-test 2026-04-25 #152 — width / radius / padding
              // tightened to match mockup-d-synthesis's `.peek` block:
              // 260 px min, 10 px corner radius (`rounded-[10px]`), and
              // 8 px / 6 px inner padding (`py-2 px-1.5`). The narrower
              // 256 px (w-64) felt cramped against the new 252 px
              // sidebar — bumping to 280 px (w-[280px]) gives enough
              // room for filenames + the meta indicator without
              // exceeding the mockup's 320 px max.
              //
              // #153 — `shadow-lg` (was `shadow-md`) so the surface
              // matches FilePreview's lift. The two popovers now share
              // the same family treatment.
              className={cn(
                "z-50 w-[280px] rounded-[10px] border bg-popover text-popover-foreground shadow-lg outline-hidden",
                "overflow-auto py-2 px-1.5",
                animationClasses,
              )}
            >
              {isEmpty ? (
                <div className="px-2 py-1.5 text-xs text-muted-foreground">
                  Empty project
                </div>
              ) : (
                <>
                  {folders.length > 0 && (
                    <div className="flex flex-col">
                      {folders.map((entry) => (
                        // #160 — wrap each peek row so right-click opens
                        // our SidebarContextMenu instead of the OS native
                        // menu. The button is a real DOM element so Radix's
                        // `asChild` Slot can attach `onContextMenu` directly.
                        <SidebarContextMenu
                          key={entry.path}
                          filePath={entry.path}
                          kind="folder"
                          onOpen={handleFolderClick}
                        >
                          <button
                            type="button"
                            tabIndex={0}
                            onClick={handleFolderClick}
                            onKeyDown={(e) =>
                              handleItemKeyDown(e, handleFolderClick)
                            }
                            // Live-test 2026-04-25 #152 — tighter row
                            // per mockup-d: 24 px height (`h-6`), 12 px
                            // text (`text-[12.5px]`), 10 px gap. Matches
                            // the mockup's `.peek-item` exactly.
                            className={cn(
                              "h-6 px-2 flex items-center gap-2.5 rounded-md cursor-pointer text-[12.5px] w-full",
                              "text-foreground/90 text-left truncate",
                              "hover:bg-muted/50 transition-colors duration-150",
                              "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--accent,var(--primary))]",
                            )}
                          >
                            <Folder
                              className="h-3.5 w-3.5 shrink-0 text-muted-foreground/70"
                              strokeWidth={1.5}
                              aria-hidden="true"
                            />
                            <span className="truncate min-w-0 flex-1">
                              {entry.name}
                            </span>
                            {/* #129 — aggregate git "●" indicator + external-
                               *  change dot for folder rows inside the peek. */}
                            <SidebarRowIndicators
                              path={entry.path}
                              kind="folder"
                            />
                          </button>
                        </SidebarContextMenu>
                      ))}
                      {folderOverflow > 0 && (
                        <div className="px-2 py-1 text-xs text-muted-foreground">
                          +{folderOverflow} more…
                        </div>
                      )}
                    </div>
                  )}
                  {files.length > 0 && (
                    <div className="flex flex-col">
                      {folders.length > 0 && (
                        <div
                          className="my-1 h-px bg-border/60"
                          aria-hidden="true"
                        />
                      )}
                      {files.map((entry) => (
                        <SidebarContextMenu
                          key={entry.path}
                          filePath={entry.path}
                          kind="file"
                          onOpen={() => handleFileClick(entry)}
                        >
                          <button
                            type="button"
                            tabIndex={0}
                            onClick={() => handleFileClick(entry)}
                            onKeyDown={(e) =>
                              handleItemKeyDown(e, () => handleFileClick(entry))
                            }
                            // Live-test 2026-04-25 #152 — tighter row
                            // per mockup-d: 24 px height (`h-6`), 12 px
                            // text (`text-[12.5px]`), 10 px gap. Matches
                            // the mockup's `.peek-item` exactly.
                            className={cn(
                              "h-6 px-2 flex items-center gap-2.5 rounded-md cursor-pointer text-[12.5px] w-full",
                              "text-foreground/90 text-left truncate",
                              "hover:bg-muted/50 transition-colors duration-150",
                              "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--accent,var(--primary))]",
                            )}
                          >
                            {/* Live-test 2026-04-25 #152 — `FileIcon`
                                gives extension-aware icons (md, png,
                                pdf, etc.) instead of the generic
                                `FileText` fallback the peek used to
                                show for every file. Same component
                                used by Pinned / Recent / TreeOverlay
                                so the peek now feels like a sibling
                                of those surfaces. */}
                            <FileIcon
                              fileName={entry.name}
                              className="h-3.5 w-3.5 shrink-0 text-muted-foreground/70"
                            />
                            <span className="truncate min-w-0 flex-1">
                              {entry.name}
                            </span>
                            {/* #129 — git status + external-change dot for
                               *  file rows inside the peek. */}
                            <SidebarRowIndicators
                              path={entry.path}
                              kind="file"
                            />
                          </button>
                        </SidebarContextMenu>
                      ))}
                      {fileOverflow > 0 && (
                        <div className="px-2 py-1 text-xs text-muted-foreground">
                          +{fileOverflow} more…
                        </div>
                      )}
                    </div>
                  )}
                </>
              )}
              <div className="my-1 h-px bg-border/60" aria-hidden="true" />
              <button
                type="button"
                tabIndex={0}
                disabled={!onOpenTreeOverlay}
                onClick={handleTreeOverlay}
                onKeyDown={(e) => handleItemKeyDown(e, handleTreeOverlay)}
                title={
                  onOpenTreeOverlay
                    ? undefined
                    : "Tree overlay not yet available"
                }
                className={cn(
                  "h-7 px-2 flex items-center justify-between gap-2 rounded-sm text-xs w-full",
                  "text-muted-foreground text-left",
                  "hover:bg-muted/50 hover:text-foreground transition-colors duration-150",
                  "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--accent,var(--primary))]",
                  "disabled:opacity-60 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-muted-foreground",
                )}
              >
                <span className="truncate">See full tree</span>
                <kbd
                  className="text-[10px] font-mono tabular-nums opacity-70"
                  aria-hidden="true"
                >
                  ⌘⇧E
                </kbd>
              </button>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

export default FolderPeek;
