import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { Folder, FileText, Plus } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useWorkspaceStore, type WorkspaceProject } from "@/stores/workspace-store";
import { useEditorStore } from "@/stores/editor-store";
import { useSettingsStore } from "@/stores/settings-store";
import { useFileOperations } from "@/hooks/useFileOperations";
import { parseFrontmatter } from "@/lib/frontmatter";
import { getFileType, isBinaryFileType } from "@/lib/file-utils";
import { setBinaryData } from "@/lib/binary-cache";
import { tauriApi, type FileEntry } from "@/lib/tauri";
import { FolderPeek, derivePeekChildren, type PeekChildren } from "./FolderPeek";
import { FilePreview, isPreviewable } from "./FilePreview";
import { subscribeToSidebarEvents } from "@/lib/sidebar-events";
import { SidebarContextMenu } from "@/components/sidebar/quiet/SidebarContextMenu";
import { SidebarInlineEdit } from "@/components/sidebar/quiet/SidebarInlineEdit";
import { validateCreateBasename } from "@/components/sidebar/quiet/rename-utils";
import {
  isContextMenuKey,
  openContextMenuOnElement,
} from "@/components/sidebar/quiet/useSidebarItemShortcuts";
import {
  isSystemFolderName,
  countMarkdownFiles,
  buildProjectNameValidator,
  CHILD_GUIDE_OFFSET,
  insertChildRows,
  projectBasename,
  type RowDescriptor,
} from "./project-section-utils";
import { ProjectRow } from "./ProjectRow";
import { ChildRow } from "./ChildRow";
import { useProjectInlineEdit } from "./useProjectInlineEdit";
import { useInboxActions } from "@/components/inbox/useInboxActions";
import { t } from "@/lib/i18n";

// ---------------------------------------------------------------------------
// Re-exports for backward compatibility with existing tests / callers
// ---------------------------------------------------------------------------
export { isSystemFolderName, countMarkdownFiles, buildProjectNameValidator };
export type { RowDescriptor };

/**
 * ProjectsSection (quiet variant) — flat list of projects with `.md` file
 * counts plus keyboard-driven one-level inline expansion (task #37).
 *
 * The sidebar is wired to `workspace-store.projects`.
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
 * Pick which file to open when the user clicks a project row.
 *
 * Live-test 2026-04-26 — preference chain matches what VS Code, Bear,
 * and Obsidian do: "give me where I left off."
 *
 *   1. Most recently opened file under this project path (from
 *      `editor-store.recentFiles`). Survives across app restarts because
 *      the recents list is persisted.
 *   2. README (case-insensitive `readme.md` at top level) — useful for
 *      fresh projects you've never opened a file in.
 *   3. First `.md` anywhere in the tree (depth-first) — last-ditch
 *      fallback so something always opens.
 *
 * Returns `null` only when the project has no markdown file at all.
 */
function findEntryToOpen(
  projectPath: string,
  tree: FileEntry[],
  recentFiles: ReadonlyArray<{ path: string; lastAccessedAt?: number }>,
): FileEntry | null {
  const projectPrefix = projectPath.endsWith("/")
    ? projectPath
    : projectPath + "/";
  const findInTree = (
    entries: FileEntry[],
    target: string,
  ): FileEntry | null => {
    for (const entry of entries) {
      if (!entry.is_directory && entry.path === target) return entry;
      if (entry.is_directory && entry.children && target.startsWith(entry.path)) {
        const found = findInTree(entry.children, target);
        if (found) return found;
      }
    }
    return null;
  };
  for (const recent of recentFiles) {
    if (!recent.path.startsWith(projectPrefix)) continue;
    const match = findInTree(tree, recent.path);
    if (match) return match;
  }

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

/**
 * Opens a file via `read_file`, routing through the parse-frontmatter /
 * openTab pipeline shared by the rest of the quiet sidebar. Shows a toast
 * on failure.
 *
 * Live-test 2026-04-25 — guard against binary file types (PDF, EPUB,
 * DOCX, images, etc.). The previous implementation always called the
 * UTF-8 `read_file` command, which crashes with "stream did not contain
 * valid UTF-8" on binary content. We now check `isBinaryFileType`
 * first and use `readBinaryFile` for those — matching the path
 * `useFileOperations.openFile` takes for the same case.
 */
async function openFileEntry(entry: FileEntry): Promise<void> {
  try {
    const fileType = getFileType(entry.name);
    if (fileType === "image" || isBinaryFileType(fileType)) {
      if (isBinaryFileType(fileType)) {
        const bytes = await tauriApi.readBinaryFile(entry.path);
        setBinaryData(entry.path, new Uint8Array(bytes));
      }
      useEditorStore
        .getState()
        .openTab(entry.path, entry.name, "", null, fileType);
      return;
    }
    const raw = await invoke<string>("read_file", { path: entry.path });
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
  // Drop-to-file: an Inbox selection (or any sidebar file) dropped on a
  // project row moves into that project, carrying its read-later state.
  const { fileTo } = useInboxActions();
  const allProjects = useWorkspaceStore((s) => s.projects);
  const activeTabPath = useEditorStore((s) => {
    const id = s.activeTabId;
    if (!id) return null;
    const tab = s.openDocuments.find((t) => t.id === id);
    return tab?.filePath ?? null;
  });
  const showHiddenFiles = useSettingsStore((s) => s.showHiddenFiles);

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

  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set());
  const [expandedChildPaths, setExpandedChildPaths] = useState<Set<string>>(new Set());

  const { renamePath, createFile, createFolder, openFile } = useFileOperations();

  // Roving tabindex
  const [focusedRowId, setFocusedRowId] = useState<string | null>(null);
  const rowRefs = useRef<Map<string, HTMLDivElement | null>>(new Map());

  // Build the flat ordered row list from the projects + expansion state.
  const rows = useMemo<RowDescriptor[]>(() => {
    const list: RowDescriptor[] = [];
    for (const project of projects) {
      list.push({ id: project.path, kind: "project", project });
      if (expandedPaths.has(project.path)) {
        const children = derivePeekChildren(project.fileTree, {
          showHidden: showHiddenFiles,
        });
        for (const folder of children.folders) {
          list.push({
            id: `${project.path}::${folder.path}`,
            kind: "child",
            project,
            entry: folder,
            depth: 1,
          });
          if (expandedChildPaths.has(folder.path)) {
            insertChildRows(list, folder.children ?? [], project, expandedChildPaths, showHiddenFiles, 2);
          }
        }
        for (const file of children.files) {
          list.push({
            id: `${project.path}::${file.path}`,
            kind: "child",
            project,
            entry: file,
            depth: 1,
          });
        }
      }
    }
    return list;
  }, [projects, expandedPaths, expandedChildPaths, showHiddenFiles]);

  // Collect visible child paths for the SIDEBAR_ENTER_RENAME_MODE_EVENT filter.
  const visibleChildPaths = useMemo(() => {
    const paths = new Set<string>();
    for (const row of rows) {
      if (row.kind === "child" && row.entry) {
        paths.add(row.entry.path);
      }
    }
    return paths;
  }, [rows]);

  // ── Inline edit / rename hook ──────────────────────────────────────────────
  const {
    renamingPath,
    renamingProjectPath,
    startRename,
    cancelRename,
    commitRename,
    startProjectRename,
    cancelProjectRename,
    commitProjectRename,
    pendingCreate,
    pendingCreateProjectPath,
    handleCreateCommit,
    handleCreateCancel,
    handleAddToProject,
    pendingCreateProject,
    validateProjectName,
    handleCreateProjectCommit,
    handleCreateProjectCancel,
  } = useProjectInlineEdit({
    projects,
    visibleChildPaths,
    setExpandedPaths,
    renamePath,
    createFile,
    createFolder,
    openFile,
  });

  const focusRow = useCallback((rowId: string) => {
    const el = rowRefs.current.get(rowId);
    if (el) {
      setFocusedRowId(rowId);
      el.focus();
    }
  }, []);

  // Sidebar-simplification task #5 — listen for `expand-path` events on
  // the shared `sidebar-events` bus.
  useEffect(() => {
    const ourProjects = new Set(projects.map((p) => p.path));
    const unsubscribe = subscribeToSidebarEvents((event) => {
      if (event.type !== "expand-path") return;
      if (!ourProjects.has(event.projectPath)) return;
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
          const projectEl = rowRefs.current.get(event.projectPath);
          if (projectEl) {
            setFocusedRowId(event.projectPath);
            projectEl.focus();
          }
        }
      });
    });
    return unsubscribe;
  }, [projects]);

  const openProject = useCallback(async (project: WorkspaceProject) => {
    if (project.fileTree.length === 0) return;
    const recentFiles = useEditorStore.getState().recentFiles;
    const entry = findEntryToOpen(project.path, project.fileTree, recentFiles);
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
      if (event.key === "F2") {
        event.preventDefault();
        startProjectRename(project.path);
        return;
      }
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
        const children = derivePeekChildren(project.fileTree, {
          showHidden: showHiddenFiles,
        });
        if (children.isEmpty) return;
        if (!isExpanded) {
          toggleExpanded(project.path, true);
          return;
        }
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
        const isExpanded = expandedPaths.has(project.path);
        toggleExpanded(project.path, !isExpanded);
      }
    },
    [expandedPaths, rows, focusRow, toggleExpanded, openProject, showHiddenFiles],
  );

  const handleChildKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>, row: RowDescriptor) => {
      if (isContextMenuKey(event)) {
        event.preventDefault();
        event.stopPropagation();
        const el = rowRefs.current.get(row.id);
        if (el) openContextMenuOnElement(el);
        return;
      }
      if (event.key === "ArrowRight" && row.entry?.is_directory) {
        event.preventDefault();
        if (!expandedChildPaths.has(row.entry.path)) {
          setExpandedChildPaths((prev) => {
            const next = new Set(prev);
            next.add(row.entry!.path);
            return next;
          });
        }
        return;
      }
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        if (row.entry?.is_directory && expandedChildPaths.has(row.entry.path)) {
          setExpandedChildPaths((prev) => {
            const next = new Set(prev);
            next.delete(row.entry!.path);
            return next;
          });
        } else {
          focusRow(row.project.path);
        }
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
          setExpandedChildPaths((prev) => {
            const next = new Set(prev);
            if (prev.has(row.entry!.path)) next.delete(row.entry!.path);
            else next.add(row.entry!.path);
            return next;
          });
          return;
        }
        void openFileEntry(row.entry);
      }
    },
    [rows, focusRow, expandedChildPaths],
  );

  // Recursive child renderer — each expanded folder renders its children in a
  // nested <ul> whose left border IS the indent guide, so every level's line is
  // continuous and each open subfolder gets its own line centred under its icon
  // (CHILD_GUIDE_OFFSET). No staircase. The flat `rows` list is kept only for
  // keyboard navigation order.
  const renderChildLevel = (
    project: WorkspaceProject,
    entries: FileEntry[],
    level: number,
  ): ReactNode => {
    const peek = derivePeekChildren(entries, { showHidden: showHiddenFiles });
    const ordered = [...peek.folders, ...peek.files];
    if (ordered.length === 0) return null;
    return (
      <ul
        role="group"
        className="flex flex-col m-0 list-none border-l border-border/70 pl-2"
        style={{ marginLeft: CHILD_GUIDE_OFFSET }}
      >
        {ordered.map((entry) => {
          const id = `${project.path}::${entry.path}`;
          const isChildExpanded =
            entry.is_directory && expandedChildPaths.has(entry.path);
          const row: RowDescriptor = {
            id,
            kind: "child",
            project,
            entry,
            depth: level,
          };
          const childRow = (
            <ChildRow
              row={row}
              level={level}
              isActive={entry.path === activeTabPath}
              isFocused={focusedRowId === id}
              hasFocusWithin={focusedRowId !== null}
              isRenaming={renamingPath === entry.path}
              isExpanded={entry.is_directory ? isChildExpanded : undefined}
              onActivate={() => {
                if (entry.is_directory) {
                  setExpandedChildPaths((prev) => {
                    const next = new Set(prev);
                    if (prev.has(entry.path)) next.delete(entry.path);
                    else next.add(entry.path);
                    return next;
                  });
                  return;
                }
                void openFileEntry(entry);
              }}
              onKeyDown={(e) => handleChildKeyDown(e, row)}
              onFocus={() => setFocusedRowId(id)}
              onStartRename={startRename}
              onCommitRename={commitRename}
              onCancelRename={cancelRename}
              registerRef={(el) => rowRefs.current.set(id, el)}
            />
          );
          const ctx = (
            <SidebarContextMenu
              filePath={entry.path}
              kind={entry.is_directory ? "folder" : "file"}
            >
              <div>{childRow}</div>
            </SidebarContextMenu>
          );
          let inner: ReactNode;
          if (entry.is_directory) {
            inner = (
              <FolderPeek projectPath={entry.path} fileTree={entry.children ?? []}>
                {ctx}
              </FolderPeek>
            );
          } else if (isPreviewable(entry.path)) {
            inner = <FilePreview filePath={entry.path}>{ctx}</FilePreview>;
          } else {
            inner = <div>{ctx}</div>;
          }
          return (
            <li key={id} className="m-0 p-0">
              {inner}
              {isChildExpanded &&
                renderChildLevel(project, entry.children ?? [], level + 1)}
            </li>
          );
        })}
      </ul>
    );
  };

  return (
    <section
      aria-label={t("section.folders")}
      className="group/section flex flex-col gap-1"
    >
      <header className="flex items-center justify-between gap-2 px-2 h-6">
        <h2 className="text-xs font-medium tracking-wider uppercase text-muted-foreground">
          Folders
        </h2>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label={t("sidebar.addFolder")}
          tabIndex={-1}
          onClick={onAdd}
          className="opacity-0 group-hover/section:opacity-100 focus-within:opacity-100 transition-opacity duration-150"
        >
          <Plus strokeWidth={1.5} />
        </Button>
      </header>
      {(projects.length > 0 || pendingCreateProject) && (
        <ul role="tree" aria-label={t("section.projects")} className="flex flex-col m-0 p-0 list-none">
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
                  placeholder={t("sidebar.newProject")}
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
              ? derivePeekChildren(project.fileTree, { showHidden: showHiddenFiles })
              : null;
            const isPendingCreateHere =
              pendingCreateProjectPath === project.path && !!pendingCreate;
            return (
              <li key={project.path} className="m-0 p-0">
                <FolderPeek
                  projectPath={project.path}
                  fileTree={project.fileTree}
                >
                  <SidebarContextMenu
                    filePath={project.path}
                    kind="project"
                    onOpen={() => void openProject(project)}
                  >
                    <div>
                      <ProjectRow
                        project={project}
                        isActive={isActive}
                        isExpanded={isExpanded}
                        isFocused={focusedRowId === project.path}
                        hasFocusWithin={focusedRowId !== null}
                        isRenaming={renamingProjectPath === project.path}
                        onOpen={() => toggleExpanded(project.path, !isExpanded)}
                        onKeyDown={(e) => handleProjectKeyDown(e, project)}
                        onFocus={() => setFocusedRowId(project.path)}
                        onAddNote={() => handleAddToProject(project.path)}
                        onStartRename={() =>
                          startProjectRename(project.path)
                        }
                        onCommitRename={(value) =>
                          void commitProjectRename(project.path, value)
                        }
                        onCancelRename={cancelProjectRename}
                        onDropFiles={(paths) => void fileTo(paths, project.path)}
                        registerRef={(el) =>
                          rowRefs.current.set(project.path, el)
                        }
                      />
                    </div>
                  </SidebarContextMenu>
                </FolderPeek>
                {(children || isPendingCreateHere) && (
                  <>
                    {isPendingCreateHere && pendingCreate && (
                      // Inline create-note row in its own guided <ul> so it
                      // lines up with the children below.
                      <ul
                        role="group"
                        className="flex flex-col m-0 list-none border-l border-border/70 pl-2"
                        style={{ marginLeft: CHILD_GUIDE_OFFSET }}
                      >
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
                      </ul>
                    )}
                    {children && renderChildLevel(project, project.fileTree, 2)}
                  </>
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
 * folder, falling back to the first file.
 */
function firstChildRowId(
  projectPath: string,
  children: PeekChildren,
): string | null {
  const firstFolder = children.folders[0];
  if (firstFolder) return `${projectPath}::${firstFolder.path}`;
  const firstFile = children.files[0];
  if (firstFile) return `${projectPath}::${firstFile.path}`;
  return null;
}
