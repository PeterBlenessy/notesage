import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { tauriApi } from "@/lib/tauri";
import { t } from "@/lib/i18n";
import {
  planLibraryMigration,
  runLibraryMigration,
  unaccountedInOldRoot,
  type MigrationPlan,
  type MigrationReport,
} from "@/lib/library-migration";
import {
  discardUndoRecord,
  invertedRenames,
  saveUndoRecord,
  undoLibraryMigration,
  undoRecordFor,
  type UndoRecord,
  type UndoReport,
} from "@/lib/library-migration-undo";
import {
  buildMigrationListing,
  collectSidecarFilePaths,
  clearMigrationInMarker,
  markerWriteDeps,
  migrationDeps,
  recordMigrationInMarker,
  undoStoreDeps,
} from "@/lib/library-migration-run";
import {
  materialiseDeps,
  materialiseLibrary,
  type PendingDownload,
} from "@/lib/library-materialise";
import {
  applyPathRewrites,
  planPathRewrites,
  type MigrationRename,
} from "@/lib/library-migration-paths";
import { executeRenameTransaction } from "@/lib/rename-transaction";
import { applyProjectMoved } from "@/lib/project-moved";
import { lockLibraryRoots, unlockLibraryRoots } from "@/lib/library-lock";
import { librarySizeBucket, track, trackLabsFeatureUsed } from "@/lib/telemetry";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { useEditorStore } from "@/stores/editor-store";
import { useSettingsStore } from "@/stores/settings-store";

type Phase =
  | { kind: "materialising"; arrived: number; total: number }
  | { kind: "blocked"; pending: PendingDownload[]; cancelled: boolean }
  | { kind: "planning" }
  | { kind: "confirm"; plan: MigrationPlan }
  | { kind: "running"; plan: MigrationPlan; done: number }
  | { kind: "done"; report: MigrationReport; undo: UndoRecord | null }
  | { kind: "offerUndo"; record: UndoRecord }
  | { kind: "undoing"; done: number; total: number }
  | { kind: "undone"; report: UndoReport }
  | { kind: "error"; message: string };

/** A path shown the way somebody could find it: relative to its own root. */
function relativeToRoot(path: string, roots: string[]): string {
  for (const root of roots) {
    if (path.startsWith(`${root}/`)) return path.slice(root.length + 1);
  }
  return path;
}

/**
 * Point every stored absolute path at where the library now is.
 *
 * Shared by the migration and its undo, in the same direction each of them
 * moved: the undo passes the roots swapped and the renames inverted, and
 * nothing else about it differs. Two copies would drift, and this is the half
 * of the migration that decides whether the library comes back with a sidebar
 * in it — the files are already where they belong by the time this runs, so a
 * mistake here reads as losing everything while nothing has been lost.
 */
async function repointStoredPaths(
  from: string,
  to: string,
  renames: MigrationRename[],
): Promise<{
  failure: string | null;
  treeReadFailures: { path: string; error: string }[];
  sidecarUnreadable: string[];
}> {
  // Path and error kept apart: the report renders the name as the subject of
  // the reason, and gluing them together produced "<path>: <error> moved, but
  // its contents could not be re-read".
  const treeReadFailures: { path: string; error: string }[] = [];
  const ws = useWorkspaceStore.getState();
  const editor = useEditorStore.getState();
  const notesRoot = useSettingsStore.getState().notesRootPath;
  // Sidecars that cannot be re-keyed are named rather than skipped in
  // silence: their key is a hash of the document path, so after the move the
  // comments are unreachable with the bytes still on disk — which reads as
  // losing them.
  const sidecarScan = notesRoot
    ? await collectSidecarFilePaths(notesRoot)
    : { paths: [], unreadable: [] };
  const rewrites = planPathRewrites({
    oldRoot: from,
    newRoot: to,
    projectPaths: ws.projects.map((p) => p.path),
    documentPaths: [
      ...editor.openDocuments.map((d) => d.filePath),
      ...(editor.recentFiles ?? []).map((r) => r.path),
    ].filter((p): p is string => Boolean(p)),
    sidecarFilePaths: sidecarScan.paths,
    commentsDir: `${notesRoot ?? ""}/.notesage/comments`,
    renames,
  });
  // The rewrites get their own failure boundary, for the same reason the
  // marker does: by this point the files HAVE moved. Letting an exception
  // here escape skipped the marker AND the settings update — a library
  // physically in one place with nothing recording that it went there, which
  // is the one state the marker exists to prevent.
  let failure: string | null = null;
  try {
    await applyPathRewrites(rewrites, {
      // The tree is RE-READ, not blanked. `updateProjectPath(from, to, [])`
      // wipes the cached tree, and nothing refills it: the watchers that
      // start on the new root only report future events, so the files that
      // are already sitting there never produce one. Every moved project
      // would render as an empty folder until the app restarted — which is
      // the "my notes are gone" moment this whole feature has to avoid.
      //
      // The SAME bookkeeping the per-project sync uses. It used to be a
      // second implementation here, and the copy was missing the
      // project-metadata re-key — so every migrated project kept its metadata
      // keyed to the old path and its AI lock silently stopped enforcing
      // until the next launch. Writes go through the migration's own entry
      // points because the roots are locked.
      updateProjectPath: (a, b) =>
        applyProjectMoved(a, b, {
          listDirectory: (path) =>
            tauriApi.listDirectory(path, useSettingsStore.getState().showHiddenFiles),
          writeFile: (path, content) => tauriApi.migrationWriteFile(path, content),
          onTreeReadFailure: (path, err) => treeReadFailures.push({ path, error: String(err) }),
        }),
      renameOpenDocument: (a, b) => editor.renameOpenDocument(a, b),
      updateFilePaths: (fromPrefix, toPrefix) => ws.updateFilePaths(fromPrefix, toPrefix),
      migrateSidecars: (inputs) =>
        notesRoot ? executeRenameTransaction(notesRoot, inputs) : Promise.resolve(),
    });
  } catch (err) {
    failure = String(err);
  }
  return { failure, treeReadFailures, sidecarUnreadable: sidecarScan.unreadable };
}

/**
 * The one place a library move can be started, and the only place its plan is
 * visible before it happens.
 *
 * The confirmation is not ceremony. The move re-uploads the whole library
 * through iCloud and has no undo button, and the collision rules — two
 * projects of the same name kept side by side rather than merged — are
 * decisions the person should see BEFORE they are carried out, not discover
 * afterwards in a report.
 */
export function LibraryMigrationDialog({
  open,
  onOpenChange,
  oldRoot,
  newRoot,
  resumeUndo,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  oldRoot: string;
  newRoot: string;
  /**
   * A record found on disk from a move performed earlier — possibly in
   * another session. The dialog then opens on the offer to reverse it
   * instead of planning a new move, which is the whole reason the record is
   * persisted rather than kept in memory.
   */
  resumeUndo?: UndoRecord;
}) {
  const [phase, setPhase] = useState<Phase>({ kind: "materialising", arrived: 0, total: 0 });
  // A run in flight, tracked in a ref so a re-render cannot lose it. The
  // dialog can be dismissed and reopened; that must not start a second run
  // over the same two roots while the first is still moving files.
  const runningRef = useRef(false);
  // The pre-flight's stop button. A ref, because the wait loop reads it
  // between sweeps and a state value would be the one captured at the start.
  const cancelPreflightRef = useRef(false);
  // Bumped by "Check again", to re-run the pre-flight without reopening.
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    cancelPreflightRef.current = false;
    if (resumeUndo) {
      // Nothing to plan: this library has already been moved, and the only
      // question is whether to put it back.
      setPhase({ kind: "offerUndo", record: resumeUndo });
      return;
    }
    setPhase({ kind: "materialising", arrived: 0, total: 0 });
    void (async () => {
      try {
        // Materialise FIRST, before the plan is even built. An evicted file is
        // on disk only as a `.name.icloud` stub, and moving that stub out of
        // the container holding its bytes leaves a reference its owner may
        // purge — the one path to real data loss this feature has. Waiting
        // until nothing is evicted removes the race instead of narrowing it,
        // and it has to happen before planning too: a placeholder is a name
        // already taken, invisible to a listing read literally.
        const materialised = await materialiseLibrary([oldRoot, newRoot], {
          ...materialiseDeps(),
          // Bounded, not indefinite. An unbounded wait sounds kinder, but a
          // file that will never arrive — deleted on another device, an
          // account out of space — leaves someone watching a bar that will
          // not move, with no way to find out which file it is except a
          // button whose label does not promise an answer. Five minutes of
          // one-second sweeps, then the same screen the Stop button reaches:
          // what is missing, and Check again. Nothing is lost by stopping —
          // the downloads carry on in iCloud's own time.
          maxSweeps: 300,
          onProgress: (arrived, total) => {
            if (!cancelled) setPhase({ kind: "materialising", arrived, total });
          },
          isCancelled: () => cancelled || cancelPreflightRef.current,
        });
        if (cancelled) return;
        if (materialised.pending.length > 0) {
          // The one gate that can stop a willing user. Nothing else would say
          // whether it is a formality or a wall in practice.
          track("library_migration_blocked", {
            size: librarySizeBucket(materialised.pending.length),
          });
          setPhase({
            kind: "blocked",
            pending: materialised.pending,
            cancelled: materialised.cancelled,
          });
          return;
        }

        const [source, dest] = await Promise.all([
          buildMigrationListing(oldRoot),
          buildMigrationListing(newRoot),
        ]);
        const plan = planLibraryMigration(source, dest);
        // A plan with nothing in it is not a migration, and must never be
        // allowed to record one. This dialog is only reachable when the old
        // root HAS content (`libraryMigrationAvailable`), so an empty plan
        // means the two listings disagree with the thing that offered the
        // move — a race, a permissions fault, or a listing that came back
        // short. Confirming it would move no files and still write the
        // marker, which is the one outcome nothing can undo.
        if (!cancelled && plan.steps.length === 0) {
          setPhase({ kind: "error", message: t("settings.libraryMoveNothingToMove") });
          return;
        }
        if (!cancelled) setPhase({ kind: "confirm", plan });
      } catch (err) {
        if (!cancelled) setPhase({ kind: "error", message: String(err) });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, oldRoot, newRoot, attempt, resumeUndo]);

  const start = useCallback(
    async (plan: MigrationPlan) => {
      if (runningRef.current) return; // a second confirm while one is in flight
      runningRef.current = true;
      setPhase({ kind: "running", plan, done: 0 });
      // Hold the library for the duration. Nothing else in the app may write
      // into either root while the files are moving and the stored paths
      // still point at the old one — see `library-lock.ts`. Released in
      // `finally`, so a thrown migration cannot leave the app unable to save.
      // Used, not merely enabled — the distinction the flag registry's
      // graduation decision turns on.
      trackLabsFeatureUsed("icloud-container-library");
      track("library_migration_started", {
        size: librarySizeBucket(plan.steps.length),
      });
      lockLibraryRoots([oldRoot, newRoot]);
      let undoRecordFailure: string | null = null;
      try {
        const report = await runLibraryMigration(plan, oldRoot, newRoot, {
          ...migrationDeps(),
          onStep: (done) => setPhase({ kind: "running", plan, done }),
        });

        // The undo record goes to disk FIRST, ahead of the bookkeeping and
        // the marker, and outside both roots. It is the only artefact that
        // makes the move reversible, and every step after this one can fail;
        // a record written last is a record missing in exactly the cases
        // somebody would want it. Its own failure is not fatal — the
        // migration succeeded — but it costs the undo, so it is reported.
        let undoRecord: UndoRecord | null = undoRecordFor(
          crypto.randomUUID(),
          oldRoot,
          newRoot,
          report,
        );
        const homeDir = useSettingsStore.getState().homeDir;
        try {
          if (!homeDir) throw new Error("no home directory");
          await saveUndoRecord(homeDir, undoRecord, undoStoreDeps());
        } catch (err) {
          undoRecordFailure = String(err);
          undoRecord = null;
        }

        // Moving the bytes is only half of it. Projects, the open document,
        // recents, pins and the path-keyed comment sidecars all store
        // ABSOLUTE paths — without this the library comes back with an empty
        // sidebar, no pins and orphaned comments, every byte still on disk,
        // which is exactly what looks like data loss. Runs even when steps
        // failed: whatever DID move has moved, and leaving the bookkeeping
        // pointing at the old place would be worse than a partial move.
        //
        // `report.renames` and not a plain rebase: a project kept as
        // `X (from iCloud Drive)` would otherwise be pointed at
        // `<new root>/X` — the OTHER project, the one already in the
        // container.
        const repoint = await repointStoredPaths(oldRoot, newRoot, report.renames);
        const rewriteFailure = repoint.failure;
        const treeReadFailures = repoint.treeReadFailures;
        const sidecarScan = { unreadable: repoint.sidecarUnreadable };

        // Check the belief against the disk before declaring anything.
        //
        // Everything above is what the runner THINKS happened. A step can
        // report success and still leave something behind, and the plan was
        // built before this dialog was confirmed — so anything that landed in
        // the old root in between is in no step at all. Re-reading is cheap
        // and is the difference between a partial migration and a partial
        // migration reported as complete. A failure to re-read is itself
        // reported rather than assumed clean.
        let unaccounted: { name: string; reason: string }[] = [];
        try {
          const remaining = await tauriApi.listDirectory(oldRoot, true);
          // The Inbox folder itself always survives — items move out of it,
          // it is never removed — so its contents are checked separately or
          // an article left inside would be hidden by the folder's own
          // explanation.
          const remainingInbox = remaining.some((e) => e.is_directory && e.name === "Inbox")
            ? await tauriApi.listDirectory(`${oldRoot}/Inbox`, true)
            : [];
          unaccounted = unaccountedInOldRoot(remaining, report, remainingInbox);
        } catch (err) {
          unaccounted = [
            {
              name: oldRoot,
              reason: t("settings.libraryMoveVerifyFailed", { error: String(err) }),
            },
          ];
        }

        // Did anything actually move?
        //
        // A run where every step failed — an unwritable container, iCloud
        // offline, a full disk — must NOT be recorded as a migration. The
        // marker is what `resolveSyncedLibraryRoot` follows before anything
        // else, so writing it would point this Mac, and every other device,
        // at a container holding nothing while the whole library sat in the
        // old folder: the library reads as empty, and because
        // `libraryMigrationAvailable` also tests the marker, the move is
        // never offered again. The one state with no way back in the app.
        //
        // A resumed run that finds every source already gone is NOT this:
        // nothing moved because a previous run moved it, so it has no
        // failures and the marker belongs.
        const movedAnything =
          report.moved.projects + report.moved.inboxItems + report.moved.looseFiles + report.merged >
          0;
        const achievedNothing = !movedAnything && report.failed.length > 0;

        // Record the move in the container's marker BEFORE touching the
        // settings, because the marker is what survives a restart and the
        // settings are not. Startup re-resolves the root every launch; an
        // unmarked container loses to "the old folder still has something in
        // it", and the app comes back pointing at the folder it just
        // emptied.
        //
        // A failure here does not fail the migration — the files have moved
        // and that cannot be undone — but it MUST be visible, because the
        // library is now in a state only this marker explains.
        let markerFailure: string | null = null;
        if (!achievedNothing) {
          try {
            await recordMigrationInMarker(newRoot, markerWriteDeps());
          } catch (err) {
            markerFailure = String(err);
          }

          // The library has moved: point the app at it, so the watchers and
          // every consumer follow without waiting for a restart.
          useSettingsStore.getState().setICloudNotesagePath(newRoot);
          useSettingsStore.getState().setLibraryRootKind("container");
        }

        track("library_migration_finished", {
          outcome: achievedNothing
            ? "nothing_moved"
            : report.failed.length > 0
              ? "partial"
              : "complete",
        });

        setPhase({
          kind: "done",
          undo: undoRecord,
          report: {
            ...report,
            leftBehind: [
              ...(achievedNothing
                ? [
                    {
                      name: t("settings.libraryMoveNothingMovedName"),
                      reason: t("settings.libraryMoveNothingMoved"),
                    },
                  ]
                : []),
              ...report.leftBehind,
              ...unaccounted,
              ...(rewriteFailure
                ? [
                    {
                      name: t("settings.libraryMoveBookkeepingName"),
                      reason: t("settings.libraryMoveBookkeepingFailed", { error: rewriteFailure }),
                    },
                  ]
                : []),
              ...sidecarScan.unreadable.map((name) => ({
                name,
                reason: t("settings.libraryMoveSidecarUnreadable"),
              })),
              ...(markerFailure
                ? [
                    {
                      name: t("settings.libraryMoveMarkerName"),
                      reason: t("settings.libraryMoveMarkerFailed", { error: markerFailure }),
                    },
                  ]
                : []),
              ...(undoRecordFailure
                ? [
                    {
                      name: t("settings.libraryUndoRecordName"),
                      reason: t("settings.libraryUndoRecordFailed", { error: undoRecordFailure }),
                    },
                  ]
                : []),
              ...treeReadFailures.map((f) => ({
                name: f.path,
                reason: `${t("settings.libraryMoveTreeUnreadable")} (${f.error})`,
              })),
            ],
          },
        });
      } catch (err) {
        setPhase({ kind: "error", message: String(err) });
        toast.error(String(err));
      } finally {
        // Always, even when the run threw. A lock left held is an app that
        // cannot save anything in its own library.
        unlockLibraryRoots();
        runningRef.current = false;
      }
    },
    [oldRoot, newRoot],
  );

  /**
   * Put the library back where it came from.
   *
   * Undo is itself a migration: it takes the same lock, goes through the same
   * `migration*` write entry points, repoints the same stored paths, and can
   * partially fail the same way. What it is NOT is a backup — it reverses what
   * the run performed and nothing else, so anything changed since is changed
   * still. See `docs/design/migration-safety.md`.
   */
  const undo = useCallback(
    async (record: UndoRecord) => {
      if (runningRef.current) return;
      runningRef.current = true;
      setPhase({ kind: "undoing", done: 0, total: 0 });
      // The record's own roots, not the props. A record read back from disk
      // may have been written in another session, and reversing it against
      // roots it does not describe is how an undo moves the wrong files.
      const from = record.newRoot;
      const to = record.oldRoot;
      lockLibraryRoots([to, from]);
      try {
        const report = await undoLibraryMigration(record, {
          ...migrationDeps(),
          onStep: (done, total) => setPhase({ kind: "undoing", done, total }),
        });

        // Same bookkeeping, the other way round. The renames are derived
        // from the record's own moves so the two cannot disagree.
        const repoint = await repointStoredPaths(from, to, invertedRenames(record));

        // The marker comes off BEFORE the settings, mirroring the order the
        // migration wrote it in: it is what survives a restart, and while it
        // stands every device — this Mac included — keeps resolving the
        // library to a container the files have just left.
        let markerFailure: string | null = null;
        try {
          await clearMigrationInMarker(from, markerWriteDeps());
        } catch (err) {
          markerFailure = String(err);
        }

        useSettingsStore.getState().setICloudNotesagePath(to);
        useSettingsStore.getState().setLibraryRootKind("clouddocs");

        // Spent, and only then. Leaving a fully applied record would offer an
        // undo of an undo — everything moved back a second time — but a
        // PARTIAL undo is exactly the case the record is still needed for:
        // it can be re-run over whatever is left, and a step whose source is
        // already gone counts as done.
        const homeDir = useSettingsStore.getState().homeDir;
        if (homeDir && report.failed.length === 0) {
          await discardUndoRecord(homeDir, record.id, undoStoreDeps());
        }

        track("library_migration_undone", {
          outcome: report.failed.length > 0 ? "partial" : "complete",
        });

        setPhase({
          kind: "undone",
          report: {
            ...report,
            failed: [
              ...report.failed,
              ...(repoint.failure
                ? [
                    {
                      from: t("settings.libraryMoveBookkeepingName"),
                      to,
                      error: repoint.failure,
                    },
                  ]
                : []),
              ...(markerFailure
                ? [{ from: t("settings.libraryMoveMarkerName"), to: from, error: markerFailure }]
                : []),
              // Named, not dropped: a project whose contents could not be
              // re-read renders as an empty folder, and a sidecar that could
              // not be re-keyed leaves comments unreachable — both read as
              // losing something that is still on disk.
              ...repoint.treeReadFailures.map((f) => ({
                from: f.path,
                to,
                error: `${t("settings.libraryMoveTreeUnreadable")} (${f.error})`,
              })),
              ...repoint.sidecarUnreadable.map((name) => ({
                from: name,
                to,
                error: t("settings.libraryMoveSidecarUnreadable"),
              })),
            ],
          },
        });
      } catch (err) {
        setPhase({ kind: "error", message: String(err) });
        toast.error(String(err));
      } finally {
        unlockLibraryRoots();
        runningRef.current = false;
      }
    },
    [oldRoot, newRoot],
  );

  // Pulled out of the JSX so the closure below keeps the narrowing: a
  // property of `phase` narrows at the point it is tested and widens again
  // inside a callback.
  const undoRecord = phase.kind === "done" ? phase.undo : null;

  return (
    <Dialog
      open={open}
      // A run cannot be dismissed. Disabling the footer button was cosmetic:
      // Escape, the corner ✕ and an outside click all closed the dialog
      // anyway, and because the roots stay set, reopening re-planned and
      // could start a SECOND run over the same files while the first was
      // still moving them. There is no cancel here because there is nothing
      // safe to cancel to — a half-moved library needs the run to finish and
      // report, not to stop in the middle.
      onOpenChange={(next) => {
        if (!next && (phase.kind === "running" || phase.kind === "undoing")) return;
        onOpenChange(next);
      }}
    >
      <DialogContent
        className="max-w-[480px]"
        showCloseButton={phase.kind !== "running" && phase.kind !== "undoing"}
        onEscapeKeyDown={(e) => {
          if (phase.kind === "running" || phase.kind === "undoing") e.preventDefault();
        }}
        onInteractOutside={(e) => {
          if (phase.kind === "running" || phase.kind === "undoing") e.preventDefault();
        }}
      >
        <DialogHeader>
          <DialogTitle>
            {phase.kind === "done"
              ? t("settings.libraryMoveDone")
              : phase.kind === "undone"
                ? t("settings.libraryUndoDone")
                : t("settings.libraryMoveTitle")}
          </DialogTitle>
          {phase.kind === "confirm" && (
            <DialogDescription>{t("settings.libraryMoveBody")}</DialogDescription>
          )}
        </DialogHeader>

        {phase.kind === "materialising" && (
          <div className="space-y-2">
            <p className="text-sm">{t("settings.libraryMoveMaterialising")}</p>
            {phase.total > 0 && (
              <>
                <Progress value={(phase.arrived / phase.total) * 100} />
                <p className="text-sm text-muted-foreground">
                  {t("settings.libraryMoveMaterialisingCount", {
                    arrived: String(phase.arrived),
                    total: String(phase.total),
                  })}
                </p>
              </>
            )}
          </div>
        )}

        {phase.kind === "blocked" && (
          <div className="space-y-2 text-sm">
            <p>
              {phase.cancelled
                ? t("settings.libraryMoveBlockedCancelled")
                : t("settings.libraryMoveBlocked")}
            </p>
            <ul className="list-disc pl-5 text-muted-foreground">
              {phase.pending.slice(0, 10).map((p) => (
                // Relative to whichever root holds it, not the bare filename:
                // several stuck files can share a name, and a list reading
                // "note.md, note.md, note.md" tells the reader nothing about
                // which ones or where to look.
                <li key={p.path}>{relativeToRoot(p.path, [oldRoot, newRoot])}</li>
              ))}
            </ul>
            {phase.pending.length > 10 && (
              <p className="text-muted-foreground">
                {t("settings.libraryMoveBlockedMore", {
                  count: String(phase.pending.length - 10),
                })}
              </p>
            )}
          </div>
        )}

        {phase.kind === "planning" && (
          <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
        )}

        {phase.kind === "confirm" && (
          <div className="space-y-3 text-sm">
            <p>
              {t("settings.libraryMoveCounts", {
                projects: String(phase.plan.counts.projects),
                inbox: String(phase.plan.counts.inboxItems),
                files: String(phase.plan.counts.looseFiles),
              })}
            </p>
            {phase.plan.leftBehind.length > 0 && (
              <div className="space-y-1">
                <p className="text-muted-foreground">{t("settings.libraryMoveCollisions")}</p>
                <ul className="list-disc pl-5 text-muted-foreground">
                  {phase.plan.leftBehind.map((l) => (
                    // Name AND reason. Every reason is a fragment with the
                    // name as its subject — `kept as "X" — a project of the
                    // same name already existed` on its own does not say
                    // WHICH project, and `could not be written (…)` does not
                    // say what.
                    <li key={l.name}>
                      <span className="text-foreground">{l.name}</span> {l.reason}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        {phase.kind === "running" && (
          <div className="space-y-2">
            <p className="text-sm">{t("settings.libraryMoveRunning")}</p>
            <Progress
              value={
                phase.plan.steps.length
                  ? (phase.done / phase.plan.steps.length) * 100
                  : 100
              }
            />
          </div>
        )}

        {phase.kind === "done" && (
          <div className="space-y-2 text-sm">
            <p>
              {t("settings.libraryMoveCounts", {
                projects: String(phase.report.moved.projects),
                inbox: String(phase.report.moved.inboxItems),
                files: String(phase.report.moved.looseFiles),
              })}
            </p>
            {phase.report.renamed > 0 && (
              <p className="text-muted-foreground">
                {t("settings.libraryMoveRenamed", { count: String(phase.report.renamed) })}
              </p>
            )}
            {phase.report.failed.length > 0 && (
              <p className="text-[var(--color-destructive)]">
                {t("settings.libraryMoveFailed", { count: String(phase.report.failed.length) })}
              </p>
            )}
            {phase.report.leftBehind.length > 0 && (
              <div className="space-y-1">
                <p className="text-muted-foreground">{t("settings.libraryMoveLeftBehind")}</p>
                <ul className="list-disc pl-5 text-muted-foreground">
                  {phase.report.leftBehind.map((l) => (
                    <li key={l.name}>
                      <span className="text-foreground">{l.name}</span> {l.reason}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        {phase.kind === "offerUndo" && (
          <p className="text-sm">
            {t("settings.libraryUndoOffer", {
              when: new Date(phase.record.at).toLocaleString(),
              count: String(phase.record.moves.length),
            })}
          </p>
        )}

        {phase.kind === "undoing" && (
          <div className="space-y-2">
            <p className="text-sm">{t("settings.libraryUndoRunning")}</p>
            <Progress value={phase.total ? (phase.done / phase.total) * 100 : 0} />
          </div>
        )}

        {phase.kind === "undone" && (
          <div className="space-y-2 text-sm">
            <p>{t("settings.libraryUndoRestored", { count: String(phase.report.restored) })}</p>
            {phase.report.failed.length > 0 && (
              <div className="space-y-1">
                <p className="text-[var(--color-destructive)]">
                  {t("settings.libraryUndoFailed", { count: String(phase.report.failed.length) })}
                </p>
                <ul className="list-disc pl-5 text-muted-foreground">
                  {phase.report.failed.map((f) => (
                    <li key={`${f.from}->${f.to}`}>
                      {f.from} — {f.error}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        {phase.kind === "error" && (
          <p className="text-sm text-[var(--color-destructive)]">{phase.message}</p>
        )}

        <DialogFooter>
          {phase.kind === "offerUndo" ? (
            <>
              <Button variant="ghost" onClick={() => void undo(phase.record)}>
                {t("settings.libraryUndoAction")}
              </Button>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                {t("common.close")}
              </Button>
            </>
          ) : phase.kind === "materialising" ? (
            // The only control during the pre-flight, and it must exist: on a
            // large library over iCloud this can take a long time, and a modal
            // spinner with no way out is its own failure.
            //
            // "Stop waiting", not "Cancel": what it ends is the waiting, and
            // the next screen names what has not arrived. The downloads carry
            // on in iCloud's own time, and Cancel in a modal footer would
            // read as abandoning the migration itself.
            <Button
              variant="ghost"
              onClick={() => {
                cancelPreflightRef.current = true;
              }}
            >
              {t("settings.libraryMoveStopWaiting")}
            </Button>
          ) : phase.kind === "blocked" ? (
            <>
              <Button variant="ghost" onClick={() => setAttempt((n) => n + 1)}>
                {t("settings.libraryMoveCheckAgain")}
              </Button>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                {t("common.close")}
              </Button>
            </>
          ) : phase.kind === "confirm" ? (
            <>
              <Button variant="ghost" onClick={() => onOpenChange(false)}>
                {t("common.cancel")}
              </Button>
              <Button onClick={() => void start(phase.plan)}>
                {t("settings.libraryMoveConfirm")}
              </Button>
            </>
          ) : (
            <>
              {undoRecord && (
                // Offered, never automatic, and never the default action: the
                // move succeeded, and moving everything back is itself a full
                // migration over iCloud. The record outlives this dialog, so
                // closing it is not the last chance.
                <Button variant="ghost" onClick={() => void undo(undoRecord)}>
                  {t("settings.libraryUndoAction")}
                </Button>
              )}
              <Button
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={phase.kind === "running" || phase.kind === "undoing"}
              >
                {t("common.close")}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
