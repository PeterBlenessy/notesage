import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { Folder, FolderOpen, FileText } from "lucide-react";
import { cn } from "@/lib/utils";
import { useWorkspaceStore, type ExplorerFolder } from "@/stores/workspace-store";
import { useEditorStore } from "@/stores/editor-store";
import { useSettingsStore } from "@/stores/settings-store";
import { useFileOperations } from "@/hooks/useFileOperations";
import { type FileEntry } from "@/lib/tauri";
import { FolderPeek, derivePeekChildren } from "./FolderPeek";
import { FilePreview, isPreviewable } from "./FilePreview";
import { SidebarRowIndicators } from "./SidebarRowIndicators";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { subscribeToSidebarEvents } from "@/lib/sidebar-events";
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
      aria-label="Folders"
      className="group/section flex flex-col gap-1"
    >
      <header className="flex items-center justify-between gap-2 px-2 h-6">
        <h2 className="text-xs font-medium tracking-wider uppercase text-muted-foreground">
          Folders
        </h2>
      </header>
      <ul role="tree" aria-label="Folders" className="flex flex-col m-0 p-0 list-none">
        {filteredFolders.map((folder) => {
          const isExpanded = expandedPaths.has(folder.path);
          return (
            <li key={folder.path} className="m-0 p-0">
              <FolderPeek
                projectPath={folder.path}
                fileTree={folder.fileTree}
              >
                {/*
                  Inline ContextMenu (rather than the heavier
                  SidebarContextMenu used by Projects / Pinned /
                  Recent) — folders only need three actions: reveal
                  in Finder, copy path, remove. The shared menu
                  carries a lot of file/project-specific items that
                  would be wrong for explorer folders.
                */}
                <ContextMenu>
                  <ContextMenuTrigger asChild>
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
                    <ContextMenuItem
                      onSelect={() => handleRemove(folder.path)}
                    >
                      Remove from sidebar
                    </ContextMenuItem>
                  </ContextMenuContent>
                </ContextMenu>
              </FolderPeek>
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
  const Icon = isExpanded ? FolderOpen : Folder;
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
      aria-label={`Open folder ${name}`}
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
          isActive
            ? "text-[var(--color-accent-primary)]"
            : "text-muted-foreground/70",
        )}
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
  const Icon = row.entry.is_directory ? Folder : FileText;
  const ariaLabel = row.entry.is_directory
    ? `Open folder ${row.entry.name}`
    : `Open file ${row.entry.name}`;
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
