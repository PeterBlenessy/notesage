import {
  useCallback,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { Folder, FileText, Plus } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useWorkspaceStore, type WorkspaceProject } from "@/stores/workspace-store";
import { useEditorStore } from "@/stores/editor-store";
import { useTreeOverlayStore } from "@/stores/tree-overlay-store";
import { parseFrontmatter } from "@/lib/frontmatter";
import { getFileType } from "@/lib/file-utils";
import type { FileEntry } from "@/lib/tauri";
import { cn } from "@/lib/utils";
import { FolderPeek, derivePeekChildren, type PeekChildren } from "./FolderPeek";

/**
 * ProjectsSection (quiet variant) — flat list of projects with `.md` file
 * counts plus keyboard-driven one-level inline expansion (task #37).
 *
 * Distinct from `src/components/sidebar/ProjectsSection.tsx` — that file
 * powers the legacy expandable sidebar and is untouched by this task. The
 * quiet-composer sidebar is wired to `workspace-store.projects`.
 *
 * Accessibility: the list is a real ARIA tree (`role="tree"`) with
 * `treeitem` rows. Arrow keys walk visible rows (siblings + expanded
 * children one level deep), ArrowRight expands a collapsed project or
 * descends into it, ArrowLeft collapses an expanded project or hops back
 * up to the parent from a child, Enter / Space activates. The hover
 * FolderPeek popover coexists as a separate mouse-only affordance.
 */

export interface ProjectsSectionProps {
  /** Optional click handler for the `+` add button (wired by task #42). */
  onAdd?: () => void;
}

/**
 * Recursively counts the number of `.md` files in a file tree. Directories
 * and non-markdown files are skipped. The counter dives into `children` on
 * every directory, so nested folders are included in the total.
 *
 * Exported for unit testing.
 */
export function countMarkdownFiles(tree: FileEntry[]): number {
  let count = 0;
  for (const entry of tree) {
    if (entry.is_directory) {
      if (entry.children && entry.children.length > 0) {
        count += countMarkdownFiles(entry.children);
      }
    } else if (entry.name.toLowerCase().endsWith(".md")) {
      count += 1;
    }
  }
  return count;
}

/**
 * Finds the project's README (case-insensitive `readme.md` at the top level)
 * or, failing that, the first `.md` file discovered anywhere in the tree
 * (depth-first). Returns `null` if the tree contains no markdown file.
 */
function findEntryToOpen(tree: FileEntry[]): FileEntry | null {
  for (const entry of tree) {
    if (!entry.is_directory && entry.name.toLowerCase() === "readme.md") {
      return entry;
    }
  }
  const firstMarkdown = (entries: FileEntry[]): FileEntry | null => {
    for (const entry of entries) {
      if (!entry.is_directory) {
        if (entry.name.toLowerCase().endsWith(".md")) return entry;
        continue;
      }
      if (entry.children && entry.children.length > 0) {
        const nested = firstMarkdown(entry.children);
        if (nested) return nested;
      }
    }
    return null;
  };
  return firstMarkdown(tree);
}

/** Derives the project's display name from the absolute path (basename). */
function projectBasename(path: string): string {
  const parts = path.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

/**
 * Flat row representation used by the keyboard navigator. Each rendered
 * row — project or expanded child — corresponds to one `RowDescriptor`,
 * letting ArrowUp / ArrowDown walk the visible sequence without caring
 * about the nested DOM structure.
 */
interface RowDescriptor {
  id: string;
  kind: "project" | "child";
  /** For `project`: the project itself. For `child`: its parent project. */
  project: WorkspaceProject;
  /** Only set for `kind: "child"` — the immediate child entry. */
  entry?: FileEntry;
  /** Overflow hint marker id, without an interactive entry. */
  overflow?: { kind: "folder" | "file"; count: number };
}

/**
 * Opens a file via `read_file`, routing through the parse-frontmatter /
 * openTab pipeline shared by the rest of the quiet sidebar. Shows a toast
 * on failure.
 */
async function openFileEntry(entry: FileEntry): Promise<void> {
  try {
    const raw = await invoke<string>("read_file", { path: entry.path });
    const fileType = getFileType(entry.name);
    if (fileType === "markdown") {
      const { frontmatter, content } = parseFrontmatter(raw);
      useEditorStore
        .getState()
        .openTab(entry.path, entry.name, content, frontmatter, fileType);
    } else {
      useEditorStore.getState().openTab(entry.path, entry.name, raw, null, fileType);
    }
  } catch (error) {
    toast.error(`Failed to open file: ${String(error)}`);
  }
}

// ---------------------------------------------------------------------------
// ProjectsSection
// ---------------------------------------------------------------------------

export function ProjectsSection({ onAdd }: ProjectsSectionProps) {
  const projects = useWorkspaceStore((s) => s.projects);
  const activeTabPath = useEditorStore((s) => {
    const id = s.activeTabId;
    if (!id) return null;
    const tab = s.tabs.find((t) => t.id === id);
    return tab?.filePath ?? null;
  });

  // Each project's inline-expanded state is independent — this set tracks
  // absolute project paths that the user has expanded via ArrowRight.
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set());

  // Roving tabindex: only one row is focusable at a time. `focusedRowId`
  // stays in sync with the DOM via the keydown handlers, and unrelated
  // clicks / pointer focus also update it so Tab returning to the section
  // lands on the row the user last touched.
  const [focusedRowId, setFocusedRowId] = useState<string | null>(null);

  const rowRefs = useRef<Map<string, HTMLDivElement | null>>(new Map());

  // Build the flat ordered row list from the projects + expansion state.
  // Each child entry gets a stable `id` of `${projectPath}::${entry.path}`
  // so refs / focus keys survive re-renders as long as the underlying
  // FileTree object identity is stable.
  const rows = useMemo<RowDescriptor[]>(() => {
    const list: RowDescriptor[] = [];
    for (const project of projects) {
      list.push({ id: project.path, kind: "project", project });
      if (expandedPaths.has(project.path)) {
        const children = derivePeekChildren(project.fileTree);
        for (const folder of children.folders) {
          list.push({
            id: `${project.path}::${folder.path}`,
            kind: "child",
            project,
            entry: folder,
          });
        }
        if (children.folderOverflow > 0) {
          list.push({
            id: `${project.path}::__folder-overflow__`,
            kind: "child",
            project,
            overflow: { kind: "folder", count: children.folderOverflow },
          });
        }
        for (const file of children.files) {
          list.push({
            id: `${project.path}::${file.path}`,
            kind: "child",
            project,
            entry: file,
          });
        }
        if (children.fileOverflow > 0) {
          list.push({
            id: `${project.path}::__file-overflow__`,
            kind: "child",
            project,
            overflow: { kind: "file", count: children.fileOverflow },
          });
        }
      }
    }
    return list;
  }, [projects, expandedPaths]);

  const focusRow = useCallback((rowId: string) => {
    const el = rowRefs.current.get(rowId);
    if (el) {
      setFocusedRowId(rowId);
      el.focus();
    }
  }, []);

  const openProject = useCallback(async (project: WorkspaceProject) => {
    if (project.fileTree.length === 0) return;
    const entry = findEntryToOpen(project.fileTree);
    if (!entry) return;
    try {
      const raw = await invoke<string>("read_file", { path: entry.path });
      const fileType = getFileType(entry.name);
      if (fileType === "markdown") {
        const { frontmatter, content } = parseFrontmatter(raw);
        useEditorStore
          .getState()
          .openTab(entry.path, entry.name, content, frontmatter, fileType);
      } else {
        useEditorStore
          .getState()
          .openTab(entry.path, entry.name, raw, null, fileType);
      }
    } catch (error) {
      toast.error(`Failed to open project: ${String(error)}`);
    }
  }, []);

  const toggleExpanded = useCallback(
    (projectPath: string, next: boolean) => {
      setExpandedPaths((prev) => {
        const updated = new Set(prev);
        if (next) updated.add(projectPath);
        else updated.delete(projectPath);
        return updated;
      });
    },
    [],
  );

  const handleProjectKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>, project: WorkspaceProject) => {
      const isExpanded = expandedPaths.has(project.path);
      if (event.key === "ArrowRight") {
        event.preventDefault();
        if (!isExpanded) {
          toggleExpanded(project.path, true);
          return;
        }
        // Already expanded → focus the first child.
        const children = derivePeekChildren(project.fileTree);
        const firstChild = firstChildRowId(project.path, children);
        if (firstChild) focusRow(firstChild);
        return;
      }
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        if (isExpanded) toggleExpanded(project.path, false);
        return;
      }
      if (event.key === "ArrowDown") {
        event.preventDefault();
        const idx = rows.findIndex((r) => r.id === project.path);
        const next = rows[idx + 1];
        if (next) focusRow(next.id);
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        const idx = rows.findIndex((r) => r.id === project.path);
        const prev = rows[idx - 1];
        if (prev) focusRow(prev.id);
        return;
      }
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        void openProject(project);
      }
    },
    [expandedPaths, rows, focusRow, toggleExpanded, openProject],
  );

  const handleChildKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>, row: RowDescriptor) => {
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        focusRow(row.project.path);
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
          useTreeOverlayStore.getState().openOverlay(row.entry.path);
        } else {
          void openFileEntry(row.entry);
        }
      }
    },
    [rows, focusRow],
  );

  const openTreeOverlayForProject = useCallback((projectPath: string) => {
    useTreeOverlayStore.getState().openOverlay(projectPath);
  }, []);

  return (
    <section
      aria-label="Projects"
      className="group/section flex flex-col gap-1"
    >
      <header className="flex items-center justify-between gap-2 px-2 h-6">
        <h2 className="text-xs font-medium tracking-wider uppercase text-muted-foreground">
          Projects
        </h2>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label="Add project"
          onClick={onAdd}
          className="opacity-0 group-hover/section:opacity-100 focus-visible:opacity-100 focus-within:opacity-100 transition-opacity duration-150"
        >
          <Plus strokeWidth={1.5} />
        </Button>
      </header>
      {projects.length > 0 && (
        <ul role="tree" aria-label="Projects" className="flex flex-col m-0 p-0 list-none">
          {projects.map((project) => {
            const isActive =
              !!activeTabPath && activeTabPath.startsWith(project.path + "/");
            const isExpanded = expandedPaths.has(project.path);
            const children = isExpanded
              ? derivePeekChildren(project.fileTree)
              : null;
            return (
              <li key={project.path} className="m-0 p-0">
                <FolderPeek
                  projectPath={project.path}
                  fileTree={project.fileTree}
                  onOpenTreeOverlay={() =>
                    openTreeOverlayForProject(project.path)
                  }
                >
                  <ProjectRow
                    project={project}
                    isActive={isActive}
                    isExpanded={isExpanded}
                    isFocused={focusedRowId === project.path}
                    hasFocusWithin={focusedRowId !== null}
                    onOpen={() => void openProject(project)}
                    onKeyDown={(e) => handleProjectKeyDown(e, project)}
                    onFocus={() => setFocusedRowId(project.path)}
                    registerRef={(el) => rowRefs.current.set(project.path, el)}
                  />
                </FolderPeek>
                {children && (
                  <ul
                    role="group"
                    className="flex flex-col m-0 p-0 list-none pl-4"
                  >
                    {rows
                      .filter(
                        (r) =>
                          r.kind === "child" && r.project.path === project.path,
                      )
                      .map((row) => (
                        <ChildRow
                          key={row.id}
                          row={row}
                          isFocused={focusedRowId === row.id}
                          hasFocusWithin={focusedRowId !== null}
                          onActivate={() => {
                            if (!row.entry) return;
                            if (row.entry.is_directory) {
                              openTreeOverlayForProject(project.path);
                            } else {
                              void openFileEntry(row.entry);
                            }
                          }}
                          onKeyDown={(e) => handleChildKeyDown(e, row)}
                          onFocus={() => setFocusedRowId(row.id)}
                          registerRef={(el) => rowRefs.current.set(row.id, el)}
                        />
                      ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/**
 * First-focusable child row ID for a given project. Returns the first
 * folder, falling back to the first file, and finally to the overflow
 * placeholder if that's all that's visible.
 */
function firstChildRowId(
  projectPath: string,
  children: PeekChildren,
): string | null {
  const firstFolder = children.folders[0];
  if (firstFolder) return `${projectPath}::${firstFolder.path}`;
  const firstFile = children.files[0];
  if (firstFile) return `${projectPath}::${firstFile.path}`;
  if (children.folderOverflow > 0) {
    return `${projectPath}::__folder-overflow__`;
  }
  if (children.fileOverflow > 0) {
    return `${projectPath}::__file-overflow__`;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Row components
// ---------------------------------------------------------------------------

interface ProjectRowProps {
  project: WorkspaceProject;
  isActive: boolean;
  isExpanded: boolean;
  isFocused: boolean;
  hasFocusWithin: boolean;
  onOpen: () => void;
  onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void;
  onFocus: () => void;
  registerRef: (el: HTMLDivElement | null) => void;
}

function ProjectRow({
  project,
  isActive,
  isExpanded,
  isFocused,
  hasFocusWithin,
  onOpen,
  onKeyDown,
  onFocus,
  registerRef,
}: ProjectRowProps) {
  const name = useMemo(() => projectBasename(project.path), [project.path]);
  const hasTree = project.fileTree.length > 0;
  const fileCount = useMemo(
    () => (hasTree ? countMarkdownFiles(project.fileTree) : null),
    [project.fileTree, hasTree],
  );
  const ariaLabel =
    fileCount === null
      ? `Open project ${name}`
      : `Open project ${name} (${fileCount} file${fileCount === 1 ? "" : "s"})`;

  // Roving tabindex — before any focus lands in the tree, the first item
  // should still be reachable via Tab, so default to tabIndex 0 when the
  // section has no focused row yet.
  const tabIndex = isFocused || !hasFocusWithin ? 0 : -1;

  return (
    <div
      ref={registerRef}
      role="treeitem"
      aria-level={1}
      aria-expanded={isExpanded}
      aria-selected={isFocused ? "true" : undefined}
      aria-label={ariaLabel}
      aria-current={isActive ? "true" : undefined}
      data-active={isActive ? "true" : undefined}
      data-row-type="project"
      tabIndex={tabIndex}
      onClick={onOpen}
      onKeyDown={onKeyDown}
      onFocus={onFocus}
      className={cn(
        "h-7 px-2 flex items-center gap-2 rounded-sm cursor-pointer text-sm",
        "text-foreground/90 transition-colors duration-150",
        "hover:bg-muted/50",
        "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--accent,var(--primary))]",
        isActive && "bg-muted",
      )}
    >
      <Folder
        className="h-3.5 w-3.5 shrink-0 text-muted-foreground/70"
        strokeWidth={1.5}
        aria-hidden="true"
      />
      <span className="truncate min-w-0 flex-1">{name}</span>
      {fileCount !== null && (
        <span className="ml-auto text-xs text-muted-foreground tabular-nums">
          {fileCount}
        </span>
      )}
    </div>
  );
}

interface ChildRowProps {
  row: RowDescriptor;
  isFocused: boolean;
  hasFocusWithin: boolean;
  onActivate: () => void;
  onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void;
  onFocus: () => void;
  registerRef: (el: HTMLDivElement | null) => void;
}

function ChildRow({
  row,
  isFocused,
  hasFocusWithin,
  onActivate,
  onKeyDown,
  onFocus,
  registerRef,
}: ChildRowProps) {
  // Roving tabindex — child rows only participate in focus order once the
  // user has entered the tree. Otherwise they stay out of the Tab sequence.
  const tabIndex = isFocused ? 0 : -1;

  if (row.overflow) {
    // Overflow rows are focusable markers with no interactive action, so
    // arrow-key navigation can still visit them. They are not announced
    // as activatable — Enter is a no-op.
    return (
      <div
        ref={registerRef}
        role="treeitem"
        aria-level={2}
        aria-disabled="true"
        aria-label={`${row.overflow.count} more ${row.overflow.kind}${row.overflow.count === 1 ? "" : "s"}`}
        data-row-type="child-overflow"
        tabIndex={hasFocusWithin ? tabIndex : -1}
        onKeyDown={onKeyDown}
        onFocus={onFocus}
        className={cn(
          "h-6 px-2 flex items-center text-xs text-muted-foreground",
          "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--accent,var(--primary))]",
        )}
      >
        +{row.overflow.count} more…
      </div>
    );
  }

  const entry = row.entry;
  if (!entry) return null;

  const Icon = entry.is_directory ? Folder : FileText;
  const ariaLabel = entry.is_directory
    ? `Open folder ${entry.name}`
    : `Open file ${entry.name}`;

  return (
    <div
      ref={registerRef}
      role="treeitem"
      aria-level={2}
      aria-selected={isFocused ? "true" : undefined}
      aria-label={ariaLabel}
      data-row-type="child"
      data-row-kind={entry.is_directory ? "folder" : "file"}
      tabIndex={hasFocusWithin ? tabIndex : -1}
      onClick={onActivate}
      onKeyDown={onKeyDown}
      onFocus={onFocus}
      className={cn(
        "h-7 px-2 flex items-center gap-2 rounded-sm cursor-pointer text-sm",
        "text-foreground/90 transition-colors duration-150",
        "hover:bg-muted/50",
        "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--accent,var(--primary))]",
      )}
    >
      <Icon
        className="h-3.5 w-3.5 shrink-0 text-muted-foreground/70"
        strokeWidth={1.5}
        aria-hidden="true"
      />
      <span className="truncate min-w-0 flex-1">{entry.name}</span>
    </div>
  );
}
