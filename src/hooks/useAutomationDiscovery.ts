import { useEffect } from 'react';
import { useSettingsStore } from '@/stores/settings-store';
import { useWorkspaceStore } from '@/stores/workspace-store';
import { useAutomationStore } from '@/stores/automation-store';
import { tauriApi } from '@/lib/tauri';
import { log } from '@/lib/logger';

/**
 * Discover automations on startup and whenever the open-project set changes,
 * then (re)load the backend schedule. Mounted once at the App root — gated on
 * `startupReady` so it runs after the workspace is known (the backend needs the
 * project base dirs, and the first reload triggers the missed-run catch-up).
 *
 * Scope is global (`~/.notesage/automations`) + per-project
 * (`<project>/.notesage/automations`) — explorer folders are intentionally
 * excluded, matching the PRD's global ∪ per-project model.
 */
export function useAutomationDiscovery() {
  const startupReady = useSettingsStore((s) => s.startupReady);
  const projectPaths = useWorkspaceStore((s) =>
    s.projects.map((p) => p.path).sort().join(',')
  );

  useEffect(() => {
    if (!startupReady) return;

    const run = async () => {
      const home = useSettingsStore.getState().homeDir;
      if (!home) {
        log.error('automations', 'Home directory not resolved yet');
        return;
      }
      const projects = useWorkspaceStore.getState().projects;
      const baseDirs = [
        `${home}/.notesage/automations`,
        ...projects.map((p) => `${p.path}/.notesage/automations`),
      ];

      await useAutomationStore.getState().scan(baseDirs);

      // The first reload per launch also computes missed runs over the downtime
      // gap and emits `automations-missed` for the chooser — never auto-fires.
      try {
        await tauriApi.reloadAutomationSchedule(baseDirs);
      } catch (e) {
        log.error('automations', 'reloadAutomationSchedule failed', e);
      }
    };

    void run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startupReady, projectPaths]);
}
