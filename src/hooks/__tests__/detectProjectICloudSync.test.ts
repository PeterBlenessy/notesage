// @vitest-environment jsdom

/**
 * Unit tests for detectProjectICloudSync (exported from useAppLifecycle).
 *
 * Covers the iCloud-sync detection decision tree:
 *   - iCloud unavailable → no-op
 *   - icloudNotesagePath is null → no-op
 *   - Project NOT under iCloud Drive → no-op
 *   - Project already in syncedProjectPaths → no-op (AC2)
 *   - Project under iCloud + not synced + global toggle ON → add silently (AC3)
 *   - Project under iCloud + not synced + global toggle OFF → prompt user (AC4)
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks — must be declared before imports that transitively use these modules
// ---------------------------------------------------------------------------

vi.mock('@/lib/tauri', () => ({
  tauriApi: {
    readSyncSettings: vi.fn().mockResolvedValue(null),
    writeSyncSettings: vi.fn().mockResolvedValue(undefined),
    setLogLevel: vi.fn(),
    getHomeDir: vi.fn().mockResolvedValue('/Users/test'),
    getICloudPath: vi.fn().mockResolvedValue(null),
    listDirectory: vi.fn().mockResolvedValue([]),
    pathExists: vi.fn().mockResolvedValue(true),
    createDirectory: vi.fn(),
    indexInit: vi.fn().mockResolvedValue(undefined),
    indexReset: vi.fn().mockResolvedValue(undefined),
    ping: vi.fn().mockResolvedValue(undefined),
    healthCheck: vi.fn().mockResolvedValue({ watcher_alive: true, acp_agents: [], copilot_lsp: null, mcp_servers: [] }),
    watchDirectory: vi.fn(),
    stopLocalServer: vi.fn().mockResolvedValue(undefined),
    readFile: vi.fn().mockResolvedValue(''),
    readBinaryFile: vi.fn().mockResolvedValue([]),
  },
}));

const ICLOUD_NOTESAGE_PATH =
  '/Users/test/Library/Mobile Documents/com~apple~CloudDocs/Notesage';

const mockSettingsState: {
  icloudAvailable: boolean;
  icloudNotesagePath: string | null;
  notesRootPath: string;
  startupReady: boolean;
  logLevel: string;
  skillsReady: boolean;
  setSkillsReady: ReturnType<typeof vi.fn>;
  setStartupReady: ReturnType<typeof vi.fn>;
  setHomeDir: ReturnType<typeof vi.fn>;
  setNotesRootPath: ReturnType<typeof vi.fn>;
  setICloudAvailable: ReturnType<typeof vi.fn>;
  setICloudNotesagePath: ReturnType<typeof vi.fn>;
  showHiddenFiles: boolean;
  homeDir: string;
} = {
  icloudAvailable: true,
  icloudNotesagePath: ICLOUD_NOTESAGE_PATH,
  notesRootPath: '/Users/test/Notesage',
  startupReady: true,
  logLevel: 'info',
  skillsReady: true,
  setSkillsReady: vi.fn(),
  setStartupReady: vi.fn(),
  setHomeDir: vi.fn(),
  setNotesRootPath: vi.fn(),
  setICloudAvailable: vi.fn(),
  setICloudNotesagePath: vi.fn(),
  showHiddenFiles: false,
  homeDir: '/Users/test',
};

vi.mock('@/stores/settings-store', () => ({
  useSettingsStore: Object.assign(
    vi.fn((selector: (s: typeof mockSettingsState) => unknown) =>
      selector(mockSettingsState),
    ),
    { getState: () => mockSettingsState },
  ),
}));

vi.mock('@/stores/workspace-store', () => ({
  useWorkspaceStore: {
    getState: () => ({
      projects: [],
      explorerFolders: [],
      updateExplorerTree: vi.fn(),
      updateProjectTree: vi.fn(),
      removeExplorerFolder: vi.fn(),
      removeProject: vi.fn(),
      addProject: vi.fn(),
    }),
    subscribe: vi.fn(() => () => {}),
  },
}));

vi.mock('@/stores/editor-store', () => ({
  useEditorStore: {
    getState: () => ({
      persistedTabs: [],
      persistedActiveFilePath: null,
      openDocuments: [],
      activeTabId: null,
      openTabPlaceholder: vi.fn(),
      setActiveTab: vi.fn(),
      loadTabContent: vi.fn(),
    }),
  },
}));

vi.mock('@/stores/editor-styles-store', () => ({
  useEditorStylesStore: {
    getState: () => ({ loadSettings: vi.fn(), loadSystemFonts: vi.fn() }),
  },
}));

vi.mock('@/stores/chat-store', () => ({
  useChatStore: {
    getState: () => ({ pruneStaleProjectPaths: vi.fn() }),
  },
}));

vi.mock('@/lib/frontmatter', () => ({
  parseFrontmatter: vi.fn(() => ({ frontmatter: null, content: '' })),
}));
vi.mock('@/lib/file-utils', () => ({
  getFileType: vi.fn(() => 'markdown'),
  isBinaryFileType: vi.fn(() => false),
}));
vi.mock('@/lib/binary-cache', () => ({ setBinaryData: vi.fn() }));
vi.mock('@/lib/refresh-notes-tree', () => ({
  refreshNotesTree: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/lib/ai/migration', () => ({ migrateV1AISettings: vi.fn() }));
vi.mock('@/lib/scan-icloud-projects', () => ({
  scanICloudForProjects: vi.fn().mockResolvedValue(false),
}));
vi.mock('@/lib/logger', () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  setLogLevel: vi.fn(),
}));
vi.mock('@/hooks/useAIOperations', () => ({ stopAcpAgent: vi.fn() }));
vi.mock('@/hooks/useAgentTaskOperations', () => ({ stopTaskAgent: vi.fn() }));

vi.mock('sonner', () => ({
  toast: {
    info: vi.fn(),
    warning: vi.fn(),
    error: vi.fn(),
    dismiss: vi.fn(),
  },
}));

// ---------------------------------------------------------------------------
// Imports after mocks
// ---------------------------------------------------------------------------

import { useSyncStore } from '@/stores/sync-store';
import { tauriApi } from '@/lib/tauri';
import { detectProjectICloudSync } from '@/hooks/useAppLifecycle';
import { toast } from 'sonner';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const syncInitial = () => ({
  icloudEnabled: false,
  syncQuickNotes: true,
  syncedProjectPaths: [] as string[],
  migrating: null,
  loaded: false,
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('detectProjectICloudSync', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useSyncStore.setState(syncInitial());
    mockSettingsState.icloudAvailable = true;
    mockSettingsState.icloudNotesagePath = ICLOUD_NOTESAGE_PATH;
    mockSettingsState.notesRootPath = '/Users/test/Notesage';
  });

  // -------------------------------------------------------------------------
  // Guard conditions
  // -------------------------------------------------------------------------

  it('does nothing when iCloudAvailable is false', async () => {
    mockSettingsState.icloudAvailable = false;
    const projectPath = `${ICLOUD_NOTESAGE_PATH}/MyProject`;

    await detectProjectICloudSync(projectPath);

    expect(useSyncStore.getState().syncedProjectPaths).toEqual([]);
    expect(toast.info).not.toHaveBeenCalled();
  });

  it('does nothing when icloudNotesagePath is null', async () => {
    mockSettingsState.icloudNotesagePath = null;
    const projectPath = `${ICLOUD_NOTESAGE_PATH}/MyProject`;

    await detectProjectICloudSync(projectPath);

    expect(useSyncStore.getState().syncedProjectPaths).toEqual([]);
    expect(toast.info).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Project not under iCloud Drive → no action
  // -------------------------------------------------------------------------

  it('does nothing for a project not under iCloud Drive', async () => {
    const projectPath = '/Users/test/Documents/LocalProject';

    await detectProjectICloudSync(projectPath);

    expect(useSyncStore.getState().syncedProjectPaths).toEqual([]);
    expect(toast.info).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // AC2 — already synced → no-op
  // -------------------------------------------------------------------------

  it('does nothing for an already-synced project (AC2)', async () => {
    const projectPath = `${ICLOUD_NOTESAGE_PATH}/AlreadyTracked`;
    useSyncStore.setState({ syncedProjectPaths: [projectPath] });

    await detectProjectICloudSync(projectPath);

    expect(useSyncStore.getState().syncedProjectPaths).toEqual([projectPath]);
    expect(vi.mocked(tauriApi.writeSyncSettings)).not.toHaveBeenCalled();
    expect(toast.info).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // AC3 — under iCloud + not synced + global toggle ON → add silently
  // -------------------------------------------------------------------------

  it('silently adds the project and saves when iCloud ON + not yet tracked (AC3)', async () => {
    useSyncStore.setState({ icloudEnabled: true, syncedProjectPaths: [] });
    const projectPath = `${ICLOUD_NOTESAGE_PATH}/NewProject`;

    await detectProjectICloudSync(projectPath);

    expect(useSyncStore.getState().syncedProjectPaths).toContain(projectPath);
    expect(toast.info).not.toHaveBeenCalled();
    expect(vi.mocked(tauriApi.writeSyncSettings)).toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // AC4 — under iCloud + not synced + global toggle OFF → prompt
  // -------------------------------------------------------------------------

  it('shows a toast prompt when iCloud OFF + project under iCloud + not tracked (AC4)', async () => {
    useSyncStore.setState({ icloudEnabled: false, syncedProjectPaths: [] });
    const projectPath = `${ICLOUD_NOTESAGE_PATH}/NewProject`;

    await detectProjectICloudSync(projectPath);

    expect(toast.info).toHaveBeenCalled();
    expect(useSyncStore.getState().syncedProjectPaths).not.toContain(projectPath);
  });
});
