/**
 * Unit tests for editor-store.ts — the Zustand store managing tabs, dirty
 * tracking, recent files, scroll positions, external changes, and persistence.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// ---------------------------------------------------------------------------
// vi.hoisted — runs before vi.mock factories and module-level store code.
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
import type { Tab } from '../editor-store';

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

async function waitForPersist(): Promise<void> {
  await new Promise((r) => setTimeout(r, 50));
}

async function simulateRestart(): Promise<void> {
  const snapshot = localStorageMock.getItem('notesage-editor');
  useEditorStore.setState(DEFAULTS);
  await waitForPersist();
  if (snapshot) localStorageMock.setItem('notesage-editor', snapshot);
  await useEditorStore.persist.rehydrate();
  await waitForPersist();
}

function getTab(filePath: string): Tab | undefined {
  return useEditorStore.getState().openDocuments.find((t) => t.filePath === filePath);
}

function getTabById(id: string): Tab | undefined {
  return useEditorStore.getState().openDocuments.find((t) => t.id === id);
}

// ---------------------------------------------------------------------------
// Setup / Teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  storageBacking.clear();
  useEditorStore.setState(DEFAULTS);
});

afterEach(() => {
  storageBacking.clear();
});

// ===========================================================================
// Tab management
// ===========================================================================

describe('Tab management', () => {
  it('openTab creates a tab with correct fields and defaults', () => {
    useEditorStore.getState().openTab('/docs/readme.md', 'readme.md', '# Hello');

    const state = useEditorStore.getState();
    expect(state.openDocuments).toHaveLength(1);

    const tab = state.openDocuments[0];
    expect(tab.filePath).toBe('/docs/readme.md');
    expect(tab.fileName).toBe('readme.md');
    expect(tab.content).toBe('# Hello');
    expect(tab.isDirty).toBe(false);
    expect(tab.contentLoaded).toBe(true);
    expect(tab.frontmatter).toBeNull();
    expect(tab.fileType).toBe('markdown');
    expect(tab.lastSavedContent).toBe('# Hello');
    expect(tab.id).toBeTruthy();
  });

  it('openTab sets the new tab as active', () => {
    useEditorStore.getState().openTab('/a.md', 'a.md', 'a');
    const state = useEditorStore.getState();
    expect(state.activeTabId).toBe(state.openDocuments[0].id);
  });

  it('openTab updates persistedActiveFilePath', () => {
    useEditorStore.getState().openTab('/a.md', 'a.md', 'a');
    expect(useEditorStore.getState().persistedActiveFilePath).toBe('/a.md');
  });

  it('openTab adds to persistedTabs', () => {
    useEditorStore.getState().openTab('/a.md', 'a.md', 'a');
    expect(useEditorStore.getState().persistedTabs).toEqual([
      { filePath: '/a.md', fileName: 'a.md' },
    ]);
  });

  it('openTab passes scrollToTag through to the tab', () => {
    const scrollToTag = { tag: 'important', occurrence: 2 };
    useEditorStore.getState().openTab('/a.md', 'a.md', 'a', null, 'markdown', scrollToTag);

    expect(useEditorStore.getState().openDocuments[0].scrollToTag).toEqual(scrollToTag);
  });

  it('openTab passes scrollToText through to the tab', () => {
    useEditorStore.getState().openTab('/a.md', 'a.md', 'a', null, 'markdown', undefined, 'find me');

    expect(useEditorStore.getState().openDocuments[0].scrollToText).toBe('find me');
  });

  it('openTab with custom fileType and frontmatter', () => {
    const fm = { title: 'Test', id: 'uuid-1' };
    useEditorStore.getState().openTab('/doc.epub', 'doc.epub', '', fm, 'epub');

    const tab = useEditorStore.getState().openDocuments[0];
    expect(tab.fileType).toBe('epub');
    expect(tab.frontmatter).toEqual(fm);
  });

  it('openTab reuses existing tab for same filePath (duplicate)', () => {
    useEditorStore.getState().openTab('/a.md', 'a.md', 'content-v1');
    const firstId = useEditorStore.getState().openDocuments[0].id;

    useEditorStore.getState().openTab('/a.md', 'a.md', 'content-v2');

    const state = useEditorStore.getState();
    expect(state.openDocuments).toHaveLength(1);
    expect(state.activeTabId).toBe(firstId);
    // Content is NOT overwritten on reuse — only activates the tab
    expect(state.openDocuments[0].content).toBe('content-v1');
  });

  it('openTab on existing tab sets scrollToTag/scrollToText', () => {
    useEditorStore.getState().openTab('/a.md', 'a.md', 'content');
    useEditorStore.getState().openTab('/a.md', 'a.md', 'content', null, 'markdown', { tag: 'x', occurrence: 0 }, 'search');

    const tab = useEditorStore.getState().openDocuments[0];
    expect(tab.scrollToTag).toEqual({ tag: 'x', occurrence: 0 });
    expect(tab.scrollToText).toBe('search');
  });

  it('closeTab removes the tab', () => {
    useEditorStore.getState().openTab('/a.md', 'a.md', 'a');
    useEditorStore.getState().openTab('/b.md', 'b.md', 'b');
    const tabA = getTab('/a.md')!;

    useEditorStore.getState().closeTab(tabA.id);

    expect(useEditorStore.getState().openDocuments).toHaveLength(1);
    expect(getTab('/a.md')).toBeUndefined();
  });

  it('closeTab removes from persistedTabs', () => {
    useEditorStore.getState().openTab('/a.md', 'a.md', 'a');
    const tabA = getTab('/a.md')!;
    useEditorStore.getState().closeTab(tabA.id);

    expect(useEditorStore.getState().persistedTabs).toEqual([]);
  });

  it('closeTab switches active to previous tab when closing active', () => {
    useEditorStore.getState().openTab('/a.md', 'a.md', 'a');
    useEditorStore.getState().openTab('/b.md', 'b.md', 'b');
    useEditorStore.getState().openTab('/c.md', 'c.md', 'c');
    const tabC = getTab('/c.md')!;

    // c is active, close it
    useEditorStore.getState().closeTab(tabC.id);

    const state = useEditorStore.getState();
    expect(state.openDocuments).toHaveLength(2);
    // Should switch to tab at index max(0, closedIndex-1) = index 1 = b
    expect(state.activeTabId).toBe(getTab('/b.md')!.id);
  });

  it('closeTab switches to first tab when closing the first active tab', () => {
    useEditorStore.getState().openTab('/a.md', 'a.md', 'a');
    useEditorStore.getState().openTab('/b.md', 'b.md', 'b');
    // Make a active
    useEditorStore.getState().setActiveTab(getTab('/a.md')!.id);
    useEditorStore.getState().closeTab(getTab('/a.md')!.id);

    expect(useEditorStore.getState().activeTabId).toBe(getTab('/b.md')!.id);
  });

  it('closeTab sets activeTabId to null when closing the last tab', () => {
    useEditorStore.getState().openTab('/a.md', 'a.md', 'a');
    useEditorStore.getState().closeTab(getTab('/a.md')!.id);

    expect(useEditorStore.getState().activeTabId).toBeNull();
    expect(useEditorStore.getState().persistedActiveFilePath).toBeNull();
  });

  it('closeTab does not change activeTabId when closing non-active tab', () => {
    useEditorStore.getState().openTab('/a.md', 'a.md', 'a');
    useEditorStore.getState().openTab('/b.md', 'b.md', 'b');
    const tabB = getTab('/b.md')!;
    const tabA = getTab('/a.md')!;

    // b is active, close a
    useEditorStore.getState().closeTab(tabA.id);

    expect(useEditorStore.getState().activeTabId).toBe(tabB.id);
  });

  it('setActiveTab changes active tab and persisted path', () => {
    useEditorStore.getState().openTab('/a.md', 'a.md', 'a');
    useEditorStore.getState().openTab('/b.md', 'b.md', 'b');
    const tabA = getTab('/a.md')!;

    useEditorStore.getState().setActiveTab(tabA.id);

    expect(useEditorStore.getState().activeTabId).toBe(tabA.id);
    expect(useEditorStore.getState().persistedActiveFilePath).toBe('/a.md');
  });
});

// ===========================================================================
// Tab placeholders
// ===========================================================================

describe('Tab placeholders', () => {
  it('openTabPlaceholder creates a tab with contentLoaded=false', () => {
    useEditorStore.getState().openTabPlaceholder('/a.md', 'a.md');

    const tab = getTab('/a.md')!;
    expect(tab).toBeDefined();
    expect(tab.contentLoaded).toBe(false);
    expect(tab.content).toBe('');
    expect(tab.isDirty).toBe(false);
    expect(tab.fileType).toBe('markdown');
  });

  it('openTabPlaceholder with custom fileType', () => {
    useEditorStore.getState().openTabPlaceholder('/doc.pdf', 'doc.pdf', 'pdf');

    expect(getTab('/doc.pdf')!.fileType).toBe('pdf');
  });

  it('openTabPlaceholder deduplicates — no-op if tab already exists', () => {
    useEditorStore.getState().openTabPlaceholder('/a.md', 'a.md');
    useEditorStore.getState().openTabPlaceholder('/a.md', 'a.md');

    expect(useEditorStore.getState().openDocuments).toHaveLength(1);
  });

  it('loadTabContent populates a placeholder tab', () => {
    useEditorStore.getState().openTabPlaceholder('/a.md', 'a.md');
    const tabId = getTab('/a.md')!.id;

    const fm = { title: 'Hello' };
    useEditorStore.getState().loadTabContent(tabId, '# Hello', fm);

    const tab = getTabById(tabId)!;
    expect(tab.contentLoaded).toBe(true);
    expect(tab.content).toBe('# Hello');
    expect(tab.frontmatter).toEqual(fm);
    expect(tab.lastSavedContent).toBe('# Hello');
  });

  it('loadTabContent without frontmatter preserves existing frontmatter', () => {
    useEditorStore.getState().openTab('/a.md', 'a.md', '', { title: 'Keep' });
    const tabId = getTab('/a.md')!.id;

    useEditorStore.getState().loadTabContent(tabId, 'new content');

    expect(getTabById(tabId)!.frontmatter).toEqual({ title: 'Keep' });
  });
});

// ===========================================================================
// Dirty tracking
// ===========================================================================

describe('Dirty tracking', () => {
  it('updateTabContent sets dirty flag and content', () => {
    useEditorStore.getState().openTab('/a.md', 'a.md', 'original');
    const tabId = getTab('/a.md')!.id;

    useEditorStore.getState().updateTabContent(tabId, 'modified', true);

    const tab = getTabById(tabId)!;
    expect(tab.isDirty).toBe(true);
    expect(tab.content).toBe('modified');
  });

  it('updateTabContent with isDirty=false sets lastSavedContent', () => {
    useEditorStore.getState().openTab('/a.md', 'a.md', 'original');
    const tabId = getTab('/a.md')!.id;

    useEditorStore.getState().updateTabContent(tabId, 'saved-content', false);

    const tab = getTabById(tabId)!;
    expect(tab.isDirty).toBe(false);
    expect(tab.lastSavedContent).toBe('saved-content');
  });

  it('updateTabContent with isDirty=true does NOT update lastSavedContent', () => {
    useEditorStore.getState().openTab('/a.md', 'a.md', 'original');
    const tabId = getTab('/a.md')!.id;

    useEditorStore.getState().updateTabContent(tabId, 'dirty-content', true);

    expect(getTabById(tabId)!.lastSavedContent).toBe('original');
  });

  it('markTabClean clears dirty flag', () => {
    useEditorStore.getState().openTab('/a.md', 'a.md', 'content');
    const tabId = getTab('/a.md')!.id;
    useEditorStore.getState().updateTabContent(tabId, 'modified', true);

    useEditorStore.getState().markTabClean(tabId);

    expect(getTabById(tabId)!.isDirty).toBe(false);
  });

  it('markTabClean with savedContent updates lastSavedContent', () => {
    useEditorStore.getState().openTab('/a.md', 'a.md', 'content');
    const tabId = getTab('/a.md')!.id;

    useEditorStore.getState().markTabClean(tabId, 'new-saved');

    expect(getTabById(tabId)!.lastSavedContent).toBe('new-saved');
  });

  it('markTabDeleted marks single file as deleted and not dirty', () => {
    useEditorStore.getState().openTab('/a.md', 'a.md', 'content');
    useEditorStore.getState().updateTabContent(getTab('/a.md')!.id, 'dirty', true);

    useEditorStore.getState().markTabDeleted('/a.md');

    const tab = getTab('/a.md')!;
    expect(tab.deleted).toBe(true);
    expect(tab.isDirty).toBe(false);
  });

  it('markTabDeleted marks all files under a directory path', () => {
    useEditorStore.getState().openTab('/project/a.md', 'a.md', 'a');
    useEditorStore.getState().openTab('/project/sub/b.md', 'b.md', 'b');
    useEditorStore.getState().openTab('/other/c.md', 'c.md', 'c');

    useEditorStore.getState().markTabDeleted('/project');

    expect(getTab('/project/a.md')!.deleted).toBe(true);
    expect(getTab('/project/sub/b.md')!.deleted).toBe(true);
    expect(getTab('/other/c.md')!.deleted).toBeUndefined();
  });

  it('setFrontmatter sets frontmatter and marks dirty', () => {
    useEditorStore.getState().openTab('/a.md', 'a.md', 'content');
    const tabId = getTab('/a.md')!.id;

    useEditorStore.getState().setFrontmatter(tabId, { title: 'New Title' });

    const tab = getTabById(tabId)!;
    expect(tab.frontmatter).toEqual({ title: 'New Title' });
    expect(tab.isDirty).toBe(true);
  });

  it('setFrontmatter with null clears frontmatter', () => {
    useEditorStore.getState().openTab('/a.md', 'a.md', 'content', { title: 'Old' });
    const tabId = getTab('/a.md')!.id;

    useEditorStore.getState().setFrontmatter(tabId, null);

    expect(getTabById(tabId)!.frontmatter).toBeNull();
  });

  it('updateFrontmatter merges into existing frontmatter', () => {
    useEditorStore.getState().openTab('/a.md', 'a.md', 'content', { title: 'Old', id: 'keep' });
    const tabId = getTab('/a.md')!.id;

    useEditorStore.getState().updateFrontmatter(tabId, { title: 'New' });

    const tab = getTabById(tabId)!;
    expect(tab.frontmatter).toEqual({ title: 'New', id: 'keep' });
    expect(tab.isDirty).toBe(true);
  });

  it('updateFrontmatter on null frontmatter creates new object', () => {
    useEditorStore.getState().openTab('/a.md', 'a.md', 'content');
    const tabId = getTab('/a.md')!.id;

    useEditorStore.getState().updateFrontmatter(tabId, { tags: ['test'] });

    expect(getTabById(tabId)!.frontmatter).toEqual({ tags: ['test'] });
  });
});

// ===========================================================================
// External changes
// ===========================================================================

describe('External changes', () => {
  it('setExternalChange stores disk content keyed by path', () => {
    useEditorStore.getState().setExternalChange('/a.md', 'disk version');

    expect(useEditorStore.getState().externalChanges['/a.md']).toBe('disk version');
  });

  it('clearExternalChange removes the entry', () => {
    useEditorStore.getState().setExternalChange('/a.md', 'v1');
    useEditorStore.getState().setExternalChange('/b.md', 'v2');

    useEditorStore.getState().clearExternalChange('/a.md');

    expect(useEditorStore.getState().externalChanges['/a.md']).toBeUndefined();
    expect(useEditorStore.getState().externalChanges['/b.md']).toBe('v2');
  });
});

// ===========================================================================
// Persistence
// ===========================================================================

describe('Persistence', () => {
  it('persists persistedTabs and persistedActiveFilePath through restart', async () => {
    useEditorStore.getState().openTab('/a.md', 'a.md', 'content');
    useEditorStore.getState().openTab('/b.md', 'b.md', 'content');
    await waitForPersist();

    await simulateRestart();

    const state = useEditorStore.getState();
    expect(state.persistedTabs).toEqual([
      { filePath: '/a.md', fileName: 'a.md' },
      { filePath: '/b.md', fileName: 'b.md' },
    ]);
    expect(state.persistedActiveFilePath).toBe('/b.md');
  });

  it('persists recentFiles through restart', async () => {
    useEditorStore.getState().openTab('/a.md', 'a.md', 'a');
    useEditorStore.getState().openTab('/b.md', 'b.md', 'b');
    await waitForPersist();

    await simulateRestart();

    const recent = useEditorStore.getState().recentFiles;
    expect(recent).toHaveLength(2);
    expect(recent[0].path).toBe('/b.md');
    expect(recent[1].path).toBe('/a.md');
  });

  it('persists scrollPositions through restart', async () => {
    useEditorStore.getState().setScrollPosition('/a.md', 0.42);
    await waitForPersist();

    await simulateRestart();

    expect(useEditorStore.getState().scrollPositions['/a.md']).toBe(0.42);
  });

  it('does NOT persist openDocuments array', async () => {
    useEditorStore.getState().openTab('/a.md', 'a.md', '# secret');
    await waitForPersist();

    const raw = localStorageMock.getItem('notesage-editor');
    const parsed = JSON.parse(raw!);
    expect(parsed.state.openDocuments).toBeUndefined();
    // Legacy key should also be absent — the field was renamed in v1.
    expect(parsed.state.tabs).toBeUndefined();
  });

  it('does NOT persist activeTabId', async () => {
    useEditorStore.getState().openTab('/a.md', 'a.md', 'content');
    await waitForPersist();

    const raw = localStorageMock.getItem('notesage-editor');
    const parsed = JSON.parse(raw!);
    expect(parsed.state.activeTabId).toBeUndefined();
  });

  it('does NOT persist externalChanges', async () => {
    useEditorStore.getState().setExternalChange('/a.md', 'disk');
    await waitForPersist();

    const raw = localStorageMock.getItem('notesage-editor');
    const parsed = JSON.parse(raw!);
    expect(parsed.state.externalChanges).toBeUndefined();
  });
});

// ===========================================================================
// Persist migration (v0 → v1: tabs → openDocuments)
// ===========================================================================

describe('Persist migration', () => {
  it('migrates legacy `tabs` key to `openDocuments` on rehydrate', async () => {
    // Simulate a pre-v1 persisted snapshot that somehow carries a `tabs`
    // array (hand-edited or forked state). The runtime `tabs` field was
    // never actually persisted by the app itself, but the migrator must
    // still drop the legacy key defensively so consumers never see both.
    const legacySnapshot = {
      state: {
        tabs: [
          { id: 'legacy-1', filePath: '/legacy.md', fileName: 'legacy.md' },
        ],
        recentFiles: [{ path: '/legacy.md', name: 'legacy.md' }],
        scrollPositions: {},
        persistedTabs: [{ filePath: '/legacy.md', fileName: 'legacy.md' }],
        persistedActiveFilePath: '/legacy.md',
      },
      version: 0,
    };
    // Follow the `simulateRestart` pattern: resetting the store first triggers
    // a persist write that would clobber our synthetic snapshot, so we reset,
    // then inject the legacy payload, then rehydrate.
    useEditorStore.setState(DEFAULTS);
    await waitForPersist();
    localStorageMock.setItem('notesage-editor', JSON.stringify(legacySnapshot));
    await useEditorStore.persist.rehydrate();
    await waitForPersist();

    const raw = localStorageMock.getItem('notesage-editor');
    const parsed = JSON.parse(raw!);
    // After rehydrate+save, the persisted snapshot must not carry `tabs`.
    expect(parsed.state.tabs).toBeUndefined();
    // Persisted data (recentFiles, persistedTabs, etc.) must survive the migration.
    expect(parsed.state.persistedTabs).toEqual([
      { filePath: '/legacy.md', fileName: 'legacy.md' },
    ]);
    expect(parsed.state.persistedActiveFilePath).toBe('/legacy.md');
    expect(parsed.version).toBe(1);
  });
});

// ===========================================================================
// Recent files
// ===========================================================================

describe('Recent files', () => {
  it('openTab adds to recent files', () => {
    useEditorStore.getState().openTab('/a.md', 'a.md', 'a');

    const recent = useEditorStore.getState().recentFiles;
    expect(recent).toHaveLength(1);
    expect(recent[0]).toMatchObject({ path: '/a.md', name: 'a.md' });
    // 2026-04-25 — sidebar relative-time hint stamps `lastAccessedAt`
    // on each entry so the Quiet sidebar can show "2h" / "1d" hints.
    expect(typeof recent[0].lastAccessedAt).toBe('number');
  });

  it('most recently opened file is first', () => {
    useEditorStore.getState().openTab('/a.md', 'a.md', 'a');
    useEditorStore.getState().openTab('/b.md', 'b.md', 'b');

    const recent = useEditorStore.getState().recentFiles;
    expect(recent[0].path).toBe('/b.md');
    expect(recent[1].path).toBe('/a.md');
  });

  it('reopening a file moves it to front (dedup)', () => {
    useEditorStore.getState().openTab('/a.md', 'a.md', 'a');
    useEditorStore.getState().openTab('/b.md', 'b.md', 'b');
    useEditorStore.getState().openTab('/a.md', 'a.md', 'a');

    const recent = useEditorStore.getState().recentFiles;
    expect(recent).toHaveLength(2);
    expect(recent[0].path).toBe('/a.md');
    expect(recent[1].path).toBe('/b.md');
  });

  it('caps at 5 recent files', () => {
    for (let i = 0; i < 7; i++) {
      useEditorStore.getState().openTab(`/file${i}.md`, `file${i}.md`, `content${i}`);
    }

    expect(useEditorStore.getState().recentFiles).toHaveLength(5);
    // Most recent should be file6
    expect(useEditorStore.getState().recentFiles[0].path).toBe('/file6.md');
  });
});

// ===========================================================================
// Scroll positions
// ===========================================================================

describe('Scroll positions', () => {
  it('setScrollPosition stores the ratio', () => {
    useEditorStore.getState().setScrollPosition('/a.md', 0.75);

    expect(useEditorStore.getState().scrollPositions['/a.md']).toBe(0.75);
  });

  it('setScrollPosition overwrites existing value', () => {
    useEditorStore.getState().setScrollPosition('/a.md', 0.25);
    useEditorStore.getState().setScrollPosition('/a.md', 0.99);

    expect(useEditorStore.getState().scrollPositions['/a.md']).toBe(0.99);
  });

  it('evicts oldest entries at 200 limit (LRU)', () => {
    // Fill to 200
    for (let i = 0; i < 200; i++) {
      useEditorStore.getState().setScrollPosition(`/file${i}.md`, i / 200);
    }
    expect(Object.keys(useEditorStore.getState().scrollPositions)).toHaveLength(200);

    // Add one more — should evict the oldest (file0)
    useEditorStore.getState().setScrollPosition('/file-new.md', 1.0);

    const positions = useEditorStore.getState().scrollPositions;
    expect(Object.keys(positions)).toHaveLength(200);
    expect(positions['/file0.md']).toBeUndefined();
    expect(positions['/file-new.md']).toBe(1.0);
    expect(positions['/file1.md']).toBeDefined();
  });
});

// ===========================================================================
// Other: renameTab, updateFilePaths, viewMode, copilot toggle, scroll targets
// ===========================================================================

describe('renameTab', () => {
  it('updates filePath and fileName in tab, persistedTabs, recentFiles, scrollPositions', () => {
    useEditorStore.getState().openTab('/old/note.md', 'note.md', 'content');
    useEditorStore.getState().setScrollPosition('/old/note.md', 0.5);

    useEditorStore.getState().renameTab('/old/note.md', '/new/renamed.md');

    const state = useEditorStore.getState();
    expect(state.openDocuments[0].filePath).toBe('/new/renamed.md');
    expect(state.openDocuments[0].fileName).toBe('renamed.md');
    expect(state.persistedTabs[0].filePath).toBe('/new/renamed.md');
    expect(state.persistedTabs[0].fileName).toBe('renamed.md');
    expect(state.recentFiles[0].path).toBe('/new/renamed.md');
    expect(state.recentFiles[0].name).toBe('renamed.md');
    expect(state.scrollPositions['/new/renamed.md']).toBe(0.5);
    expect(state.scrollPositions['/old/note.md']).toBeUndefined();
  });

  it('updates persistedActiveFilePath when renaming the active file', () => {
    useEditorStore.getState().openTab('/a.md', 'a.md', 'content');
    useEditorStore.getState().renameTab('/a.md', '/b.md');

    expect(useEditorStore.getState().persistedActiveFilePath).toBe('/b.md');
  });
});

describe('updateFilePaths', () => {
  it('rewrites all paths with matching prefix', () => {
    useEditorStore.getState().openTab('/old/dir/a.md', 'a.md', 'a');
    useEditorStore.getState().openTab('/old/dir/b.md', 'b.md', 'b');
    useEditorStore.getState().openTab('/other/c.md', 'c.md', 'c');
    useEditorStore.getState().setScrollPosition('/old/dir/a.md', 0.3);

    useEditorStore.getState().updateFilePaths('/old/dir', '/new/dir');

    const state = useEditorStore.getState();
    expect(state.openDocuments[0].filePath).toBe('/new/dir/a.md');
    expect(state.openDocuments[1].filePath).toBe('/new/dir/b.md');
    expect(state.openDocuments[2].filePath).toBe('/other/c.md');
    // Last opened tab was /other/c.md which doesn't match prefix, so stays as-is
    expect(state.persistedActiveFilePath).toBe('/other/c.md');
    expect(state.scrollPositions['/new/dir/a.md']).toBe(0.3);
    expect(state.scrollPositions['/old/dir/a.md']).toBeUndefined();
  });

  it('does not modify paths that do not match prefix', () => {
    useEditorStore.getState().openTab('/keep/x.md', 'x.md', 'x');
    useEditorStore.getState().updateFilePaths('/other', '/changed');

    expect(getTab('/keep/x.md')).toBeDefined();
  });
});

describe('viewMode', () => {
  it('setViewMode changes the tab view mode', () => {
    useEditorStore.getState().openTab('/a.md', 'a.md', 'content');
    const tabId = getTab('/a.md')!.id;

    useEditorStore.getState().setViewMode(tabId, 'source');

    expect(getTabById(tabId)!.viewMode).toBe('source');
  });

  it('toggleViewMode switches between wysiwyg and source', () => {
    useEditorStore.getState().openTab('/a.md', 'a.md', 'content');
    const tabId = getTab('/a.md')!.id;

    // Default is undefined, toggle should go to source
    useEditorStore.getState().toggleViewMode(tabId);
    expect(getTabById(tabId)!.viewMode).toBe('source');

    useEditorStore.getState().toggleViewMode(tabId);
    expect(getTabById(tabId)!.viewMode).toBe('wysiwyg');
  });
});

describe('copilot toggle', () => {
  it('toggleCopilotForTab toggles copilotDisabled', () => {
    useEditorStore.getState().openTab('/a.md', 'a.md', 'content');
    const tabId = getTab('/a.md')!.id;

    expect(getTabById(tabId)!.copilotDisabled).toBeFalsy();

    useEditorStore.getState().toggleCopilotForTab(tabId);
    expect(getTabById(tabId)!.copilotDisabled).toBe(true);

    useEditorStore.getState().toggleCopilotForTab(tabId);
    expect(getTabById(tabId)!.copilotDisabled).toBe(false);
  });
});

describe('reorderTab', () => {
  it('reorders tabs by moving a tab from one index to another', () => {
    useEditorStore.getState().openTab('/a.md', 'a.md', 'a');
    useEditorStore.getState().openTab('/b.md', 'b.md', 'b');
    useEditorStore.getState().openTab('/c.md', 'c.md', 'c');
    useEditorStore.getState().openTab('/d.md', 'd.md', 'd');

    // Move tab at index 0 (a) to index 2
    useEditorStore.getState().reorderTab(0, 2);

    const paths = useEditorStore.getState().openDocuments.map((t) => t.filePath);
    expect(paths).toEqual(['/b.md', '/c.md', '/a.md', '/d.md']);
  });

  it('no-op when fromIndex equals toIndex', () => {
    useEditorStore.getState().openTab('/a.md', 'a.md', 'a');
    useEditorStore.getState().openTab('/b.md', 'b.md', 'b');

    useEditorStore.getState().reorderTab(1, 1);

    const paths = useEditorStore.getState().openDocuments.map((t) => t.filePath);
    expect(paths).toEqual(['/a.md', '/b.md']);
  });

  it('does not change activeTabId', () => {
    useEditorStore.getState().openTab('/a.md', 'a.md', 'a');
    useEditorStore.getState().openTab('/b.md', 'b.md', 'b');
    useEditorStore.getState().openTab('/c.md', 'c.md', 'c');
    const activeId = useEditorStore.getState().activeTabId;

    useEditorStore.getState().reorderTab(0, 2);

    expect(useEditorStore.getState().activeTabId).toBe(activeId);
  });

  it('updates persistedTabs order to match', () => {
    useEditorStore.getState().openTab('/a.md', 'a.md', 'a');
    useEditorStore.getState().openTab('/b.md', 'b.md', 'b');
    useEditorStore.getState().openTab('/c.md', 'c.md', 'c');

    useEditorStore.getState().reorderTab(2, 0);

    const persistedPaths = useEditorStore.getState().persistedTabs.map((p) => p.filePath);
    expect(persistedPaths).toEqual(['/c.md', '/a.md', '/b.md']);
  });

  it('moving last tab to first position works', () => {
    useEditorStore.getState().openTab('/a.md', 'a.md', 'a');
    useEditorStore.getState().openTab('/b.md', 'b.md', 'b');
    useEditorStore.getState().openTab('/c.md', 'c.md', 'c');

    useEditorStore.getState().reorderTab(2, 0);

    const paths = useEditorStore.getState().openDocuments.map((t) => t.filePath);
    expect(paths).toEqual(['/c.md', '/a.md', '/b.md']);
  });
});

describe('lastSavedAt tracking', () => {
  it('updateTabContent stamps lastSavedAt on dirty → clean transition', () => {
    useEditorStore.getState().openTab('/a.md', 'a.md', 'content');
    const tabId = getTab('/a.md')!.id;
    useEditorStore.getState().updateTabContent(tabId, 'dirty content', true);
    expect(getTabById(tabId)!.lastSavedAt).toBeUndefined();

    const before = Date.now();
    useEditorStore.getState().updateTabContent(tabId, 'saved content', false);
    const after = Date.now();

    const stamped = getTabById(tabId)!.lastSavedAt;
    expect(stamped).toBeDefined();
    expect(stamped!).toBeGreaterThanOrEqual(before);
    expect(stamped!).toBeLessThanOrEqual(after);
  });

  it('updateTabContent with isDirty=true does NOT update lastSavedAt', () => {
    useEditorStore.getState().openTab('/a.md', 'a.md', 'content');
    const tabId = getTab('/a.md')!.id;

    useEditorStore.getState().updateTabContent(tabId, 'modified', true);

    expect(getTabById(tabId)!.lastSavedAt).toBeUndefined();
  });

  it('updateTabContent with clean → clean does NOT update lastSavedAt', () => {
    useEditorStore.getState().openTab('/a.md', 'a.md', 'content');
    const tabId = getTab('/a.md')!.id;

    useEditorStore.getState().updateTabContent(tabId, 'content', false);

    expect(getTabById(tabId)!.lastSavedAt).toBeUndefined();
  });

  it('markTabClean stamps lastSavedAt when transitioning from dirty', () => {
    useEditorStore.getState().openTab('/a.md', 'a.md', 'content');
    const tabId = getTab('/a.md')!.id;
    useEditorStore.getState().updateTabContent(tabId, 'dirty', true);

    const before = Date.now();
    useEditorStore.getState().markTabClean(tabId);
    const after = Date.now();

    const stamped = getTabById(tabId)!.lastSavedAt;
    expect(stamped).toBeDefined();
    expect(stamped!).toBeGreaterThanOrEqual(before);
    expect(stamped!).toBeLessThanOrEqual(after);
  });
});

describe('scroll-to targets', () => {
  it('setScrollToTag sets and clears scrollToTag', () => {
    useEditorStore.getState().openTab('/a.md', 'a.md', 'content');
    const tabId = getTab('/a.md')!.id;

    useEditorStore.getState().setScrollToTag(tabId, { tag: 'todo', occurrence: 1 });
    expect(getTabById(tabId)!.scrollToTag).toEqual({ tag: 'todo', occurrence: 1 });

    useEditorStore.getState().setScrollToTag(tabId, undefined);
    expect(getTabById(tabId)!.scrollToTag).toBeUndefined();
  });

  it('setScrollToText sets and clears scrollToText', () => {
    useEditorStore.getState().openTab('/a.md', 'a.md', 'content');
    const tabId = getTab('/a.md')!.id;

    useEditorStore.getState().setScrollToText(tabId, 'find this');
    expect(getTabById(tabId)!.scrollToText).toBe('find this');

    useEditorStore.getState().setScrollToText(tabId, undefined);
    expect(getTabById(tabId)!.scrollToText).toBeUndefined();
  });
});
