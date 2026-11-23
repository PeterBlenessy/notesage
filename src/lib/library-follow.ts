import { isUnder, rebaseWithRenames, type MigrationRename } from "@/lib/library-migration-paths";

/**
 * Following a library move that ANOTHER Mac performed.
 *
 * The Mac that runs the migration rewrites its own stored paths
 * (`planPathRewrites` + `applyPathRewrites`). Every other Mac only learns of
 * the move from the marker, and its workspace — projects, explorer folders,
 * pins, tabs, recents — still records absolute paths under its own
 * `iCloud Drive/Notesage`. Startup used to read those paths, find them gone,
 * and REMOVE each project with a "directory no longer exists" toast. The
 * cross-device scan then re-added whatever the container held, so the second
 * Mac ended up with the migrating Mac's project list and none of its own
 * setup — which is what a user saw as "the app can't see my files, and it
 * always starts with the other laptop's folders".
 *
 * The rule is decided per TOP-LEVEL entry of the old root, because that is
 * the unit the migration moves: an entry has moved when it is gone from the
 * old root and present in the new one. No marker field is needed for that,
 * and nothing is rewritten on a guess — an entry still sitting in the old
 * root (a leftover, a step that failed) stays where it is.
 *
 * The migration renames on a collision (`X` → `X (from iCloud Drive)`), and
 * the record of that lives only on the Mac that ran it. The suffixed name is
 * therefore checked FIRST: if it exists, this Mac's `X` is the one that was
 * renamed, and the plain `X` in the container is a different project.
 */

/** Must match the collision suffix in `library-migration.ts`. */
export const COLLISION_SUFFIX = " (from iCloud Drive)";

export interface FollowInputs {
  oldRoot: string;
  newRoot: string;
  /** Every stored absolute path that may sit under the old root. */
  paths: string[];
  exists: (path: string) => Promise<boolean>;
}

export interface FollowPlan {
  /** Top-level entries that moved, as renames relative to the roots. */
  renames: MigrationRename[];
  /** Whether the old root ITSELF should be followed (an explorer folder
   *  opened on the whole library). True only when something moved. */
  rootMoved: boolean;
}

/** The top-level entry name of `path` under `root`, or null. */
function topLevelName(path: string, root: string): string | null {
  if (!path.startsWith(`${root}/`)) return null;
  const name = path.slice(root.length + 1).split("/")[0];
  return name || null;
}

export async function planLibraryFollow(inputs: FollowInputs): Promise<FollowPlan> {
  const { oldRoot, newRoot, exists } = inputs;
  const names = new Set<string>();
  for (const p of inputs.paths) {
    const name = topLevelName(p, oldRoot);
    if (name) names.add(name);
  }

  const renames: MigrationRename[] = [];
  await Promise.all(
    [...names].map(async (name) => {
      try {
        if (await exists(`${oldRoot}/${name}`)) return; // still there: not moved
        const suffixed = `${name}${COLLISION_SUFFIX}`;
        if (await exists(`${newRoot}/${suffixed}`)) {
          renames.push({ from: name, to: suffixed });
        } else if (await exists(`${newRoot}/${name}`)) {
          renames.push({ from: name, to: name });
        }
      } catch {
        // An existence check that fails decides nothing: leave the entry be.
      }
    }),
  );
  renames.sort((a, b) => a.from.localeCompare(b.from));
  return { renames, rootMoved: renames.length > 0 };
}

/**
 * Where `path` lives after the move, or null when it did not move.
 * Only paths inside a moved entry are rebased — never the rest of the old
 * root, which may still hold entries that stayed behind.
 */
export function followPath(path: string, plan: FollowPlan, oldRoot: string, newRoot: string): string | null {
  if (path === oldRoot) return plan.rootMoved ? newRoot : null;
  const name = topLevelName(path, oldRoot);
  if (!name || !plan.renames.some((r) => r.from === name)) return null;
  return rebaseWithRenames(path, oldRoot, newRoot, plan.renames);
}

/**
 * Is `path` inside a library root whose state is currently uncertain?
 *
 * Such a path must not be removed for being unreadable. Two cases set hold
 * roots: macOS will not let the app read Notesage's iCloud folder (the files
 * are very likely in there), and the library marker could not be read or has
 * not downloaded yet (so it is not known WHICH root is live, and a project
 * "missing" from one may simply be in the other).
 */
export function isHeldPath(path: string, holdRoots: readonly string[]): boolean {
  return holdRoots.some((root) => isUnder(path, root));
}
