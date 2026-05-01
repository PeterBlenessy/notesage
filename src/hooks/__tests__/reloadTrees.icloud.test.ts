// @vitest-environment jsdom

/**
 * Regression-lock test for issue #40 / PR #84 — iCloud sync used to
 * get silently disabled on every app reload because of a stale Zustand
 * snapshot in `reloadTrees()` (the `useSettingsStore` capture at the
 * top of the function never picked up `setICloudAvailable(true)` later
 * in the same function). PR #84 fixed the same-shape bug for the now-
 * deleted `useSyncStore` but missed this one; commit `8884a61f`
 * replaced the stale-snapshot read with a locally-computed
 * `icloudAvailable` / `icloudNotesagePath`, killing the failure mode
 * at the source.
 *
 * Since the global iCloud-enabled toggle and `useSyncStore` itself
 * have been removed, the test now just verifies the local-variables
 * fix: when getICloudPath resolves to a real path, the code reaches
 * the iCloud branch (calls scanICloudForProjects) and never falls
 * through to a "no longer available" path.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

import '@/test/tauri-mock';

// vi.mock factories run BEFORE module-scoped const declarations (Vitest hoists
// them), so anything referenced inside the factories must come from
// vi.hoisted() — that's the only way to share state between hoisted mocks
// and the test body.
const {
  settingsState,
  getICloudPathMock,
  toastInfoMock,
  scanICloudForProjectsMock,
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
  const getICloudPathMock = vi.fn();
  const toastInfoMock = vi.fn();
  const scanICloudForProjectsMock = vi.fn().mockResolvedValue(false);
  return {
    settingsState,
    getICloudPathMock,
    toastInfoMock,
    scanICloudForProjectsMock,
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
vi.mock('@/lib/scan-icloud-projects', () => ({ scanICloudForProjects: scanICloudForProjectsMock }));
vi.mock('@/lib/logger', () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() }, setLogLevel: vi.fn() }));

vi.mock('sonner', () => ({ toast: { info: toastInfoMock, warning: vi.fn(), error: vi.fn(), dismiss: vi.fn() } }));

import { reloadTrees } from '../useAppLifecycle';

describe('reloadTrees — iCloud detection (regression for #40 / PR #84)', () => {
  beforeEach(() => {
    settingsState.icloudAvailable = false;
    settingsState.icloudNotesagePath = null;
    settingsState.setICloudAvailable.mockClear();
    settingsState.setICloudNotesagePath.mockClear();
    toastInfoMock.mockReset();
    getICloudPathMock.mockReset();
    scanICloudForProjectsMock.mockReset().mockResolvedValue(false);
  });

  it('marks iCloud available + scans for projects when getICloudPath resolves', async () => {
    // Regression-lock: the stale-Zustand-snapshot bug used to skip the
    // iCloud branch even when getICloudPath resolved successfully. The
    // fix replaces the stale snapshot read with locally-computed
    // booleans. With the fix in place: getICloudPath resolving to a
    // real path means the store is marked available AND
    // scanICloudForProjects runs (cross-device project discovery).
    getICloudPathMock.mockResolvedValue('/Users/test/Library/Mobile Documents/com~apple~CloudDocs');

    await reloadTrees();

    expect(settingsState.setICloudAvailable).toHaveBeenCalledWith(true);
    expect(settingsState.setICloudNotesagePath).toHaveBeenCalledWith(
      '/Users/test/Library/Mobile Documents/com~apple~CloudDocs/Notesage',
    );
    expect(scanICloudForProjectsMock).toHaveBeenCalledWith(
      '/Users/test/Library/Mobile Documents/com~apple~CloudDocs/Notesage',
    );
    expect(toastInfoMock).not.toHaveBeenCalledWith(
      expect.stringContaining('iCloud is no longer available'),
    );
  });

  it('does NOT scan when getICloudPath returns null', async () => {
    getICloudPathMock.mockResolvedValue(null);

    await reloadTrees();

    expect(settingsState.setICloudAvailable).not.toHaveBeenCalled();
    expect(scanICloudForProjectsMock).not.toHaveBeenCalled();
  });
});
