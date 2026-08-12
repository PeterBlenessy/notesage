/**
 * Unit tests for workspace-store.
 *
 * Covers explorer folders, projects, file trees, folder expansion,
 * section collapse, recent projects, persistence round-trip, and v1 migration.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// ---------------------------------------------------------------------------
// vi.hoisted — runs before vi.mock factories and module-level store code.
// Sets up an in-memory localStorage polyfill since Node.js v22+ has a native
// localStorage without standard methods (setItem, getItem, clear, etc.).
// ---------------------------------------------------------------------------

const { localStorageMock, storageBacking } = vi.hoisted(() => {
  const storageBacking = new Map<string, string>();
  const localStorageMock: Storage = {
    getItem: (key: string) => storageBacking.get(key) ?? null,
    setItem: (key: string, value: string) => { storageBacking.set(key, value); },
    removeItem: (key: string) => { storageBacking.delete(key); },
    clear: () => { storageBacking.clear(); },
    get length() { return storageBacking.size; },
    key: (index: number) => [...storageBacking.keys()][index] ?? null,
  };

  Object.defineProperty(globalThis, 'localStorage', {
    value: localStorageMock,
    writable: true,
    configurable: true,
  });

  if (typeof globalThis.window === 'undefined') {
    (globalThis as Record<string, unknown>).window = globalThis;
  }

  return { localStorageMock, storageBacking };
});

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn().mockResolvedValue(null),
}));

vi.mock('@/lib/logger', () => ({
  log: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('@/lib/tauri-storage', () => {
  const { createJSONStorage } = require('zustand/middleware');
  return {
    createTauriStorage: () => createJSONStorage(() => localStorageMock),
  };
});

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

import { invoke } from '@tauri-apps/api/core';
import { useWorkspaceStore } from '../workspace-store';
import { useSettingsStore } from '@/stores/settings-store';
import type { FileEntry } from '@/lib/tauri';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function waitForPersist(): Promise<void> {
  await new Promise((r) => setTimeout(r, 50));
}

async function simulateRestart(
  store: {
    setState: (state: Record<string, unknown>) => void;
    persist: { rehydrate: () => void | Promise<void> };
  },
  storageKey: string,
  defaults: Record<string, unknown>,
): Promise<void> {
  const snapshot = localStorageMock.getItem(storageKey);
  store.setState(defaults);
  await waitForPersist();
  if (snapshot) localStorageMock.setItem(storageKey, snapshot);
  await store.persist.rehydrate();
  await waitForPersist();
}

const WORKSPACE_DEFAULTS = {
  explorerFolders: [],
  projects: [],
  recentProjects: [],
  notesTree: [],
  pinnedFiles: [],
  expandedFolders: new Set<string>(),
  explorerCollapsed: false,
  projectsCollapsed: false,
  notesCollapsed: false,
};

const STORAGE_KEY = 'notesage-workspace';

function makeTree(names: string[], basePath: string): FileEntry[] {
  return names.map((name) => ({
    name,
    path: `${basePath}/${name}`,
    is_directory: false,
    hidden: name.startsWith('.'),
    children: undefined,
  }));
}

// ---------------------------------------------------------------------------
// Setup / Teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  storageBacking.clear();
  useWorkspaceStore.setState(WORKSPACE_DEFAULTS);
});

afterEach(() => {
  storageBacking.clear();
});

// ===========================================================================
// Explorer folders
// ===========================================================================

describe('explorer folders', () => {
  it('adds a new explorer folder', () => {
    const tree = makeTree(['a.md'], '/docs');
    useWorkspaceStore.getState().addExplorerFolder('/docs', tree);

    const state = useWorkspaceStore.getState();
    expect(state.explorerFolders).toHaveLength(1);
    expect(state.explorerFolders[0].path).toBe('/docs');
    expect(state.explorerFolders[0].fileTree).toEqual(tree);
  });

  it('deduplicates by refreshing tree when adding existing folder', () => {
    const tree1 = makeTree(['a.md'], '/docs');
    const tree2 = makeTree(['a.md', 'b.md'], '/docs');

    useWorkspaceStore.getState().addExplorerFolder('/docs', tree1);
    useWorkspaceStore.getState().addExplorerFolder('/docs', tree2);

    const state = useWorkspaceStore.getState();
    expect(state.explorerFolders).toHaveLength(1);
    expect(state.explorerFolders[0].fileTree).toEqual(tree2);
  });

  it('removes an explorer folder', () => {
    useWorkspaceStore.getState().addExplorerFolder('/docs', []);
    useWorkspaceStore.getState().addExplorerFolder('/notes', []);
    useWorkspaceStore.getState().removeExplorerFolder('/docs');

    const state = useWorkspaceStore.getState();
    expect(state.explorerFolders).toHaveLength(1);
    expect(state.explorerFolders[0].path).toBe('/notes');
  });

  it('updates an explorer tree', () => {
    useWorkspaceStore.getState().addExplorerFolder('/docs', []);
    const newTree = makeTree(['updated.md'], '/docs');
    useWorkspaceStore.getState().updateExplorerTree('/docs', newTree);

    expect(useWorkspaceStore.getState().explorerFolders[0].fileTree).toEqual(newTree);
  });

  it('findOwningExplorerFolder returns correct folder', () => {
    useWorkspaceStore.getState().addExplorerFolder('/docs', []);
    useWorkspaceStore.getState().addExplorerFolder('/notes', []);

    const found = useWorkspaceStore.getState().findOwningExplorerFolder('/docs/sub/file.md');
    expect(found).toBeDefined();
    expect(found!.path).toBe('/docs');
  });

  it('findOwningExplorerFolder returns undefined for non-matching path', () => {
    useWorkspaceStore.getState().addExplorerFolder('/docs', []);

    const found = useWorkspaceStore.getState().findOwningExplorerFolder('/other/file.md');
    expect(found).toBeUndefined();
  });

  it('findOwningExplorerFolder does not match the folder path itself (requires trailing /)', () => {
    useWorkspaceStore.getState().addExplorerFolder('/docs', []);

    // The exact folder path without a child separator should not match
    const found = useWorkspaceStore.getState().findOwningExplorerFolder('/docs');
    expect(found).toBeUndefined();
  });
});

// ===========================================================================
// Projects
// ===========================================================================

describe('projects', () => {
  it('adds a new project', () => {
    const tree = makeTree(['readme.md'], '/projects/alpha');
    useWorkspaceStore.getState().addProject('/projects/alpha', tree);

    const state = useWorkspaceStore.getState();
    expect(state.projects).toHaveLength(1);
    expect(state.projects[0].path).toBe('/projects/alpha');
    expect(state.projects[0].fileTree).toEqual(tree);
  });

  it('deduplicates by refreshing tree when adding existing project', () => {
    const tree1 = makeTree(['a.md'], '/proj');
    const tree2 = makeTree(['a.md', 'b.md'], '/proj');

    useWorkspaceStore.getState().addProject('/proj', tree1);
    useWorkspaceStore.getState().addProject('/proj', tree2);

    const state = useWorkspaceStore.getState();
    expect(state.projects).toHaveLength(1);
    expect(state.projects[0].fileTree).toEqual(tree2);
  });

  it('removes a project and adds it to recent projects', () => {
    useWorkspaceStore.getState().addProject('/proj', []);
    useWorkspaceStore.getState().removeProject('/proj', 'My Project');

    const state = useWorkspaceStore.getState();
    expect(state.projects).toHaveLength(0);
    expect(state.recentProjects).toHaveLength(1);
    expect(state.recentProjects[0]).toEqual({ path: '/proj', name: 'My Project' });
  });

  it('removeProject derives name from path when not provided', () => {
    useWorkspaceStore.getState().addProject('/path/to/myproject', []);
    useWorkspaceStore.getState().removeProject('/path/to/myproject');

    expect(useWorkspaceStore.getState().recentProjects[0].name).toBe('myproject');
  });

  it('promotes explorer folder to project (removes from explorer)', () => {
    useWorkspaceStore.getState().addExplorerFolder('/docs', makeTree(['a.md'], '/docs'));
    expect(useWorkspaceStore.getState().explorerFolders).toHaveLength(1);

    useWorkspaceStore.getState().addProject('/docs', makeTree(['a.md'], '/docs'));

    const state = useWorkspaceStore.getState();
    expect(state.projects).toHaveLength(1);
    expect(state.explorerFolders).toHaveLength(0);
  });

  it('re-opening a project removes it from recent projects', () => {
    useWorkspaceStore.getState().addProject('/proj', []);
    useWorkspaceStore.getState().removeProject('/proj', 'Proj');
    expect(useWorkspaceStore.getState().recentProjects).toHaveLength(1);

    useWorkspaceStore.getState().addProject('/proj', []);
    expect(useWorkspaceStore.getState().recentProjects).toHaveLength(0);
    expect(useWorkspaceStore.getState().projects).toHaveLength(1);
  });

  it('updateProjectTree updates tree for matching path', () => {
    useWorkspaceStore.getState().addProject('/proj', []);
    const newTree = makeTree(['new.md'], '/proj');
    useWorkspaceStore.getState().updateProjectTree('/proj', newTree);

    expect(useWorkspaceStore.getState().projects[0].fileTree).toEqual(newTree);
  });

  it('updateProjectPath migrates project path and tree', () => {
    useWorkspaceStore.getState().addProject('/old/path', makeTree(['a.md'], '/old/path'));
    const newTree = makeTree(['a.md'], '/new/path');
    useWorkspaceStore.getState().updateProjectPath('/old/path', '/new/path', newTree);

    const state = useWorkspaceStore.getState();
    expect(state.projects).toHaveLength(1);
    expect(state.projects[0].path).toBe('/new/path');
    expect(state.projects[0].fileTree).toEqual(newTree);
  });

  it('findOwningProject returns correct project', () => {
    useWorkspaceStore.getState().addProject('/projects/alpha', []);
    useWorkspaceStore.getState().addProject('/projects/beta', []);

    const found = useWorkspaceStore.getState().findOwningProject('/projects/alpha/src/main.ts');
    expect(found).toBeDefined();
    expect(found!.path).toBe('/projects/alpha');
  });

  it('findOwningProject returns undefined for non-matching path', () => {
    useWorkspaceStore.getState().addProject('/projects/alpha', []);

    const found = useWorkspaceStore.getState().findOwningProject('/other/file.md');
    expect(found).toBeUndefined();
  });
});

// ===========================================================================
// File trees (notes)
// ===========================================================================

describe('notes tree', () => {
  it('setNotesTree sets the notes tree', () => {
    const tree = makeTree(['note1.md', 'note2.md'], '/notes');
    useWorkspaceStore.getState().setNotesTree(tree);

    expect(useWorkspaceStore.getState().notesTree).toEqual(tree);
  });

  it('setNotesTree replaces the previous tree', () => {
    useWorkspaceStore.getState().setNotesTree(makeTree(['old.md'], '/notes'));
    const newTree = makeTree(['new.md'], '/notes');
    useWorkspaceStore.getState().setNotesTree(newTree);

    expect(useWorkspaceStore.getState().notesTree).toEqual(newTree);
  });
});

// ===========================================================================
// Folder expansion
// ===========================================================================

describe('folder expansion', () => {
  it('toggleFolder expands a folder', () => {
    useWorkspaceStore.getState().toggleFolder('/docs/sub');

    expect(useWorkspaceStore.getState().isExpanded('/docs/sub')).toBe(true);
  });

  it('toggleFolder collapses an expanded folder', () => {
    useWorkspaceStore.getState().toggleFolder('/docs/sub');
    useWorkspaceStore.getState().toggleFolder('/docs/sub');

    expect(useWorkspaceStore.getState().isExpanded('/docs/sub')).toBe(false);
  });

  it('isExpanded returns false for unknown folders', () => {
    expect(useWorkspaceStore.getState().isExpanded('/nonexistent')).toBe(false);
  });

  it('multiple folders can be expanded independently', () => {
    useWorkspaceStore.getState().toggleFolder('/a');
    useWorkspaceStore.getState().toggleFolder('/b');

    expect(useWorkspaceStore.getState().isExpanded('/a')).toBe(true);
    expect(useWorkspaceStore.getState().isExpanded('/b')).toBe(true);

    useWorkspaceStore.getState().toggleFolder('/a');
    expect(useWorkspaceStore.getState().isExpanded('/a')).toBe(false);
    expect(useWorkspaceStore.getState().isExpanded('/b')).toBe(true);
  });
});

// ===========================================================================
// Section collapse
// ===========================================================================

describe('section collapse', () => {
  it('setExplorerCollapsed toggles explorer collapsed state', () => {
    useWorkspaceStore.getState().setExplorerCollapsed(true);
    expect(useWorkspaceStore.getState().explorerCollapsed).toBe(true);

    useWorkspaceStore.getState().setExplorerCollapsed(false);
    expect(useWorkspaceStore.getState().explorerCollapsed).toBe(false);
  });

  it('setProjectsCollapsed toggles projects collapsed state', () => {
    useWorkspaceStore.getState().setProjectsCollapsed(true);
    expect(useWorkspaceStore.getState().projectsCollapsed).toBe(true);
  });

  it('setNotesCollapsed toggles notes collapsed state', () => {
    useWorkspaceStore.getState().setNotesCollapsed(true);
    expect(useWorkspaceStore.getState().notesCollapsed).toBe(true);
  });
});

// ===========================================================================
// Recent projects
// ===========================================================================

describe('recent projects', () => {
  it('addRecentProject adds a project to recents', () => {
    useWorkspaceStore.getState().addRecentProject('/proj', 'Proj');

    expect(useWorkspaceStore.getState().recentProjects).toEqual([
      { path: '/proj', name: 'Proj' },
    ]);
  });

  it('addRecentProject deduplicates (moves to front)', () => {
    useWorkspaceStore.getState().addRecentProject('/a', 'A');
    useWorkspaceStore.getState().addRecentProject('/b', 'B');
    useWorkspaceStore.getState().addRecentProject('/a', 'A Updated');

    const recents = useWorkspaceStore.getState().recentProjects;
    expect(recents).toHaveLength(2);
    expect(recents[0]).toEqual({ path: '/a', name: 'A Updated' });
    expect(recents[1]).toEqual({ path: '/b', name: 'B' });
  });

  it('caps at 5 recent projects', () => {
    for (let i = 0; i < 7; i++) {
      useWorkspaceStore.getState().addRecentProject(`/proj${i}`, `Proj ${i}`);
    }

    const recents = useWorkspaceStore.getState().recentProjects;
    expect(recents).toHaveLength(5);
    // Most recent should be first
    expect(recents[0].path).toBe('/proj6');
    expect(recents[4].path).toBe('/proj2');
  });

  it('removeRecentProject removes from recents', () => {
    useWorkspaceStore.getState().addRecentProject('/a', 'A');
    useWorkspaceStore.getState().addRecentProject('/b', 'B');
    useWorkspaceStore.getState().removeRecentProject('/a');

    const recents = useWorkspaceStore.getState().recentProjects;
    expect(recents).toHaveLength(1);
    expect(recents[0].path).toBe('/b');
  });

  it('removeProject caps recent projects at 5', () => {
    // Fill up 5 recent slots via addRecentProject
    for (let i = 0; i < 5; i++) {
      useWorkspaceStore.getState().addRecentProject(`/recent${i}`, `Recent ${i}`);
    }
    expect(useWorkspaceStore.getState().recentProjects).toHaveLength(5);

    // Add and remove a project — it should push into recents but stay at 5
    useWorkspaceStore.getState().addProject('/overflow', []);
    useWorkspaceStore.getState().removeProject('/overflow', 'Overflow');

    expect(useWorkspaceStore.getState().recentProjects).toHaveLength(5);
    expect(useWorkspaceStore.getState().recentProjects[0].path).toBe('/overflow');
  });
});

// ===========================================================================
// Persistence round-trip
// ===========================================================================

describe('persistence round-trip', () => {
  it('persists and restores explorer folder paths (trees not persisted)', async () => {
    useWorkspaceStore.getState().addExplorerFolder('/docs', makeTree(['a.md'], '/docs'));
    useWorkspaceStore.getState().addExplorerFolder('/notes', makeTree(['b.md'], '/notes'));
    await waitForPersist();

    const raw = localStorageMock.getItem(STORAGE_KEY);
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(raw!);
    // Trees should be stripped from persisted state (partialize removes them)
    expect(parsed.state.explorerFolders).toEqual([
      { path: '/docs' },
      { path: '/notes' },
    ]);

    await simulateRestart(useWorkspaceStore, STORAGE_KEY, WORKSPACE_DEFAULTS);

    const state = useWorkspaceStore.getState();
    expect(state.explorerFolders).toHaveLength(2);
    expect(state.explorerFolders[0].path).toBe('/docs');
    expect(state.explorerFolders[1].path).toBe('/notes');
    // Trees should be empty after restore
    expect(state.explorerFolders[0].fileTree).toEqual([]);
    expect(state.explorerFolders[1].fileTree).toEqual([]);
  });

  it('persists and restores project paths (trees not persisted)', async () => {
    useWorkspaceStore.getState().addProject('/proj1', makeTree(['x.md'], '/proj1'));
    useWorkspaceStore.getState().addProject('/proj2', makeTree(['y.md'], '/proj2'));
    await waitForPersist();

    const raw = localStorageMock.getItem(STORAGE_KEY);
    const parsed = JSON.parse(raw!);
    expect(parsed.state.projects).toEqual([
      { path: '/proj1', fileTree: [] },
      { path: '/proj2', fileTree: [] },
    ]);

    await simulateRestart(useWorkspaceStore, STORAGE_KEY, WORKSPACE_DEFAULTS);

    const state = useWorkspaceStore.getState();
    expect(state.projects).toHaveLength(2);
    expect(state.projects[0].path).toBe('/proj1');
    expect(state.projects[0].fileTree).toEqual([]);
  });

  it('persists and restores expandedFolders (serialized as array)', async () => {
    useWorkspaceStore.getState().toggleFolder('/docs');
    useWorkspaceStore.getState().toggleFolder('/notes/sub');
    await waitForPersist();

    const raw = localStorageMock.getItem(STORAGE_KEY);
    const parsed = JSON.parse(raw!);
    // Should be serialized as an array
    expect(Array.isArray(parsed.state.expandedFolders)).toBe(true);
    expect(parsed.state.expandedFolders).toContain('/docs');
    expect(parsed.state.expandedFolders).toContain('/notes/sub');

    await simulateRestart(useWorkspaceStore, STORAGE_KEY, WORKSPACE_DEFAULTS);

    const state = useWorkspaceStore.getState();
    expect(state.expandedFolders).toBeInstanceOf(Set);
    expect(state.isExpanded('/docs')).toBe(true);
    expect(state.isExpanded('/notes/sub')).toBe(true);
  });

  it('persists and restores recent projects', async () => {
    useWorkspaceStore.getState().addRecentProject('/proj1', 'Project One');
    useWorkspaceStore.getState().addRecentProject('/proj2', 'Project Two');
    await waitForPersist();

    await simulateRestart(useWorkspaceStore, STORAGE_KEY, WORKSPACE_DEFAULTS);

    const recents = useWorkspaceStore.getState().recentProjects;
    expect(recents).toHaveLength(2);
    expect(recents[0]).toEqual({ path: '/proj2', name: 'Project Two' });
    expect(recents[1]).toEqual({ path: '/proj1', name: 'Project One' });
  });

  it('persists and restores section collapse states', async () => {
    useWorkspaceStore.getState().setExplorerCollapsed(true);
    useWorkspaceStore.getState().setProjectsCollapsed(true);
    useWorkspaceStore.getState().setNotesCollapsed(true);
    await waitForPersist();

    await simulateRestart(useWorkspaceStore, STORAGE_KEY, WORKSPACE_DEFAULTS);

    const state = useWorkspaceStore.getState();
    expect(state.explorerCollapsed).toBe(true);
    expect(state.projectsCollapsed).toBe(true);
    expect(state.notesCollapsed).toBe(true);
  });

  it('does NOT persist notesTree (ephemeral runtime state)', async () => {
    useWorkspaceStore.getState().setNotesTree(makeTree(['note.md'], '/notes'));
    await waitForPersist();

    const raw = localStorageMock.getItem(STORAGE_KEY);
    const parsed = JSON.parse(raw!);
    expect(parsed.state.notesTree).toBeUndefined();
  });
});

// ===========================================================================
// v1 migration (single explorerPath → explorerFolders array)
// ===========================================================================

describe('v1 migration', () => {
  it('migrates single explorerPath to explorerFolders array', async () => {
    // Simulate persisted v1 data with a single explorerPath
    const v1Data = {
      state: {
        explorerPath: '/old/single/path',
        projects: [],
        recentProjects: [],
        expandedFolders: [],
        explorerCollapsed: false,
        projectsCollapsed: false,
        notesCollapsed: false,
      },
      version: 0,
    };

    // Write v1 data, reset store in-memory, then rehydrate (simulates fresh app start)
    localStorageMock.setItem(STORAGE_KEY, JSON.stringify(v1Data));
    useWorkspaceStore.setState(WORKSPACE_DEFAULTS);
    // Prevent the setState above from overwriting our v1 snapshot
    await waitForPersist();
    localStorageMock.setItem(STORAGE_KEY, JSON.stringify(v1Data));
    await useWorkspaceStore.persist.rehydrate();
    await waitForPersist();

    const state = useWorkspaceStore.getState();
    expect(state.explorerFolders).toHaveLength(1);
    expect(state.explorerFolders[0].path).toBe('/old/single/path');
    expect(state.explorerFolders[0].fileTree).toEqual([]);
  });

  it('prefers explorerFolders array over explorerPath when both present', async () => {
    const data = {
      state: {
        explorerPath: '/should/be/ignored',
        explorerFolders: [{ path: '/folder1' }, { path: '/folder2' }],
        projects: [],
        recentProjects: [],
        expandedFolders: [],
        explorerCollapsed: false,
        projectsCollapsed: false,
        notesCollapsed: false,
      },
      version: 0,
    };

    localStorageMock.setItem(STORAGE_KEY, JSON.stringify(data));
    useWorkspaceStore.setState(WORKSPACE_DEFAULTS);
    await waitForPersist();
    localStorageMock.setItem(STORAGE_KEY, JSON.stringify(data));
    await useWorkspaceStore.persist.rehydrate();
    await waitForPersist();

    const state = useWorkspaceStore.getState();
    expect(state.explorerFolders).toHaveLength(2);
    expect(state.explorerFolders[0].path).toBe('/folder1');
    expect(state.explorerFolders[1].path).toBe('/folder2');
  });

  it('handles empty explorerPath gracefully', async () => {
    const data = {
      state: {
        explorerPath: '',
        projects: [],
        recentProjects: [],
        expandedFolders: [],
        explorerCollapsed: false,
        projectsCollapsed: false,
        notesCollapsed: false,
      },
      version: 0,
    };

    localStorageMock.setItem(STORAGE_KEY, JSON.stringify(data));
    useWorkspaceStore.setState(WORKSPACE_DEFAULTS);
    await waitForPersist();
    localStorageMock.setItem(STORAGE_KEY, JSON.stringify(data));
    await useWorkspaceStore.persist.rehydrate();
    await waitForPersist();

    const state = useWorkspaceStore.getState();
    expect(state.explorerFolders).toHaveLength(0);
  });

  it('restores expandedFolders from persisted array to Set', async () => {
    const data = {
      state: {
        explorerFolders: [{ path: '/docs' }],
        projects: [],
        recentProjects: [],
        expandedFolders: ['/docs', '/docs/sub'],
        explorerCollapsed: false,
        projectsCollapsed: false,
        notesCollapsed: false,
      },
      version: 0,
    };

    localStorageMock.setItem(STORAGE_KEY, JSON.stringify(data));
    useWorkspaceStore.setState(WORKSPACE_DEFAULTS);
    await waitForPersist();
    localStorageMock.setItem(STORAGE_KEY, JSON.stringify(data));
    await useWorkspaceStore.persist.rehydrate();
    await waitForPersist();

    const state = useWorkspaceStore.getState();
    expect(state.expandedFolders).toBeInstanceOf(Set);
    expect(state.expandedFolders.size).toBe(2);
    expect(state.isExpanded('/docs')).toBe(true);
    expect(state.isExpanded('/docs/sub')).toBe(true);
  });
});

// ===========================================================================
// Pinned files
// ===========================================================================

describe('pinnedFiles', () => {
  it('defaults to an empty array', () => {
    expect(useWorkspaceStore.getState().pinnedFiles).toEqual([]);
  });

  it('pinFile adds a path', () => {
    useWorkspaceStore.getState().pinFile('/docs/a.md');
    expect(useWorkspaceStore.getState().pinnedFiles).toEqual(['/docs/a.md']);
  });

  it('pinFile deduplicates (no-op when path already pinned)', () => {
    useWorkspaceStore.getState().pinFile('/docs/a.md');
    useWorkspaceStore.getState().pinFile('/docs/a.md');

    const pinned = useWorkspaceStore.getState().pinnedFiles;
    expect(pinned).toEqual(['/docs/a.md']);
  });

  it('unpinFile removes a path', () => {
    useWorkspaceStore.getState().pinFile('/docs/a.md');
    useWorkspaceStore.getState().pinFile('/docs/b.md');
    useWorkspaceStore.getState().unpinFile('/docs/a.md');

    expect(useWorkspaceStore.getState().pinnedFiles).toEqual(['/docs/b.md']);
  });

  it('unpinFile is a no-op for non-existent paths', () => {
    useWorkspaceStore.getState().pinFile('/docs/a.md');
    useWorkspaceStore.getState().unpinFile('/nope.md');

    expect(useWorkspaceStore.getState().pinnedFiles).toEqual(['/docs/a.md']);
  });

  it('reorderPinnedFiles swaps entries', () => {
    useWorkspaceStore.getState().pinFile('/a.md');
    useWorkspaceStore.getState().pinFile('/b.md');
    useWorkspaceStore.getState().pinFile('/c.md');

    useWorkspaceStore.getState().reorderPinnedFiles(0, 2);

    expect(useWorkspaceStore.getState().pinnedFiles).toEqual([
      '/b.md',
      '/c.md',
      '/a.md',
    ]);
  });

  it('reorderPinnedFiles is a no-op for out-of-range indices', () => {
    useWorkspaceStore.getState().pinFile('/a.md');
    useWorkspaceStore.getState().pinFile('/b.md');

    useWorkspaceStore.getState().reorderPinnedFiles(0, 5);
    useWorkspaceStore.getState().reorderPinnedFiles(-1, 1);
    useWorkspaceStore.getState().reorderPinnedFiles(1, 1);

    expect(useWorkspaceStore.getState().pinnedFiles).toEqual([
      '/a.md',
      '/b.md',
    ]);
  });

  it('updateFilePaths rewrites pinned entries that match the prefix', () => {
    useWorkspaceStore.getState().pinFile('/old/a.md');
    useWorkspaceStore.getState().pinFile('/old/sub/b.md');
    useWorkspaceStore.getState().pinFile('/other/c.md');

    useWorkspaceStore.getState().updateFilePaths('/old', '/new');

    expect(useWorkspaceStore.getState().pinnedFiles).toEqual([
      '/new/a.md',
      '/new/sub/b.md',
      '/other/c.md',
    ]);
  });

  it('updateFilePaths does not partially rewrite similar-looking prefixes', () => {
    useWorkspaceStore.getState().pinFile('/projects/alpha/file.md');
    useWorkspaceStore.getState().pinFile('/projects/alphabet/file.md');

    useWorkspaceStore.getState().updateFilePaths('/projects/alpha', '/renamed');

    expect(useWorkspaceStore.getState().pinnedFiles).toEqual([
      '/renamed/file.md',
      '/projects/alphabet/file.md',
    ]);
  });

  it('updateProjectPath also rewrites pinned entries under the project', () => {
    useWorkspaceStore.getState().addProject('/old/proj', []);
    useWorkspaceStore.getState().pinFile('/old/proj/readme.md');
    useWorkspaceStore.getState().pinFile('/external/note.md');

    useWorkspaceStore.getState().updateProjectPath('/old/proj', '/new/proj', []);

    expect(useWorkspaceStore.getState().pinnedFiles).toEqual([
      '/new/proj/readme.md',
      '/external/note.md',
    ]);
  });

  it('persists pinnedFiles across a restart', async () => {
    useWorkspaceStore.getState().pinFile('/docs/a.md');
    useWorkspaceStore.getState().pinFile('/docs/b.md');
    await waitForPersist();

    const raw = localStorageMock.getItem(STORAGE_KEY);
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(raw!);
    expect(parsed.state.pinnedFiles).toEqual(['/docs/a.md', '/docs/b.md']);

    await simulateRestart(useWorkspaceStore, STORAGE_KEY, WORKSPACE_DEFAULTS);

    expect(useWorkspaceStore.getState().pinnedFiles).toEqual([
      '/docs/a.md',
      '/docs/b.md',
    ]);
  });

  it('merge tolerates missing pinnedFiles (back-compat with pre-31 persisted state)', async () => {
    const legacyData = {
      state: {
        explorerFolders: [],
        projects: [],
        recentProjects: [],
        expandedFolders: [],
        explorerCollapsed: false,
        projectsCollapsed: false,
        notesCollapsed: false,
      },
      version: 0,
    };

    localStorageMock.setItem(STORAGE_KEY, JSON.stringify(legacyData));
    useWorkspaceStore.setState(WORKSPACE_DEFAULTS);
    await waitForPersist();
    localStorageMock.setItem(STORAGE_KEY, JSON.stringify(legacyData));
    await useWorkspaceStore.persist.rehydrate();
    await waitForPersist();

    expect(useWorkspaceStore.getState().pinnedFiles).toEqual([]);
  });
});

// ===========================================================================
// Shared pins.json write-through & sync (iOS Pinned group, #652)
// ===========================================================================

describe('pins.json write-through & sync (#652)', () => {
  const LIBRARY_ROOT = '/Users/x/Library/Mobile Documents/com~apple~CloudDocs/Notesage';
  const PINS_PATH = `${LIBRARY_ROOT}/.notesage/pins.json`;

  beforeEach(() => {
    useSettingsStore.getState().setICloudNotesagePath(LIBRARY_ROOT);
    vi.mocked(invoke).mockReset();
    vi.mocked(invoke).mockResolvedValue(null);
  });

  afterEach(() => {
    useSettingsStore.getState().setICloudNotesagePath(null);
  });

  it('pinning a file inside the library root writes/updates pins.json with the relative path', async () => {
    const writeCalls: Array<{ path: string; content: string }> = [];
    vi.mocked(invoke).mockImplementation(async (cmd: string, args?: unknown) => {
      if (cmd === 'read_file') throw new Error('file not found');
      if (cmd === 'write_file') {
        writeCalls.push(args as { path: string; content: string });
      }
      return null;
    });

    useWorkspaceStore.getState().pinFile(`${LIBRARY_ROOT}/notes/a.md`);
    await waitForPersist();

    expect(writeCalls).toHaveLength(1);
    expect(writeCalls[0].path).toBe(PINS_PATH);
    expect(JSON.parse(writeCalls[0].content)).toEqual({ paths: ['notes/a.md'] });
  });

  it('unpinning a file removes its path from pins.json', async () => {
    const writeCalls: Array<{ content: string }> = [];
    vi.mocked(invoke).mockImplementation(async (cmd: string, args?: unknown) => {
      if (cmd === 'read_file') throw new Error('file not found');
      if (cmd === 'write_file') {
        writeCalls.push(args as { content: string });
      }
      return null;
    });

    useWorkspaceStore.getState().pinFile(`${LIBRARY_ROOT}/notes/a.md`);
    await waitForPersist();
    useWorkspaceStore.getState().pinFile(`${LIBRARY_ROOT}/notes/b.md`);
    await waitForPersist();
    useWorkspaceStore.getState().unpinFile(`${LIBRARY_ROOT}/notes/a.md`);
    await waitForPersist();

    const last = writeCalls[writeCalls.length - 1];
    expect(JSON.parse(last.content)).toEqual({ paths: ['notes/b.md'] });
  });

  it('pinning a file OUTSIDE the library root does NOT write to pins.json', async () => {
    let writeCalled = false;
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === 'read_file') throw new Error('file not found');
      if (cmd === 'write_file') writeCalled = true;
      return null;
    });

    useWorkspaceStore.getState().pinFile('/Users/x/elsewhere/note.md');
    await waitForPersist();

    expect(writeCalled).toBe(false);
    // It still stays local-only in pinnedFiles.
    expect(useWorkspaceStore.getState().pinnedFiles).toEqual(['/Users/x/elsewhere/note.md']);
  });

  it('opening a library that has no pins.json yet does not throw — the read path treats "not found" as an empty set', async () => {
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === 'read_file') throw new Error('file not found');
      return null;
    });

    let threw = false;
    try {
      await useWorkspaceStore.getState().syncPinsFromLibraryRoot(LIBRARY_ROOT);
    } catch {
      threw = true;
    }

    expect(threw).toBe(false);
    expect(useWorkspaceStore.getState().pinnedFiles).toEqual([]);
  });

  it('opening a library whose pins.json already exists merges/derives correctly on first read (no duplicates, no data loss)', async () => {
    useWorkspaceStore.setState({ pinnedFiles: [`${LIBRARY_ROOT}/local-only.md`] });
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === 'read_file') {
        return JSON.stringify({ paths: ['remote-only.md', 'local-only.md'] });
      }
      return null;
    });

    await useWorkspaceStore.getState().syncPinsFromLibraryRoot(LIBRARY_ROOT);

    const pinned = useWorkspaceStore.getState().pinnedFiles;
    expect(pinned).toContain(`${LIBRARY_ROOT}/local-only.md`);
    expect(pinned).toContain(`${LIBRARY_ROOT}/remote-only.md`);
    expect(pinned.filter((p) => p === `${LIBRARY_ROOT}/local-only.md`)).toHaveLength(1);
  });
});
