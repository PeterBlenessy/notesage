// @vitest-environment jsdom

/**
 * Audit 2026-11-22 §3 — sidebar tree rows must not re-render when the section
 * re-renders for a reason that does not concern them.
 *
 * Both sections subscribe to the active tab, so every tab switch re-renders
 * the section. Before the fix that re-rendered EVERY visible child row (fresh
 * `row` object, inline handlers and an inline ref callback per row). The rows
 * are now behind a `memo` boundary with stable props, so only the rows whose
 * own state changed (here: the one that became the active document) render.
 *
 * `SidebarRowIndicators` renders once per row render, so a counting stand-in
 * for it is the probe.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act } from 'react';
import { renderWithProviders, screen, fireEvent } from '@/test/component-harness';
import { ProjectsSection } from '../ProjectsSection';
import { FoldersSection } from '../FoldersSection';
import { useWorkspaceStore } from '@/stores/workspace-store';
import { useEditorStore } from '@/stores/editor-store';
import { useSettingsStore } from '@/stores/settings-store';
import type { FileEntry } from '@/lib/tauri';

const renderCounts = new Map<string, number>();

vi.mock('@/components/sidebar/quiet/SidebarRowIndicators', () => ({
  SidebarRowIndicators: ({ path }: { path: string }) => {
    renderCounts.set(path, (renderCounts.get(path) ?? 0) + 1);
    return null;
  },
}));

vi.mock('@/hooks/useFileOperations', () => ({
  useFileOperations: vi.fn(() => ({
    openFile: vi.fn(),
    openFileAtTag: vi.fn(),
    openFileAtText: vi.fn(),
    saveFile: vi.fn(),
    createFile: vi.fn(),
    createFolder: vi.fn(),
    renamePath: vi.fn(),
    deletePath: vi.fn(),
    refreshFileTree: vi.fn(),
  })),
}));

function makeFile(name: string, path: string): FileEntry {
  return { name, path, is_directory: false, hidden: false };
}

const ROOT = '/Users/me/Notesage/alpha';
const A = `${ROOT}/a.md`;
const B = `${ROOT}/b.md`;
const C = `${ROOT}/c.md`;
const tree: FileEntry[] = [makeFile('a.md', A), makeFile('b.md', B), makeFile('c.md', C)];

function setActiveDocument(path: string): void {
  act(() => {
    useEditorStore.setState({
      openDocuments: [{ id: 't1', filePath: path }],
      activeTabId: 't1',
    } as Parameters<typeof useEditorStore.setState>[0]);
  });
}

beforeEach(() => {
  renderCounts.clear();
  useWorkspaceStore.setState({
    explorerFolders: [],
    projects: [],
    recentProjects: [],
    notesTree: [],
  });
  useEditorStore.setState({
    openDocuments: [],
    activeTabId: null,
    persistedTabs: [],
    persistedActiveFilePath: null,
  });
  useSettingsStore.setState({ showHiddenFiles: false });
});

describe('sidebar tree rows are memoized', () => {
  it('ProjectsSection: a tab switch re-renders only the row that became active', () => {
    useWorkspaceStore.setState({ projects: [{ path: ROOT, fileTree: tree }] });
    renderWithProviders(<ProjectsSection />);
    fireEvent.keyDown(screen.getByRole('treeitem', { name: /open project alpha/i }), {
      key: 'ArrowRight',
    });
    expect(screen.getByRole('treeitem', { name: /open file b\.md/i })).toBeTruthy();

    renderCounts.clear();
    setActiveDocument(A);

    expect(screen.getByRole('treeitem', { name: /open file a\.md/i }).getAttribute('aria-current')).toBe('page');
    expect(renderCounts.get(A) ?? 0).toBeGreaterThan(0);
    expect(renderCounts.get(B) ?? 0).toBe(0);
    expect(renderCounts.get(C) ?? 0).toBe(0);
  });

  it('ProjectsSection: keyboard navigation still follows the current row order after memoization', () => {
    useWorkspaceStore.setState({ projects: [{ path: ROOT, fileTree: tree }] });
    renderWithProviders(<ProjectsSection />);
    fireEvent.keyDown(screen.getByRole('treeitem', { name: /open project alpha/i }), {
      key: 'ArrowRight',
    });
    const a = screen.getByRole('treeitem', { name: /open file a\.md/i });
    a.focus();
    fireEvent.keyDown(a, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(screen.getByRole('treeitem', { name: /open file b\.md/i }));

    // The tree changes under the rows: the stable handler must see the new order.
    act(() => {
      useWorkspaceStore.setState({
        projects: [{ path: ROOT, fileTree: [tree[0], makeFile('aa.md', `${ROOT}/aa.md`), tree[1], tree[2]] }],
      });
    });
    const a2 = screen.getByRole('treeitem', { name: /open file a\.md/i });
    a2.focus();
    fireEvent.keyDown(a2, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(screen.getByRole('treeitem', { name: /open file aa\.md/i }));
  });

  it('FoldersSection: a tab switch re-renders only the row that became active', () => {
    useWorkspaceStore.setState({ explorerFolders: [{ path: ROOT, fileTree: tree }] });
    renderWithProviders(<FoldersSection />);
    fireEvent.keyDown(screen.getByRole('treeitem', { name: /external folder.*alpha/i }), {
      key: 'ArrowRight',
    });
    expect(screen.getByRole('treeitem', { name: /open file b\.md/i })).toBeTruthy();

    renderCounts.clear();
    setActiveDocument(A);

    expect(screen.getByRole('treeitem', { name: /open file a\.md/i }).getAttribute('aria-current')).toBe('page');
    expect(renderCounts.get(A) ?? 0).toBeGreaterThan(0);
    expect(renderCounts.get(B) ?? 0).toBe(0);
    expect(renderCounts.get(C) ?? 0).toBe(0);
  });
});
