import type { WorkspaceProject } from "@/stores/workspace-store";

/**
 * Resolve the parent directory for a new note triggered by `⌘N`. Returns the
 * active document's parent directory when that file lives inside an open
 * project (so the new note is created next to the current document), else
 * `null` to signal the no-match fallback (the caller shows an "open a project"
 * toast).
 *
 * Pure helper — no store or filesystem access. Used by the `new-note` shortcut
 * action so ⌘N keeps its file-directory-aware placement after the keyboard
 * centralization.
 */
export function resolveCreateParent(
  activeFilePath: string | null,
  projects: WorkspaceProject[],
): string | null {
  if (projects.length === 0) return null;

  if (activeFilePath) {
    // Match the active document against every open project. If the file lives
    // inside one, return its immediate parent directory.
    for (const p of projects) {
      if (activeFilePath === p.path) continue;
      if (activeFilePath.startsWith(p.path + "/")) {
        const lastSlash = activeFilePath.lastIndexOf("/");
        if (lastSlash > 0) return activeFilePath.slice(0, lastSlash);
      }
    }
  }

  // No active document, or the active file is outside every open project.
  return null;
}
