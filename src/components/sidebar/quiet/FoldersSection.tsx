import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { FileText } from "lucide-react";
import { resolveFolderIcon } from "@/lib/folder-icon";
import { cn } from "@/lib/utils";
import { useWorkspaceStore, type ExplorerFolder } from "@/stores/workspace-store";
import { useEditorStore } from "@/stores/editor-store";
import { useSettingsStore } from "@/stores/settings-store";
import { useFolderAppearanceStore } from "@/stores/folder-appearance-store";
import { useFileOperations } from "@/hooks/useFileOperations";
import { type FileEntry } from "@/lib/tauri";
import { FolderPeek, derivePeekChildren } from "./FolderPeek";
import { FilePreview, isPreviewable } from "./FilePreview";
import { SidebarRowIndicators } from "./SidebarRowIndicators";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
} from "@/components/ui/popover";
import { FolderAppearancePicker } from "@/components/FolderAppearancePicker";
import { SIDEBAR_MAKE_PROJECT_EVENT } from "@/components/sidebar/quiet/SidebarContextMenu";
import { subscribeToSidebarEvents } from "@/lib/sidebar-events";
import {
  decrementCustomizePopoverOpen,
  decrementOpenContextMenus,
  forceCloseAllPeeks,
  incrementCustomizePopoverOpen,
  incrementOpenContextMenus,
} from "@/lib/sidebar-context-menu-state";
import { tauriApi } from "@/lib/tauri";
import { copyToClipboard } from "@/components/sidebar/quiet/sidebar-clipboard";
import { toast } from "sonner";

/**
 * FoldersSection — the QuietSidebar's section for arbitrary folders the
 * user opened via `⌘O` that are NOT Notesage projects (no `.notesage/`
 * directory). Sits between Projects and Recent in the sidebar.
 *
 * Sidebar-simplification task #9. Reads from
 * `workspace-store.explorerFolders`. The section self-hides when the
 * list is empty — there's no cap UI (locked-in 2026-04-27 decision:
 * the user IS the limiter for sections they curate explicitly, so no
 * slider). `⌘O` adds via `App.tsx::handleOpenFolder` which dedups via
 * canonical path (sidebar #8) and toasts when the user re-opens an
 * already-tracked folder.
 *
 * This is a deliberately slimmer cousin of `ProjectsSection`. Folders
 * intentionally don't get:
 *   - The per-row `+ Add note` affordance (folders aren't a "writing
 *     destination" the way projects are)
 *   - AI-lock padlock (only projects can be lock-targeted)
 *   - README-on-click (no project conventions)
 *   - Pending inline-create (`⌘N` is project-scoped)
 *   - File-count badge in the row meta slot
 *
 * The shared FolderPeek hover popover, the SQLite-backed indicator
 * widgets (git status, external-change dot), and the inline `→` /
 * `←` keyboard expansion are reused from the existing primitives.
 *
 * Right-click → "Remove from sidebar" calls
 * `workspace-store.removeExplorerFolder`. The `⌘O` re-open toast and
 * canonical-path dedup live one layer up in `App.tsx`.
 */

interface FoldersSectionProps {
  /** Type-to-filter string passed from QuietSidebar (case-insensitive). */
  filter?: string;
}

interface FolderRowDescriptor {
  kind: "folder" | "child" | "overflow";
  id: string; // = path or synthetic key for overflow
  folder: ExplorerFolder;
  /** For child rows: the underlying FileEntry. */
  entry?: FileEntry;
  /** For overflow rows: how many more items + which kind. */
  overflow?: { kind: "folder" | "file"; count: number };
}

function folderBasename(path: string): string {
  const parts = path.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

export function FoldersSection({ filter }: FoldersSectionProps = {}) {
  const folders = useWorkspaceStore((s) => s.explorerFolders);
  const removeExplorerFolder = useWorkspaceStore((s) => s.removeExplorerFolder);
  const activeTabPath = useEditorStore((s) => {
    const tab = s.openDocuments.find((t) => t.id === s.activeTabId);
    return tab?.filePath ?? null;
  });
  const { openFile: openFileEntry } = useFileOperations();
  // Live-test 2026-04-28 finding #4 — propagate the global "Show
  // hidden files" setting into every `derivePeekChildren` call below
  // so toggling it actually surfaces dotfiles in the sidebar tree.
  const showHiddenFiles = useSettingsStore((s) => s.showHiddenFiles);

  // Per-folder inline expand state — same shape ProjectsSection uses.
  // Ephemeral (not persisted) — survives section re-render but resets
  // on full unmount.
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set());
  // Live-test 2026-04-28 finding #2 — when "+N more" is clicked,
  // the folder path is added here so the next derive uses the
  // unbounded variant.
  const [showAllPaths, setShowAllPaths] = useState<Set<string>>(new Set());
  const [focusedRowId, setFocusedRowId] = useState<string | null>(null);
  // Folder-merge fix — section-level state for the "Customize…" popover.
  // Only one row can be customizing at a time; clicking Customize on a
  // different row replaces the open popover. `null` = no popover open.
  const [customizingPath, setCustomizingPath] = useState<string | null>(null);
  // Mirror SidebarContextMenu: while the customize popover is open, bump
  // the shared overlay counter so FolderPeek / FilePreview pause their
  // hover-open / hover-close logic. We ALSO emit a one-shot
  // `forceCloseAllPeeks` signal at open time — closing any FolderPeek
  // that was already open from a prior hover, so the popover doesn't
  // render beneath the peek.
  useEffect(() => {
    if (customizingPath === null) return;
    forceCloseAllPeeks();
    incrementOpenContextMenus();
    incrementCustomizePopoverOpen();
    return () => {
      decrementOpenContextMenus();
      decrementCustomizePopoverOpen();
    };
  }, [customizingPath]);
  const rowRefs = useRef<Map<string, HTMLElement>>(new Map());

  const registerRef = useCallback((rowId: string, el: HTMLElement | null) => {
    if (el) rowRefs.current.set(rowId, el);
    else rowRefs.current.delete(rowId);
  }, []);

  const focusRow = useCallback((rowId: string) => {
    const el = rowRefs.current.get(rowId);
    if (el) {
      setFocusedRowId(rowId);
      el.focus();
    }
  }, []);

  // Sidebar #5 — listen for `expand-path` events on the bus. When the
  // event names a folder we own, expand it AND focus the row matching
  // `targetPath` on the next paint.
  useEffect(() => {
    const ourFolders = new Set(folders.map((f) => f.path));
    const unsub = subscribeToSidebarEvents((event) => {
      if (event.type !== "expand-path") return;
      if (!ourFolders.has(event.projectPath)) return;
      setExpandedPaths((prev) => {
        if (prev.has(event.projectPath)) return prev;
        const updated = new Set(prev);
        updated.add(event.projectPath);
        return updated;
      });
      requestAnimationFrame(() => {
        const el = rowRefs.current.get(event.targetPath);
        if (el) {
          setFocusedRowId(event.targetPath);
          el.focus();
        } else {
          const folderEl = rowRefs.current.get(event.projectPath);
          if (folderEl) {
            setFocusedRowId(event.projectPath);
            folderEl.focus();
          }
        }
      });
    });
    return unsub;
  }, [folders]);

  // Apply the type-to-filter (matches folder basename + child entry name).
  const filteredFolders = useMemo(() => {
    if (!filter) return folders;
    const needle = filter.toLowerCase();
    return folders.filter((f) =>
      folderBasename(f.path).toLowerCase().includes(needle),
    );
  }, [folders, filter]);

  // Walk the visible folder list AND the expanded children to build
  // the flat row sequence used for ↑ / ↓ navigation.
  const rows = useMemo(() => {
    const list: FolderRowDescriptor[] = [];
    for (const folder of filteredFolders) {
      list.push({ kind: "folder", id: folder.path, folder });
      if (expandedPaths.has(folder.path)) {
        const peek = derivePeekChildren(folder.fileTree, {
          unbounded: showAllPaths.has(folder.path),
          showHidden: showHiddenFiles,
        });
        for (const dir of peek.folders) {
          list.push({
            kind: "child",
            id: dir.path,
            folder,
            entry: dir,
          });
        }
        if (peek.folderOverflow > 0) {
          list.push({
            kind: "overflow",
            id: `${folder.path}::__folder-overflow__`,
            folder,
            overflow: { kind: "folder", count: peek.folderOverflow },
          });
        }
        for (const file of peek.files) {
          list.push({
            kind: "child",
            id: file.path,
            folder,
            entry: file,
          });
        }
        if (peek.fileOverflow > 0) {
          list.push({
            kind: "overflow",
            id: `${folder.path}::__file-overflow__`,
            folder,
            overflow: { kind: "file", count: peek.fileOverflow },
          });
        }
      }
    }
    return list;
  }, [filteredFolders, expandedPaths, showAllPaths, showHiddenFiles]);

  const toggleExpanded = useCallback((path: string, next: boolean) => {
    setExpandedPaths((prev) => {
      const updated = new Set(prev);
      if (next) updated.add(path);
      else updated.delete(path);
      return updated;
    });
  }, []);

  const handleFolderKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>, folder: ExplorerFolder) => {
      const isExpanded = expandedPaths.has(folder.path);
      if (event.key === "ArrowRight") {
        event.preventDefault();
        const peek = derivePeekChildren(folder.fileTree, {
          showHidden: showHiddenFiles,
        });
        if (peek.isEmpty) return;
        if (!isExpanded) {
          toggleExpanded(folder.path, true);
          return;
        }
        // Already expanded → focus first child.
        const first = peek.folders[0] ?? peek.files[0];
        if (first) focusRow(first.path);
        return;
      }
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        if (isExpanded) toggleExpanded(folder.path, false);
        return;
      }
      if (event.key === "ArrowDown") {
        event.preventDefault();
        const idx = rows.findIndex((r) => r.id === folder.path);
        const next = rows[idx + 1];
        if (next) focusRow(next.id);
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        const idx = rows.findIndex((r) => r.id === folder.path);
        const prev = rows[idx - 1];
        if (prev) focusRow(prev.id);
        return;
      }
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        // No project-style README convention for folders — Enter on a
        // folder row toggles its expand state. Matches the keyboard
        // mental model: expand to see what's in it.
        toggleExpanded(folder.path, !isExpanded);
      }
    },
    [expandedPaths, rows, focusRow, toggleExpanded, showHiddenFiles],
  );

  const handleChildKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>, row: FolderRowDescriptor) => {
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        focusRow(row.folder.path);
        return;
      }
      if (event.key === "ArrowDown") {
        event.preventDefault();
        const idx = rows.findIndex((r) => r.id === row.id);
        const next = rows[idx + 1];
        if (next) focusRow(next.id);
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        const idx = rows.findIndex((r) => r.id === row.id);
        const prev = rows[idx - 1];
        if (prev) focusRow(prev.id);
        return;
      }
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        if (!row.entry) return;
        if (row.entry.is_directory) {
          // Multi-level inline expand for child folders lands with
          // sidebar #20 (TreeOverlay deletion). Today: silent no-op
          // matching ProjectsSection's child-folder behaviour.
          return;
        }
        void openFileEntry(row.entry.path, row.entry.name);
      }
    },
    [rows, focusRow, openFileEntry],
  );

  const handleRemove = useCallback(
    (path: string) => {
      const name = folderBasename(path);
      removeExplorerFolder(path);
      toast(`Removed "${name}" from sidebar`);
    },
    [removeExplorerFolder],
  );

  // Sidebar-simplification locked-in decision (2026-04-27): no cap, no
  // slider, no settings UI. The section disappears when there are no
  // folders to show.
  if (folders.length === 0) return null;

  return (
    <section
      aria-label="External folders"
      className="group/section flex flex-col gap-1"
    >
      {/* Folder-merge fix — header dropped. The merged "Folders" header is
          rendered by ProjectsSection above; explorer folders flow into the
          same visual section. The structural FolderSymlink icon (set by
          resolveFolderIcon) signals that these rows are external. */}
      <ul role="tree" aria-label="External folders" className="flex flex-col m-0 p-0 list-none">
        {filteredFolders.map((folder) => {
          const isExpanded = expandedPaths.has(folder.path);
          return (
            <li key={folder.path} className="m-0 p-0">
              <Popover
                open={customizingPath === folder.path}
                onOpenChange={(open) =>
                  setCustomizingPath(open ? folder.path : null)
                }
              >
                <PopoverAnchor asChild>
                  <span className="block">
                    <FolderPeek
                      projectPath={folder.path}
                      fileTree={folder.fileTree}
                    >
                      <ContextMenu
                        onOpenChange={(open) => {
                          // Match SidebarContextMenu's pattern: bump the
                          // shared counter so FolderPeek / FilePreview
                          // pause their hover-open while the menu is up.
                          // Without this the FolderPeek would still
                          // schedule its 220 ms openTimer during the
                          // menu's lifetime and pop over the menu.
                          if (open) incrementOpenContextMenus();
                          else decrementOpenContextMenus();
                        }}
                      >
                        <ContextMenuTrigger asChild>
                          {/*
                            Radix's Slot uses cloneElement to inject
                            `onContextMenu` and a ref onto its child.
                            FolderRow is a function component that
                            destructures only its declared props, so the
                            injected handler/ref get silently dropped and
                            the OS native menu fires (with row-selection
                            visual). Wrapping with a passthrough <div>
                            makes the immediate Slot target a raw DOM
                            element so prop injection lands. Mirrors the
                            same workaround in ProjectsSection.
                          */}
                          <div>
                            <FolderRow
                              folder={folder}
                              isExpanded={isExpanded}
                              isFocused={focusedRowId === folder.path}
                              hasFocusWithin={focusedRowId !== null}
                              isActive={
                                !!activeTabPath &&
                                activeTabPath.startsWith(folder.path + "/")
                              }
                              registerRef={(el) => registerRef(folder.path, el)}
                              onKeyDown={(e) => handleFolderKeyDown(e, folder)}
                              onFocus={() => setFocusedRowId(folder.path)}
                              onActivate={() =>
                                toggleExpanded(folder.path, !isExpanded)
                              }
                            />
                          </div>
                        </ContextMenuTrigger>
                        <ContextMenuContent>
                          <ContextMenuItem
                            onSelect={() => {
                              void tauriApi
                                .revealInFinder(folder.path)
                                .catch((e) =>
                                  toast.error(`Failed to reveal: ${String(e)}`),
                                );
                            }}
                          >
                            Reveal in Finder
                          </ContextMenuItem>
                          <ContextMenuItem
                            onSelect={() => {
                              void copyToClipboard(folder.path, "Path copied");
                            }}
                          >
                            Copy path
                          </ContextMenuItem>
                          <ContextMenuSeparator />
                          <ContextMenuItem
                            onSelect={() => {
                              // Defer one frame so the context menu fully
                              // closes before the popover paints.
                              requestAnimationFrame(() =>
                                setCustomizingPath(folder.path),
                              );
                            }}
                          >
                            Customize…
                          </ContextMenuItem>
                          {/* Manage with Notesage — turn this external folder
                              into a managed Notesage folder. Creates `.notesage/`
                              and re-registers the folder so it gains AI lock,
                              custom appearance persistence, durable comments,
                              per-folder skills/agents/MCP. The dual label
                              handles the case where `.notesage/` already
                              exists (folder is structurally Notesage but
                              isn't registered as such yet — common when
                              re-opening a previously-managed folder via ⌘O). */}
                          {(() => {
                            const hasNotesageDir = folder.fileTree.some(
                              (c) =>
                                c.name === ".notesage" && c.is_directory,
                            );
                            const label = hasNotesageDir
                              ? "Open as Notesage folder"
                              : "Manage with Notesage";
                            const tooltip = hasNotesageDir
                              ? "Add this folder to the sidebar as a Notesage folder. It already has a .notesage settings directory."
                              : "Adds a .notesage settings directory to this folder and unlocks Notesage features: AI provider lock, folder appearance, comments that survive renames, and per-folder skills, agents, and MCP servers.";
                            return (
                              <ContextMenuItem
                                title={tooltip}
                                onSelect={() => {
                                  window.dispatchEvent(
                                    new CustomEvent(
                                      SIDEBAR_MAKE_PROJECT_EVENT,
                                      { detail: { path: folder.path } },
                                    ),
                                  );
                                }}
                              >
                                {label}
                              </ContextMenuItem>
                            );
                          })()}
                          <ContextMenuSeparator />
                          <ContextMenuItem
                            onSelect={() => handleRemove(folder.path)}
                          >
                            Remove from sidebar
                          </ContextMenuItem>
                        </ContextMenuContent>
                      </ContextMenu>
                    </FolderPeek>
                  </span>
                </PopoverAnchor>
                <PopoverContent
                  side="right"
                  align="start"
                  sideOffset={4}
                  className="p-0 w-auto"
                  // React synthetic events bubble through the REACT tree,
                  // even across portals. PopoverContent is React-tree-inside
                  // `<Popover>`, which is inside the QuietSidebar `<nav>`'s
                  // onKeyDown / inside FolderPeek's onMouseEnter. Without
                  // these stoppers, typing in the popover lands in the
                  // sidebar's type-to-filter, and mouse-over the popover
                  // fires FolderPeek's hover-open. Stop propagation at the
                  // popover boundary.
                  onKeyDown={(e) => e.stopPropagation()}
                  onMouseEnter={(e) => e.stopPropagation()}
                  onMouseLeave={(e) => e.stopPropagation()}
                  onMouseOver={(e) => e.stopPropagation()}
                >
                  <FolderAppearancePicker
                    folderPath={folder.path}
                    folderType="external"
                    isProject={false}
                    onClose={() => setCustomizingPath(null)}
                  />
                </PopoverContent>
              </Popover>
              {isExpanded && (
                <ul role="group" className="m-0 p-0 list-none pl-4">
                  {rows
                    .filter(
                      (r) =>
                        (r.kind === "child" || r.kind === "overflow") &&
                        r.folder.path === folder.path,
                    )
                    .map((row) => (
                      <li key={row.id} className="m-0 p-0">
                        {row.kind === "overflow" && row.overflow ? (
                          <OverflowRow
                            count={row.overflow.count}
                            kind={row.overflow.kind}
                            isFocused={focusedRowId === row.id}
                            hasFocusWithin={focusedRowId !== null}
                            registerRef={(el) => registerRef(row.id, el)}
                            onActivate={() =>
                              setShowAllPaths((prev) => {
                                const updated = new Set(prev);
                                updated.add(folder.path);
                                return updated;
                              })
                            }
                            onKeyDown={(e) => handleChildKeyDown(e, row)}
                            onFocus={() => setFocusedRowId(row.id)}
                          />
                        ) : (() => {
                          const childRow = (
                            <ChildRow
                              row={row}
                              isFocused={focusedRowId === row.id}
                              hasFocusWithin={focusedRowId !== null}
                              registerRef={(el) => registerRef(row.id, el)}
                              onKeyDown={(e) => handleChildKeyDown(e, row)}
                              onFocus={() => setFocusedRowId(row.id)}
                              onActivate={() => {
                                if (row.entry?.is_directory) return;
                                if (row.entry) void openFileEntry(row.entry.path, row.entry.name);
                              }}
                            />
                          );
                          // Live-test 2026-04-28 finding #3 — same hover
                          // treatment ProjectsSection child rows get:
                          // FolderPeek for folders (one level into the
                          // already-loaded recursive tree), FilePreview
                          // for previewable file extensions. Other files
                          // render bare.
                          if (!row.entry) return childRow;
                          if (row.entry.is_directory) {
                            return (
                              <FolderPeek
                                projectPath={row.entry.path}
                                fileTree={row.entry.children ?? []}
                              >
                                <div>{childRow}</div>
                              </FolderPeek>
                            );
                          }
                          if (isPreviewable(row.entry.path)) {
                            return (
                              <FilePreview filePath={row.entry.path}>
                                <div>{childRow}</div>
                              </FilePreview>
                            );
                          }
                          return childRow;
                        })()}
                      </li>
                    ))}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

interface FolderRowProps {
  folder: ExplorerFolder;
  isExpanded: boolean;
  isFocused: boolean;
  /**
   * Whether ANY row in the section currently has focus. When false
   * (initial state, before the user has tabbed into the section), the
   * row falls back to `tabIndex=0` so Tab from a sibling section can
   * land here. Mirrors the pattern in `ProjectsSection`.
   */
  hasFocusWithin: boolean;
  isActive: boolean;
  registerRef: (el: HTMLElement | null) => void;
  onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void;
  onFocus: () => void;
  onActivate: () => void;
}

function FolderRow({
  folder,
  isExpanded,
  isFocused,
  hasFocusWithin,
  isActive,
  registerRef,
  onKeyDown,
  onFocus,
  onActivate,
}: FolderRowProps) {
  const name = folderBasename(folder.path);
  // Folder-merge fix — read custom appearance from the global path-keyed
  // registry so user-picked icons / colors actually surface on the row.
  const appearance = useFolderAppearanceStore((s) =>
    s.getAppearance(folder.path),
  );
  const { icon: Icon, ariaLabel: folderAriaLabel, color } = resolveFolderIcon({
    type: 'external',
    expanded: isExpanded,
    name,
    appearance,
  });
  // Roving tabindex with a "no row focused yet" fallback. When the
  // user hasn't tabbed into the section, the first FolderRow (which
  // is the only one mounted with `hasFocusWithin === false`)
  // exposes `tabIndex=0` so Tab from the previous section lands
  // here. Once focus enters, only the focused row stays at 0.
  const tabIndex = isFocused || !hasFocusWithin ? 0 : -1;
  return (
    <div
      ref={registerRef}
      role="treeitem"
      aria-level={1}
      aria-expanded={isExpanded}
      aria-selected={isFocused ? "true" : undefined}
      aria-label={folderAriaLabel}
      data-row-type="folder"
      tabIndex={tabIndex}
      onClick={onActivate}
      onKeyDown={onKeyDown}
      onFocus={onFocus}
      className={cn(
        "group/row h-7 px-2 flex items-center gap-2 rounded-sm cursor-pointer text-[13px]",
        "text-foreground/90 transition-colors duration-150",
        "hover:bg-muted/50",
        "relative focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--accent,var(--primary))] focus-visible:z-10",
        isActive && "bg-muted text-foreground font-medium",
      )}
    >
      <Icon
        className={cn(
          "h-3.5 w-3.5 shrink-0",
          // When a custom color is applied, drop the muted greyscale class
          // so the user-picked color isn't overridden by the muted fill.
          color
            ? undefined
            : isActive
              ? "text-[var(--color-accent-primary)]"
              : "text-muted-foreground/70",
        )}
        style={color ? { color } : undefined}
        strokeWidth={1.5}
        aria-hidden="true"
      />
      <span className="truncate min-w-0 flex-1">{name}</span>
      {/* Folder rows surface the same git + external-change indicators
          that project rows do. AI-lock is intentionally NOT shown
          here — explorer folders aren't a lock target. */}
      <SidebarRowIndicators path={folder.path} kind="folder" />
    </div>
  );
}

interface OverflowRowProps {
  count: number;
  kind: "folder" | "file";
  isFocused: boolean;
  hasFocusWithin: boolean;
  registerRef: (el: HTMLElement | null) => void;
  onActivate: () => void;
  onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void;
  onFocus: () => void;
}

function OverflowRow({
  count,
  kind,
  isFocused,
  hasFocusWithin,
  registerRef,
  onActivate,
  onKeyDown,
  onFocus,
}: OverflowRowProps) {
  const label = `Show ${count} more ${kind}${count === 1 ? "" : "s"}`;
  const tabIndex = isFocused || !hasFocusWithin ? 0 : -1;
  return (
    <div
      ref={registerRef}
      role="treeitem"
      aria-level={2}
      aria-label={label}
      data-row-type="folder-overflow"
      tabIndex={tabIndex}
      onClick={onActivate}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onActivate();
          return;
        }
        onKeyDown(e);
      }}
      onFocus={onFocus}
      className={cn(
        "h-6 px-2 flex items-center text-xs text-muted-foreground cursor-pointer",
        "hover:text-foreground hover:underline underline-offset-2 transition-colors",
        "relative focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--accent,var(--primary))] focus-visible:z-10",
      )}
    >
      +{count} more…
    </div>
  );
}

interface ChildRowProps {
  row: FolderRowDescriptor;
  isFocused: boolean;
  hasFocusWithin: boolean;
  registerRef: (el: HTMLElement | null) => void;
  onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void;
  onFocus: () => void;
  onActivate: () => void;
}

function ChildRow({
  row,
  isFocused,
  hasFocusWithin,
  registerRef,
  onKeyDown,
  onFocus,
  onActivate,
}: ChildRowProps) {
  if (!row.entry) return null;
  // Sub-directories inside an explorer folder are NOT external themselves —
  // they're just folders within. Use the standard structural icon.
  const { icon: Icon, ariaLabel } = row.entry.is_directory
    ? resolveFolderIcon({ type: 'standard', name: row.entry.name })
    : { icon: FileText, ariaLabel: `Open file ${row.entry.name}` };
  // ChildRow only renders inside an expanded FolderRow, so it sits
  // BELOW the parent in tab order. The same fallback applies:
  // expose `tabIndex=0` when no row is focused yet so external Tab
  // can still reach the section through the parent FolderRow.
  const tabIndex = isFocused || !hasFocusWithin ? 0 : -1;
  return (
    <div
      ref={registerRef}
      role="treeitem"
      aria-level={2}
      aria-selected={isFocused ? "true" : undefined}
      aria-label={ariaLabel}
      data-row-type="child"
      tabIndex={tabIndex}
      onClick={onActivate}
      onKeyDown={onKeyDown}
      onFocus={onFocus}
      className={cn(
        "h-7 px-2 flex items-center gap-2 rounded-sm cursor-pointer text-[13px]",
        "text-foreground/90 transition-colors duration-150",
        "hover:bg-muted/50",
        "relative focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--accent,var(--primary))] focus-visible:z-10",
      )}
    >
      <Icon
        className="h-3.5 w-3.5 shrink-0 text-muted-foreground/70"
        strokeWidth={1.5}
        aria-hidden="true"
      />
      <span className="truncate min-w-0 flex-1">{row.entry.name}</span>
      <SidebarRowIndicators
        path={row.entry.path}
        kind={row.entry.is_directory ? "folder" : "file"}
      />
    </div>
  );
}

export default FoldersSection;
