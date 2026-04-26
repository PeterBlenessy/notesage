import { useCallback, useMemo, useState } from 'react';
import { Switch } from '@/components/ui/switch';
import { useSettingsStore } from '@/stores/settings-store';
import { useWorkspaceStore } from '@/stores/workspace-store';
import { tauriApi } from '@/lib/tauri';
import { ProjectCard } from '../ProjectCard';
import { SyncSettings as LegacySyncSettings } from '../SyncSettings';
import { SettingsGroup } from './SettingsGroup';
import { SettingsHint } from './SettingsHint';
import { SettingsRow } from './SettingsRow';

function basename(path: string): string {
  return path.split('/').filter(Boolean).pop() || path;
}

/**
 * Projects settings panel (v2).
 *
 * Live-test 2026-04-26 — replaced the picker + inline `<ProjectSettings>`
 * block with a scannable card list (one card per project) modeled on
 * `ConnectionCard`. Each card shows the project name + description +
 * status pills (iCloud / Git / AI override / Lock) and expands inline
 * to reveal the full `<ProjectSettings>` form. The whole card row is
 * the accordion trigger — no separate gear icon.
 *
 * Global Version Control + iCloud Sync groups stay below for now (their
 * global on/off toggles affect cross-machine workflows; revisit
 * removing them in a follow-up batch).
 */
export function ProjectsSettings() {
  const projects = useWorkspaceStore((s) => s.projects);
  const sortedProjects = useMemo(
    () =>
      [...projects].sort((a, b) =>
        basename(a.path).localeCompare(basename(b.path)),
      ),
    [projects],
  );

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
      {sortedProjects.length > 0 ? (
        <SettingsGroup label="Projects" bare>
          <div className="py-2 space-y-2">
            {sortedProjects.map((p) => (
              <ProjectCard key={p.path} projectPath={p.path} />
            ))}
          </div>
        </SettingsGroup>
      ) : null}

      <SettingsGroup label="Version Control">
        <SettingsRow
          label="Enable git"
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
          <SettingsHint tone="warning" title="Git is not installed on this system">
            <p>
              Install it from{' '}
              <span className="font-medium text-foreground">git-scm.com</span>{' '}
              or via Homebrew:
            </p>
            <pre className="rounded bg-muted px-2 py-1.5 font-mono text-[11px] select-all mt-1">
              brew install git
            </pre>
          </SettingsHint>
        )}
      </SettingsGroup>

      <SettingsGroup label="iCloud Sync">
        {/* Non-bare — the inner SyncSettings component now renders a
            flat Enable toggle row that lives on the tinted island
            (matches the Version Control group above). The legacy
            duplicate "iCloud Sync" header inside SyncSettings was
            dropped (live-test 2026-04-26). */}
        <div className="py-1">
          <LegacySyncSettings />
        </div>
      </SettingsGroup>
    </>
  );
}
