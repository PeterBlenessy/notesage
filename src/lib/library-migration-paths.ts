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

export interface PathRewritePlan {
  /** Projects whose root moved: old → new. */
  projects: { from: string; to: string }[];
  /** Open documents and recents: old → new. */
  documents: { from: string; to: string }[];
  /** Pinned files, as a single prefix swap. */
  pinPrefix: { from: string; to: string } | null;
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
}

/**
 * Work out every rewrite before performing any. Anything not under the old
 * root is left alone: a project on the local disk, or on another volume, is
 * not part of this move and must not be dragged into it.
 */
export function planPathRewrites(inputs: PathRewriteInputs): PathRewritePlan {
  const { oldRoot, newRoot, commentsDir } = inputs;

  const projects: { from: string; to: string }[] = [];
  for (const from of inputs.projectPaths) {
    const to = rebase(from, oldRoot, newRoot);
    if (to) projects.push({ from, to });
  }

  const documents: { from: string; to: string }[] = [];
  for (const from of inputs.documentPaths) {
    const to = rebase(from, oldRoot, newRoot);
    if (to) documents.push({ from, to });
  }

  const sidecars: SidecarMigrationInput[] = [];
  for (const from of inputs.sidecarFilePaths) {
    const to = rebase(from, oldRoot, newRoot);
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
    pinPrefix: { from: oldRoot, to: newRoot },
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
  if (plan.sidecars.length) await deps.migrateSidecars(plan.sidecars);
}
