import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { SettingsRow } from "@/components/settings/v2/SettingsRow";
import { useSettingsStore } from "@/stores/settings-store";
import { useFlagStore } from "@/stores/flag-store";
import { tauriApi } from "@/lib/tauri";
import { libraryMigrationAvailable } from "@/lib/library-root";
import { t } from "@/lib/i18n";

/**
 * Where the synced library is, and — behind the Labs flag, and only when
 * there is something to move — the offer to move it into Notesage's own
 * iCloud container.
 *
 * Reads its own inputs rather than taking them as props. Eligibility depends
 * on what is on disk right now (a container that appeared since launch, an
 * old folder somebody emptied by hand), and a value threaded down from
 * startup would be answering yesterday's question.
 */
export function LibraryMigrationRow({ onReview }: { onReview: () => void }) {
  const rootPath = useSettingsStore((s) => s.icloudNotesagePath);
  const rootKind = useSettingsStore((s) => s.libraryRootKind);
  const flagOn = useFlagStore((s) => s.enabled.includes("icloud-container-library"));
  const [eligible, setEligible] = useState(false);

  useEffect(() => {
    let cancelled = false;
    // Only asked when the flag is on: without it the answer changes nothing
    // on screen, and this is two filesystem calls on a cloud path.
    if (!flagOn) {
      setEligible(false);
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
        if (!cancelled) {
          setEligible(
            libraryMigrationAvailable({
              containerRoot,
              cloudDocsRoot,
              marker,
              cloudDocsHasContent,
            }),
          );
        }
      } catch {
        if (!cancelled) setEligible(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [flagOn, rootPath]);

  const describeRoot = useCallback(() => {
    if (!rootPath) return t("settings.librarySyncOff");
    return rootKind === "container"
      ? t("settings.libraryInContainer")
      : t("settings.libraryInCloudDocs");
  }, [rootPath, rootKind]);

  return (
    <SettingsRow
      label={t("settings.libraryLocation")}
      description={rootPath ? `${describeRoot()} · ${rootPath}` : describeRoot()}
      control={
        eligible ? (
          <Button variant="outline" size="sm" onClick={onReview}>
            {t("settings.libraryMoveAction")}
          </Button>
        ) : null
      }
    />
  );
}
