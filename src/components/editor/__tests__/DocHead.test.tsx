// @vitest-environment jsdom

import '@/test/tauri-mock';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderWithProviders, registerDefaultHandlers, act } from '@/test/component-harness';
import { DocHead, buildBreadcrumb } from '@/components/editor/DocHead';
import { useEditorStore } from '@/stores/editor-store';
import { useWorkspaceStore } from '@/stores/workspace-store';
import { useSettingsStore } from '@/stores/settings-store';

function resetStores(notesRoot = '/Users/test/Notesage') {
  useEditorStore.setState({
    tabs: [],
    activeTabId: null,
    recentFiles: [],
    scrollPositions: {},
    externalChanges: {},
    pendingCloseTabId: null,
    persistedTabs: [],
    persistedActiveFilePath: null,
  });
  useWorkspaceStore.setState({
    explorerFolders: [],
    projects: [],
    recentProjects: [],
    notesTree: [],
    expandedFolders: new Set<string>(),
    explorerCollapsed: false,
    projectsCollapsed: false,
    notesCollapsed: false,
  });
  useSettingsStore.setState({ notesRootPath: notesRoot });
}

function openTab(path: string, fileName: string, overrides: { isDirty?: boolean; lastSavedAt?: number } = {}) {
  const id = 'tab-' + path;
  useEditorStore.setState((s) => ({
    tabs: [
      ...s.tabs,
      {
        id,
        filePath: path,
        fileName,
        isDirty: overrides.isDirty ?? false,
        content: '',
        contentLoaded: true,
        frontmatter: null,
        fileType: 'markdown',
        lastSavedAt: overrides.lastSavedAt,
      },
    ],
    activeTabId: id,
  }));
  return id;
}

describe('buildBreadcrumb', () => {
  it('returns root-only segment when filePath is null', () => {
    const segments = buildBreadcrumb(null, { projects: [], libraryRoot: null });
    expect(segments).toEqual([{ kind: 'root', label: 'Notesage' }]);
  });

  it('resolves file inside a known project', () => {
    const segments = buildBreadcrumb('/Users/test/Work/Alpha/notes/idea.md', {
      projects: [{ path: '/Users/test/Work/Alpha' }],
      libraryRoot: '/Users/test/Notesage',
    });
    expect(segments.map((s) => [s.kind, s.label])).toEqual([
      ['root', 'Notesage'],
      ['project', 'Alpha'],
      ['folder', 'notes'],
      ['file', 'idea.md'],
    ]);
  });

  it('resolves file inside the library root', () => {
    const segments = buildBreadcrumb('/Users/test/Notesage/quick.md', {
      projects: [],
      libraryRoot: '/Users/test/Notesage',
    });
    expect(segments.map((s) => [s.kind, s.label])).toEqual([
      ['root', 'Notesage'],
      ['library', 'Library'],
      ['file', 'quick.md'],
    ]);
  });

  it('falls back to top-level folder for orphan files', () => {
    const segments = buildBreadcrumb('/Random/foo/bar.md', {
      projects: [],
      libraryRoot: '/Users/test/Notesage',
    });
    expect(segments.map((s) => [s.kind, s.label])).toEqual([
      ['root', 'Notesage'],
      ['folder', 'Random'],
      ['folder', 'foo'],
      ['file', 'bar.md'],
    ]);
  });

  it('collapses middle folders when chain exceeds 4 segments', () => {
    const segments = buildBreadcrumb('/proj/a/b/c/d/e/f/file.md', {
      projects: [{ path: '/proj' }],
      libraryRoot: null,
    });
    const kinds = segments.map((s) => s.kind);
    expect(kinds[0]).toBe('root');
    expect(kinds[1]).toBe('project');
    expect(kinds.includes('collapsed')).toBe(true);
    expect(segments[segments.length - 1]).toEqual({ kind: 'file', label: 'file.md' });
    expect(segments.find((s) => s.kind === 'collapsed')?.label).toBe('\u2026');
  });

  it('prefers the most specific (longest) matching project', () => {
    const segments = buildBreadcrumb('/work/parent/child/file.md', {
      projects: [{ path: '/work/parent' }, { path: '/work/parent/child' }],
      libraryRoot: null,
    });
    expect(segments[1]).toEqual({ kind: 'project', label: 'child' });
    // The anchor is "/work/parent/child", so the file is the only tail segment.
    expect(segments[segments.length - 1]).toEqual({ kind: 'file', label: 'file.md' });
  });
});

describe('DocHead', () => {
  beforeEach(() => {
    registerDefaultHandlers();
    resetStores();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders Notesage / <project> / <file.md> when active tab is in a project', () => {
    useWorkspaceStore.setState({ projects: [{ path: '/Users/test/Work/Alpha', fileTree: [] }] });
    openTab('/Users/test/Work/Alpha/idea.md', 'idea.md');

    const { container } = renderWithProviders(<DocHead />);
    const text = container.textContent ?? '';
    expect(text).toContain('Notesage');
    expect(text).toContain('Alpha');
    expect(text).toContain('idea.md');
  });

  it('renders Notesage / Library / <file.md> when active tab is under ~/Notesage', () => {
    openTab('/Users/test/Notesage/ideas/brainstorm.md', 'brainstorm.md');

    const { container } = renderWithProviders(<DocHead />);
    const text = container.textContent ?? '';
    expect(text).toContain('Library');
    expect(text).toContain('brainstorm.md');
  });

  it('renders dirty dot when tab.isDirty is true', () => {
    openTab('/Users/test/Notesage/file.md', 'file.md', { isDirty: true });

    renderWithProviders(<DocHead />);
    const dot = document.querySelector('[role="status"][aria-label="Unsaved changes"]');
    expect(dot).toBeTruthy();
  });

  it('hides saved timer when tab is dirty', () => {
    openTab('/Users/test/Notesage/file.md', 'file.md', {
      isDirty: true,
      lastSavedAt: Date.now() - 3000,
    });

    const { container } = renderWithProviders(<DocHead />);
    expect(container.textContent ?? '').not.toContain('saved');
  });

  it('renders "saved Ns ago" within the last minute', () => {
    openTab('/Users/test/Notesage/file.md', 'file.md', {
      isDirty: false,
      lastSavedAt: Date.now() - 3_000,
    });

    const { container } = renderWithProviders(<DocHead />);
    expect(container.textContent ?? '').toMatch(/saved \ds ago/);
  });

  it('updates the saved label as time advances (fake timers)', () => {
    vi.useFakeTimers();
    const start = new Date('2026-04-22T12:00:00Z').getTime();
    vi.setSystemTime(start);
    openTab('/Users/test/Notesage/file.md', 'file.md', {
      isDirty: false,
      lastSavedAt: start,
    });

    const { container } = renderWithProviders(<DocHead />);
    expect(container.textContent ?? '').toContain('saved 0s ago');

    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    expect(container.textContent ?? '').toContain('saved 10s ago');
  });

  it('renders em-dash placeholder when lastSavedAt is undefined', () => {
    openTab('/Users/test/Notesage/file.md', 'file.md', { isDirty: false });

    const { container } = renderWithProviders(<DocHead />);
    expect(container.textContent ?? '').toContain('\u2014');
  });

  it('roots the header with data-doc-head and reserves the 130px right zone', () => {
    openTab('/Users/test/Notesage/file.md', 'file.md');

    const { container } = renderWithProviders(<DocHead />);
    expect(container.querySelector('[data-doc-head]')).toBeTruthy();
    const reserved = container.querySelector('[data-doc-head-reserved]') as HTMLElement | null;
    expect(reserved).toBeTruthy();
    expect(reserved?.style.width).toBe('130px');
  });

  it('renders Notesage root only when there is no active tab', () => {
    const { container } = renderWithProviders(<DocHead />);
    const text = container.textContent ?? '';
    expect(text).toContain('Notesage');
    expect(container.querySelector('[data-doc-head-reserved]')).toBeTruthy();
    expect(container.querySelector('[role="status"][aria-label="Unsaved changes"]')).toBeNull();
  });

  it('collapses folder chain past 4 middles with …', () => {
    useWorkspaceStore.setState({ projects: [{ path: '/proj', fileTree: [] }] });
    openTab('/proj/a/b/c/d/e/f/deep.md', 'deep.md');

    const { container } = renderWithProviders(<DocHead />);
    expect(container.textContent ?? '').toContain('\u2026');
    expect(container.textContent ?? '').toContain('deep.md');
  });
});
