// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Store mocks — drive scope resolution via Zustand state
// ---------------------------------------------------------------------------

const workspaceState: {
  explorerFolders: { path: string; fileTree: unknown[] }[];
  projects: { path: string; fileTree: unknown[] }[];
  notesTree: unknown[];
} = {
  explorerFolders: [],
  projects: [],
  notesTree: [],
};

const settingsState: { notesRootPath: string | null } = {
  notesRootPath: null,
};

const chatState: {
  conversations: { id: string; projectPaths: string[] }[];
  activeConversationId: string | null;
} = {
  conversations: [],
  activeConversationId: null,
};

vi.mock('@/stores/workspace-store', () => ({
  useWorkspaceStore: { getState: () => workspaceState },
}));

vi.mock('@/stores/settings-store', () => ({
  useSettingsStore: { getState: () => settingsState },
}));

vi.mock('@/stores/chat-store', () => ({
  useChatStore: { getState: () => chatState },
  selectProjectPaths: (state: typeof chatState) => {
    if (!state.activeConversationId) return [];
    return state.conversations.find((c) => c.id === state.activeConversationId)?.projectPaths ?? [];
  },
}));

// Import AFTER mocks so the module sees the mocked stores.
import {
  getAllSearchPaths,
  getDefaultPaletteScope,
  resolveSearchPaths,
  getSearchPaths,
  type PaletteSearchScope,
} from '@/lib/command-palette';

// ---------------------------------------------------------------------------
// Reset state between tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  workspaceState.explorerFolders = [];
  workspaceState.projects = [];
  workspaceState.notesTree = [];
  settingsState.notesRootPath = null;
  chatState.conversations = [];
  chatState.activeConversationId = null;
});

// ---------------------------------------------------------------------------
// getAllSearchPaths
// ---------------------------------------------------------------------------

describe('getAllSearchPaths', () => {
  it('returns empty when no workspace folders configured', () => {
    expect(getAllSearchPaths()).toEqual([]);
  });

  it('unions explorer folders, projects, and notes root', () => {
    workspaceState.explorerFolders = [{ path: '/folder', fileTree: [] }];
    workspaceState.projects = [
      { path: '/project-a', fileTree: [] },
      { path: '/project-b', fileTree: [] },
    ];
    settingsState.notesRootPath = '/notes';

    expect(getAllSearchPaths()).toEqual(['/folder', '/project-a', '/project-b', '/notes']);
  });

  it('skips notes root when unset', () => {
    workspaceState.projects = [{ path: '/project-a', fileTree: [] }];
    expect(getAllSearchPaths()).toEqual(['/project-a']);
  });
});

// ---------------------------------------------------------------------------
// getDefaultPaletteScope
// ---------------------------------------------------------------------------

describe('getDefaultPaletteScope', () => {
  it("returns 'all' when there is no active conversation", () => {
    expect(getDefaultPaletteScope()).toBe('all');
  });

  it("returns 'all' when the active conversation has no selected projects", () => {
    chatState.conversations = [{ id: 'c1', projectPaths: [] }];
    chatState.activeConversationId = 'c1';
    expect(getDefaultPaletteScope()).toBe('all');
  });

  it('returns the conversation project paths when set', () => {
    chatState.conversations = [{ id: 'c1', projectPaths: ['/project-a'] }];
    chatState.activeConversationId = 'c1';
    expect(getDefaultPaletteScope()).toEqual(['/project-a']);
  });

  it('returns multiple paths when multi-select is active', () => {
    chatState.conversations = [
      { id: 'c1', projectPaths: ['/project-a', '/project-b'] },
    ];
    chatState.activeConversationId = 'c1';
    expect(getDefaultPaletteScope()).toEqual(['/project-a', '/project-b']);
  });
});

// ---------------------------------------------------------------------------
// resolveSearchPaths
// ---------------------------------------------------------------------------

describe('resolveSearchPaths', () => {
  beforeEach(() => {
    workspaceState.projects = [
      { path: '/project-a', fileTree: [] },
      { path: '/project-b', fileTree: [] },
      { path: '/project-c', fileTree: [] },
    ];
    settingsState.notesRootPath = '/notes';
  });

  it("'all' returns every indexed workspace path", () => {
    expect(resolveSearchPaths('all')).toEqual([
      '/project-a',
      '/project-b',
      '/project-c',
      '/notes',
    ]);
  });

  it('scoped array intersects with workspace paths', () => {
    expect(resolveSearchPaths(['/project-a', '/project-b'])).toEqual([
      '/project-a',
      '/project-b',
    ]);
  });

  it('drops scope entries that are not indexed', () => {
    // '/other' is not in workspace — filtered out. '/project-a' kept.
    expect(resolveSearchPaths(['/project-a', '/other'])).toEqual(['/project-a']);
  });

  it('falls back to all paths when empty array is passed', () => {
    expect(resolveSearchPaths([])).toEqual([
      '/project-a',
      '/project-b',
      '/project-c',
      '/notes',
    ]);
  });

  it('falls back to all paths when scope has only unknown paths', () => {
    // Empty intersection — user just closed the scoped project. Don't return
    // nothing — unfiltered is a safer default than "no results".
    expect(resolveSearchPaths(['/does-not-exist'])).toEqual([
      '/project-a',
      '/project-b',
      '/project-c',
      '/notes',
    ]);
  });
});

// ---------------------------------------------------------------------------
// getSearchPaths — default scope convenience wrapper
// ---------------------------------------------------------------------------

describe('getSearchPaths', () => {
  beforeEach(() => {
    workspaceState.projects = [
      { path: '/project-a', fileTree: [] },
      { path: '/project-b', fileTree: [] },
    ];
  });

  it("defaults to 'all' when no active conversation selection", () => {
    expect(getSearchPaths()).toEqual(['/project-a', '/project-b']);
  });

  it('defaults to the active conversation scope when set', () => {
    chatState.conversations = [{ id: 'c1', projectPaths: ['/project-a'] }];
    chatState.activeConversationId = 'c1';
    expect(getSearchPaths()).toEqual(['/project-a']);
  });

  it('explicit scope overrides the default', () => {
    chatState.conversations = [{ id: 'c1', projectPaths: ['/project-a'] }];
    chatState.activeConversationId = 'c1';

    // User clicked "Search all projects" — explicit 'all' scope wins over
    // the conversation default.
    const scope: PaletteSearchScope = 'all';
    expect(getSearchPaths(scope)).toEqual(['/project-a', '/project-b']);
  });
});

// ---------------------------------------------------------------------------
// Toggle behaviour — verifies the palette's session "Search all projects"
// flips the effective scope without changing the default computation.
// ---------------------------------------------------------------------------

describe('palette session scope toggle', () => {
  beforeEach(() => {
    workspaceState.projects = [
      { path: '/project-a', fileTree: [] },
      { path: '/project-b', fileTree: [] },
      { path: '/project-c', fileTree: [] },
    ];
    chatState.conversations = [{ id: 'c1', projectPaths: ['/project-a'] }];
    chatState.activeConversationId = 'c1';
  });

  it('scoped mode hits only the selected project path', () => {
    // Palette's derived scope when the toggle is OFF.
    const scope: PaletteSearchScope = getDefaultPaletteScope();
    expect(scope).toEqual(['/project-a']);
    expect(resolveSearchPaths(scope)).toEqual(['/project-a']);
  });

  it("'all projects' mode hits every indexed path despite the selection", () => {
    // Palette's derived scope when the toggle is ON.
    const scope: PaletteSearchScope = 'all';
    expect(resolveSearchPaths(scope)).toEqual([
      '/project-a',
      '/project-b',
      '/project-c',
    ]);
  });

  it('flipping the toggle changes the search path set without changing store state', () => {
    // Before toggle (default scoped) — narrow set.
    const scoped = resolveSearchPaths(getDefaultPaletteScope());
    // Simulate toggle ON — widen.
    const all = resolveSearchPaths('all');
    // Toggle OFF again — narrow set again (store state unchanged).
    const scopedAgain = resolveSearchPaths(getDefaultPaletteScope());

    expect(scoped).toEqual(['/project-a']);
    expect(all).toEqual(['/project-a', '/project-b', '/project-c']);
    expect(scopedAgain).toEqual(['/project-a']);
  });
});
