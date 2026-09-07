import { hashPath } from "@/lib/comment-storage";
import type { SidecarMigrationInput } from "@/lib/rename-transaction";

/**
 * Every stored path that has to move when the library does.
 *
 * The files are only half the migration. Projects, pins, recents, the open
 * document and the path-keyed comment sidecars all record ABSOLUTE paths, and
 * a library that moved without them comes back with an empty sidebar, no
 * pins, and every comment on a non-project file orphaned — the data is all
 * still there, which is exactly what makes it look like data loss.
 *
 * Kept pure and separate from the runner so the rewriting can be tested
 * exhaustively without moving a byte, and so the runner does not grow a
 * second job.
 */

/** Is `path` inside `root`? Prefix matching, but only at a boundary — `/a/bc`
 *  is not inside `/a/b`, and a bug there silently rewrites the wrong tree. */
export function isUnder(path: string, root: string): boolean {
  return path === root || path.startsWith(`${root}/`);
}

/** `<root>/x` → `<newRoot>/x`. Returns null when the path is not under the
 *  old root, so a caller cannot rewrite something it never owned. */
export function rebase(path: string, oldRoot: string, newRoot: string): string | null {
  if (!isUnder(path, oldRoot)) return null;
  return `${newRoot}${path.slice(oldRoot.length)}`;
}

/** A relative path that changed during the move, as the report records it. */
export interface MigrationRename {
  from: string;
  to: string;
}

/**
 * Rebase, applying whatever rename the migration gave this path.
 *
 * A plain rebase is right only while the name survived the move, and this
 * migration renames on every collision: a project kept as
 * `X (from iCloud Drive)`, a deduped `note-1.md`, a merged folder's child.
 * Rebasing those to `<new root>/<original name>` does not point at nothing —
 * it points at the entry that WON the collision, which for two same-named
 * projects is a different project entirely. Pins, recents, the open document
 * and a re-keyed comment sidecar would all quietly attach to it.
 *
 * The longest matching rename wins, so a renamed file inside a renamed folder
 * lands in the right place, and the match is at a path boundary so `Notes`
 * never rewrites `Notes Archive`.
 */
export function rebaseWithRenames(
  path: string,
  oldRoot: string,
  newRoot: string,
  renames: MigrationRename[],
): string | null {
  if (!isUnder(path, oldRoot)) return null;
  const rel = path.slice(oldRoot.length).replace(/^\//, "");
  let best: MigrationRename | null = null;
  for (const rename of renames) {
    if (rel !== rename.from && !rel.startsWith(`${rename.from}/`)) continue;
    if (!best || rename.from.length > best.from.length) best = rename;
  }
  if (!best) return rebase(path, oldRoot, newRoot);
  return `${newRoot}/${best.to}${rel.slice(best.from.length)}`;
}

export interface PathRewritePlan {
  /** Projects whose root moved: old → new. */
  projects: { from: string; to: string }[];
  /** Open documents and recents: old → new. */
  documents: { from: string; to: string }[];
  /** Pinned files, as a single prefix swap. */
  pinPrefix: { from: string; to: string } | null;
  /**
   * Pins the prefix swap lands in the wrong place, corrected afterwards.
   * Expressed in POST-SWAP terms (`<new root>/<old name>` →
   * `<new root>/<new name>`) because that is the state the swap leaves.
   */
  renamedPins: { from: string; to: string }[];
  /** Comment sidecars for non-project files, which are keyed by a hash OF THE
   *  PATH — so moving the file changes the key and the sidecar has to be
   *  rewritten under the new name or the comments are lost. */
  sidecars: SidecarMigrationInput[];
}

export interface PathRewriteInputs {
  oldRoot: string;
  newRoot: string;
  /** Absolute paths of every project in the workspace. */
  projectPaths: string[];
  /** Absolute paths of open documents and recents. */
  documentPaths: string[];
  /** Absolute paths of non-project files that have a comment sidecar. */
  sidecarFilePaths: string[];
  /** Where the path-keyed sidecars live (`<notes root>/.notesage/comments`). */
  commentsDir: string;
  /**
   * Relative paths the migration renamed, from the run's report. Optional so
   * a caller with nothing to declare stays honest rather than passing `[]`
   * it has not actually checked.
   */
  renames?: MigrationRename[];
}

/**
 * Work out every rewrite before performing any. Anything not under the old
 * root is left alone: a project on the local disk, or on another volume, is
 * not part of this move and must not be dragged into it.
 */
export function planPathRewrites(inputs: PathRewriteInputs): PathRewritePlan {
  const { oldRoot, newRoot, commentsDir } = inputs;
  const renames = inputs.renames ?? [];
  const move = (path: string) => rebaseWithRenames(path, oldRoot, newRoot, renames);

  const projects: { from: string; to: string }[] = [];
  for (const from of inputs.projectPaths) {
    const to = move(from);
    if (to) projects.push({ from, to });
  }

  const documents: { from: string; to: string }[] = [];
  for (const from of inputs.documentPaths) {
    const to = move(from);
    if (to) documents.push({ from, to });
  }

  const sidecars: SidecarMigrationInput[] = [];
  for (const from of inputs.sidecarFilePaths) {
    const to = move(from);
    if (!to) continue;
    sidecars.push({
      oldSidecar: `${commentsDir}/path-${hashPath(from)}.json`,
      newSidecar: `${commentsDir}/path-${hashPath(to)}.json`,
      newFilePath: to,
    });
  }

  return {
    projects,
    documents,
    // Pins live relative to the library root in the shared file, but the
    // workspace store holds them absolute; one prefix swap covers every one,
    // and the store ignores paths that do not match it.
    //
    // A prefix swap cannot express a rename, so a pinned file that WAS
    // renamed is handled by `renamedPins` below — applied after the sweep,
    // since it has to correct what the sweep just did.
    pinPrefix: { from: oldRoot, to: newRoot },
    renamedPins: renames.map((r) => ({
      from: `${newRoot}/${r.from}`,
      to: `${newRoot}/${r.to}`,
    })),
    sidecars,
  };
}

export interface PathRewriteDeps {
  /** May be async: the caller re-reads the moved project's tree, and the
   *  ordering below only holds if that is awaited rather than left running. */
  updateProjectPath: (from: string, to: string) => void | Promise<void>;
  renameOpenDocument: (from: string, to: string) => void;
  updateFilePaths: (fromPrefix: string, toPrefix: string) => void;
  migrateSidecars: (inputs: SidecarMigrationInput[]) => Promise<void>;
}

/**
 * Apply a plan. Stores first, sidecars last: the store updates are synchronous
 * and cannot fail, so doing them first means a sidecar failure leaves the app
 * pointing at the right files with some comments unmigrated — recoverable and
 * visible — rather than the reverse, which looks like the library vanished.
 */
export async function applyPathRewrites(
  plan: PathRewritePlan,
  deps: PathRewriteDeps,
): Promise<void> {
  for (const { from, to } of plan.projects) await deps.updateProjectPath(from, to);
  for (const { from, to } of plan.documents) deps.renameOpenDocument(from, to);
  if (plan.pinPrefix) deps.updateFilePaths(plan.pinPrefix.from, plan.pinPrefix.to);
  // After the sweep, never before: these correct paths the sweep produced.
  for (const { from, to } of plan.renamedPins) deps.updateFilePaths(from, to);
  if (plan.sidecars.length) await deps.migrateSidecars(plan.sidecars);
}
