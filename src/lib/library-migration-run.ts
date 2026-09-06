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

/**
 * Absolute paths of every non-project file that has a comment sidecar.
 *
 * These are keyed by a hash OF THE PATH, so moving the file changes the key
 * and the comments become unreachable while still sitting on disk. The only
 * way to find them is to read each sidecar's own record of the document it
 * belongs to.
 */
export async function collectSidecarFilePaths(notesRoot: string): Promise<string[]> {
  const dir = `${notesRoot}/.notesage/comments`;
  const entries = await tauriApi.listDirectory(dir).catch(() => []);
  const paths: string[] = [];
  for (const entry of entries) {
    if (entry.is_directory || !entry.name.startsWith("path-") || !entry.name.endsWith(".json")) {
      continue;
    }
    try {
      const parsed = JSON.parse(await tauriApi.readFile(`${dir}/${entry.name}`)) as {
        originalPath?: unknown;
      };
      if (typeof parsed.originalPath === "string") paths.push(parsed.originalPath);
    } catch {
      // A sidecar we cannot read is one we cannot re-key. Skipping it leaves
      // it exactly as it was rather than moving it somewhere wrong.
    }
  }
  return paths;
}
