import { useState } from 'react';
import { ArrowUpCircle, Download, Loader2, ScrollText } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { useSettingsStore } from '@/stores/settings-store';
import { ChangelogDialog } from '../ChangelogDialog';
import type { UpdateState } from '@/hooks/useAutoUpdate';
import { SettingsGroup } from './SettingsGroup';
import { SettingsRow } from './SettingsRow';

export interface AboutSettingsProps {
  updateState?: UpdateState;
  onCheckForUpdate?: () => Promise<void>;
  onOpenUpdateDialog?: () => void;
  /**
   * Optional callback fired after the user picks "View Update" — used by the
   * v2 shell to close the settings dialog when the standalone update dialog
   * opens, matching the legacy behavior.
   */
  onDismissSettings?: () => void;
}

function friendlyUpdateError(error: string | null): string {
  if (!error) return 'Could not check for updates';
  const lower = error.toLowerCase();
  if (
    lower.includes('network') ||
    lower.includes('fetch') ||
    lower.includes('connect') ||
    lower.includes('dns')
  )
    return 'Could not connect to update server';
  if (lower.includes('404') || lower.includes('not found'))
    return 'No published release found';
  if (lower.includes('timeout')) return 'Update check timed out';
  if (lower.includes('signature') || lower.includes('verify'))
    return 'Update signature verification failed';
  if (
    lower.includes('json') ||
    lower.includes('parse') ||
    lower.includes('deserialize')
  )
    return 'Invalid update manifest';
  return error.length > 80 ? 'Could not check for updates' : error;
}

function formatRelativeTime(isoString: string | null): string {
  if (!isoString) return 'Never';
  const diff = Date.now() - new Date(isoString).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

/**
 * About settings panel (v2) — version info, update checks, and changelog.
 *
 * Update behavior is preserved byte-for-byte from the legacy About tab; the
 * caller passes through `updateState`, `onCheckForUpdate`, and
 * `onOpenUpdateDialog` exactly as before.
 */
export function AboutSettings({
  updateState,
  onCheckForUpdate,
  onOpenUpdateDialog,
  onDismissSettings,
}: AboutSettingsProps = {}) {
  const autoCheckUpdates = useSettingsStore((s) => s.autoCheckUpdates);
  const setAutoCheckUpdates = useSettingsStore((s) => s.setAutoCheckUpdates);
  const lastUpdateCheck = useSettingsStore((s) => s.lastUpdateCheck);
  const [changelogOpen, setChangelogOpen] = useState(false);

  // `__APP_VERSION__` is injected at build time by Vite's `define`. In test
  // environments (vitest) it may be undefined; guard so the panel still
  // mounts and the tests can assert on the layout.
  const appVersion =
    typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'dev';

  return (
    <>
      <SettingsGroup
        label="Notesage"
        description={`Version ${appVersion}`}
      >
        <SettingsRow
          label="Changelog"
          description="What changed in recent releases."
          control={
            <Button
              variant="outline"
              size="sm"
              onClick={() => setChangelogOpen(true)}
            >
              <ScrollText className="h-3.5 w-3.5 mr-1.5" strokeWidth={1.5} />
              View Changelog
            </Button>
          }
        />
        <ChangelogDialog open={changelogOpen} onOpenChange={setChangelogOpen} />
      </SettingsGroup>

      <SettingsGroup label="Updates" description="Keep Notesage up to date.">
        <SettingsRow
          label={
            updateState?.updateInfo
              ? `Update available: v${updateState.updateInfo.version}`
              : updateState?.status === 'checking'
              ? 'Checking for updates…'
              : updateState?.status === 'error'
              ? friendlyUpdateError(updateState.error)
              : 'Check for updates'
          }
          description={
            updateState?.updateInfo
              ? undefined
              : `Last checked: ${formatRelativeTime(lastUpdateCheck)}`
          }
          control={
            updateState?.updateInfo && onOpenUpdateDialog ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  onOpenUpdateDialog();
                  onDismissSettings?.();
                }}
              >
                <ArrowUpCircle
                  className="h-3.5 w-3.5 mr-1.5"
                  strokeWidth={1.5}
                />
                View Update
              </Button>
            ) : (
              <Button
                variant="outline"
                size="sm"
                onClick={onCheckForUpdate}
                disabled={updateState?.status === 'checking'}
              >
                {updateState?.status === 'checking' ? (
                  <Loader2
                    className="h-3.5 w-3.5 mr-1.5 animate-spin"
                    strokeWidth={1.5}
                  />
                ) : (
                  <Download
                    className="h-3.5 w-3.5 mr-1.5"
                    strokeWidth={1.5}
                  />
                )}
                {updateState?.status === 'checking'
                  ? 'Checking...'
                  : 'Check for Updates'}
              </Button>
            )
          }
        />
        <SettingsRow
          label="Automatically Check for Updates"
          description="Check for new versions when the app starts."
          htmlFor="auto-check-updates"
          control={
            <Switch
              id="auto-check-updates"
              checked={autoCheckUpdates}
              onCheckedChange={setAutoCheckUpdates}
            />
          }
        />
      </SettingsGroup>
    </>
  );
}
