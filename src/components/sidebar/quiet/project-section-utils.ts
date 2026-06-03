/**
 * Shared utilities for ProjectsSection and its extracted sub-components.
 *
 * Keeping these separate avoids circular imports when ProjectRow / ChildRow /
 * useProjectInlineEdit each need helpers that also live in ProjectsSection.
 */

import type { FileEntry } from "@/lib/tauri";
import type { WorkspaceProject } from "@/stores/workspace-store";

// ---------------------------------------------------------------------------
// RowDescriptor — flat row representation used by the keyboard navigator
// ---------------------------------------------------------------------------

/**
 * Flat row representation used by the keyboard navigator. Each rendered
 * row — project or expanded child — corresponds to one `RowDescriptor`,
 * letting ArrowUp / ArrowDown walk the visible sequence without caring
 * about the nested DOM structure.
 */
export interface RowDescriptor {
  id: string;
  kind: "project" | "child";
  /** For `project`: the project itself. For `child`: its parent project. */
  project: WorkspaceProject;
  /** Only set for `kind: "child"` — the immediate child entry. */
  entry?: FileEntry;
  /** Overflow hint marker id, without an interactive entry. */
  overflow?: { kind: "folder" | "file"; count: number };
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/** Derives the project's display name from the absolute path (basename). */
export function projectBasename(path: string): string {
  const parts = path.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

/**
 * Issue #89 — any dotfile folder must never be renamed via the UI.
 *
 * Renaming `.notesage` corrupts the project (loses metadata, comments,
 * drawings, charts). The same risk applies to other tool dirs (`.claude`,
 * `.git`, `.vscode`, `.cursor`, `.codex`, `.github`, etc.) and to user
 * dotfiles whose tools may not survive being renamed (`.env`, `.gitignore`,
 * `.npmrc`, …). The only safe rule is: any leading-dot name is a no-op for
 * UI rename.
 *
 * Exported for unit tests.
 */
export function isSystemFolderName(name: string): boolean {
  return name.startsWith(".");
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
 * Recursively inserts child entry rows beneath an already-expanded subfolder
 * row. Dirs-before-files ordering mirrors derivePeekChildren. Used by the
 * `rows` useMemo to support multi-level inline expand (#158).
 */
export function insertChildRows(
  list: RowDescriptor[],
  entries: FileEntry[],
  project: WorkspaceProject,
  expandedChildPaths: Set<string>,
  showHiddenFiles: boolean,
): void {
  const visible = entries.filter((e) => showHiddenFiles || !e.hidden);
  const dirs = visible.filter((e) => e.is_directory);
  const files = visible.filter((e) => !e.is_directory);
  for (const dir of dirs) {
    list.push({
      id: `${project.path}::${dir.path}`,
      kind: "child",
      project,
      entry: dir,
    });
    if (expandedChildPaths.has(dir.path)) {
      insertChildRows(list, dir.children ?? [], project, expandedChildPaths, showHiddenFiles);
    }
  }
  for (const file of files) {
    list.push({
      id: `${project.path}::${file.path}`,
      kind: "child",
      project,
      entry: file,
    });
  }
}
