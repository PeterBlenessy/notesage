import { useCallback, useState } from 'react';
import { Info } from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { useSettingsStore } from '@/stores/settings-store';
import { tauriApi } from '@/lib/tauri';
import { SyncSettings as LegacySyncSettings } from '../SyncSettings';
import { SettingsGroup } from './SettingsGroup';
import { SettingsRow } from './SettingsRow';

/**
 * Projects settings panel (v2) — version control (git) and workspace sync.
 *
 * AI provider lock and per-project overrides live in the per-project
 * Settings dialog (ProjectSettingsDialog), not the global settings, so this
 * panel focuses on the workspace-wide integrations.
 */
export function ProjectsSettings() {
  const gitEnabled = useSettingsStore((s) => s.gitEnabled);
  const setGitEnabled = useSettingsStore((s) => s.setGitEnabled);
  const [gitNotAvailable, setGitNotAvailable] = useState(false);

  const handleGitToggle = useCallback(
    async (checked: boolean) => {
      if (!checked) {
        setGitEnabled(false);
        setGitNotAvailable(false);
        return;
      }

      try {
        const available = await tauriApi.gitCheckAvailable();
        if (available) {
          setGitEnabled(true);
          setGitNotAvailable(false);
        } else {
          setGitNotAvailable(true);
        }
      } catch {
        setGitNotAvailable(true);
      }
    },
    [setGitEnabled],
  );

  return (
    <>
      <SettingsGroup
        label="Version Control"
        description="Git integration for the workspace."
      >
        <SettingsRow
          label="Enable Git"
          description="Track file changes, view status indicators, switch branches, and commit from within the app."
          htmlFor="git-integration"
          control={
            <Switch
              id="git-integration"
              checked={gitEnabled}
              onCheckedChange={handleGitToggle}
            />
          }
        />
        {gitNotAvailable && (
          <div className="flex gap-2.5 px-4 py-3 bg-muted/50">
            <Info
              className="h-4 w-4 shrink-0 text-muted-foreground mt-0.5"
              strokeWidth={1.5}
            />
            <div className="space-y-1 text-xs text-muted-foreground">
              <p className="font-medium text-foreground">
                Git is not installed on this system
              </p>
              <p>
                Install it from{' '}
                <span className="font-medium text-foreground">git-scm.com</span>{' '}
                or via Homebrew:
              </p>
              <pre className="rounded bg-muted px-2 py-1.5 font-mono text-xs select-all">
                brew install git
              </pre>
            </div>
          </div>
        )}
      </SettingsGroup>

      <SettingsGroup label="iCloud Sync">
        <div className="px-4 py-4">
          <LegacySyncSettings />
        </div>
      </SettingsGroup>
    </>
  );
}
