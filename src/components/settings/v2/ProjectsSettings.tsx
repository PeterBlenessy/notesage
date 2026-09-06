import { useCallback, useMemo, useState } from 'react';
import { Switch } from '@/components/ui/switch';
import { useSettingsStore } from '@/stores/settings-store';
import { useWorkspaceStore } from '@/stores/workspace-store';
import { tauriApi } from '@/lib/tauri';
import { ProjectCard } from '../ProjectCard';
import { SettingsGroup } from './SettingsGroup';
import { LibraryMigrationRow } from '@/components/settings/LibraryMigrationRow';
import { LibraryMigrationDialog } from '@/components/settings/LibraryMigrationDialog';
import { SettingsHint } from './SettingsHint';
import { SettingsRow } from './SettingsRow';
import { t } from '@/lib/i18n';
import { useLocale } from '@/lib/useLocale';

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
 * Global Version Control group stays below. The global iCloud Sync
 * group was removed when sync state became a pure derivation from the
 * project path (a project under iCloud Notesage = synced; anywhere
 * else = local). Per-project sync (move-to/move-from iCloud) lives
 * inside each ProjectCard now.
 */
export function ProjectsSettings() {
  // `t()` reads module state — subscribe so a language change repaints this.
  useLocale();
  const projects = useWorkspaceStore((s) => s.projects);
  const sortedProjects = useMemo(
    () =>
      [...projects].sort((a, b) =>
        basename(a.path).localeCompare(basename(b.path)),
      ),
    [projects],
  );

  // Where the synced library is, and the offer to move it. Above the project
  // cards because it is about all of them at once.
  const [migrationOpen, setMigrationOpen] = useState(false);
  const [migrationRoots, setMigrationRoots] = useState<{ from: string; to: string } | null>(null);

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
      <SettingsGroup label={t("settings.libraryGroup")}>
        <LibraryMigrationRow
          onReview={async () => {
            const [icloudRoot, containerRoot] = await Promise.all([
              tauriApi.getICloudPath(),
              tauriApi.getLibraryContainerPath(),
            ]);
            if (!icloudRoot || !containerRoot) return;
            setMigrationRoots({ from: `${icloudRoot}/Notesage`, to: containerRoot });
            setMigrationOpen(true);
          }}
        />
      </SettingsGroup>
      {migrationRoots && (
        <LibraryMigrationDialog
          open={migrationOpen}
          onOpenChange={setMigrationOpen}
          oldRoot={migrationRoots.from}
          newRoot={migrationRoots.to}
        />
      )}

      {sortedProjects.length > 0 ? (
        <SettingsGroup label={t("settings.projectsGroup")} bare>
          <div className="py-2 space-y-2">
            {sortedProjects.map((p) => (
              <ProjectCard key={p.path} projectPath={p.path} />
            ))}
          </div>
        </SettingsGroup>
      ) : null}

      <SettingsGroup label={t("settings.versionControl")}>
        <SettingsRow
          label={t("settings.enableGit")}
          description={t("settings.enableGitDesc")}
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
          <SettingsHint tone="warning" title={t("projectsSettings.gitNotInstalled")}>
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

    </>
  );
}
