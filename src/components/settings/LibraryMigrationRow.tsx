import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { SettingsRow } from "@/components/settings/v2/SettingsRow";
import { SettingsHint } from "@/components/settings/v2/SettingsHint";
import { useSettingsStore } from "@/stores/settings-store";
import { useFlagStore } from "@/stores/flag-store";
import { tauriApi } from "@/lib/tauri";
import { migrationOfferState, type MigrationOfferState } from "@/lib/library-root";
import { latestUndoRecord, type UndoRecord } from "@/lib/library-migration-undo";
import { undoStoreDeps } from "@/lib/library-migration-run";
import { track } from "@/lib/telemetry";
import { t } from "@/lib/i18n";

/**
 * Where the synced library is, and — behind the Labs flag — the offer to move
 * it into Notesage's own iCloud container.
 *
 * Reads its own inputs rather than taking them as props. Eligibility depends
 * on what is on disk right now (a container that appeared since launch, an
 * old folder somebody emptied by hand), and a value threaded down from
 * startup would be answering yesterday's question.
 *
 * The row EXPLAINS ITSELF. It used to render a button when the move was
 * available and nothing at all otherwise — four different situations all
 * showing the same blank space, so somebody who had just turned the flag on
 * could not tell a broken feature from a Mac that is not eligible. Every
 * state now says what it is and, where there is one, what would change it.
 */
export function LibraryMigrationRow({
  onReview,
  onUndo,
}: {
  onReview: () => void;
  /** Given the record found on disk, so the caller can open the dialog on it. */
  onUndo: (record: UndoRecord) => void;
}) {
  const rootPath = useSettingsStore((s) => s.icloudNotesagePath);
  const rootKind = useSettingsStore((s) => s.libraryRootKind);
  const flagOn = useFlagStore((s) => s.enabled.includes("icloud-container-library"));
  const [offer, setOffer] = useState<MigrationOfferState | null>(null);
  // A move this Mac performed and has not spent. Read from disk, not from
  // memory: the record is written to `~/.notesage/migrations/` precisely
  // because the moment someone decides the result is wrong is more likely to
  // be the next morning than the next minute — and by then the dialog that
  // performed it is long gone.
  const [undoable, setUndoable] = useState<UndoRecord | null>(null);
  const homeDir = useSettingsStore((s) => s.homeDir);

  useEffect(() => {
    let cancelled = false;
    // Only asked when the flag is on: without it the answer changes nothing
    // on screen, and this is two filesystem calls on a cloud path.
    if (!flagOn) {
      setOffer(null);
      return;
    }
    void (async () => {
      try {
        const [icloudRoot, containerRoot] = await Promise.all([
          tauriApi.getICloudPath(),
          tauriApi.getLibraryContainerPath(),
        ]);
        const cloudDocsRoot = icloudRoot ? `${icloudRoot}/Notesage` : null;
        const marker = containerRoot ? await tauriApi.readLibraryMarker(containerRoot) : null;
        let cloudDocsHasContent = false;
        if (cloudDocsRoot) {
          try {
            const entries = await tauriApi.listDirectory(cloudDocsRoot);
            cloudDocsHasContent = entries.some((e) => e.name !== ".DS_Store");
          } catch {
            cloudDocsHasContent = false;
          }
        }
        const state = migrationOfferState({
          containerRoot,
          cloudDocsRoot,
          marker,
          cloudDocsHasContent,
        });
        if (cancelled) return;
        setOffer(state);
        // What is stopping the people who opted in. Once per mount of this
        // panel rather than per render; the volume is a person opening
        // Settings, not a loop.
        track("library_migration_state", { state });
      } catch {
        if (!cancelled) setOffer("no-icloud");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [flagOn, rootPath]);

  useEffect(() => {
    let cancelled = false;
    if (!homeDir) return;
    void (async () => {
      const record = await latestUndoRecord(homeDir, undoStoreDeps()).catch(() => null);
      if (!cancelled) setUndoable(record);
    })();
    return () => {
      cancelled = true;
    };
    // `rootPath` so the offer disappears as soon as an undo has moved the
    // library back and discarded its record.
  }, [homeDir, rootPath]);

  const describeRoot = useCallback(() => {
    if (!rootPath) return t("settings.librarySyncOff");
    return rootKind === "container"
      ? t("settings.libraryInContainer")
      : t("settings.libraryInCloudDocs");
  }, [rootPath, rootKind]);

  // The explanation for whichever state this Mac is in. Null when the flag is
  // off — there is nothing to explain until somebody asks for it.
  const hint = offer === null ? null : t(HINT_KEY[offer]);

  return (
    <>
      <SettingsRow
        label={t("settings.libraryLocation")}
        description={
          rootPath ? (
            <span className="flex flex-col gap-0.5">
              <span>{describeRoot()}</span>
              {/* The full path, second and quieter. It is the answer to "which
                  folder exactly", not the name of the place — nobody reads
                  `com~apple~CloudDocs` as "iCloud Drive". */}
              <span className="font-mono text-[11px] opacity-70">{rootPath}</span>
            </span>
          ) : (
            describeRoot()
          )
        }
        control={
          offer === "offer" ? (
            <Button variant="outline" size="sm" onClick={onReview}>
              {t("settings.libraryMoveAction")}
            </Button>
          ) : undoable ? (
            <Button variant="outline" size="sm" onClick={() => onUndo(undoable)}>
              {t("settings.libraryUndoAction")}
            </Button>
          ) : null
        }
      />
      {hint && <SettingsHint>{hint}</SettingsHint>}
    </>
  );
}

const HINT_KEY = {
  offer: "settings.libraryOfferReady",
  "no-icloud": "settings.libraryOfferNoICloud",
  "no-container": "settings.libraryOfferNoContainer",
  "already-migrated": "settings.libraryOfferAlreadyMigrated",
  "nothing-to-move": "settings.libraryOfferNothingToMove",
} as const;
