import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";
import { toast } from "sonner";
import { useSettingsStore } from "@/stores/settings-store";

type NotificationType = "agent_completion" | "agent_error" | "external_change";

const TYPE_TO_SETTING: Record<NotificationType, keyof Pick<
  ReturnType<typeof useSettingsStore.getState>,
  "notifyAgentCompletion" | "notifyExternalChanges"
>> = {
  agent_completion: "notifyAgentCompletion",
  agent_error: "notifyAgentCompletion",
  external_change: "notifyExternalChanges",
};

/**
 * Send a desktop notification if the corresponding setting is enabled.
 * Handles permission checking/requesting silently.
 */
export async function notify(
  type: NotificationType,
  title: string,
  body: string
): Promise<void> {
  const settingKey = TYPE_TO_SETTING[type];
  const settings = useSettingsStore.getState();
  if (!settings[settingKey]) return;

  try {
    let granted = await isPermissionGranted();
    if (!granted) {
      const result = await requestPermission();
      granted = result === "granted";
    }
    if (!granted) return;

    sendNotification({ title, body });
  } catch {
    // Notification not supported or permission denied — silent degradation
  }
}

// ---------------------------------------------------------------------------
// External-change toast helpers
// ---------------------------------------------------------------------------

/** Extract a short filename from an absolute file path. */
function fileNameFromPath(filePath: string): string {
  const idx = filePath.lastIndexOf("/");
  return idx >= 0 ? filePath.slice(idx + 1) : filePath;
}

export interface ExternalChangeToastOptions {
  /** Absolute path of the file that changed on disk. */
  filePath: string;
  /** Invoked when the user clicks "Accept" — reload from disk. */
  onAccept: () => void;
  /** Invoked when the user clicks "Reject" — keep in-memory version. */
  onReject: () => void;
  /**
   * Invoked when the user dismisses the toast (X button or auto-dismiss).
   * Decorations remain in the editor for per-hunk review.
   */
  onDismiss?: () => void;
}

/**
 * Sticky action toast shown when "Review external diff" is ON and a file is
 * modified on disk. Accept reloads from disk, Reject keeps the in-memory
 * version, Dismiss leaves the decorations visible so the user can review them
 * via the inline per-hunk controls.
 *
 * Uses a stable id derived from the file path so repeated changes to the same
 * file collapse into one toast instead of stacking.
 */
export function toastExternalChange(options: ExternalChangeToastOptions): string | number {
  const { filePath, onAccept, onReject, onDismiss } = options;
  const fileName = fileNameFromPath(filePath);
  return toast(`${fileName} changed externally`, {
    id: `external-change:${filePath}`,
    duration: Infinity,
    closeButton: true,
    action: {
      label: "Accept",
      onClick: onAccept,
    },
    cancel: {
      label: "Reject",
      onClick: onReject,
    },
    onDismiss: onDismiss,
  });
}

/**
 * Info toast shown when "Review external diff" is OFF and a file is
 * modified on disk — the tab has already been silently auto-reloaded.
 * Auto-dismisses after ~3 seconds, no actions.
 */
export function toastExternalReload(filePath: string): void {
  const fileName = fileNameFromPath(filePath);
  toast.info(`${fileName} reloaded from disk`, {
    id: `external-change:${filePath}`,
    duration: 3000,
  });
}

/**
 * Sticky toast shown when a file that has unsaved edits is renamed externally.
 * The tab path has already been rewritten to the new path; this toast gives
 * the user a one-click Save action so the edits land at the new path.
 *
 * When the file has no unsaved edits, call this without `onSave` — the toast
 * will omit the action button.
 */
export function toastExternalRename(
  oldName: string,
  newName: string,
  onSave?: () => void,
): string | number {
  return toast(`${oldName} renamed to ${newName} externally${onSave ? " — your unsaved edits stay on the new path. Save now?" : ""}`, {
    id: `external-rename:${newName}`,
    duration: Infinity,
    closeButton: true,
    ...(onSave
      ? {
          action: {
            label: "Save",
            onClick: onSave,
          },
        }
      : {}),
  });
}
