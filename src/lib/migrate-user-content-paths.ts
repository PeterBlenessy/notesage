/**
 * One-time startup migration: moves user-supplied research files and PPTX
 * templates out of hidden `.notesage/` subdirectories into visible sibling
 * folders (issue #172).
 *
 * Before:  `<folder>/.notesage/research/`       and  `<folder>/.notesage/pptx-templates/`
 * After:   `<folder>/research/`                  and  `<folder>/templates/`
 *
 * For the global scope, `~/.notesage/pptx-templates/` → `~/Notesage/templates/`.
 *
 * The Rust backend handles the actual filesystem work and returns a result
 * describing what happened (files moved, collision detected, etc.).
 */

import { tauriApi } from '@/lib/tauri';
import { log } from '@/lib/logger';
import { toast } from 'sonner';

export interface MigrateUserContentResult {
  /** Number of individual files (or the directory itself) that were moved. */
  migrated: number;
  /**
   * Names of sub-directories that had a collision (`research` or `templates`
   * already existed at the destination with existing content). Files in these
   * dirs were NOT moved; the old `.notesage/…` dirs remain intact.
   */
  collisions: string[];
}

/**
 * Run the user-content-path migration for each of the given folder paths.
 *
 * This is a best-effort, silent-on-error operation. Individual folder
 * failures are swallowed so one bad folder can't block startup.
 *
 * A brief toast is shown:
 * - Info: if anything was actually migrated (total migrated count > 0)
 * - Warning: for each folder that had a collision
 */
export async function migrateUserContentPathsForFolders(
  folders: string[],
): Promise<void> {
  if (folders.length === 0) return;

  let totalMigrated = 0;
  const collisionFolders: string[] = [];

  await Promise.all(
    folders.map(async (folder) => {
      try {
        const result = await tauriApi.migrateUserContentPaths(folder);
        totalMigrated += result.migrated;
        if (result.collisions.length > 0) {
          collisionFolders.push(folder);
        }
      } catch (err) {
        log.warn(
          'migrateUserContentPaths',
          `Migration failed for ${folder}: ${err}`,
        );
      }
    }),
  );

  if (totalMigrated > 0) {
    toast.info(
      'Moved research files and templates to visible folders (research/ and templates/). ' +
        'Your files are in the same project folder — just no longer hidden.',
      { id: 'migrate-user-content-paths', duration: 8000 },
    );
  }

  for (const folder of collisionFolders) {
    toast.warning(
      `Could not auto-migrate files in ${folder}: research/ or templates/ already exists with content. ` +
        'Move files from .notesage/research/ or .notesage/pptx-templates/ manually.',
      { id: `migrate-collision-${folder}`, duration: 12000 },
    );
  }
}
