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
import { tauriApi } from "@/lib/tauri";
import { emitSidebarEvent } from "@/lib/sidebar-events";
import { setBinaryData } from "@/lib/binary-cache";
import { toast } from "sonner";
import { useEditorStore } from "@/stores/editor-store";
import { useSettingsStore } from "@/stores/settings-store";
import { parseFrontmatter } from "@/lib/frontmatter";
import { getFileType, isBinaryFileType } from "@/lib/file-utils";
import { useReducedMotion } from "@/hooks/useReducedMotion";
import { log, PERF } from "@/lib/logger";
import type { FileEntry } from "@/lib/tauri";
import { cn } from "@/lib/utils";
import { SidebarRowIndicators } from "./SidebarRowIndicators";
import { SidebarContextMenu } from "@/components/sidebar/quiet/SidebarContextMenu";
import { FileIcon } from "@/components/sidebar/FileIcon";
import { formatSavedShort } from "@/lib/saved-ago";
import {
  isAnyContextMenuOpen,
  isAnyCustomizePopoverOpen,
  subscribeToOpenContextMenus,
  subscribeToForceCloseAllPeeks,
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
  // Sidebar-simplification task #6 — `onOpenTreeOverlay` was removed.
  // Folder-clicks and the footer "Expand in sidebar" link now dispatch
  // `notesage:sidebar-expand-path` on the shared `sidebar-events` bus
  // (handled by ProjectsSection). TreeOverlay deletion lands in #20.
}

// Bumped from 220 → 500ms on 2026-05-05 user feedback that the folder-peek
// popover felt too eager during sidebar navigation, particularly while the
// large-file editor was hydrating. 500ms aligns with FilePreview's earlier
// default and is a comfortable threshold for "deliberate hover" vs "drive-by".
const HOVER_DELAY_MS = 500;
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
 * `ProjectsSection` (inline keyboard expansion for task #37). `.DS_Store`
 * is always dropped; dotfiles are dropped unless `showHidden` is true
 * (Settings > System > "Show hidden files"). Caps are applied after
 * sorting so the visible slice is always the alphabetical head.
 */
export function derivePeekChildren(
  tree: FileEntry[],
  /**
   * Live-test 2026-04-28 finding #2 — when the user clicks "+N more"
   * on an overflow row, callers re-derive with `unbounded: true` so
   * every child renders (no cap, no overflow markers). Default keeps
   * the historical 8-folder / 6-file slice the hover popover was
   * built around.
   *
   * Live-test 2026-04-28 finding #4 — `showHidden` reflects the
   * Settings > System > "Show hidden files" toggle. The Rust listing
   * still flags dotfiles via `entry.hidden`, so the UI must opt in to
   * keep them; otherwise the toggle is a no-op in the Quiet sidebar.
   */
  options: { unbounded?: boolean; showHidden?: boolean } = {},
): PeekChildren {
  const folders: FileEntry[] = [];
  const files: FileEntry[] = [];
  for (const entry of tree) {
    if (entry.name === ".DS_Store") continue;
    if (entry.hidden && !options.showHidden) continue;
    if (entry.is_directory) folders.push(entry);
    else files.push(entry);
  }
  const byName = (a: FileEntry, b: FileEntry) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
  folders.sort(byName);
  files.sort(byName);
  const folderCap = options.unbounded ? folders.length : MAX_FOLDERS;
  const fileCap = options.unbounded ? files.length : MAX_FILES;
  const visibleFolders = folders.slice(0, folderCap);
  const visibleFiles = files.slice(0, fileCap);
  return {
    folders: visibleFolders,
    files: visibleFiles,
    folderOverflow: Math.max(0, folders.length - visibleFolders.length),
    fileOverflow: Math.max(0, files.length - visibleFiles.length),
    isEmpty: visibleFolders.length === 0 && visibleFiles.length === 0,
  };
}

/**
 * Count direct + nested file entries under a folder. Used for the meta
 * column on folder rows ("3 files", "12 files"). Walks the FileEntry
 * tree without any filesystem call — it relies on what `list_directory`
 * already loaded. `.DS_Store` is always dropped; dotfiles are dropped
 * unless `showHidden` is true.
 */
export function countFilesInFolder(folder: FileEntry, showHidden = false): number {
  if (!folder.is_directory || !folder.children) return 0;
  let count = 0;
  const walk = (entries: FileEntry[]) => {
    for (const entry of entries) {
      if (entry.name === ".DS_Store") continue;
      if (entry.hidden && !showHidden) continue;
      if (entry.is_directory) {
        if (entry.children) walk(entry.children);
      } else {
        count += 1;
      }
    }
  };
  walk(folder.children);
  return count;
}

export function FolderPeek({
  projectPath,
  fileTree,
  children,
}: FolderPeekProps) {
  const [isOpen, setIsOpen] = useState(false);
  // Reset the "show all" flag when the popover closes so a fresh
  // hover opens at the default cap (avoids surprise giant popovers
  // on subsequent hovers of a folder where the user once expanded).
  useEffect(() => {
    if (!isOpen) setUnbounded(false);
  }, [isOpen]);
  const [position, setPosition] = useState<{ top: number; left: number } | null>(
    null,
  );
  const openTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const triggerRef = useRef<HTMLDivElement | null>(null);
  const reducedMotion = useReducedMotion();
  const openTab = useEditorStore((s) => s.openTab);

  const projectName = useMemo(() => projectBasename(projectPath), [projectPath]);
  // Live-test 2026-04-28 finding #2 — clicking "+N more" in the
  // popover flips this flag so the next derive uses the unbounded
  // variant. Resets to false on close so a fresh peek opens at the
  // default cap.
  const [unbounded, setUnbounded] = useState(false);
  const showHiddenFiles = useSettingsStore((s) => s.showHiddenFiles);
  const { folders, files, folderOverflow, fileOverflow, isEmpty } = useMemo(
    () => derivePeekChildren(fileTree, { unbounded, showHidden: showHiddenFiles }),
    [fileTree, unbounded, showHiddenFiles],
  );

  // `path → lastAccessedAt` lookup for the file-row meta column. We
  // pull from `recentFiles` (persisted MRU) so the time-ago survives
  // app restarts. Files that have never been opened simply have no
  // entry here — the row renders an em-dash placeholder.
  const recentFiles = useEditorStore((s) => s.recentFiles);
  const lastAccessByPath = useMemo(() => {
    const map = new Map<string, number>();
    for (const recent of recentFiles) {
      if (recent.lastAccessedAt !== undefined) {
        map.set(recent.path, recent.lastAccessedAt);
      }
    }
    return map;
  }, [recentFiles]);

  // Re-render the popover every minute so "2m" / "1h" labels stay
  // fresh while the popover is visible. Cheap — only fires when open.
  const [, setNowTick] = useState(0);
  useEffect(() => {
    if (!isOpen) return;
    const id = setInterval(() => setNowTick((n) => n + 1), 60_000);
    return () => clearInterval(id);
  }, [isOpen]);

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
    // Hard guard: while any Customize folder appearance popover is up,
    // the peek must not engage at all. Receiver bails regardless of how
    // the event arrived (React tree bubble, DOM tree, Radix internals).
    if (isAnyCustomizePopoverOpen()) return;
    cursorInsideRef.current = true;
    clearCloseTimer();
    if (isOpen) return;
    // Don't open while a sidebar context menu is up — React's portal-
    // traversing synthetic `mouseenter` would otherwise fire on this
    // trigger when the cursor enters the menu portal.
    if (isAnyContextMenuOpen()) return;
    clearOpenTimer();
    openTimerRef.current = setTimeout(() => {
      // Re-check at fire time — a menu / popover may have opened during the delay.
      if (isAnyContextMenuOpen()) return;
      if (isAnyCustomizePopoverOpen()) return;
      const next = computePosition();
      if (next) setPosition(next);
      setIsOpen(true);
      log.debug(PERF.peek, "open", { projectPath });
    }, HOVER_DELAY_MS);
  }, [clearCloseTimer, clearOpenTimer, computePosition, isOpen, projectPath]);

  const handleMouseLeave = useCallback(() => {
    // Same hard guard as handleMouseEnter — while customize is up, the
    // peek doesn't engage in any direction.
    if (isAnyCustomizePopoverOpen()) return;
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

  // Force-close on demand. Used by overlays (Customize folder appearance)
  // that need the peek out of the way regardless of cursor position. The
  // peek's existing pause-flag prevents NEW opens; this closes the
  // already-open one. See `sidebar-context-menu-state` for context.
  useEffect(() => {
    return subscribeToForceCloseAllPeeks(() => {
      clearOpenTimer();
      clearCloseTimer();
      cursorInsideRef.current = false;
      setIsOpen(false);
    });
  }, [clearCloseTimer, clearOpenTimer]);

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
        // Binary file handling (live-test 2026-04-26) — read the
        // bytes via `readBinaryFile` and cache via `setBinaryData` so
        // PdfViewer / EpubViewer / DocxViewer can find them. Without
        // the cache write, viewers showed "no PDF data available".
        // Images use convertFileSrc and don't need caching, but the
        // call is cheap.
        const fileType = getFileType(entry.name);
        if (fileType === "image" || isBinaryFileType(fileType)) {
          if (isBinaryFileType(fileType)) {
            const bytes = await tauriApi.readBinaryFile(entry.path);
            setBinaryData(entry.path, new Uint8Array(bytes));
          }
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

  // Sidebar-simplification task #6 — folder-row clicks now dispatch
  // `notesage:sidebar-expand-path` so the parent ProjectsSection (or
  // future FoldersSection) inline-expands to the clicked subfolder
  // instead of opening TreeOverlay. Multi-level walk lands with #20.
  const handleFolderClick = useCallback(
    (entry: FileEntry) => {
      setIsOpen(false);
      emitSidebarEvent({
        type: "expand-path",
        projectPath,
        targetPath: entry.path,
      });
    },
    [projectPath],
  );

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
                          onOpen={() => handleFolderClick(entry)}
                        >
                          <button
                            type="button"
                            tabIndex={0}
                            onClick={() => handleFolderClick(entry)}
                            onKeyDown={(e) =>
                              handleItemKeyDown(e, () => handleFolderClick(entry))
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
                            {/* Meta column (live-test 2026-04-26 #152)
                                — folders show the recursive file count
                                so users can scan project structure at
                                a glance, matching mockup-d's `.peek
                                .meta`. */}
                            {(() => {
                              const count = countFilesInFolder(entry, showHiddenFiles);
                              return count > 0 ? (
                                <span className="text-[11px] text-muted-foreground shrink-0 tabular-nums">
                                  {count} file{count === 1 ? "" : "s"}
                                </span>
                              ) : null;
                            })()}
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
                        // Live-test 2026-04-28 finding #2 — clickable
                        // overflow expands the popover to show every
                        // child (no more cap). The grouped state lives
                        // in the popover's own `unbounded` flag and
                        // resets on close.
                        <button
                          type="button"
                          onClick={() => setUnbounded(true)}
                          aria-label={`Show ${folderOverflow} more folder${folderOverflow === 1 ? "" : "s"}`}
                          className={cn(
                            "px-2 py-1 text-xs text-muted-foreground text-left w-full cursor-pointer",
                            "hover:text-foreground hover:underline underline-offset-2 transition-colors",
                            "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--accent,var(--primary))] rounded-sm",
                          )}
                        >
                          +{folderOverflow} more…
                        </button>
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
                            {/* Meta column (live-test 2026-04-26 #152)
                                — files show "time since last opened"
                                from the persisted MRU. Files never
                                opened render no meta (cleaner than an
                                em-dash placeholder). */}
                            {(() => {
                              const lastAt = lastAccessByPath.get(entry.path);
                              return lastAt ? (
                                <span
                                  className="text-[11px] text-muted-foreground shrink-0 tabular-nums"
                                  title={new Date(lastAt).toLocaleString()}
                                >
                                  {formatSavedShort(Date.now() - lastAt)}
                                </span>
                              ) : null;
                            })()}
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
                        <button
                          type="button"
                          onClick={() => setUnbounded(true)}
                          aria-label={`Show ${fileOverflow} more file${fileOverflow === 1 ? "" : "s"}`}
                          className={cn(
                            "px-2 py-1 text-xs text-muted-foreground text-left w-full cursor-pointer",
                            "hover:text-foreground hover:underline underline-offset-2 transition-colors",
                            "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--accent,var(--primary))] rounded-sm",
                          )}
                        >
                          +{fileOverflow} more…
                        </button>
                      )}
                    </div>
                  )}
                </>
              )}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

export default FolderPeek;
