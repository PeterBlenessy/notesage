/**
 * Pure derivation: a project is synced iff its path lives under the
 * iCloud Notesage folder. There is no "sync state" to store — the path
 * IS the state.
 *
 * This replaces the old `useSyncStore.syncedProjectPaths` array. The
 * old model kept a separate flag per project (the array) which had to
 * stay coordinated with the actual folder location; the new model
 * collapses that to a one-liner. Moving a project to iCloud Drive
 * (via `tauriApi.migrateToICloud`) flips the derived state because
 * the path itself changes; moving back via `tauriApi.migrateFromICloud`
 * flips it back. No store updates required.
 */

import { useSettingsStore } from "@/stores/settings-store";

export function isProjectSynced(
  projectPath: string,
  icloudNotesagePath: string | null,
): boolean {
  if (!icloudNotesagePath) return false;
  return (
    projectPath === icloudNotesagePath ||
    projectPath.startsWith(icloudNotesagePath + "/")
  );
}

/**
 * React hook flavour — subscribes to the settings store so the
 * component re-renders if the iCloud notesage path changes (e.g.
 * iCloud Drive becomes available mid-session, or the user changes
 * the notes root path).
 */
export function useIsProjectSynced(projectPath: string): boolean {
  return useSettingsStore((s) =>
    isProjectSynced(projectPath, s.icloudNotesagePath),
  );
}
