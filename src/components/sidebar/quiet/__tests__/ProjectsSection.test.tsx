// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  renderWithProviders,
  screen,
  fireEvent,
  waitFor,
  setMockInvokeHandler,
} from '@/test/component-harness';
import { ProjectsSection, countMarkdownFiles } from '../ProjectsSection';
import { useWorkspaceStore, type WorkspaceProject } from '@/stores/workspace-store';
import { useEditorStore } from '@/stores/editor-store';
import type { FileEntry } from '@/lib/tauri';

// ----------------------------------------------------------------------------
// Test helpers
// ----------------------------------------------------------------------------

function makeFile(name: string, path: string): FileEntry {
  return { name, path, is_directory: false, hidden: name.startsWith('.') };
}

function makeDir(name: string, path: string, children: FileEntry[] = []): FileEntry {
  return {
    name,
    path,
    is_directory: true,
    children,
    hidden: name.startsWith('.'),
  };
}

function setProjects(projects: WorkspaceProject[]): void {
  useWorkspaceStore.setState({ projects });
}

function resetStores(): void {
  useWorkspaceStore.setState({
    explorerFolders: [],
    projects: [],
    recentProjects: [],
    notesTree: [],
  });
  useEditorStore.setState({
    tabs: [],
    activeTabId: null,
    persistedTabs: [],
    persistedActiveFilePath: null,
  });
}

beforeEach(() => {
  resetStores();
});

// ----------------------------------------------------------------------------
// countMarkdownFiles — pure helper
// ----------------------------------------------------------------------------

describe('countMarkdownFiles', () => {
  it('counts only .md files and skips directories / other file types', () => {
    const tree: FileEntry[] = [
      makeFile('a.md', '/p/a.md'),
      makeFile('image.png', '/p/image.png'),
      makeFile('report.pdf', '/p/report.pdf'),
      makeDir('sub', '/p/sub', []),
    ];
    expect(countMarkdownFiles(tree)).toBe(1);
  });

  it('walks nested directories recursively', () => {
    const tree: FileEntry[] = [
      makeFile('root.md', '/p/root.md'),
      makeDir('notes', '/p/notes', [
        makeFile('a.md', '/p/notes/a.md'),
        makeFile('b.md', '/p/notes/b.md'),
        makeDir('deep', '/p/notes/deep', [
          makeFile('c.md', '/p/notes/deep/c.md'),
        ]),
      ]),
    ];
    expect(countMarkdownFiles(tree)).toBe(4);
  });

  it('is case-insensitive on the .md extension', () => {
    const tree: FileEntry[] = [
      makeFile('A.MD', '/p/A.MD'),
      makeFile('b.Md', '/p/b.Md'),
      makeFile('c.md', '/p/c.md'),
    ];
    expect(countMarkdownFiles(tree)).toBe(3);
  });

  it('returns 0 for an empty tree', () => {
    expect(countMarkdownFiles([])).toBe(0);
  });
});

// ----------------------------------------------------------------------------
// ProjectsSection — rendering
// ----------------------------------------------------------------------------

describe('ProjectsSection (quiet variant)', () => {
  it('renders the uppercase "Projects" heading', () => {
    renderWithProviders(<ProjectsSection />);
    const heading = screen.getByRole('heading', { level: 2, name: /projects/i });
    expect(heading.textContent).toBe('Projects');
    expect(heading.className).toMatch(/uppercase/);
  });

  it('renders an accessible add-button', () => {
    renderWithProviders(<ProjectsSection onAdd={vi.fn()} />);
    const btn = screen.getByRole('button', { name: /add project/i });
    expect(btn).toBeTruthy();
  });

  it('calls onAdd when the add-button is clicked', () => {
    const onAdd = vi.fn();
    renderWithProviders(<ProjectsSection onAdd={onAdd} />);
    fireEvent.click(screen.getByRole('button', { name: /add project/i }));
    expect(onAdd).toHaveBeenCalledTimes(1);
  });

  it('renders no rows when the projects list is empty (header only)', () => {
    renderWithProviders(<ProjectsSection />);
    // Only the "Add project" button — no row buttons.
    expect(screen.queryByRole('button', { name: /open project/i })).toBeNull();
  });

  it('renders a row per project with the basename and file count', () => {
    setProjects([
      {
        path: '/Users/me/Notesage/alpha',
        fileTree: [
          makeFile('README.md', '/Users/me/Notesage/alpha/README.md'),
          makeFile('note.md', '/Users/me/Notesage/alpha/note.md'),
        ],
      },
      {
        path: '/Users/me/Notesage/beta',
        fileTree: [
          makeFile('one.md', '/Users/me/Notesage/beta/one.md'),
          makeFile('image.png', '/Users/me/Notesage/beta/image.png'),
        ],
      },
    ]);

    renderWithProviders(<ProjectsSection />);

    const alpha = screen.getByRole('button', { name: /open project alpha \(2 files\)/i });
    const beta = screen.getByRole('button', { name: /open project beta \(1 file\)/i });

    expect(alpha.textContent).toMatch(/alpha/);
    expect(alpha.textContent).toMatch(/2/);
    expect(beta.textContent).toMatch(/beta/);
    expect(beta.textContent).toMatch(/1/);
  });

  it('counts .md files recursively through nested folders', () => {
    setProjects([
      {
        path: '/Users/me/Notesage/deep',
        fileTree: [
          makeDir('notes', '/Users/me/Notesage/deep/notes', [
            makeFile('a.md', '/Users/me/Notesage/deep/notes/a.md'),
            makeDir('sub', '/Users/me/Notesage/deep/notes/sub', [
              makeFile('b.md', '/Users/me/Notesage/deep/notes/sub/b.md'),
              makeFile('c.md', '/Users/me/Notesage/deep/notes/sub/c.md'),
            ]),
          ]),
        ],
      },
    ]);

    renderWithProviders(<ProjectsSection />);

    const row = screen.getByRole('button', { name: /open project deep \(3 files\)/i });
    expect(row.textContent).toMatch(/3/);
  });

  it('hides the file count when the project fileTree has not been hydrated yet', () => {
    setProjects([{ path: '/Users/me/Notesage/pending', fileTree: [] }]);

    renderWithProviders(<ProjectsSection />);

    // aria-label should be the "no count" variant.
    const row = screen.getByRole('button', { name: /^open project pending$/i });
    // Nothing "0" in the trailing position — the row text must not end with 0.
    expect(row.textContent?.trim()).toBe('pending');
  });

  it('marks the row for the active tab with aria-current="true"', () => {
    setProjects([
      { path: '/Users/me/Notesage/alpha', fileTree: [makeFile('note.md', '/Users/me/Notesage/alpha/note.md')] },
      { path: '/Users/me/Notesage/beta', fileTree: [makeFile('note.md', '/Users/me/Notesage/beta/note.md')] },
    ]);
    useEditorStore.setState({
      tabs: [
        {
          id: 't1',
          filePath: '/Users/me/Notesage/beta/note.md',
          fileName: 'note.md',
          isDirty: false,
          content: '',
          frontmatter: null,
          fileType: 'markdown',
          contentLoaded: true,
        },
      ],
      activeTabId: 't1',
    });

    renderWithProviders(<ProjectsSection />);

    const alpha = screen.getByRole('button', { name: /open project alpha/i });
    const beta = screen.getByRole('button', { name: /open project beta/i });
    expect(alpha.getAttribute('aria-current')).toBeNull();
    expect(beta.getAttribute('aria-current')).toBe('true');
  });

  it('opens README.md when present on click', async () => {
    const readFile = vi.fn(() => '# Hello world');
    setMockInvokeHandler('read_file', readFile as (args?: Record<string, unknown>) => unknown);

    setProjects([
      {
        path: '/Users/me/Notesage/alpha',
        fileTree: [
          makeFile('note.md', '/Users/me/Notesage/alpha/note.md'),
          makeFile('README.md', '/Users/me/Notesage/alpha/README.md'),
        ],
      },
    ]);

    renderWithProviders(<ProjectsSection />);
    fireEvent.click(screen.getByRole('button', { name: /open project alpha/i }));

    await waitFor(() => {
      expect(readFile).toHaveBeenCalledWith(
        expect.objectContaining({ path: '/Users/me/Notesage/alpha/README.md' })
      );
    });

    await waitFor(() => {
      const tabs = useEditorStore.getState().tabs;
      expect(tabs).toHaveLength(1);
      expect(tabs[0].filePath).toBe('/Users/me/Notesage/alpha/README.md');
      expect(tabs[0].fileName).toBe('README.md');
    });
  });

  it('falls back to the first .md file when no README exists', async () => {
    const readFile = vi.fn(() => 'body');
    setMockInvokeHandler('read_file', readFile as (args?: Record<string, unknown>) => unknown);

    setProjects([
      {
        path: '/Users/me/Notesage/alpha',
        fileTree: [
          makeFile('image.png', '/Users/me/Notesage/alpha/image.png'),
          makeDir('notes', '/Users/me/Notesage/alpha/notes', [
            makeFile('first.md', '/Users/me/Notesage/alpha/notes/first.md'),
            makeFile('second.md', '/Users/me/Notesage/alpha/notes/second.md'),
          ]),
        ],
      },
    ]);

    renderWithProviders(<ProjectsSection />);
    fireEvent.click(screen.getByRole('button', { name: /open project alpha/i }));

    await waitFor(() => {
      expect(readFile).toHaveBeenCalledWith(
        expect.objectContaining({ path: '/Users/me/Notesage/alpha/notes/first.md' })
      );
    });

    await waitFor(() => {
      const tabs = useEditorStore.getState().tabs;
      expect(tabs).toHaveLength(1);
      expect(tabs[0].filePath).toBe('/Users/me/Notesage/alpha/notes/first.md');
    });
  });

  it('is a no-op when the project has no markdown files', async () => {
    const readFile = vi.fn(() => '');
    setMockInvokeHandler('read_file', readFile as (args?: Record<string, unknown>) => unknown);

    setProjects([
      {
        path: '/Users/me/Notesage/empty',
        fileTree: [makeFile('image.png', '/Users/me/Notesage/empty/image.png')],
      },
    ]);

    renderWithProviders(<ProjectsSection />);
    fireEvent.click(screen.getByRole('button', { name: /open project empty/i }));

    // No read_file invocation, no tab opened.
    expect(readFile).not.toHaveBeenCalled();
    expect(useEditorStore.getState().tabs).toHaveLength(0);
  });
});
