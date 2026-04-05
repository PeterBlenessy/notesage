import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";
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
