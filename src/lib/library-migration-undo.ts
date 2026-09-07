import type { MigrationDeps, MigrationReport } from "@/lib/library-migration";

/**
 * Putting a migration back.
 *
 * The migration already knows exactly what it did, so the undo is that record
 * reversed rather than a second algorithm. This is why the runner records
 * every move and stashes what it overwrote: with both, reversing is
 * mechanical.
 *
 * Design: `docs/design/migration-safety.md`.
 *
 * **This is not a backup.** It reverses what the migration performed. It
 * cannot help if bytes were destroyed in the cloud, or if something outside
 * the app changed a file since. Materialise-first is what closes that; this
 * closes regret — the migration doing exactly what it promised and the result
 * still being wrong.
 */

/** What a migration left behind, everything an undo needs and nothing else. */
export interface UndoRecord {
  /** Which migration this belongs to, so a stale record cannot be applied. */
  id: string;
  /** ISO-8601, for the offer to say how long ago. */
  at: string;
  oldRoot: string;
  newRoot: string;
  /** Every relocation, `from`/`to` relative to the two roots. */
  moves: { from: string; to: string }[];
  /** Destination content the run overwrote or deleted; `null` = nothing there. */
  destroyed: { root: "old" | "new"; path: string; content: string | null }[];
}

export function undoRecordFor(
  id: string,
  oldRoot: string,
  newRoot: string,
  report: Pick<MigrationReport, "moves" | "destroyed">,
  at: string = new Date().toISOString(),
): UndoRecord {
  return { id, at, oldRoot, newRoot, moves: report.moves, destroyed: report.destroyed };
}

export interface UndoReport {
  restored: number;
  /** Entries that could not go back, with why. Never silent. */
  failed: { from: string; to: string; error: string }[];
}

/**
 * Reverse a migration.
 *
 * Moves run in REVERSE order. The forward run can create a directory and then
 * move things into it; undoing that in the same order would try to take the
 * directory back while its children are still inside. Reversing means every
 * child is out before its parent is touched — the same reason a stack unwinds
 * the way it does.
 *
 * A step whose source is already gone counts as done, exactly as the forward
 * run does, so an interrupted undo can be re-run over what remains. A step
 * that fails does not abort the rest: a library half returned with no record
 * of which half is worse than finishing and saying what did not make it.
 */
export async function undoLibraryMigration(
  record: UndoRecord,
  deps: Pick<MigrationDeps, "moveEntry" | "exists" | "writeFile" | "deletePath" | "onStep">,
): Promise<UndoReport> {
  const report: UndoReport = { restored: 0, failed: [] };
  const total = record.moves.length + record.destroyed.length;
  let done = 0;

  for (const move of [...record.moves].reverse()) {
    const from = `${record.newRoot}/${move.to}`;
    const to = `${record.oldRoot}/${move.from}`;
    try {
      if (await deps.exists(from)) {
        await deps.moveEntry(from, to);
        report.restored += 1;
      }
    } catch (err) {
      report.failed.push({ from: move.to, to: move.from, error: String(err) });
    }
    done += 1;
    deps.onStep?.(done, total, { kind: "move", from: move.to, to: move.from });
  }

  // What the merges overwrote, put back as it was. Last, because these live
  // inside directories the moves above may have had to restore first.
  for (const item of record.destroyed) {
    // The root is recorded, never inferred: a merge destroys the
    // destination's copy AND the source, at two different roots, and writing
    // one back to the other's path would put the old library's pins inside
    // the container.
    const base = item.root === "old" ? record.oldRoot : record.newRoot;
    const path = `${base}/${item.path}`;
    try {
      if (item.content === null) {
        // There was nothing there before the migration, so the merged result
        // is itself the thing to remove — leaving it would be the migration's
        // output surviving its own undo.
        if (await deps.exists(path)) await deps.deletePath(path);
      } else {
        await deps.writeFile(path, item.content);
      }
      report.restored += 1;
    } catch (err) {
      report.failed.push({ from: item.path, to: item.path, error: String(err) });
    }
    done += 1;
    deps.onStep?.(done, total, { kind: "move", from: item.path, to: item.path });
  }

  return report;
}
