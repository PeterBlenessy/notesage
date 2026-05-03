/** Simple deterministic hash of a string → hex string (for filename-safe comment keys). */
export function hashPath(path: string): string {
  let h = 0;
  for (let i = 0; i < path.length; i++) {
    h = ((h << 5) - h + path.charCodeAt(i)) | 0;
  }
  return 'path-' + (h >>> 0).toString(16);
}

/** Full path to the JSON sidecar for a non-project file's comments. */
export function commentSidecarPath(notesRootPath: string, filePath: string): string {
  return `${notesRootPath}/.notesage/comments/${hashPath(filePath)}.json`;
}
