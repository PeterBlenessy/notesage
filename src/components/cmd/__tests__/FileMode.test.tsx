// @vitest-environment jsdom

import '@/test/tauri-mock';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act } from 'react';
import {
  renderWithProviders,
  screen,
  fireEvent,
  waitFor,
} from '@/test/component-harness';
import {
  setMockInvokeHandler,
  registerDefaultHandlers,
} from '@/test/tauri-mock';
import FileMode from '@/components/cmd/modes/FileMode';
import { useEditorStore } from '@/stores/editor-store';
import { useSettingsStore } from '@/stores/settings-store';
import { useWorkspaceStore } from '@/stores/workspace-store';
import { useChatStore } from '@/stores/chat-store';

// ---------------------------------------------------------------------------
// FileMode picker tests (PRD `2026-04-28-cmd-bar-verb-prefixes`, #8/#9/#10/#12).
//
// Covers the picker's own behavior in isolation:
//   - empty filter → MRU empty-state from `editor-store.recentFiles`
//   - non-empty filter → backend query against `index_search_filenames`
//   - hidden-files filter (frontend-side, controlled by `settings.showHiddenFiles`)
//   - `.DS_Store` always excluded
//   - scope filter limits MRU to entries inside the active scope
//   - Enter/click invokes `openFile` (verified via the stubbed Tauri command)
// ---------------------------------------------------------------------------

const openedFiles: string[] = [];

const openFileMock = vi.fn(async (path: string, _name: string) => {
  openedFiles.push(path);
});

vi.mock('@/hooks/useFileOperations', () => ({
  useFileOperations: () => ({
    openFile: openFileMock,
    openFileAtTag: vi.fn(),
    openFileAtText: vi.fn(),
    saveFile: vi.fn(),
    createFile: vi.fn(),
    createFolder: vi.fn(),
    renamePath: vi.fn(),
    deletePath: vi.fn(),
    refreshFileTree: vi.fn(),
  }),
}));

beforeEach(() => {
  registerDefaultHandlers();
  openedFiles.length = 0;
  openFileMock.mockClear();
  // Reset every store touched by FileMode so each test starts clean.
  useEditorStore.setState({
    openDocuments: [],
    activeTabId: null,
    recentFiles: [],
    persistedTabs: [],
  });
  useWorkspaceStore.setState({
    explorerFolders: [],
    projects: [],
    recentProjects: [],
    notesTree: [],
    pinnedFiles: [],
  });
  useSettingsStore.setState({ showHiddenFiles: false });
  // Default chat scope = no projects selected → resolveSearchPaths
  // falls back to all-indexed paths. Tests that need a specific
  // scope set the conv's projectPaths explicitly.
  useChatStore.setState({ conversations: [], activeConversationId: null });
});

// ---------------------------------------------------------------------------
// Empty filter → MRU empty-state
// ---------------------------------------------------------------------------

describe('FileMode — MRU empty-state (#10)', () => {
  it('renders the no-recent-files empty-state when MRU is empty', async () => {
    renderWithProviders(<FileMode filter="" />);
    await waitFor(() => {
      expect(screen.getByText(/No recent files/i)).not.toBeNull();
    });
  });

  it('renders MRU entries when recentFiles has matching paths', async () => {
    useWorkspaceStore.setState({
      projects: [
        { path: '/p/alpha', fileTree: [] },
      ],
    });
    useEditorStore.setState({
      recentFiles: [
        { path: '/p/alpha/notes.md', name: 'notes.md', lastAccessedAt: Date.now() },
        { path: '/p/alpha/todo.md', name: 'todo.md', lastAccessedAt: Date.now() },
      ],
    });
    renderWithProviders(<FileMode filter="" />);
    await waitFor(() => {
      expect(screen.getByText('notes.md')).not.toBeNull();
      expect(screen.getByText('todo.md')).not.toBeNull();
    });
  });

  it('excludes MRU entries outside the active scope (#9)', async () => {
    useWorkspaceStore.setState({
      projects: [
        { path: '/p/alpha', fileTree: [] },
      ],
    });
    useEditorStore.setState({
      recentFiles: [
        { path: '/p/alpha/notes.md', name: 'notes.md', lastAccessedAt: Date.now() },
        { path: '/elsewhere/secret.md', name: 'secret.md', lastAccessedAt: Date.now() },
      ],
    });
    renderWithProviders(<FileMode filter="" />);
    await waitFor(() => {
      expect(screen.getByText('notes.md')).not.toBeNull();
    });
    expect(screen.queryByText('secret.md')).toBeNull();
  });

  it('excludes dotfiles from MRU when showHiddenFiles is false', async () => {
    useWorkspaceStore.setState({
      projects: [{ path: '/p/alpha', fileTree: [] }],
    });
    useEditorStore.setState({
      recentFiles: [
        { path: '/p/alpha/notes.md', name: 'notes.md', lastAccessedAt: Date.now() },
        { path: '/p/alpha/.hidden.md', name: '.hidden.md', lastAccessedAt: Date.now() },
      ],
    });
    renderWithProviders(<FileMode filter="" />);
    await waitFor(() => {
      expect(screen.getByText('notes.md')).not.toBeNull();
    });
    expect(screen.queryByText('.hidden.md')).toBeNull();
  });

  it('includes dotfiles in MRU when showHiddenFiles is true', async () => {
    useWorkspaceStore.setState({
      projects: [{ path: '/p/alpha', fileTree: [] }],
    });
    useEditorStore.setState({
      recentFiles: [
        { path: '/p/alpha/notes.md', name: 'notes.md', lastAccessedAt: Date.now() },
        { path: '/p/alpha/.hidden.md', name: '.hidden.md', lastAccessedAt: Date.now() },
      ],
    });
    useSettingsStore.setState({ showHiddenFiles: true });
    renderWithProviders(<FileMode filter="" />);
    await waitFor(() => {
      expect(screen.getByText('.hidden.md')).not.toBeNull();
    });
  });

  it('always excludes .DS_Store from MRU', async () => {
    useWorkspaceStore.setState({
      projects: [{ path: '/p/alpha', fileTree: [] }],
    });
    useEditorStore.setState({
      recentFiles: [
        { path: '/p/alpha/notes.md', name: 'notes.md', lastAccessedAt: Date.now() },
        { path: '/p/alpha/.DS_Store', name: '.DS_Store', lastAccessedAt: Date.now() },
      ],
    });
    useSettingsStore.setState({ showHiddenFiles: true });
    renderWithProviders(<FileMode filter="" />);
    await waitFor(() => {
      expect(screen.getByText('notes.md')).not.toBeNull();
    });
    expect(screen.queryByText('.DS_Store')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Non-empty filter → backend query
// ---------------------------------------------------------------------------

describe('FileMode — backend search (#8 + #9)', () => {
  it('queries index_search_filenames after a filter is typed', async () => {
    useWorkspaceStore.setState({
      projects: [{ path: '/p/alpha', fileTree: [] }],
    });
    let receivedQuery = '';
    setMockInvokeHandler('index_search_filenames', (args: unknown) => {
      const { query } = args as { query: string };
      receivedQuery = query;
      return [
        { path: '/p/alpha/README.md', file_name: 'README.md', parent_dir: '/p/alpha', project_root: '/p/alpha' },
      ];
    });
    renderWithProviders(<FileMode filter="readme" />);
    await waitFor(() => {
      expect(screen.getByText('README.md')).not.toBeNull();
    });
    expect(receivedQuery).toBe('readme');
  });

  it('renders the no-match empty-state with hidden-files hint', async () => {
    setMockInvokeHandler('index_search_filenames', () => []);
    renderWithProviders(<FileMode filter="zzzznomatch" />);
    await waitFor(() => {
      expect(screen.getByText(/No files matching/i)).not.toBeNull();
    });
    expect(screen.getByText(/Hidden files are excluded/i)).not.toBeNull();
  });

  it('filters out dotfile results when showHiddenFiles is false', async () => {
    setMockInvokeHandler('index_search_filenames', () => [
      { path: '/p/alpha/notes.md', file_name: 'notes.md', parent_dir: '/p/alpha', project_root: '/p/alpha' },
      { path: '/p/alpha/.env', file_name: '.env', parent_dir: '/p/alpha', project_root: '/p/alpha' },
    ]);
    renderWithProviders(<FileMode filter="env" />);
    await waitFor(() => {
      expect(screen.getByText('notes.md')).not.toBeNull();
    });
    expect(screen.queryByText('.env')).toBeNull();
  });

  it('includes dotfile results when showHiddenFiles is true', async () => {
    setMockInvokeHandler('index_search_filenames', () => [
      { path: '/p/alpha/.env', file_name: '.env', parent_dir: '/p/alpha', project_root: '/p/alpha' },
    ]);
    useSettingsStore.setState({ showHiddenFiles: true });
    renderWithProviders(<FileMode filter="env" />);
    await waitFor(() => {
      expect(screen.getByText('.env')).not.toBeNull();
    });
  });

  it('always excludes .DS_Store from search results', async () => {
    setMockInvokeHandler('index_search_filenames', () => [
      { path: '/p/alpha/notes.md', file_name: 'notes.md', parent_dir: '/p/alpha', project_root: '/p/alpha' },
      { path: '/p/alpha/.DS_Store', file_name: '.DS_Store', parent_dir: '/p/alpha', project_root: '/p/alpha' },
    ]);
    useSettingsStore.setState({ showHiddenFiles: true });
    renderWithProviders(<FileMode filter="store" />);
    await waitFor(() => {
      expect(screen.getByText('notes.md')).not.toBeNull();
    });
    expect(screen.queryByText('.DS_Store')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Selection wiring
// ---------------------------------------------------------------------------

describe('FileMode — selection (#8)', () => {
  it('opens a file via openFile when the row is clicked', async () => {
    setMockInvokeHandler('index_search_filenames', () => [
      { path: '/p/alpha/notes.md', file_name: 'notes.md', parent_dir: '/p/alpha', project_root: '/p/alpha' },
    ]);
    renderWithProviders(<FileMode filter="notes" />);
    const button = await screen.findByRole('option', { name: /notes\.md/i });
    act(() => {
      fireEvent.click(button);
    });
    expect(openFileMock).toHaveBeenCalledWith('/p/alpha/notes.md', 'notes.md');
    expect(openedFiles).toEqual(['/p/alpha/notes.md']);
  });

  it('opens the highlighted file on Enter key', async () => {
    setMockInvokeHandler('index_search_filenames', () => [
      { path: '/p/alpha/notes.md', file_name: 'notes.md', parent_dir: '/p/alpha', project_root: '/p/alpha' },
    ]);
    renderWithProviders(<FileMode filter="notes" />);
    await screen.findByRole('option', { name: /notes\.md/i });
    act(() => {
      fireEvent.keyDown(document, { key: 'Enter' });
    });
    expect(openedFiles).toEqual(['/p/alpha/notes.md']);
  });

  // -------------------------------------------------------------------------
  // #88 — active row styling: muted bg + accent border replaces solid fill
  // -------------------------------------------------------------------------

  it('active row uses muted bg with accent border instead of solid accent fill (#88)', async () => {
    setMockInvokeHandler('index_search_filenames', () => [
      { path: '/p/alpha/notes.md', file_name: 'notes.md', parent_dir: '/p/alpha', project_root: '/p/alpha' },
    ]);
    renderWithProviders(<FileMode filter="notes" />);
    await waitFor(() => {
      expect(screen.queryByRole('option', { name: /notes\.md/i })).toBeTruthy();
    });
    const activeRow = screen.getByRole('option', { name: /notes\.md/i });
    // New styling
    expect(activeRow.classList.contains('bg-muted')).toBe(true);
    expect(activeRow.className).toContain('border-[var(--color-accent-primary)]');
    expect(activeRow.classList.contains('text-foreground')).toBe(true);
    // Old solid accent fill must be gone
    expect(activeRow.className).not.toContain('bg-[var(--color-accent-primary)]');
  });
});
