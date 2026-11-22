import { LIBRARY_MARKER_REL_PATH } from "@/lib/library-marker";

/**
 * Why a library marker could not be read.
 *
 * The Rust reader answers `None` for a missing marker, an unreadable one and
 * one iCloud has not downloaded yet, and every caller took `None` to mean
 * "there is no marker". That is the wrong answer for the last two: a second
 * Mac whose marker is still an `.icloud` placeholder resolved the library as
 * NOT migrated, skipped the follow, and removed every project that had moved;
 * and an undo that could not read the marker reported success while leaving
 * `migratedFrom` in place, pointing every device at a container the files had
 * just left.
 *
 * So "no marker" is only believed once the file is confirmed absent.
 */
export type MarkerAbsence =
  /** No marker and no placeholder: there really is none. */
  | "absent"
  /** iCloud holds it as a `.icloud` placeholder that is not downloaded yet. */
  | "pending"
  /** The file is there and cannot be read. */
  | "unreadable";

export interface MarkerStateDeps {
  pathExists: (path: string) => Promise<boolean>;
  readFile: (path: string) => Promise<string>;
}

/** `<root>/.notesage/.library.json.icloud` — how iCloud stores an evicted file. */
export function markerPlaceholderPath(root: string): string {
  const slash = LIBRARY_MARKER_REL_PATH.lastIndexOf("/");
  const dir = LIBRARY_MARKER_REL_PATH.slice(0, slash);
  const name = LIBRARY_MARKER_REL_PATH.slice(slash + 1);
  return `${root}/${dir}/.${name}.icloud`;
}

/**
 * Called only AFTER a marker read came back empty. A marker that exists, can
 * be read and simply is not a valid marker counts as absent — that is the
 * documented rule for junk (`parseLibraryMarker`).
 */
export async function classifyMissingMarker(
  root: string,
  deps: MarkerStateDeps,
): Promise<MarkerAbsence> {
  try {
    if (await deps.pathExists(markerPlaceholderPath(root))) return "pending";
    const file = `${root}/${LIBRARY_MARKER_REL_PATH}`;
    if (!(await deps.pathExists(file))) return "absent";
    try {
      await deps.readFile(file);
      return "absent"; // readable, just not a marker
    } catch {
      return "unreadable";
    }
  } catch {
    // Could not even ask. Not knowing is not the same as "absent".
    return "unreadable";
  }
}
