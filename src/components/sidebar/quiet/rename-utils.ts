/**
 * rename-utils — shared helpers for sidebar inline rename (task #40).
 *
 * `SidebarInlineEdit` handles the UI state; these pure helpers take care of
 * path arithmetic (derive the new path from the user's input) and validation
 * messages (shown below the input when the user tries to commit).
 *
 * Kept in its own module so Pinned / Recent / Projects row components can
 * share the exact same rules without duplication.
 */

/** Basename of an absolute path (last `/`-separated segment). */
export function basename(path: string): string {
  const segments = path.split("/").filter(Boolean);
  return segments[segments.length - 1] ?? path;
}

/** Parent directory of an absolute path (everything before the last `/`). */
export function parentDir(path: string): string {
  const idx = path.lastIndexOf("/");
  if (idx <= 0) return "";
  return path.slice(0, idx);
}

/**
 * Derive the new absolute path from the user's committed rename input.
 *
 * Rules:
 * - If the user typed a name with no extension (no `.` after the last `/`),
 *   preserve the original extension. `foo` + `bar.md` → `bar.md`.
 * - Otherwise take the user's input verbatim. `foo.md` + `bar.txt` → `bar.txt`.
 * - Slashes in the input are NOT stripped here — `validateRenameBasename`
 *   rejects them before we ever get to this function.
 *
 * Always returns an absolute path rooted in the old path's parent directory.
 */
export function resolveRenamePath(oldPath: string, newBasename: string): string {
  const parent = parentDir(oldPath);
  const oldName = basename(oldPath);

  // Does the new name already carry an extension?
  const hasExt = newBasename.includes(".") && !newBasename.startsWith(".");
  if (hasExt) {
    return parent ? `${parent}/${newBasename}` : `/${newBasename}`;
  }

  // Preserve the original extension if present.
  const dot = oldName.lastIndexOf(".");
  if (dot > 0) {
    const ext = oldName.slice(dot); // includes the dot
    return parent ? `${parent}/${newBasename}${ext}` : `/${newBasename}${ext}`;
  }

  // Old had no extension either — just rename.
  return parent ? `${parent}/${newBasename}` : `/${newBasename}`;
}

/**
 * Validation rule applied by SidebarInlineEdit. Returns a user-facing
 * message string when the input is invalid (keeps the input open), or
 * `null` when the commit should proceed / cancel normally.
 *
 * - Empty / whitespace inputs return `null` — SidebarInlineEdit auto-cancels
 *   on empty, so we don't need a message.
 * - Slashes are the only hard reject — everything else falls through to the
 *   filesystem, which may reject (duplicate name, permission, etc.) but
 *   that's a post-commit failure handled by toast.
 * - Same-as-current is allowed (no-op) — SidebarInlineEdit commits and the
 *   row returns to normal without a filesystem round-trip.
 */
export function validateRenameBasename(input: string): string | null {
  const trimmed = input.trim();
  if (trimmed.length === 0) return null;
  if (trimmed.includes("/")) return "Name cannot contain slashes";
  return null;
}

/**
 * Validation rule for `SidebarInlineEdit` in create mode (task #41). Same
 * rules as rename (slashes rejected, empty passes through to auto-cancel).
 * Kept as a separate export so future create-specific rules (e.g. reject a
 * name that already exists in the target directory) can land here without
 * loosening the rename contract.
 */
export function validateCreateBasename(input: string): string | null {
  return validateRenameBasename(input);
}
