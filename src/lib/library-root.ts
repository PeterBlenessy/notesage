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
 * Is there a migration to offer on this Mac?
 *
 * Only when both roots exist, the old one still holds something, and no
 * migration has been recorded. Anything else is either already done or has
 * nothing to move.
 */
export function libraryMigrationAvailable(inputs: LibraryRootInputs): boolean {
  return Boolean(
    inputs.containerRoot &&
      inputs.cloudDocsRoot &&
      inputs.cloudDocsHasContent &&
      !inputs.marker?.migratedFrom,
  );
}
