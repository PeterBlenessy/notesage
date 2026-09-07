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
  buildMigrationListing,
  collectSidecarFilePaths,
  markerWriteDeps,
  migrationDeps,
  recordMigrationInMarker,
} from "@/lib/library-migration-run";
import { applyPathRewrites, planPathRewrites } from "@/lib/library-migration-paths";
import { executeRenameTransaction } from "@/lib/rename-transaction";
import { lockLibraryRoots, unlockLibraryRoots } from "@/lib/library-lock";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { useEditorStore } from "@/stores/editor-store";
import { useSettingsStore } from "@/stores/settings-store";

type Phase =
  | { kind: "planning" }
  | { kind: "confirm"; plan: MigrationPlan }
  | { kind: "running"; plan: MigrationPlan; done: number }
  | { kind: "done"; report: MigrationReport }
  | { kind: "error"; message: string };

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
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  oldRoot: string;
  newRoot: string;
}) {
  const [phase, setPhase] = useState<Phase>({ kind: "planning" });
  // A run in flight, tracked in a ref so a re-render cannot lose it. The
  // dialog can be dismissed and reopened; that must not start a second run
  // over the same two roots while the first is still moving files.
  const runningRef = useRef(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setPhase({ kind: "planning" });
    void (async () => {
      try {
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
  }, [open, oldRoot, newRoot]);

  const start = useCallback(
    async (plan: MigrationPlan) => {
      if (runningRef.current) return; // a second confirm while one is in flight
      runningRef.current = true;
      setPhase({ kind: "running", plan, done: 0 });
      // Hold the library for the duration. Nothing else in the app may write
      // into either root while the files are moving and the stored paths
      // still point at the old one — see `library-lock.ts`. Released in
      // `finally`, so a thrown migration cannot leave the app unable to save.
      lockLibraryRoots([oldRoot, newRoot]);
      try {
        const report = await runLibraryMigration(plan, oldRoot, newRoot, {
          ...migrationDeps(),
          onStep: (done) => setPhase({ kind: "running", plan, done }),
        });

        // Moving the bytes is only half of it. Projects, the open document,
        // recents, pins and the path-keyed comment sidecars all store
        // ABSOLUTE paths — without this the library comes back with an empty
        // sidebar, no pins and orphaned comments, every byte still on disk,
        // which is exactly what looks like data loss. Runs even when steps
        // failed: whatever DID move has moved, and leaving the bookkeeping
        // pointing at the old place would be worse than a partial move.
        const treeReadFailures: string[] = [];
        const ws = useWorkspaceStore.getState();
        const editor = useEditorStore.getState();
        const notesRoot = useSettingsStore.getState().notesRootPath;
        // Sidecars that cannot be re-keyed are named in the report rather
        // than skipped in silence: their key is a hash of the document path,
        // so after the move the comments are unreachable with the bytes still
        // on disk — which reads as losing them.
        const sidecarScan = notesRoot
          ? await collectSidecarFilePaths(notesRoot)
          : { paths: [], unreadable: [] };
        const rewrites = planPathRewrites({
          oldRoot,
          newRoot,
          projectPaths: ws.projects.map((p) => p.path),
          documentPaths: [
            ...editor.openDocuments.map((d) => d.filePath),
            ...(editor.recentFiles ?? []).map((r) => r.path),
          ].filter((p): p is string => Boolean(p)),
          sidecarFilePaths: sidecarScan.paths,
          commentsDir: `${notesRoot ?? ""}/.notesage/comments`,
          // What the run actually renamed. A plain rebase would point a
          // project kept as `X (from iCloud Drive)` at `<new root>/X` — the
          // OTHER project, the one already in the container.
          renames: report.renames,
        });
        // The rewrites get their own failure boundary, for the same reason
        // the marker does: by this point the files HAVE moved, and that
        // cannot be undone. Letting an exception here jump to the outer catch
        // skipped the marker AND the settings update — a library physically
        // in the container with nothing recording that it went there, which
        // is the one state the marker exists to prevent.
        let rewriteFailure: string | null = null;
        try {
          await applyPathRewrites(rewrites, {
            // The tree is RE-READ, not blanked. `updateProjectPath(from, to, [])`
            // wipes the cached tree, and nothing refills it: the watchers that
            // start on the new root only report future events, so the files
            // that are already sitting there never produce one. Every migrated
            // project would render as an empty folder until the app restarted
            // — which is the "my notes are gone" moment this whole feature has
            // to avoid. `migrateProjectPath` has always done it this way for a
            // single project.
            updateProjectPath: async (from, to) => {
              // A failed re-read is the empty-tree bug again, one project at a
              // time — so it is recorded rather than swallowed. The path still
              // updates: pointing at the right place with a stale tree beats
              // pointing at a folder that is no longer there.
              let tree: Awaited<ReturnType<typeof tauriApi.listDirectory>> = [];
              try {
                tree = await tauriApi.listDirectory(
                  to,
                  useSettingsStore.getState().showHiddenFiles,
                );
              } catch (err) {
                treeReadFailures.push(`${to}: ${String(err)}`);
              }
              ws.updateProjectPath(from, to, tree);
            },
            renameOpenDocument: (from, to) => editor.renameOpenDocument(from, to),
            updateFilePaths: (fromPrefix, toPrefix) => ws.updateFilePaths(fromPrefix, toPrefix),
            migrateSidecars: (inputs) =>
              notesRoot ? executeRenameTransaction(notesRoot, inputs) : Promise.resolve(),
          });
        } catch (err) {
          rewriteFailure = String(err);
        }

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
          unaccounted = unaccountedInOldRoot(remaining, report);
        } catch (err) {
          unaccounted = [
            {
              name: oldRoot,
              reason: t("settings.libraryMoveVerifyFailed", { error: String(err) }),
            },
          ];
        }

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
        try {
          await recordMigrationInMarker(newRoot, markerWriteDeps());
        } catch (err) {
          markerFailure = String(err);
        }

        // The library has moved: point the app at it, so the watchers and
        // every consumer follow without waiting for a restart.
        useSettingsStore.getState().setICloudNotesagePath(newRoot);
        useSettingsStore.getState().setLibraryRootKind("container");

        setPhase({
          kind: "done",
          report: {
            ...report,
            leftBehind: [
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
              ...treeReadFailures.map((f) => ({
                name: f,
                reason: "moved, but its contents could not be re-read — restart to see them",
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
        if (!next && phase.kind === "running") return;
        onOpenChange(next);
      }}
    >
      <DialogContent
        className="max-w-[480px]"
        showCloseButton={phase.kind !== "running"}
        onEscapeKeyDown={(e) => {
          if (phase.kind === "running") e.preventDefault();
        }}
        onInteractOutside={(e) => {
          if (phase.kind === "running") e.preventDefault();
        }}
      >
        <DialogHeader>
          <DialogTitle>
            {phase.kind === "done" ? t("settings.libraryMoveDone") : t("settings.libraryMoveTitle")}
          </DialogTitle>
          {phase.kind === "confirm" && (
            <DialogDescription>{t("settings.libraryMoveBody")}</DialogDescription>
          )}
        </DialogHeader>

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
                    <li key={l.name}>{l.reason}</li>
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
                    <li key={l.name}>{l.reason}</li>
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
          {phase.kind === "confirm" ? (
            <>
              <Button variant="ghost" onClick={() => onOpenChange(false)}>
                {t("common.cancel")}
              </Button>
              <Button onClick={() => void start(phase.plan)}>
                {t("settings.libraryMoveConfirm")}
              </Button>
            </>
          ) : (
            <Button
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={phase.kind === "running"}
            >
              {t("common.close")}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
