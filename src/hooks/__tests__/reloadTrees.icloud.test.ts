// @vitest-environment jsdom

/**
 * Regression-lock test for issue #40 / PR #84 — iCloud sync getting
 * silently disabled on every app reload because of a stale Zustand
 * snapshot in `reloadTrees()`.
 *
 * The bug: `reloadTrees()` captures `const settings =
 * useSettingsStore.getState()` at the top of the function. Later it
 * calls `tauriApi.getICloudPath()` and, on success, calls
 * `settings.setICloudAvailable(true)` to mutate the store. The local
 * `settings` snapshot is NOT refreshed, so the subsequent check
 * `if (!icloudNotesagePath || !settings.icloudAvailable)` reads the
 * stale `false` and the code disables iCloud sync + posts the
 * "iCloud is no longer available" toast.
 *
 * PR #84 fixed the same shape of bug for `useSyncStore` (introduced
 * `freshSync = useSyncStore.getState()` after `loadSettings()`) but
 * missed `useSettingsStore`. The fix in this file's commit replaces
 * the stale-snapshot read with locally-computed `icloudAvailable` /
 * `icloudNotesagePath` variables, eliminating the failure mode at
 * the source instead of band-aid re-reads.
 *
 * The test mocks `tauriApi.getICloudPath` to RESOLVE successfully
 * (the case PR #84's existing tests don't exercise — they mock it
 * to `null`, exiting the iCloud branch entirely) and asserts the
 * disable + toast path is NOT taken.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

import '@/test/tauri-mock';

// vi.mock factories run BEFORE module-scoped const declarations (Vitest hoists
// them), so anything referenced inside the factories must come from
// vi.hoisted() — that's the only way to share state between hoisted mocks
// and the test body.
const {
  settingsState,
  syncState,
  setICloudEnabledMock,
  saveSyncSettingsMock,
  loadSyncSettingsMock,
  getICloudPathMock,
  toastInfoMock,
} = vi.hoisted(() => {
  const settingsState = {
    notesRootPath: '/Users/test/Notesage',
    homeDir: '/Users/test',
    icloudAvailable: false,
    icloudNotesagePath: null as string | null,
    showHiddenFiles: false,
    skillsReady: false,
    startupReady: false,
    uiPreview: 'legacy' as const,
    setHomeDir: vi.fn((d: string) => { settingsState.homeDir = d; }),
    setNotesRootPath: vi.fn((p: string) => { settingsState.notesRootPath = p; }),
    setSkillsReady: vi.fn((v: boolean) => { settingsState.skillsReady = v; }),
    setStartupReady: vi.fn((v: boolean) => { settingsState.startupReady = v; }),
    setICloudAvailable: vi.fn((v: boolean) => { settingsState.icloudAvailable = v; }),
    setICloudNotesagePath: vi.fn((p: string) => { settingsState.icloudNotesagePath = p; }),
  };
  const setICloudEnabledMock = vi.fn();
  const saveSyncSettingsMock = vi.fn().mockResolvedValue(undefined);
  const loadSyncSettingsMock = vi.fn().mockResolvedValue(undefined);
  const syncState = {
    icloudEnabled: false,
    syncedProjectPaths: [] as string[],
    loadSettings: loadSyncSettingsMock,
    saveSettings: saveSyncSettingsMock,
    setICloudEnabled: setICloudEnabledMock,
    removeSyncedProject: vi.fn(),
  };
  const getICloudPathMock = vi.fn();
  const toastInfoMock = vi.fn();
  return {
    settingsState,
    syncState,
    setICloudEnabledMock,
    saveSyncSettingsMock,
    loadSyncSettingsMock,
    getICloudPathMock,
    toastInfoMock,
  };
});

vi.mock('@/stores/settings-store', () => ({
  useSettingsStore: { getState: () => settingsState },
}));
vi.mock('@/stores/workspace-store', () => ({
  useWorkspaceStore: {
    getState: () => ({
      projects: [],
      explorerFolders: [],
      updateExplorerTree: vi.fn(),
      updateProjectTree: vi.fn(),
      removeProject: vi.fn(),
      removeExplorerFolder: vi.fn(),
      addProject: vi.fn(),
    }),
    subscribe: () => () => {},
  },
}));
vi.mock('@/stores/editor-store', () => ({
  useEditorStore: { getState: () => ({ openDocuments: [], setOpenDocuments: vi.fn(), persistedTabs: [], persistedActiveFilePath: null, loadTabContent: vi.fn() }) },
}));
vi.mock('@/stores/sync-store', () => ({
  useSyncStore: { getState: () => syncState },
}));
vi.mock('@/stores/editor-styles-store', () => ({
  useEditorStylesStore: { getState: () => ({ loadSettings: vi.fn(), loadSystemFonts: vi.fn() }) },
}));
vi.mock('@/stores/chat-store', () => ({
  useChatStore: { getState: () => ({ pruneStaleProjectPaths: vi.fn() }) },
}));

vi.mock('@/lib/tauri', () => ({
  tauriApi: {
    setLogLevel: vi.fn(),
    ping: vi.fn().mockResolvedValue(undefined),
    healthCheck: vi.fn().mockResolvedValue({ watcher_alive: true, acp_agents: [], copilot_lsp: null, mcp_servers: [] }),
    getHomeDir: vi.fn().mockResolvedValue('/Users/test'),
    listDirectory: vi.fn().mockResolvedValue([]),
    pathExists: vi.fn().mockResolvedValue(true),
    createDirectory: vi.fn(),
    getICloudPath: getICloudPathMock,
    indexInit: vi.fn().mockResolvedValue(undefined),
    indexReset: vi.fn().mockResolvedValue(undefined),
    readFile: vi.fn().mockResolvedValue(''),
    readBinaryFile: vi.fn().mockResolvedValue([]),
    watchDirectory: vi.fn(),
    stopLocalServer: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('@/lib/frontmatter', () => ({ parseFrontmatter: vi.fn(() => ({ frontmatter: null, content: '' })) }));
vi.mock('@/lib/file-utils', () => ({ getFileType: vi.fn(() => 'markdown'), isBinaryFileType: vi.fn(() => false) }));
vi.mock('@/lib/binary-cache', () => ({ setBinaryData: vi.fn() }));
vi.mock('@/lib/refresh-notes-tree', () => ({ refreshNotesTree: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/lib/scan-icloud-projects', () => ({ scanICloudForProjects: vi.fn().mockResolvedValue(false) }));
vi.mock('@/lib/logger', () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() }, setLogLevel: vi.fn() }));

vi.mock('sonner', () => ({ toast: { info: toastInfoMock, warning: vi.fn(), error: vi.fn(), dismiss: vi.fn() } }));

import { reloadTrees } from '../useAppLifecycle';

describe('reloadTrees — iCloud detection (regression for #40 / PR #84)', () => {
  beforeEach(() => {
    settingsState.icloudAvailable = false;
    settingsState.icloudNotesagePath = null;
    syncState.icloudEnabled = true;
    syncState.syncedProjectPaths = [];
    setICloudEnabledMock.mockReset();
    saveSyncSettingsMock.mockReset();
    loadSyncSettingsMock.mockReset().mockResolvedValue(undefined);
    toastInfoMock.mockReset();
    getICloudPathMock.mockReset();
  });

  it('does NOT disable iCloud sync when getICloudPath resolves successfully', async () => {
    // The bug: settings.icloudAvailable was a stale snapshot — captured at
    // the top of reloadTrees (false) and never refreshed after the
    // setICloudAvailable(true) call. The check then read stale `false`
    // and triggered the disable path. Fix verified: with getICloudPath
    // resolving to a real path and the user's icloudEnabled being true,
    // the function must NOT call setICloudEnabled(false) and must NOT
    // post the "iCloud is no longer available" toast.
    getICloudPathMock.mockResolvedValue('/Users/test/Library/Mobile Documents/com~apple~CloudDocs');

    await reloadTrees();

    expect(setICloudEnabledMock).not.toHaveBeenCalledWith(false);
    expect(toastInfoMock).not.toHaveBeenCalledWith(
      expect.stringContaining('iCloud is no longer available'),
    );
    // Sanity: the iCloud-available branch did run (the store was marked
    // available), so the assertions above aren't passing for an
    // unrelated reason.
    expect(settingsState.setICloudAvailable).toHaveBeenCalledWith(true);
  });
});
