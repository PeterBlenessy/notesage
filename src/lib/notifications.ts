import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";
import { toast } from "sonner";
import { useSettingsStore } from "@/stores/settings-store";

type NotificationType =
  | "agent_completion"
  | "agent_error"
  | "external_change"
  | "automation_failure"
  | "inbox_capture";

/**
 * Opaque payload carried on the notification and handed back to `onAction`
 * handlers when it is clicked (e.g. `{ inbox: true }` so `useInboxArrivals`
 * can open the Inbox). Never shown to the user.
 */
export type NotificationExtra = Record<string, unknown>;

const TYPE_TO_SETTING: Record<NotificationType, keyof Pick<
  ReturnType<typeof useSettingsStore.getState>,
  "notifyAgentCompletion" | "notifyExternalChanges" | "notifyAutomationFailure" | "notifyInboxCaptures"
>> = {
  agent_completion: "notifyAgentCompletion",
  agent_error: "notifyAgentCompletion",
  external_change: "notifyExternalChanges",
  automation_failure: "notifyAutomationFailure",
  inbox_capture: "notifyInboxCaptures",
};

/** Permission check + send, with silent degradation. Setting-agnostic. */
async function deliverNotification(
  title: string,
  body: string,
  extra?: NotificationExtra,
): Promise<void> {
  try {
    let granted = await isPermissionGranted();
    if (!granted) {
      const result = await requestPermission();
      granted = result === "granted";
    }
    if (!granted) return;

    sendNotification(extra ? { title, body, extra } : { title, body });
  } catch {
    // Notification not supported or permission denied — silent degradation
  }
}

/**
 * Send a desktop notification if the corresponding setting is enabled.
 * Handles permission checking/requesting silently. `extra` rides along on
 * the notification for the click handler (`onAction`), never for display.
 */
export async function notify(
  type: NotificationType,
  title: string,
  body: string,
  extra?: NotificationExtra,
): Promise<void> {
  const settingKey = TYPE_TO_SETTING[type];
  if (!useSettingsStore.getState()[settingKey]) return;
  await deliverNotification(title, body, extra);
}

/**
 * A user-authored automation `notify` step — always fires (subject to OS
 * permission), since it's explicit user intent, not a gated diagnostic.
 */
export async function notifyAutomation(title: string, body: string): Promise<void> {
  await deliverNotification(title, body);
}

/**
 * Desktop notification for a BACKGROUNDED chat session (PRD
 * `2026-06-14-command-bar-session-multitasking`, task #15) — a session the user
 * isn't currently watching that needs a permission decision or has completed.
 * Gated on the matching setting (`notifyPermissionRequest` /
 * `notifyAgentCompletion`). The `conversationId` rides along in `extra` so the
 * notification-click handler (registered in `useSessionManager`) can foreground
 * the right session.
 */
export async function notifyBackgroundSession(
  kind: "permission" | "completion",
  title: string,
  body: string,
  conversationId: string,
): Promise<void> {
  const settings = useSettingsStore.getState();
  const enabled =
    kind === "permission"
      ? settings.notifyPermissionRequest
      : settings.notifyAgentCompletion;
  if (!enabled) return;

  try {
    let granted = await isPermissionGranted();
    if (!granted) {
      granted = (await requestPermission()) === "granted";
    }
    if (!granted) return;

    sendNotification({ title, body, extra: { conversationId } });
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

// ---------------------------------------------------------------------------
// Telemetry first-run / channel-switch notice
// ---------------------------------------------------------------------------

export interface TelemetryNoticeToastOptions {
  /** Invoked when the user clicks "Open settings". */
  onOpenSettings: () => void;
}

/**
 * Non-blocking notice shown once when the app starts on (or switches to) the
 * alpha channel, telling the user telemetry is on by default and how to opt out.
 * Uses a stable id so a startup notice and a channel-switch toast collapse into
 * one rather than stacking.
 */
export function toastTelemetryNotice(options: TelemetryNoticeToastOptions): void {
  // Short title + secondary description reads better in a banner than the full
  // single-sentence disclosure; the elaborating clause goes in `description`.
  toast.info("Alpha builds share anonymous usage + crash reports by default.", {
    id: "telemetry-notice",
    // Privacy-relevant notice with an action — give the user time to read it,
    // and a close button so it doesn't vanish before they decide.
    duration: 15000,
    closeButton: true,
    description: "No document content, file contents, or AI prompts are ever sent.",
    action: {
      label: "Open settings",
      onClick: options.onOpenSettings,
    },
  });
}

export interface ExternalRenameToastOptions {
  /** Old absolute path (before rename). */
  oldPath: string;
  /** New absolute path (after rename). */
  newPath: string;
  /** When the renamed file had unsaved edits, provide a callback to save them. */
  onSave?: () => void;
}

/**
 * Toast shown when an external rename is detected:
 * - Clean tab: 3-second info toast.
 * - Dirty tab: sticky toast with "Save now" action (unsaved edits follow the new path).
 */
export function toastExternalRename(options: ExternalRenameToastOptions): void {
  const { oldPath, newPath, onSave } = options;
  const oldName = fileNameFromPath(oldPath);
  const newName = fileNameFromPath(newPath);

  if (onSave) {
    toast(`${oldName} renamed to ${newName} externally — your unsaved edits stay on the new path.`, {
      id: `external-rename:${oldPath}`,
      duration: Infinity,
      closeButton: true,
      action: {
        label: "Save now",
        onClick: onSave,
      },
    });
  } else {
    toast.info(`${oldName} renamed to ${newName}`, {
      id: `external-rename:${oldPath}`,
      duration: 3000,
    });
  }
}
