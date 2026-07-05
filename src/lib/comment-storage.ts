/**
 * Low-level utilities for path-keyed comment sidecar files.
 *
 * Non-project files store comments in
 * `<notesRoot>/.notesage/comments/path-<hash>.json`. After issue #117,
 * these sidecars carry an `originalPath` field so that folder renames
 * can migrate them via reverse-lookup without a full disk scan.
 *
 * The `hashPath` algorithm is FROZEN: changing it would orphan every
 * existing non-project comment sidecar on disk. If the algorithm needs
 * to change, write a one-time migration that re-keys old sidecars to
 * the new hash before flipping the algorithm here.
 */

import type { Comment } from '@/stores/comment-store';

/** Sidecar envelope. Old sidecars on disk may be a bare `Comment[]`; `parseSidecar` normalises. */
export interface SidecarData {
  /** The non-project file path the comments anchor to. Optional for backward-compat with pre-#117 sidecars. */
  originalPath?: string;
  comments: Comment[];
}

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

/** Parse a sidecar JSON string — handles both old `Comment[]` and new `{ originalPath, comments }` formats. */
export function parseSidecar(raw: string): SidecarData {
  const parsed: unknown = JSON.parse(raw);
  if (Array.isArray(parsed)) {
    return { comments: parsed as Comment[] };
  }
  // Envelope branch: the sidecar is user-visible JSON on disk — guard that
  // `.comments` is actually an array before handing it to consumers.
  if (typeof parsed === 'object' && parsed !== null) {
    const o = parsed as { originalPath?: unknown; comments?: unknown };
    return {
      ...(typeof o.originalPath === 'string' ? { originalPath: o.originalPath } : {}),
      comments: Array.isArray(o.comments) ? (o.comments as Comment[]) : [],
    };
  }
  return { comments: [] };
}

/** Serialize a sidecar. Writes the envelope format when `originalFilePath` is provided, plain array otherwise. */
export function serializeSidecar(comments: Comment[], originalFilePath?: string): string {
  if (originalFilePath) {
    return JSON.stringify({ originalPath: originalFilePath, comments }, null, 2);
  }
  return JSON.stringify(comments, null, 2);
}
