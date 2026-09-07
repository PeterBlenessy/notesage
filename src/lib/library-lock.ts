/**
 * A hold on the library while it is being moved.
 *
 * The migration relocates every file the app owns, and until now nothing
 * stopped the rest of the app writing into that tree while it happened. There
 * is no natural quiescence: the editor autosaves on a 1 s debounce, the Inbox
 * store flushes `reading-progress.json` through its own write chain, the
 * recordings scanner writes manifests, an agent can be mid-task. Worse, the
 * stored absolute paths are only rewritten AFTER every move completes, so for
 * the whole run every writer in the app is still aimed at the OLD root.
 *
 * The failure is quiet and permanent: `write_file` creates a missing file
 * rather than failing, so an autosave landing after its note has moved
 * recreates that note at the abandoned root with the newest edit in it, and
 * the migration has already counted the old copy as moved. For the Inbox
 * sidecar it is worse still — a write landing after the merge step's delete
 * silently discards read state merged from both devices.
 *
 * So writes under a locked root are REFUSED for the duration, with an error
 * that names why. A refused autosave is a toast and a retry; a write into a
 * tree being moved is a file nobody will find again.
 *
 * The migration's own writes do not consult this — they go through the
 * `migration*` functions in `tauri.ts`, which are separate entry points
 * rather than an exemption flag. A flag would have to be set around each
 * awaited call, and anything else running during that await would be exempt
 * too, which is the race this exists to close.
 */

export class LibraryLockedError extends Error {
  constructor(readonly path: string) {
    super(
      `The library is being moved right now, so ${path} cannot be written. Wait for the move to finish and try again.`,
    );
    this.name = "LibraryLockedError";
  }
}

let lockedRoots: string[] = [];

/** Hold both roots for the duration of a migration. Both, not just the
 *  source: the destination is being written by the move itself, and a second
 *  writer landing in it produces the same collisions on the far side. */
export function lockLibraryRoots(roots: (string | null | undefined)[]): void {
  lockedRoots = roots.filter((r): r is string => Boolean(r)).map((r) => r.replace(/\/+$/, ""));
}

export function unlockLibraryRoots(): void {
  lockedRoots = [];
}

export function libraryRootsLocked(): boolean {
  return lockedRoots.length > 0;
}

/** Is this path inside a root that is currently being moved? Boundary-matched,
 *  so `<root>x/note.md` is not inside `<root>`. */
export function isLibraryPathLocked(path: string): boolean {
  return lockedRoots.some((root) => path === root || path.startsWith(`${root}/`));
}

/** Throws `LibraryLockedError` when the path is inside a root being moved. */
export function assertLibraryUnlocked(path: string): void {
  if (isLibraryPathLocked(path)) throw new LibraryLockedError(path);
}
