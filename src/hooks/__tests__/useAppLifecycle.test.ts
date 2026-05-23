// @vitest-environment jsdom

/**
 * Unit tests for useAppLifecycle's tag/mention badge click routing.
 *
 * Clicking a `#tag` or `@mention` badge inside the editor emits a
 * `notesage:open-tag-search` / `notesage:open-mention-search` event;
 * the hook listens and re-emits a `cmd-bar-events` `{ type: 'focus',
 * prefix, drilldown }` payload that the FloatingCommandBar picks up.
 *
 * These tests mock every other side effect of `useAppLifecycle` (heavy
 * startup, ACP cleanup, visibility-change wake handler, drag-drop guards)
 * so the only behaviour exercised is the tag/mention handler dispatch.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook } from '@testing-library/react';

// Pulls in the localStorage polyfill — useAppLifecycle's startup effect calls
// localStorage.removeItem to clear orphaned stores.
import '@/test/tauri-mock';

import { subscribeToCmdBarEvents, type CmdBarEvent } from '@/lib/cmd-bar-events';

// --- Settings mock — minimum surface the hook touches at startup. ---
const mockSettings: {
  logLevel: 'info';
  skillsReady: boolean;
  startupReady: boolean;
  setSkillsReady: (v: boolean) => void;
  setStartupReady: (v: boolean) => void;
} = {
  logLevel: 'info',
  skillsReady: true,
  startupReady: true,
  setSkillsReady: vi.fn(),
  setStartupReady: vi.fn(),
};

vi.mock('@/stores/settings-store', () => ({
  useSettingsStore: Object.assign(
    vi.fn((selector: (s: typeof mockSettings) => unknown) => selector(mockSettings)),
    { getState: () => mockSettings },
  ),
}));

// --- Stub every other store the hook touches at startup ---
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
  useEditorStylesStore: { getState: () => ({ loadSettings: vi.fn(), loadSystemFonts: vi.fn() }) },
}));

vi.mock('@/stores/chat-store', () => ({
  useChatStore: { getState: () => ({ pruneStaleProjectPaths: vi.fn() }) },
}));

// --- Stub Tauri + side-effecting helpers ---
vi.mock('@/lib/tauri', () => ({
  tauriApi: {
    setLogLevel: vi.fn(),
    ping: vi.fn().mockResolvedValue(undefined),
    healthCheck: vi.fn().mockResolvedValue({ watcher_alive: true, acp_agents: [], copilot_lsp: null, mcp_servers: [] }),
    getHomeDir: vi.fn().mockResolvedValue('/Users/test'),
    listDirectory: vi.fn().mockResolvedValue([]),
    pathExists: vi.fn().mockResolvedValue(true),
    createDirectory: vi.fn(),
    getICloudPath: vi.fn().mockResolvedValue(null),
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
vi.mock('@/lib/ai/migration', () => ({ migrateV1AISettings: vi.fn() }));
vi.mock('@/lib/scan-icloud-projects', () => ({ scanICloudForProjects: vi.fn().mockResolvedValue(false) }));
vi.mock('@/lib/logger', () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  setLogLevel: vi.fn(),
}));
vi.mock('@/hooks/useAIOperations', () => ({ stopAcpAgent: vi.fn() }));
vi.mock('@/hooks/useAgentTaskOperations', () => ({ stopTaskAgent: vi.fn() }));
vi.mock('sonner', () => ({ toast: { info: vi.fn(), warning: vi.fn(), error: vi.fn(), dismiss: vi.fn() } }));

import { useAppLifecycle } from '@/hooks/useAppLifecycle';

let captured: CmdBarEvent[];
let unsubscribe: () => void;
let onOpenPalette: ReturnType<typeof vi.fn<(mode: string, drilldown: string) => void>>;

beforeEach(() => {
  captured = [];
  unsubscribe = subscribeToCmdBarEvents((e) => {
    captured.push(e);
  });
  onOpenPalette = vi.fn<(mode: string, drilldown: string) => void>();
});

afterEach(() => {
  unsubscribe();
});

describe('useAppLifecycle — tag click routing', () => {
  it('emits cmd-bar drilldown on notesage:open-tag-search', () => {
    renderHook(() => useAppLifecycle({ onOpenPalette }));

    window.dispatchEvent(
      new CustomEvent('notesage:open-tag-search', { detail: { tag: 'finance' } }),
    );

    expect(captured).toEqual([
      { type: 'focus', prefix: '#', drilldown: { kind: 'tag', name: 'finance' } },
    ]);
    expect(onOpenPalette).not.toHaveBeenCalled();
  });

});

describe('useAppLifecycle — mention click routing', () => {
  it('emits cmd-bar drilldown on notesage:open-mention-search', () => {
    renderHook(() => useAppLifecycle({ onOpenPalette }));

    window.dispatchEvent(
      new CustomEvent('notesage:open-mention-search', { detail: { mention: 'alice' } }),
    );

    expect(captured).toEqual([
      { type: 'focus', prefix: '@', drilldown: { kind: 'mention', name: 'alice' } },
    ]);
    expect(onOpenPalette).not.toHaveBeenCalled();
  });

});
