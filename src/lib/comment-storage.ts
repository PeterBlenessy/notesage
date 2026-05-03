/**
 * Shared utilities for comment sidecar storage paths.
 *
 * Single source of truth for the path-hash algorithm used to derive
 * non-project comment sidecar filenames. All call sites must import
 * from here — never duplicate the algorithm inline.
 */

/** Deterministic hash of a file path → hex string (filename-safe comment key). */
export function hashPath(path: string): string {
  let h = 0;
  for (let i = 0; i < path.length; i++) {
    h = ((h << 5) - h + path.charCodeAt(i)) | 0;
  }
  return 'path-' + (h >>> 0).toString(16);
}

/** Full path to the comment sidecar JSON for a non-project file. */
export function commentSidecarPath(notesRootPath: string, filePath: string): string {
  return `${notesRootPath}/.notesage/comments/${hashPath(filePath)}.json`;
}
