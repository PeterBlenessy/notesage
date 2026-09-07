import { tauriApi } from "@/lib/tauri";
import {
  mergeReadingProgress,
  parseReadingProgress,
  serializeReadingProgress,
} from "@/lib/reading-progress-file";
import type { MigrationDeps, MigrationListing } from "@/lib/library-migration";
import {
  LEGACY_CLOUD_DOCS_LIBRARY,
  LIBRARY_MARKER_REL_PATH,
  markMigrated,
  newLibraryMarker,
  parseLibraryMarker,
  serializeLibraryMarker,
  type LibraryMarker,
} from "@/lib/library-marker";

/**
 * The wiring between the pure migration and the real filesystem.
 *
 * Kept apart from `library-migration.ts` so the planner and the runner stay
 * testable with plain objects: everything here talks to Tauri, and nothing
 * here makes a decision.
 */

/** Read one root into the shape the planner wants. */
export async function buildMigrationListing(root: string): Promise<MigrationListing> {
  // Hidden entries INCLUDED. An evicted iCloud file is on disk only as a
  // `.name.icloud` placeholder, and the default listing hides dotfiles — so a
  // loose note nobody had opened recently was invisible to planning: never
  // moved, never reported, and left stranded in a folder the app had stopped
  // looking at. The planner decides what to do with them; it cannot decide
  // about something it never sees.
  // The ROOT listing is allowed to fail loudly. Swallowing it into `[]` made
  // an unreachable library indistinguishable from an empty one, and the
  // difference is everything: an empty source plans zero steps, the run
  // reports success, and the caller then records the migration and repoints
  // the app at a container holding nothing. `resolveSyncedLibraryRoot`
  // follows that marker for ever, so one transient iCloud fault becomes a
  // library that reads as empty permanently. iCloud IS transiently
  // unavailable; that is the environment this feature runs in.
  const entries = await tauriApi.listDirectory(root, true);
  // `Inbox/` genuinely may not exist, and that is not a fault. One that
  // exists and cannot be READ is a different thing entirely: catching that
  // into `[]` plans no Inbox steps at all, so every captured article stays
  // behind while the report says the migration completed. Absence is asked
  // about separately from failure, so the two cannot be confused.
  const hasInbox = entries.some((e) => e.is_directory && e.name === "Inbox");
  const inbox = hasInbox ? await tauriApi.listDirectory(`${root}/Inbox`, true) : [];
  // A directory is a PROJECT when it carries `.notesage/` — the same test the
  // rest of the app uses, and the one the collision rules turn on.
  //
  // NOT `.catch(() => false)`. A failed check would quietly demote a project
  // to a plain folder, and a plain folder of the same name on both sides is
  // MERGED rather than kept side by side — which is the one thing the
  // collision rules exist to prevent, because it combines two sets of
  // settings, comments and AI locks that were never meant to meet.
  const projectDirs = new Set<string>();
  for (const entry of entries) {
    if (!entry.is_directory) continue;
    if (await tauriApi.pathExists(`${root}/${entry.name}/.notesage`)) projectDirs.add(entry.name);
  }
  return { entries, inbox, projectDirs };
}

/** Union of two `pins.json` bodies, by relative path. Malformed input is
 *  treated as empty rather than throwing: losing a pin is a nuisance, and
 *  failing the whole migration over one is not a trade worth making. */
export function mergePinsFiles(mine: string | null, theirs: string | null): string {
  const read = (text: string | null): string[] => {
    if (!text) return [];
    try {
      const parsed = JSON.parse(text) as { pins?: unknown };
      return Array.isArray(parsed.pins) ? parsed.pins.filter((p): p is string => typeof p === "string") : [];
    } catch {
      return [];
    }
  };
  const union = Array.from(new Set([...read(mine), ...read(theirs)])).sort();
  return `${JSON.stringify({ version: 1, pins: union }, null, 2)}\n`;
}

export function migrationDeps(): Omit<MigrationDeps, "onStep"> {
  return {
    moveEntry: (src, dst) => tauriApi.migrateLibraryEntry(src, dst),
    // HIDDEN INCLUDED, and this argument is the whole point. A merge that
    // lists only visible children moves every document out of a folder and
    // leaves `.notesage/` — its comments, pins, project settings, an AI lock
    // — behind, reporting success. That is worse than the failure it
    // replaced, which at least said so.
    listNames: async (dir) => (await tauriApi.listDirectory(dir, true)).map((e) => e.name),
    readFile: (path) => tauriApi.readFile(path),
    // The migration-only entry points: these must work while the library
    // lock is held, which is exactly what the lock refuses to everyone else.
    writeFile: (path, content) => tauriApi.migrationWriteFile(path, content),
    deletePath: (path) => tauriApi.migrationDeletePath(path),
    exists: (path) => tauriApi.pathExists(path),
    // Both devices have been writing this file, so it is merged by the
    // existing rules — progress only moves forward, a tombstone wins by time
    // — rather than one side overwriting the other.
    mergeReadingProgress: (mine, theirs) =>
      serializeReadingProgress(
        mergeReadingProgress(
          parseReadingProgress(mine ?? ""),
          parseReadingProgress(theirs ?? ""),
        ),
      ),
    mergePins: mergePinsFiles,
  };
}

/**
 * Absolute paths of every non-project file that has a comment sidecar.
 *
 * These are keyed by a hash OF THE PATH, so moving the file changes the key
 * and the comments become unreachable while still sitting on disk. The only
 * way to find them is to read each sidecar's own record of the document it
 * belongs to.
 */
export interface SidecarScan {
  /** Documents whose sidecar can be re-keyed. */
  paths: string[];
  /**
   * Sidecars that cannot be re-keyed, by filename.
   *
   * Skipping them is right — a sidecar we cannot read is one we cannot move
   * somewhere correct — but skipping them SILENTLY was not. The key is a hash
   * of the document's path, so once the document moves the key no longer
   * matches and every comment on it is unreachable while the bytes sit on
   * disk. That is indistinguishable from losing them, and the report has a
   * `leftBehind` list precisely to name what did not come along.
   */
  unreadable: string[];
}

export async function collectSidecarFilePaths(notesRoot: string): Promise<SidecarScan> {
  const dir = `${notesRoot}/.notesage/comments`;
  // A comments directory that does not exist is the ordinary case for a
  // library nobody has commented in; one that exists but cannot be READ is
  // not, and would silently orphan every sidecar in it.
  if (!(await tauriApi.pathExists(dir))) return { paths: [], unreadable: [] };
  const entries = await tauriApi.listDirectory(dir);
  const paths: string[] = [];
  const unreadable: string[] = [];
  for (const entry of entries) {
    if (entry.is_directory || !entry.name.startsWith("path-") || !entry.name.endsWith(".json")) {
      continue;
    }
    try {
      const parsed = JSON.parse(await tauriApi.readFile(`${dir}/${entry.name}`)) as {
        originalPath?: unknown;
      };
      if (typeof parsed.originalPath === "string") paths.push(parsed.originalPath);
      else unreadable.push(entry.name);
    } catch {
      unreadable.push(entry.name);
    }
  }
  return { paths, unreadable };
}

/** What `recordMigrationInMarker` needs, injected so it is testable without
 *  a filesystem. */
export interface MarkerWriteDeps {
  readMarker: (root: string) => Promise<LibraryMarker | null>;
  createDirectory: (path: string) => Promise<void>;
  writeFile: (path: string, content: string) => Promise<void>;
  deviceName: () => Promise<string>;
}

/**
 * Record the migration in the container's marker. THE step that makes a
 * migration stick.
 *
 * Everything else about this feature is bytes on disk; this is the only thing
 * that says which root is the library. Without it:
 *
 * - no other Mac and no phone can follow the move, because
 *   `resolveSyncedLibraryRoot`'s first branch tests exactly this field;
 * - this Mac keeps offering a migration it already performed, since
 *   `libraryMigrationAvailable` also tests it;
 * - and worst, the next launch re-resolves the root from scratch and falls
 *   through to "the old folder still has something in it, so it is the
 *   library" — pointing the app back at the folder it just emptied, with the
 *   dialog's own `setICloudNotesagePath` silently overwritten.
 *
 * A container with no marker at all gets one: the phone writes it when IT
 * creates the library, but a container this Mac is the first to use has
 * nothing in it yet, and a migration into an unmarked root is exactly the
 * case that must not read as "never migrated".
 */
export async function recordMigrationInMarker(
  newRoot: string,
  deps: MarkerWriteDeps,
  now: string = new Date().toISOString(),
): Promise<LibraryMarker> {
  const existing = await deps.readMarker(newRoot).catch(() => null);
  const base = existing ?? newLibraryMarker("macos", now);
  const marked = markMigrated(base, {
    from: LEGACY_CLOUD_DOCS_LIBRARY,
    by: await deps.deviceName().catch(() => "a Mac"),
    at: now,
  });
  await deps.createDirectory(`${newRoot}/.notesage`).catch(() => {
    // Already there, which is the ordinary case for a container the phone
    // created. A real failure surfaces on the write below, where it belongs.
  });
  await deps.writeFile(`${newRoot}/${LIBRARY_MARKER_REL_PATH}`, serializeLibraryMarker(marked));
  return marked;
}

/** The real wiring for {@link recordMigrationInMarker}. */
export function markerWriteDeps(): MarkerWriteDeps {
  return {
    // Through the parser, not straight across: the IPC type is the loose
    // shape the command can return (`migratedFrom?: string`), and this module
    // works in the validated one. Re-serialising what Rust read and parsing
    // it is the same check every other reader applies, so a marker a hand
    // edit has made invalid reads as absent here too — and gets replaced by
    // a valid one, rather than being extended into something no reader
    // accepts.
    readMarker: async (root) => {
      const raw = await tauriApi.readLibraryMarker(root);
      return raw ? parseLibraryMarker(JSON.stringify(raw)) : null;
    },
    createDirectory: (path) => tauriApi.migrationCreateDirectory(path),
    writeFile: (path, content) => tauriApi.migrationWriteFile(path, content),
    deviceName: () => tauriApi.getDeviceName(),
  };
}
