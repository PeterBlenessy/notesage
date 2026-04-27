/**
 * Path-normalisation helpers shared by the workspace store and the
 * `⌘O` open-folder flow.
 *
 * Sidebar-simplification task #8 — the QuietSidebar's Folders section
 * needs to dedup `⌘O` re-opens by canonical path so the same folder
 * accessed via two different surface forms (e.g. `/var/foo` vs the
 * macOS-canonical `/private/var/foo`) doesn't appear twice in the
 * sidebar.
 *
 * **Today's coverage:** the macOS `/var` → `/private/var` symlink
 * (the most common collision in the wild — `os.tmpdir()`,
 * `/var/folders/*`, and other system paths all canonicalise this
 * way). Symlinks elsewhere on disk and iCloud Drive's
 * `~/Library/Mobile Documents/...` paths are NOT yet handled — those
 * would need a Rust-side `canonicalize_path` Tauri command using
 * `std::fs::canonicalize`. Adding that is straightforward but
 * deferred until we see a real-world miss the JS path can't fix.
 */

/**
 * Returns the path with the macOS `/private` prefix stripped where it
 * collides with the public `/var` / `/tmp` / `/etc` symlinks. The
 * comparison is a plain string-prefix check so it's safe on
 * non-macOS platforms (no-op there).
 *
 * Examples (macOS):
 *   `/private/var/folders/.../X` → `/var/folders/.../X`
 *   `/private/tmp/X`             → `/tmp/X`
 *   `/private/etc/hosts`         → `/etc/hosts`
 *   `/Users/peter/notes`         → `/Users/peter/notes` (unchanged)
 *   `/var/foo`                   → `/var/foo` (unchanged)
 */
export function canonicalizeMacPath(path: string): string {
  if (path.startsWith("/private/var/")) return path.slice("/private".length);
  if (path.startsWith("/private/tmp/")) return path.slice("/private".length);
  if (path.startsWith("/private/etc/")) return path.slice("/private".length);
  // Bare `/private/var`, `/private/tmp`, `/private/etc` (no trailing
  // slash) also normalise — covers the case where the user opens the
  // root of one of those symlinked dirs.
  if (path === "/private/var") return "/var";
  if (path === "/private/tmp") return "/tmp";
  if (path === "/private/etc") return "/etc";
  return path;
}
