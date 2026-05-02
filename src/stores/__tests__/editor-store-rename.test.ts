/**
 * Unit tests for editor-store.ts — renameOpenDocument action.
 * Tests file rename (exact match) and folder rename (prefix cascade).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// ---------------------------------------------------------------------------
// vi.hoisted — localStorage polyfill, must run before vi.mock factories
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

import { useEditorStore } from '../editor-store';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const DEFAULTS = {
  openDocuments: [],
  activeTabId: null,
  recentFiles: [],
  scrollPositions: {},
  externalChanges: {},
  persistedTabs: [],
  persistedActiveFilePath: null,
};

beforeEach(() => {
  storageBacking.clear();
  useEditorStore.setState(DEFAULTS);
});

afterEach(() => {
  storageBacking.clear();
});

// ===========================================================================
// renameOpenDocument — file rename (exact match)
// ===========================================================================

describe('renameOpenDocument — file rename (exact path match)', () => {
  it('updates filePath and fileName for the matching open tab', () => {
    useEditorStore.getState().openTab('/project/notes/foo.md', 'foo.md', '# Foo');

    useEditorStore.getState().renameOpenDocument('/project/notes/foo.md', '/project/notes/bar.md');

    const state = useEditorStore.getState();
    expect(state.openDocuments).toHaveLength(1);
    expect(state.openDocuments[0].filePath).toBe('/project/notes/bar.md');
    expect(state.openDocuments[0].fileName).toBe('bar.md');
  });

  it('updates persistedTabs entry for the renamed file', () => {
    useEditorStore.getState().openTab('/project/notes/foo.md', 'foo.md', '# Foo');

    useEditorStore.getState().renameOpenDocument('/project/notes/foo.md', '/project/notes/bar.md');

    const state = useEditorStore.getState();
    const persistedTab = state.persistedTabs.find((pt) => pt.filePath === '/project/notes/bar.md');
    expect(persistedTab).toBeDefined();
    expect(persistedTab?.fileName).toBe('bar.md');
    expect(state.persistedTabs.some((pt) => pt.filePath === '/project/notes/foo.md')).toBe(false);
  });

  it('updates persistedActiveFilePath when the active tab is renamed', () => {
    useEditorStore.getState().openTab('/project/notes/foo.md', 'foo.md', '# Foo');

    useEditorStore.getState().renameOpenDocument('/project/notes/foo.md', '/project/notes/bar.md');

    expect(useEditorStore.getState().persistedActiveFilePath).toBe('/project/notes/bar.md');
  });

  it('updates recentFiles entry for the renamed path', () => {
    useEditorStore.getState().openTab('/project/notes/foo.md', 'foo.md', '# Foo');

    useEditorStore.getState().renameOpenDocument('/project/notes/foo.md', '/project/notes/bar.md');

    const state = useEditorStore.getState();
    const recent = state.recentFiles.find((rf) => rf.path === '/project/notes/bar.md');
    expect(recent).toBeDefined();
    expect(recent?.name).toBe('bar.md');
    expect(state.recentFiles.some((rf) => rf.path === '/project/notes/foo.md')).toBe(false);
  });

  it('updates scrollPositions key for the renamed path', () => {
    useEditorStore.getState().openTab('/project/notes/foo.md', 'foo.md', '# Foo');
    useEditorStore.getState().setScrollPosition('/project/notes/foo.md', 0.5);

    useEditorStore.getState().renameOpenDocument('/project/notes/foo.md', '/project/notes/bar.md');

    const state = useEditorStore.getState();
    expect(state.scrollPositions['/project/notes/bar.md']).toBe(0.5);
    expect('/project/notes/foo.md' in state.scrollPositions).toBe(false);
  });

  it('does not affect other open tabs', () => {
    useEditorStore.getState().openTab('/project/notes/foo.md', 'foo.md', '# Foo');
    useEditorStore.getState().openTab('/project/notes/other.md', 'other.md', '# Other');

    useEditorStore.getState().renameOpenDocument('/project/notes/foo.md', '/project/notes/bar.md');

    const state = useEditorStore.getState();
    expect(state.openDocuments).toHaveLength(2);
    expect(state.openDocuments.some((t) => t.filePath === '/project/notes/other.md')).toBe(true);
  });

  it('is a no-op when the old path is not open', () => {
    useEditorStore.getState().openTab('/project/notes/other.md', 'other.md', '# Other');

    useEditorStore.getState().renameOpenDocument('/project/notes/nonexistent.md', '/project/notes/new.md');

    const state = useEditorStore.getState();
    expect(state.openDocuments[0].filePath).toBe('/project/notes/other.md');
  });
});

// ===========================================================================
// renameOpenDocument — folder rename (prefix cascade)
// ===========================================================================

describe('renameOpenDocument — folder rename (prefix cascade)', () => {
  it('rewrites all descendant tab paths when a parent folder is renamed', () => {
    useEditorStore.getState().openTab('/project/notes/a.md', 'a.md', '# A');
    useEditorStore.getState().openTab('/project/notes/sub/b.md', 'b.md', '# B');
    useEditorStore.getState().openTab('/project/other/c.md', 'c.md', '# C');

    useEditorStore.getState().renameOpenDocument('/project/notes', '/project/renamed');

    const state = useEditorStore.getState();
    expect(state.openDocuments.some((t) => t.filePath === '/project/renamed/a.md')).toBe(true);
    expect(state.openDocuments.some((t) => t.filePath === '/project/renamed/sub/b.md')).toBe(true);
    expect(state.openDocuments.some((t) => t.filePath === '/project/other/c.md')).toBe(true);
    expect(state.openDocuments.some((t) => t.filePath.startsWith('/project/notes'))).toBe(false);
  });

  it('rewrites all descendant fileName fields in the folder cascade', () => {
    useEditorStore.getState().openTab('/project/notes/a.md', 'a.md', '# A');

    useEditorStore.getState().renameOpenDocument('/project/notes', '/project/renamed');

    const state = useEditorStore.getState();
    const tab = state.openDocuments.find((t) => t.filePath === '/project/renamed/a.md');
    expect(tab?.fileName).toBe('a.md');
  });

  it('rewrites all descendant recentFiles entries in the folder cascade', () => {
    useEditorStore.getState().openTab('/project/notes/a.md', 'a.md', '# A');
    useEditorStore.getState().openTab('/project/notes/sub/b.md', 'b.md', '# B');

    useEditorStore.getState().renameOpenDocument('/project/notes', '/project/renamed');

    const state = useEditorStore.getState();
    expect(state.recentFiles.some((rf) => rf.path === '/project/renamed/a.md')).toBe(true);
    expect(state.recentFiles.some((rf) => rf.path === '/project/renamed/sub/b.md')).toBe(true);
    expect(state.recentFiles.some((rf) => rf.path.startsWith('/project/notes'))).toBe(false);
  });

  it('rewrites persistedActiveFilePath when it is under the renamed folder', () => {
    useEditorStore.getState().openTab('/project/notes/a.md', 'a.md', '# A');

    useEditorStore.getState().renameOpenDocument('/project/notes', '/project/renamed');

    expect(useEditorStore.getState().persistedActiveFilePath).toBe('/project/renamed/a.md');
  });
});
