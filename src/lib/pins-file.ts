/**
 * Shared pins.json format + path helpers for cross-platform pin storage
 * (#652). Desktop (workspace-store) writes through to this file for the
 * subset of pins that fall inside the granted/synced library root; iOS
 * (mobile-store) reads it read-only to populate the Pinned group. Framework
 * agnostic on purpose — no Tauri imports — so both platforms share one
 * parser/serializer instead of drifting apart.
 */

export const PINS_FILE_REL_PATH = ".notesage/pins.json";

interface PinsFileShape {
  paths: string[];
}

/** Absolute path to pins.json under a given desktop library root. */
export function pinsFilePath(libraryRoot: string): string {
  return `${libraryRoot}/${PINS_FILE_REL_PATH}`;
}

/** True when `absolutePath` is the library root itself or a descendant. */
export function isInsideLibraryRoot(absolutePath: string, libraryRoot: string): boolean {
  return absolutePath === libraryRoot || absolutePath.startsWith(`${libraryRoot}/`);
}

/** Absolute pinned path → root-relative path, or `null` when it's outside the root. */
export function toRelativePinPath(absolutePath: string, libraryRoot: string): string | null {
  if (!isInsideLibraryRoot(absolutePath, libraryRoot)) return null;
  return absolutePath === libraryRoot ? "" : absolutePath.slice(libraryRoot.length + 1);
}

/** Root-relative pinned path → absolute path. */
export function toAbsolutePinPath(relPath: string, libraryRoot: string): string {
  return `${libraryRoot}/${relPath}`;
}

/** Parse pins.json content. Malformed/unexpected JSON degrades to an empty set. */
export function parsePinsFileContent(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (
      parsed &&
      typeof parsed === "object" &&
      Array.isArray((parsed as PinsFileShape).paths)
    ) {
      return (parsed as PinsFileShape).paths.filter((p): p is string => typeof p === "string");
    }
  } catch {
    // Malformed JSON — treat as an empty pin set rather than throwing.
  }
  return [];
}

export function serializePinsFileContent(relPaths: string[]): string {
  const content: PinsFileShape = { paths: relPaths };
  return JSON.stringify(content, null, 2);
}

/**
 * Derive the pins.json content (root-relative, deduped) from the full set
 * of absolute pinned paths — only the subset that lives inside the
 * library root; paths outside it (arbitrary Explorer folders, non-synced
 * projects) are omitted since iOS can never reach them anyway.
 */
export function derivePinsFilePaths(pinnedFiles: string[], libraryRoot: string): string[] {
  const rel: string[] = [];
  for (const abs of pinnedFiles) {
    const r = toRelativePinPath(abs, libraryRoot);
    if (r !== null && !rel.includes(r)) rel.push(r);
  }
  return rel;
}

/**
 * Merge on-disk pins.json (root-relative paths) into the local absolute
 * `pinnedFiles` list, adding any remote-only entry as an absolute path.
 * Never drops an existing local pin — used when opening a library whose
 * pins.json already has entries from another device.
 */
export function mergePinsFromFile(
  pinnedFiles: string[],
  remoteRelPaths: string[],
  libraryRoot: string,
): string[] {
  const merged = [...pinnedFiles];
  for (const rel of remoteRelPaths) {
    const abs = toAbsolutePinPath(rel, libraryRoot);
    if (!merged.includes(abs)) merged.push(abs);
  }
  return merged;
}

export interface GroupedEntries<T> {
  pinned: T[];
  rest: T[];
}

/**
 * Split a (already sorted/filtered) list of entries into a "Pinned" bucket
 * — entries whose relative path is in `pinnedPaths` — and the remaining
 * entries, preserving relative order within each bucket.
 */
export function groupByPinned<T>(
  entries: T[],
  pinnedPaths: string[],
  getRelPath: (entry: T) => string,
): GroupedEntries<T> {
  if (pinnedPaths.length === 0) return { pinned: [], rest: entries };
  const pinnedSet = new Set(pinnedPaths);
  const pinned: T[] = [];
  const rest: T[] = [];
  for (const entry of entries) {
    if (pinnedSet.has(getRelPath(entry))) pinned.push(entry);
    else rest.push(entry);
  }
  return { pinned, rest };
}
