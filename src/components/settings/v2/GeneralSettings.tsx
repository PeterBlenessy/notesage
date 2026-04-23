import { invoke } from '@tauri-apps/api/core';
import { Switch } from '@/components/ui/switch';
import { useSettingsStore } from '@/stores/settings-store';
import { SettingsGroup } from './SettingsGroup';
import { SettingsRow } from './SettingsRow';

/**
 * General settings panel (v2) — system tray and notifications.
 *
 * Appearance (theme / contrast / accent / tint) lives in the AppearanceSettings
 * panel (task #65), not here.
 */
export function GeneralSettings() {
  const showInTray = useSettingsStore((s) => s.showInTray);
  const setShowInTray = useSettingsStore((s) => s.setShowInTray);
  const closeToTray = useSettingsStore((s) => s.closeToTray);
  const setCloseToTray = useSettingsStore((s) => s.setCloseToTray);
  const startAtLogin = useSettingsStore((s) => s.startAtLogin);
  const setStartAtLogin = useSettingsStore((s) => s.setStartAtLogin);
  const notifyAgentCompletion = useSettingsStore((s) => s.notifyAgentCompletion);
  const setNotifyAgentCompletion = useSettingsStore((s) => s.setNotifyAgentCompletion);
  const notifyExternalChanges = useSettingsStore((s) => s.notifyExternalChanges);
  const setNotifyExternalChanges = useSettingsStore((s) => s.setNotifyExternalChanges);

  return (
    <>
      <SettingsGroup
        label="System Tray"
        description="Menu bar icon and background behavior."
      >
        <SettingsRow
          label="Show in menu bar"
          description="Keep Notesage accessible from the menu bar."
          htmlFor="show-in-tray"
          control={
            <Switch
              id="show-in-tray"
              checked={showInTray}
              onCheckedChange={(checked) => {
                setShowInTray(checked);
                invoke('set_tray_visible', { visible: checked }).catch(() => {});
              }}
            />
          }
        />
        <SettingsRow
          label="Close window to tray"
          description="Closing the window hides it instead of quitting the app."
          htmlFor="close-to-tray"
          control={
            <Switch
              id="close-to-tray"
              checked={closeToTray}
              onCheckedChange={(checked) => {
                setCloseToTray(checked);
                invoke('set_close_to_tray', { enabled: checked }).catch(() => {});
              }}
            />
          }
        />
        <SettingsRow
          label="Start at login"
          description="Launch Notesage automatically when you log in."
          htmlFor="start-at-login"
          control={
            <Switch
              id="start-at-login"
              checked={startAtLogin}
              onCheckedChange={async (checked) => {
                try {
                  if (checked) {
                    await import('@tauri-apps/plugin-autostart').then((m) => m.enable());
                  } else {
                    await import('@tauri-apps/plugin-autostart').then((m) => m.disable());
                  }
                  setStartAtLogin(checked);
                } catch (e) {
                  console.error('Failed to toggle autostart:', e);
                }
              }}
            />
          }
        />
      </SettingsGroup>

      <SettingsGroup
        label="Notifications"
        description="Choose which desktop notifications to receive."
      >
        <SettingsRow
          label="Agent task completion"
          description="Notify when an agent finishes or encounters an error."
          htmlFor="notify-agent"
          control={
            <Switch
              id="notify-agent"
              checked={notifyAgentCompletion}
              onCheckedChange={setNotifyAgentCompletion}
            />
          }
        />
        <SettingsRow
          label="External file changes"
          description="Notify when files are modified externally."
          htmlFor="notify-external"
          control={
            <Switch
              id="notify-external"
              checked={notifyExternalChanges}
              onCheckedChange={setNotifyExternalChanges}
            />
          }
        />
      </SettingsGroup>
    </>
  );
}
