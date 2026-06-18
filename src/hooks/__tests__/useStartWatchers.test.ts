// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import '@/test/tauri-mock';
import { renderHook } from '@testing-library/react';

vi.mock('@/lib/tauri', () => ({
  tauriApi: {
    allowAssetDir: vi.fn(() => Promise.resolve()),
    watchDirectory: vi.fn(() => Promise.resolve()),
    getHomeDir: vi.fn(() => Promise.resolve('/Users/test')),
  },
}));

import { useStartWatchers } from '@/hooks/useStartWatchers';
import { tauriApi } from '@/lib/tauri';
import { useSettingsStore } from '@/stores/settings-store';
import { useWorkspaceStore } from '@/stores/workspace-store';

type WorkspaceState = ReturnType<typeof useWorkspaceStore.getState>;

beforeEach(() => {
  vi.clearAllMocks();
  useSettingsStore.setState({
    startupReady: false,
    notesRootPath: '/Users/test/Notesage',
    icloudNotesagePath: null,
  });
  useWorkspaceStore.setState({
    projects: [{ path: '/Users/test/proj', fileTree: [] }],
    explorerFolders: [],
  } as Partial<WorkspaceState> as WorkspaceState);
});

describe('useStartWatchers — asset grants decoupled from startupReady', () => {
  it('grants asset dirs even when startupReady is FALSE (the iCloud-race fix)', () => {
    renderHook(() => useStartWatchers());
    // The whole point: images can become asset-readable before slow tree
    // validation finishes.
    expect(tauriApi.allowAssetDir).toHaveBeenCalledWith('/Users/test/Notesage');
    expect(tauriApi.allowAssetDir).toHaveBeenCalledWith('/Users/test/proj');
  });

  it('does NOT start watchers until startupReady (those still need validated paths)', () => {
    renderHook(() => useStartWatchers());
    expect(tauriApi.watchDirectory).not.toHaveBeenCalled();
  });

  it('starts watchers once startupReady is true', () => {
    useSettingsStore.setState({ startupReady: true });
    renderHook(() => useStartWatchers());
    expect(tauriApi.watchDirectory).toHaveBeenCalledWith('/Users/test/proj');
  });
});
