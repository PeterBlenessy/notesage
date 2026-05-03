/**
 * One-time startup migration: adds the `originalPath` field to path-keyed
 * comment sidecars that were created before issue #117 was fixed.
 *
 * The migration is idempotent — sidecars that already have `originalPath`
 * are left unchanged.
 */

import { tauriApi } from '@/lib/tauri';
import { log } from '@/lib/logger';
import { parseSidecar, serializeSidecar, commentSidecarPath } from '@/lib/comment-storage';

/**
 * For each file path in `markdownFilePaths`, check whether a path-keyed sidecar
 * exists under `notesRootPath` without an `originalPath` field. If so, add it.
 *
 * Silently swallows per-file errors so a single bad sidecar cannot block startup.
 */
export async function backfillSidecarOriginalPaths(
  notesRootPath: string,
  markdownFilePaths: string[],
): Promise<void> {
  for (const filePath of markdownFilePaths) {
    const targetSidecar = commentSidecarPath(notesRootPath, filePath);
    try {
      const exists = await tauriApi.pathExists(targetSidecar);
      if (!exists) continue;

      const raw = await tauriApi.readFile(targetSidecar);
      const data = parseSidecar(raw);

      if (data.originalPath) continue; // already migrated

      await tauriApi.writeFile(targetSidecar, serializeSidecar(data.comments, filePath));
    } catch (err) {
      log.warn('backfillSidecarOriginalPaths', `skipping ${filePath}: ${err}`);
    }
  }
}
