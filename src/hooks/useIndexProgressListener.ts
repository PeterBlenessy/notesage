import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { useIndexProgressStore, type IndexProgressEvent } from "@/stores/index-progress-store";
import { useSettingsStore } from "@/stores/settings-store";
import { useWorkspaceStore, type WorkspaceProject } from "@/stores/workspace-store";

function projectPaths(projects: readonly WorkspaceProject[]): string[] {
  return projects.map((project) => project.path);
}

/**
 * Feed `index-progress-store` from the backend's index events, from
 * `settings.indexReady` and from the workspace's project list.
 *
 * The ONE place that listens to `index-progress`; every surface that shows
 * indexing reads the store instead of registering listeners of its own. The
 * two stores are subscribed to directly, not through a render: the startup
 * pass reads the project list and starts indexing in the same tick, and a
 * value mirrored by an effect would be one render behind it.
 *
 * Must be mounted in App.tsx.
 */
export function useIndexProgressListener(): void {
  useEffect(() => {
    const store = useIndexProgressStore.getState();

    store.setProjects(projectPaths(useWorkspaceStore.getState().projects));
    store.setStartupSettled(useSettingsStore.getState().indexReady);
    const unsubscribeProjects = useWorkspaceStore.subscribe((state, previous) => {
      // `projects` is replaced on every tree change; only the set of roots matters.
      if (state.projects === previous.projects) return;
      const next = projectPaths(state.projects);
      const before = projectPaths(previous.projects);
      if (next.length === before.length && next.every((path, i) => path === before[i])) return;
      store.setProjects(next);
    });
    const unsubscribeSettings = useSettingsStore.subscribe((state, previous) => {
      if (state.indexReady !== previous.indexReady) store.setStartupSettled(state.indexReady);
    });

    // Mounted-flag pattern (see `useSandboxViolations`): `listen()` resolves
    // asynchronously, so a registration that arrives after unmount is undone
    // at once instead of leaking.
    let mounted = true;
    const unlisteners: Array<() => void> = [];
    const keep = (unlisten: () => void) => {
      if (mounted) unlisteners.push(unlisten);
      else unlisten();
    };
    const noBridge = () => {
      // No event bridge (tests, a non-Tauri host): begin/settle still report.
    };

    listen<IndexProgressEvent>("index-progress", (event) => {
      if (mounted && event.payload) store.progress(event.payload);
    })
      .then(keep)
      .catch(noBridge);
    listen<{ project_path?: string | null } | null>("index-ready", (event) => {
      if (mounted) store.ready(event.payload?.project_path ?? null);
    })
      .then(keep)
      .catch(noBridge);

    return () => {
      mounted = false;
      unsubscribeProjects();
      unsubscribeSettings();
      for (const unlisten of unlisteners) unlisten();
    };
  }, []);
}
