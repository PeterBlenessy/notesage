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
  type MigrationPlan,
  type MigrationReport,
} from "@/lib/library-migration";
import {
  buildMigrationListing,
  collectSidecarFilePaths,
  migrationDeps,
} from "@/lib/library-migration-run";
import { applyPathRewrites, planPathRewrites } from "@/lib/library-migration-paths";
import { executeRenameTransaction } from "@/lib/rename-transaction";
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
        if (!cancelled) setPhase({ kind: "confirm", plan: planLibraryMigration(source, dest) });
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
        const ws = useWorkspaceStore.getState();
        const editor = useEditorStore.getState();
        const notesRoot = useSettingsStore.getState().notesRootPath;
        const rewrites = planPathRewrites({
          oldRoot,
          newRoot,
          projectPaths: ws.projects.map((p) => p.path),
          documentPaths: [
            ...editor.openDocuments.map((d) => d.filePath),
            ...(editor.recentFiles ?? []).map((r) => r.path),
          ].filter((p): p is string => Boolean(p)),
          sidecarFilePaths: notesRoot ? await collectSidecarFilePaths(notesRoot) : [],
          commentsDir: `${notesRoot ?? ""}/.notesage/comments`,
        });
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
            const tree = await tauriApi
              .listDirectory(to, useSettingsStore.getState().showHiddenFiles)
              .catch(() => []);
            ws.updateProjectPath(from, to, tree);
          },
          renameOpenDocument: (from, to) => editor.renameOpenDocument(from, to),
          updateFilePaths: (fromPrefix, toPrefix) => ws.updateFilePaths(fromPrefix, toPrefix),
          migrateSidecars: (inputs) =>
            notesRoot ? executeRenameTransaction(notesRoot, inputs) : Promise.resolve(),
        });

        // The library has moved: point the app at it, so the watchers and
        // every consumer follow without waiting for a restart.
        useSettingsStore.getState().setICloudNotesagePath(newRoot);
        useSettingsStore.getState().setLibraryRootKind("container");

        setPhase({ kind: "done", report });
      } catch (err) {
        setPhase({ kind: "error", message: String(err) });
        toast.error(String(err));
      } finally {
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
