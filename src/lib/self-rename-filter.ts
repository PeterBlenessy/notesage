/**
 * Module-level tracking for in-progress self-initiated renames.
 *
 * When Notesage renames a file via its own UI, the Rust watcher fires a
 * `file-renamed` event unconditionally (no self-write check in the rename
 * handler).  This module lets `useFileOperations.renamePath` mark a rename
 * as self-initiated so `useFileRenameSync` can suppress the spurious
 * "renamed externally" toast.
 *
 * TTL matches the Rust backend's SELF_WRITE_TTL (5 seconds), covering the
 * 500 ms watcher debounce window plus macOS FSEvents re-reporting latency.
 */

const SELF_RENAME_TTL_MS = 5_000;

const pendingSelfRenames = new Set<string>();

export function trackSelfRename(oldPath: string, newPath: string): void {
  pendingSelfRenames.add(oldPath);
  pendingSelfRenames.add(newPath);
  setTimeout(() => {
    pendingSelfRenames.delete(oldPath);
    pendingSelfRenames.delete(newPath);
  }, SELF_RENAME_TTL_MS);
}

export function isSelfRename(oldPath: string, newPath: string): boolean {
  return pendingSelfRenames.has(oldPath) || pendingSelfRenames.has(newPath);
}

export function consumeSelfRename(oldPath: string, newPath: string): void {
  pendingSelfRenames.delete(oldPath);
  pendingSelfRenames.delete(newPath);
}
