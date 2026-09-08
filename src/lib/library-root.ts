import type { LibraryMarker } from "@/lib/tauri";

/**
 * Which of the two possible synced libraries is the live one.
 *
 * There are two places a synced Notesage library can now be: today's
 * `iCloud Drive/Notesage` (a plain folder in Apple's generic CloudDocs
 * container, which the Mac created with ordinary file I/O), and Notesage's
 * own iCloud container, which only Notesage can write and which the phone
 * can therefore create without asking anyone to pick a folder.
 *
 * Both can exist at once — during a migration they must — so "which is the
 * library?" cannot be answered by looking at the directories. The marker
 * answers it: a container carrying `migratedFrom` IS the library, and the
 * CloudDocs folder beside it is a leftover awaiting cleanup. That is what
 * lets a second Mac, or a phone holding an old bookmark, follow a migration
 * it did not perform, with no flag and no prompt.
 */
export type LibraryRootKind = "container" | "clouddocs";

export interface LibraryRootInputs {
  /** Notesage's own container, or null when it does not exist. */
  containerRoot: string | null;
  /** `<iCloud Drive>/Notesage`, or null when iCloud is off. */
  cloudDocsRoot: string | null;
  /** The container's marker, or null when there is none. */
  marker: LibraryMarker | null;
  /**
   * Whether this Mac can READ the container, as opposed to merely seeing it.
   * Absent means "not checked", which is treated as readable so callers that
   * only resolve the root (rather than offering a migration) need not ask.
   */
  containerAccess?: "missing" | "denied" | "ready";
  /**
   * Whether the CloudDocs folder has anything in it. `.DS_Store` does not
   * count — Finder leaves one behind in a folder a person merely opened, and
   * treating that as "there is a library here" would strand a phone-first
   * user on an empty root for ever.
   */
  cloudDocsHasContent: boolean;
}

export interface ResolvedLibraryRoot {
  path: string | null;
  kind: LibraryRootKind | null;
}

/**
 * The four-branch rule from the PRD, in order. Pure, so each branch is a test
 * rather than something to re-derive by launching the app against a
 * particular iCloud state.
 */
export function resolveSyncedLibraryRoot(inputs: LibraryRootInputs): ResolvedLibraryRoot {
  const { containerRoot, cloudDocsRoot, marker, cloudDocsHasContent } = inputs;

  // 1. A migration happened somewhere. Follow it, whoever performed it and
  //    whatever is still sitting in the old folder.
  if (containerRoot && marker?.migratedFrom) {
    return { path: containerRoot, kind: "container" };
  }

  // 2. A marked container with nothing in the old place: the phone made the
  //    library and this Mac is joining afterwards. There is nothing here to
  //    migrate, so there is nothing to decide.
  if (containerRoot && marker && !cloudDocsHasContent) {
    return { path: containerRoot, kind: "container" };
  }

  // 3. Today's behaviour, deliberately untouched: an existing CloudDocs
  //    library keeps being the library until a migration says otherwise.
  //    This is the branch every current user takes.
  if (cloudDocsRoot && cloudDocsHasContent) {
    return { path: cloudDocsRoot, kind: "clouddocs" };
  }

  // 4. A container and no CloudDocs library at all.
  if (containerRoot) {
    return { path: containerRoot, kind: "container" };
  }

  // Neither: iCloud is off, or nothing has been created yet. `cloudDocsRoot`
  // is still the right answer when iCloud is on but the folder is empty —
  // that is where a new library goes.
  if (cloudDocsRoot) {
    return { path: cloudDocsRoot, kind: "clouddocs" };
  }
  return { path: null, kind: null };
}

/**
 * Why a migration is, or is not, on offer here.
 *
 * A boolean was not enough. Four different situations all produced "no", and
 * the UI showed the same nothing for each — so somebody who turned the flag
 * on could not tell an unfinished feature from a Mac that simply is not
 * eligible yet, which is exactly what happened. Each case has a different
 * answer and a different thing the person might do about it, so each gets a
 * name.
 */
export type MigrationOfferState =
  /** Everything is in place; the move can be offered. */
  | "offer"
  /** iCloud sync is off, or there is no iCloud Drive folder to move from. */
  | "no-icloud"
  /**
   * Notesage's own iCloud folder is not on this Mac. It is created by the
   * app — the iPhone makes it on first run — and this Mac deliberately never
   * creates it: an unentitled Mac that made the directory anyway would
   * produce a folder that never syncs.
   */
  | "no-container"
  /** The move has already been performed, here or on another device. */
  | "already-migrated"
  /** The old folder is empty, so there is nothing to move. */
  | "nothing-to-move"
  /**
   * The container is there and macOS will not let this Mac read it.
   *
   * A state of its own, and the one that cost the most to diagnose. It is not
   * "no container" — saying that would send somebody to wait for a folder
   * that is already sitting on their disk. The Mac app carries no iCloud
   * entitlement (only the iOS app declares the container), so macOS guards
   * it; Full Disk Access is the way through, and it is the user who has to
   * grant it.
   */
  | "container-denied";

export function migrationOfferState(inputs: LibraryRootInputs): MigrationOfferState {
  if (!inputs.cloudDocsRoot) return "no-icloud";
  if (!inputs.containerRoot) return "no-container";
  // Before every question that needs to READ the container — the marker most
  // of all. Those reads fail under a denial, and their failure would be
  // reported as some other state entirely.
  if (inputs.containerAccess === "denied") return "container-denied";
  // Before "nothing to move": a completed migration is why the old folder is
  // empty, and "there is nothing to move" would read as a fault.
  if (inputs.marker?.migratedFrom) return "already-migrated";
  if (!inputs.cloudDocsHasContent) return "nothing-to-move";
  return "offer";
}

/**
 * Is there a migration to offer on this Mac?
 *
 * Only when both roots exist, the old one still holds something, and no
 * migration has been recorded. Anything else is either already done or has
 * nothing to move.
 */
export function libraryMigrationAvailable(inputs: LibraryRootInputs): boolean {
  return migrationOfferState(inputs) === "offer";
}

/**
 * How to NAME the synced library in copy that tells someone where their
 * files are going.
 *
 * Hardcoding "iCloud Drive/Notesage" was fine while that was the only
 * possibility. Once the library can live in Notesage's own iCloud folder,
 * that sentence is simply false for anyone who has migrated — and it appears
 * in exactly the places where being wrong matters, next to a button that
 * moves a project.
 */
export function syncedRootLabel(kind: LibraryRootKind | null): string {
  return kind === "container" ? "Notesage in iCloud" : "iCloud Drive/Notesage";
}
