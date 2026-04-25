import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { Folder, FileText, Plus } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useWorkspaceStore, type WorkspaceProject } from "@/stores/workspace-store";
import { useEditorStore } from "@/stores/editor-store";
import { useSettingsStore } from "@/stores/settings-store";
import { useTreeOverlayStore } from "@/stores/tree-overlay-store";
import { useQuietSidebarStore } from "@/stores/quiet-sidebar-store";
import { useFileOperations } from "@/hooks/useFileOperations";
import { parseFrontmatter } from "@/lib/frontmatter";
import { getFileType } from "@/lib/file-utils";
import { tauriApi, type FileEntry } from "@/lib/tauri";
import { cn } from "@/lib/utils";
import { FolderPeek, derivePeekChildren, type PeekChildren } from "./FolderPeek";
import { beginFileDrag } from "./file-drag";
import {
  SIDEBAR_ENTER_RENAME_MODE_EVENT,
  SidebarContextMenu,
} from "@/components/sidebar/quiet/SidebarContextMenu";
import { SidebarInlineEdit } from "@/components/sidebar/quiet/SidebarInlineEdit";
import { SidebarRowIndicators } from "@/components/sidebar/quiet/SidebarRowIndicators";
import {
  basename as pathBasename,
  resolveRenamePath,
  validateCreateBasename,
  validateRenameBasename,
} from "@/components/sidebar/quiet/rename-utils";
import {
  isContextMenuKey,
  openContextMenuOnElement,
} from "@/components/sidebar/quiet/useSidebarItemShortcuts";
import { announce } from "@/components/sidebar/quiet/aria-announcer";

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
  /**
   * Case-insensitive substring filter applied to project display names
   * (the basename of `project.path`). Inline-expanded children are NOT
   * filtered — if a parent project matches, its expanded tree stays intact.
   * Task #43 — sidebar type-to-filter. Empty / undefined = no filter.
   */
  filter?: string;
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
 * Build a `validate` callback for the inline project-create input.
 *
 * Rejects:
 *   - Slashes — projects are always a single folder directly under the
 *     Notesage library root. Nested paths are not supported from this UI.
 *   - Names beginning with `.` — dot-prefixed folders are treated as hidden
 *     metadata directories elsewhere in the app.
 *   - Names that collide (case-sensitively, by basename) with an already
 *     open project.
 *
 * Empty inputs return `null` — SidebarInlineEdit auto-cancels those before
 * this function is consulted.
 */
export function buildProjectNameValidator(
  existingBasenames: Set<string>,
): (input: string) => string | null {
  return (input: string) => {
    const trimmed = input.trim();
    if (trimmed.length === 0) return null;
    if (trimmed.includes("/")) return "Name cannot contain slashes";
    if (trimmed.startsWith(".")) return "Name cannot start with a dot";
    if (existingBasenames.has(trimmed)) return "Project already exists";
    return null;
  };
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

export function ProjectsSection({ onAdd, filter }: ProjectsSectionProps) {
  const allProjects = useWorkspaceStore((s) => s.projects);
  const activeTabPath = useEditorStore((s) => {
    const id = s.activeTabId;
    if (!id) return null;
    const tab = s.openDocuments.find((t) => t.id === id);
    return tab?.filePath ?? null;
  });

  // Filter projects by basename (case-insensitive substring). Expanded
  // children of a matching parent are preserved — we filter the project
  // list only, not the nested trees.
  const projects = useMemo(
    () =>
      filter
        ? allProjects.filter((p) =>
            projectBasename(p.path)
              .toLowerCase()
              .includes(filter.toLowerCase()),
          )
        : allProjects,
    [allProjects, filter],
  );

  // Each project's inline-expanded state is independent — this set tracks
  // absolute project paths that the user has expanded via ArrowRight.
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set());

  // Task #40 — inline rename for child FILE rows. Project roots are NOT
  // renameable in this task (bigger blast radius; separate follow-up).
  const [renamingPath, setRenamingPath] = useState<string | null>(null);
  const { renamePath, createFile, createFolder, openFile } = useFileOperations();

  // Task #41 — inline create note. The pending signal comes from either the
  // `⌘N` handler in `QuietLayout` or the per-row `+` button below. The
  // owning project (`parentDir` equals project.path OR starts with
  // `project.path + "/"`) is auto-expanded so the inline input appears as
  // the first row in its child tree.
  const pendingCreate = useQuietSidebarStore((s) => s.pendingCreate);
  const setPendingCreate = useQuietSidebarStore((s) => s.setPendingCreate);

  // Task #42 — inline create project. Flag driven by `⌘⇧N` in QuietLayout
  // or the section-header `+` button. When set, we render a
  // SidebarInlineEdit row at the very top of the projects list (above
  // any existing rows) that creates a new empty folder under the Notesage
  // library root and registers it via workspace-store.addProject.
  const pendingCreateProject = useQuietSidebarStore(
    (s) => s.pendingCreateProject,
  );
  const setPendingCreateProject = useQuietSidebarStore(
    (s) => s.setPendingCreateProject,
  );

  const pendingCreateProjectPath = useMemo(() => {
    if (!pendingCreate) return null;
    for (const p of projects) {
      if (
        pendingCreate.parentDir === p.path ||
        pendingCreate.parentDir.startsWith(p.path + "/")
      ) {
        return p.path;
      }
    }
    return null;
  }, [pendingCreate, projects]);

  // Auto-expand the owning project when a pending create is set for it.
  useEffect(() => {
    if (!pendingCreateProjectPath) return;
    setExpandedPaths((prev) => {
      if (prev.has(pendingCreateProjectPath)) return prev;
      const next = new Set(prev);
      next.add(pendingCreateProjectPath);
      return next;
    });
  }, [pendingCreateProjectPath]);

  const handleCreateCommit = useCallback(
    async (parentDir: string, trimmedName: string) => {
      const fileName = trimmedName.includes(".")
        ? trimmedName
        : `${trimmedName}.md`;
      const filePath = `${parentDir}/${fileName}`;
      // Clear pending state up front so a slow createFile doesn't leave the
      // input hanging in the DOM. If creation fails we surface the toast
      // and the user re-triggers from scratch.
      setPendingCreate(null);
      try {
        await createFile(parentDir, fileName);
        await openFile(filePath, fileName);
        toast.success(`Created ${fileName}`);
      } catch (error) {
        toast.error(`Failed to create: ${error}`);
      }
    },
    [createFile, openFile, setPendingCreate],
  );

  const handleCreateCancel = useCallback(() => {
    setPendingCreate(null);
  }, [setPendingCreate]);

  /** Handler for the per-row `+` button. Sets pending state at the project
   *  root (not at the active tab's parent — that's what `⌘N` is for). */
  const handleAddToProject = useCallback(
    (projectPath: string) => {
      setPendingCreate({ parentDir: projectPath });
    },
    [setPendingCreate],
  );

  // Task #42 — inline create project. The set of existing project
  // basenames is used by the validator to reject duplicates before we
  // hit the filesystem. Derived from `allProjects` (pre-filter) so the
  // duplicate check doesn't miss projects the user has filtered out.
  const existingProjectBasenames = useMemo(() => {
    const set = new Set<string>();
    for (const p of allProjects) {
      set.add(projectBasename(p.path));
    }
    return set;
  }, [allProjects]);

  const validateProjectName = useMemo(
    () => buildProjectNameValidator(existingProjectBasenames),
    [existingProjectBasenames],
  );

  const handleCreateProjectCommit = useCallback(
    async (trimmedName: string) => {
      // Resolve the Notesage library root. After `useAppLifecycle.reloadTrees`,
      // `notesRootPath` is an expanded absolute path. Before that, it still
      // carries a leading `~` — we bail rather than feed a non-absolute path
      // to `create_directory`.
      const libraryRoot = useSettingsStore.getState().notesRootPath;
      if (!libraryRoot || libraryRoot.startsWith("~")) {
        toast.error("Notesage library is not ready yet — try again in a moment");
        setPendingCreateProject(false);
        return;
      }

      const projectPath = `${libraryRoot}/${trimmedName}`;

      // Clear the pending flag up front so a slow create doesn't leave the
      // input hanging in the DOM. Toast reports any failure; the user can
      // retrigger from scratch.
      setPendingCreateProject(false);

      try {
        await createFolder(libraryRoot, trimmedName);
        // Phase 1: projects start empty — no templates, no goal files,
        // no iCloud migration. The freshly-created directory is empty, so
        // the tree snapshot is predictable; we still fetch it via the same
        // command the rest of the app uses for consistency.
        let tree: FileEntry[] = [];
        try {
          tree = await tauriApi.listDirectory(projectPath, false);
        } catch {
          // Expected: on some filesystems (iCloud, permission-restricted
          // mounts) a freshly-created directory may briefly not list. An
          // empty tree is still a valid initial state — the watcher will
          // refresh it on the next event.
        }
        useWorkspaceStore.getState().addProject(projectPath, tree);
        toast.success(`Created project ${trimmedName}`);
      } catch (error) {
        toast.error(`Failed to create project: ${error}`);
      }
    },
    [createFolder, setPendingCreateProject],
  );

  const handleCreateProjectCancel = useCallback(() => {
    setPendingCreateProject(false);
  }, [setPendingCreateProject]);

  const startRename = useCallback((path: string) => {
    setRenamingPath(path);
  }, []);
  const cancelRename = useCallback(() => setRenamingPath(null), []);
  const commitRename = useCallback(
    async (oldPath: string, newBasename: string) => {
      setRenamingPath(null);
      const oldName = pathBasename(oldPath);
      if (newBasename === oldName) return;
      const newPath = resolveRenamePath(oldPath, newBasename);
      try {
        await renamePath(oldPath, newPath);
        toast.success(`Renamed to ${pathBasename(newPath)}`);
      } catch (error) {
        toast.error(`Failed to rename: ${error}`);
      }
    },
    [renamePath],
  );

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

  // Collect every currently-visible child FILE path so the event listener
  // can decide whether it owns this rename request. Projects + folders +
  // overflow markers are intentionally excluded — they are not renameable
  // in this task.
  const visibleChildFilePaths = useMemo(() => {
    const paths = new Set<string>();
    for (const row of rows) {
      if (
        row.kind === "child" &&
        row.entry &&
        !row.entry.is_directory
      ) {
        paths.add(row.entry.path);
      }
    }
    return paths;
  }, [rows]);

  // Rename context-menu event. Only activate on visible child file paths;
  // project roots and folders are skipped.
  useEffect(() => {
    function handleRenameEvent(event: Event) {
      const detail = (event as CustomEvent<{ filePath: string }>).detail;
      if (!detail?.filePath) return;
      if (!visibleChildFilePaths.has(detail.filePath)) return;
      setRenamingPath(detail.filePath);
    }
    window.addEventListener(
      SIDEBAR_ENTER_RENAME_MODE_EVENT,
      handleRenameEvent,
    );
    return () => {
      window.removeEventListener(
        SIDEBAR_ENTER_RENAME_MODE_EVENT,
        handleRenameEvent,
      );
    };
  }, [visibleChildFilePaths]);

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
      // #80 — keyboard context-menu gesture (Menu key / Shift+F10 / ⌘⇧,).
      // Synthesises a contextmenu event on the focused row so the project's
      // SidebarContextMenu opens from the keyboard. Currently no
      // SidebarContextMenu is mounted on the project row itself (only on
      // child file rows), so this is wired forward-compatibly: the synthetic
      // event bubbles, and any future ContextMenuTrigger on the project
      // level will pick it up. Today it's a no-op for projects but matches
      // the gesture across all sections.
      if (isContextMenuKey(event)) {
        event.preventDefault();
        event.stopPropagation();
        const el = rowRefs.current.get(project.path);
        if (el) openContextMenuOnElement(el);
        return;
      }
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
      // #80 — keyboard context-menu gesture on a child row (file or folder).
      // Files have a SidebarContextMenu wrapper in this section's children
      // hierarchy so the synthetic event opens the menu; folders do not yet
      // (out of scope), but the dispatch is harmless for them.
      if (isContextMenuKey(event)) {
        event.preventDefault();
        event.stopPropagation();
        const el = rowRefs.current.get(row.id);
        if (el) openContextMenuOnElement(el);
        return;
      }
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
      {(projects.length > 0 || pendingCreateProject) && (
        <ul role="tree" aria-label="Projects" className="flex flex-col m-0 p-0 list-none">
          {pendingCreateProject && (
            <li
              className="m-0 p-0"
              data-pending-create-project="true"
            >
              <div className="h-7 px-2 flex items-center gap-2">
                <Folder
                  className="h-3.5 w-3.5 shrink-0 text-muted-foreground/70"
                  strokeWidth={1.5}
                  aria-hidden="true"
                />
                <SidebarInlineEdit
                  mode="create"
                  placeholder="New project"
                  validate={validateProjectName}
                  onCommit={(value) =>
                    void handleCreateProjectCommit(value)
                  }
                  onCancel={handleCreateProjectCancel}
                  className="flex-1 min-w-0"
                />
              </div>
            </li>
          )}
          {projects.map((project) => {
            const isActive =
              !!activeTabPath && activeTabPath.startsWith(project.path + "/");
            const isExpanded = expandedPaths.has(project.path);
            const children = isExpanded
              ? derivePeekChildren(project.fileTree)
              : null;
            const isPendingCreateHere =
              pendingCreateProjectPath === project.path && !!pendingCreate;
            return (
              <li key={project.path} className="m-0 p-0">
                <FolderPeek
                  projectPath={project.path}
                  fileTree={project.fileTree}
                  onOpenTreeOverlay={() =>
                    openTreeOverlayForProject(project.path)
                  }
                >
                  {/* Live-test 2026-04-25: project rows were dropping
                      to the OS browser context menu on right-click —
                      they hadn't been wrapped in `SidebarContextMenu`
                      (the comment at #80 about being "wired forward-
                      compatibly" never got fulfilled). Wrap the row so
                      right-click opens our menu with the full project-
                      kind action set. */}
                  <SidebarContextMenu
                    filePath={project.path}
                    kind="project"
                    onOpen={() => void openProject(project)}
                  >
                    {/* Live-test 2026-04-25 (#140): the previous wrapping
                        attempt put `<ProjectRow />` directly under
                        `<ContextMenuTrigger asChild>`. Radix's Slot uses
                        cloneElement to inject `onContextMenu` and a ref
                        onto the child element — but `ProjectRow` is a
                        function component that destructures only its
                        explicit props, so the injected handler / ref were
                        silently dropped and the OS native context menu
                        kept appearing. Wrapping with a passthrough <div>
                        makes the immediate Slot target a raw DOM element
                        so the prop injection lands. The wrapper has no
                        styling — `<li>` is `m-0 p-0` and the row's own
                        height/padding is unchanged. */}
                    <div>
                      <ProjectRow
                        project={project}
                        isActive={isActive}
                        isExpanded={isExpanded}
                        isFocused={focusedRowId === project.path}
                        hasFocusWithin={focusedRowId !== null}
                        onOpen={() => void openProject(project)}
                        onKeyDown={(e) => handleProjectKeyDown(e, project)}
                        onFocus={() => setFocusedRowId(project.path)}
                        onAddNote={() => handleAddToProject(project.path)}
                        registerRef={(el) =>
                          rowRefs.current.set(project.path, el)
                        }
                      />
                    </div>
                  </SidebarContextMenu>
                </FolderPeek>
                {(children || isPendingCreateHere) && (
                  <ul
                    role="group"
                    className="flex flex-col m-0 p-0 list-none pl-4"
                  >
                    {isPendingCreateHere && pendingCreate && (
                      <li
                        className="m-0 p-0"
                        data-pending-create="true"
                        data-pending-create-parent={pendingCreate.parentDir}
                      >
                        <div className="h-7 px-2 flex items-center gap-2">
                          <FileText
                            className="h-3.5 w-3.5 shrink-0 text-muted-foreground/70"
                            strokeWidth={1.5}
                            aria-hidden="true"
                          />
                          <SidebarInlineEdit
                            mode="create"
                            placeholder="note.md"
                            validate={validateCreateBasename}
                            onCommit={(value) =>
                              void handleCreateCommit(
                                pendingCreate.parentDir,
                                value,
                              )
                            }
                            onCancel={handleCreateCancel}
                            className="flex-1 min-w-0"
                          />
                        </div>
                      </li>
                    )}
                    {rows
                      .filter(
                        (r) =>
                          r.kind === "child" && r.project.path === project.path,
                      )
                      .map((row) => {
                        const childRow = (
                          <ChildRow
                            key={row.id}
                            row={row}
                            isFocused={focusedRowId === row.id}
                            hasFocusWithin={focusedRowId !== null}
                            isRenaming={
                              !!row.entry && renamingPath === row.entry.path
                            }
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
                            onStartRename={startRename}
                            onCommitRename={commitRename}
                            onCancelRename={cancelRename}
                            registerRef={(el) =>
                              rowRefs.current.set(row.id, el)
                            }
                          />
                        );
                        // Live-test 2026-04-25 (#140): wrapping the
                        // ChildRow function component directly under
                        // `<SidebarContextMenu>` (which uses
                        // `<ContextMenuTrigger asChild>`) silently dropped
                        // Radix's injected `onContextMenu` / ref because
                        // the row only destructures its own props. The OS
                        // native menu appeared on right-click. The
                        // passthrough <div> wrapper exposes a raw DOM
                        // element to Radix's Slot so the prop injection
                        // lands; the row's own layout is unchanged.
                        if (!row.entry) return childRow;
                        return (
                          <SidebarContextMenu
                            key={row.id}
                            filePath={row.entry.path}
                            kind={row.entry.is_directory ? "folder" : "file"}
                          >
                            <div>{childRow}</div>
                          </SidebarContextMenu>
                        );
                      })}
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
  onAddNote: () => void;
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
  onAddNote,
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
        "group/row h-7 px-2 flex items-center gap-2 rounded-sm cursor-pointer text-sm",
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
      {/* #129 — per-project visual state. Surfaces the AI-lock padlock,
         *  the aggregate git "●" glyph when any file inside the project
         *  has changes, and the pending-external-change dot. */}
      <SidebarRowIndicators path={project.path} kind="project" />
      {/* Live-test 2026-04-25 — alignment, take 2. The number stays
       *  RIGHT-ALIGNED at the row's right padding edge (matching the
       *  Pinned/Recent time hints, which use `ml-auto` to anchor to
       *  the same edge). The hover `+` button overlays the slot at
       *  the same right edge — the button is 24×24 so its centre sits
       *  12 px in from the right edge, exactly matching the section-
       *  header `+` centre. Slot height bumped to h-6 (24 px) so the
       *  button's hover highlight is no longer clipped by an h-5 slot
       *  bound. `min-w-6` keeps the slot at least button-wide while
       *  letting wider numbers (3+ digits) push the slot out without
       *  pushing the button glyph off-centre. */}
      <span
        className="relative inline-flex h-6 min-w-6 items-center justify-end shrink-0"
        aria-hidden={fileCount === null ? undefined : "false"}
      >
        {fileCount !== null && (
          <span className="text-xs text-muted-foreground tabular-nums opacity-100 group-hover/row:opacity-0 group-focus-within/row:opacity-0 transition-opacity duration-150">
            {fileCount}
          </span>
        )}
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label={`New note in ${name}`}
          tabIndex={-1}
          onClick={(event) => {
            event.stopPropagation();
            onAddNote();
          }}
          // Anchor the button to the slot's top-right. The button is
          // 24×24 (size-icon-xs) and the slot is h-6 (24 px), so it
          // fills the vertical space exactly — no clipping. Right edge
          // = slot right = row right - px-2 (8 px), so its centre lines
          // up with the section-header `+` centre (row right - 20 px).
          className="absolute right-0 top-0 opacity-0 group-hover/row:opacity-100 group-focus-within/row:opacity-100 focus-visible:opacity-100 transition-opacity duration-150"
        >
          <Plus strokeWidth={1.5} />
        </Button>
      </span>
    </div>
  );
}

interface ChildRowProps {
  row: RowDescriptor;
  isFocused: boolean;
  hasFocusWithin: boolean;
  isRenaming: boolean;
  onActivate: () => void;
  onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void;
  onFocus: () => void;
  onStartRename: (path: string) => void;
  onCommitRename: (oldPath: string, newBasename: string) => void;
  onCancelRename: () => void;
  registerRef: (el: HTMLDivElement | null) => void;
}

function ChildRow({
  row,
  isFocused,
  hasFocusWithin,
  isRenaming,
  onActivate,
  onKeyDown,
  onFocus,
  onStartRename,
  onCommitRename,
  onCancelRename,
  registerRef,
}: ChildRowProps) {
  // Roving tabindex — child rows only participate in focus order once the
  // user has entered the tree. Otherwise they stay out of the Tab sequence.
  const tabIndex = isFocused ? 0 : -1;
  const internalRef = useRef<HTMLDivElement | null>(null);
  const setRef = (el: HTMLDivElement | null) => {
    internalRef.current = el;
    registerRef(el);
  };

  // Restore focus to the row when rename mode ends.
  const wasRenamingRef = useRef(false);
  useEffect(() => {
    if (wasRenamingRef.current && !isRenaming) {
      internalRef.current?.focus();
    }
    wasRenamingRef.current = isRenaming;
  }, [isRenaming]);

  // #80 — announce the rename transition to screen readers via aria-live.
  // Mirrors PinnedRow / RecentRow exactly so every section produces the same
  // SR output ("Renaming <filename>") on F2 / double-click / context-menu
  // entry into rename mode.
  const prevRenamingRef = useRef(false);
  useEffect(() => {
    if (isRenaming && !prevRenamingRef.current && row.entry) {
      announce(`Renaming ${row.entry.name}`);
    }
    prevRenamingRef.current = isRenaming;
  }, [isRenaming, row.entry]);

  if (row.overflow) {
    // Overflow rows are focusable markers with no interactive action, so
    // arrow-key navigation can still visit them. They are not announced
    // as activatable — Enter is a no-op.
    return (
      <div
        ref={setRef}
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
  // File children are draggable into the Pinned section (#44). Folders are
  // not — only file paths can be pinned in Phase 1. Projects themselves
  // (row.kind === "project") stay non-draggable too.
  const draggable = !entry.is_directory;
  // Rename support — files only. Folders and project roots are explicitly
  // out of scope in this task.
  const renameable = !entry.is_directory;

  // Chain rename-aware handling with the parent's navigation handler.
  const handleRowKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (renameable && event.key === "F2") {
      event.preventDefault();
      onStartRename(entry.path);
      return;
    }
    onKeyDown(event);
  };

  const handleRowClick = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (renameable && event.detail === 2) {
      event.preventDefault();
      event.stopPropagation();
      onStartRename(entry.path);
      return;
    }
    onActivate();
  };

  return (
    <div
      ref={setRef}
      role="treeitem"
      aria-level={2}
      aria-selected={isFocused ? "true" : undefined}
      aria-label={ariaLabel}
      data-row-type="child"
      data-row-kind={entry.is_directory ? "folder" : "file"}
      data-renaming={isRenaming ? "true" : undefined}
      tabIndex={hasFocusWithin ? tabIndex : -1}
      draggable={draggable && !isRenaming}
      onClick={isRenaming ? undefined : handleRowClick}
      onKeyDown={isRenaming ? undefined : handleRowKeyDown}
      onFocus={onFocus}
      onDragStart={
        draggable && !isRenaming
          ? (e) => {
              beginFileDrag(e, entry.path);
            }
          : undefined
      }
      className={cn(
        "h-7 px-2 flex items-center gap-2 rounded-sm text-sm",
        "text-foreground/90 transition-colors duration-150",
        !isRenaming && "hover:bg-muted/50 cursor-pointer",
        "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--accent,var(--primary))]",
      )}
    >
      <Icon
        className="h-3.5 w-3.5 shrink-0 text-muted-foreground/70"
        strokeWidth={1.5}
        aria-hidden="true"
      />
      {isRenaming ? (
        <SidebarInlineEdit
          mode="rename"
          initialValue={entry.name}
          validate={validateRenameBasename}
          onCommit={(value) => onCommitRename(entry.path, value)}
          onCancel={onCancelRename}
          className="flex-1 min-w-0"
        />
      ) : (
        <>
          <span className="truncate min-w-0 flex-1">{entry.name}</span>
          {/* #129 — per-row visual state. File rows surface git status +
             *  external-change; folder rows only surface the aggregate
             *  "●" when the folder contains changes. */}
          <SidebarRowIndicators
            path={entry.path}
            kind={entry.is_directory ? "folder" : "file"}
          />
        </>
      )}
    </div>
  );
}
