import { tauriApi } from "@/lib/tauri";
import {
  mergeReadingProgress,
  parseReadingProgress,
  serializeReadingProgress,
} from "@/lib/reading-progress-file";
import type { MigrationDeps, MigrationListing } from "@/lib/library-migration";

/**
 * The wiring between the pure migration and the real filesystem.
 *
 * Kept apart from `library-migration.ts` so the planner and the runner stay
 * testable with plain objects: everything here talks to Tauri, and nothing
 * here makes a decision.
 */

/** Read one root into the shape the planner wants. */
export async function buildMigrationListing(root: string): Promise<MigrationListing> {
  const entries = await tauriApi.listDirectory(root).catch(() => []);
  const inbox = await tauriApi.listDirectory(`${root}/Inbox`).catch(() => []);
  // A directory is a PROJECT when it carries `.notesage/` — the same test the
  // rest of the app uses, and the one the collision rules turn on.
  const projectDirs = new Set<string>();
  for (const entry of entries) {
    if (!entry.is_directory) continue;
    const marked = await tauriApi.pathExists(`${root}/${entry.name}/.notesage`).catch(() => false);
    if (marked) projectDirs.add(entry.name);
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
    readFile: (path) => tauriApi.readFile(path),
    writeFile: (path, content) => tauriApi.writeFile(path, content),
    deletePath: (path) => tauriApi.deletePath(path),
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
