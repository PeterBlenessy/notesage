import { useEffect } from 'react';
import { useSettingsStore } from '@/stores/settings-store';
import { useWorkspaceStore } from '@/stores/workspace-store';
import { useAutomationStore } from '@/stores/automation-store';
import { tauriApi } from '@/lib/tauri';
import { log } from '@/lib/logger';
import { automationBase } from '@/lib/automations/file-match';

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
  const automationsEnabled = useSettingsStore((s) => s.automationsEnabled);
  const projectPaths = useWorkspaceStore((s) =>
    s.projects.map((p) => p.path).sort().join(',')
  );

  // Keep the Rust scheduler's master flag in sync with the persisted setting
  // (it defaults off in the backend, so this also applies it on startup).
  useEffect(() => {
    tauriApi
      .setAutomationsEnabled(automationsEnabled)
      .catch((e) => log.error('automations', 'setAutomationsEnabled failed', e));
  }, [automationsEnabled]);

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

      // Task #7: make sure each enabled file-event automation's watched root is
      // actually watched (it may target a dir not opened as a project, e.g. a
      // global ~/Notesage/Inbox). watch_directory is idempotent per path.
      const watched = new Set<string>();
      for (const a of useAutomationStore.getState().automations) {
        if (!a.enabled || a.trigger.type !== 'file') continue;
        const path = automationBase(a) ?? `${home}/Notesage`;
        if (watched.has(path)) continue;
        watched.add(path);
        tauriApi
          .watchDirectory(path)
          .catch((e) => log.error('automations', `watch ${path} failed`, e));
      }
    };

    void run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startupReady, projectPaths]);
}
