// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach } from 'vitest';
import userEvent from '@testing-library/user-event';
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
import { useSettingsStore } from '@/stores/settings-store';
import type { FileEntry } from '@/lib/tauri';

// ----------------------------------------------------------------------------
// useFileOperations mock — rename wiring (#40) asserts against renamePath;
// inline create (#41) asserts against createFile + openFile; project-create
// (#42) asserts against createFolder.
// ----------------------------------------------------------------------------

const mockRenamePath = vi.fn();
const mockCreateFile = vi.fn();
const mockCreateFolder = vi.fn();
const mockOpenFile = vi.fn();

vi.mock('@/hooks/useFileOperations', () => ({
  useFileOperations: vi.fn(() => ({
    openFile: mockOpenFile,
    openFileAtTag: vi.fn(),
    openFileAtText: vi.fn(),
    saveFile: vi.fn(),
    createFile: mockCreateFile,
    createFolder: mockCreateFolder,
    renamePath: mockRenamePath,
    deletePath: vi.fn(),
    refreshFileTree: vi.fn(),
  })),
}));

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
    openDocuments: [],
    activeTabId: null,
    persistedTabs: [],
    persistedActiveFilePath: null,
  });
  useSettingsStore.setState({ showHiddenFiles: false });
}

beforeEach(() => {
  resetStores();
  mockRenamePath.mockReset();
  mockRenamePath.mockResolvedValue(true);
  mockCreateFile.mockReset();
  mockCreateFile.mockResolvedValue('/Users/me/Notesage/alpha/new.md');
  mockCreateFolder.mockReset();
  mockCreateFolder.mockResolvedValue('/Users/me/Notesage/new-project');
  mockOpenFile.mockReset();
  mockOpenFile.mockResolvedValue(undefined);
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

  // Regression lock for sidebar audit 2026-04-27 finding #11.
  // The `+` add-button in the section header is `opacity-0` by default
  // and only appears on hover/focus-within. Leaving it Tab-focusable
  // caused a "phantom + appears" effect — Tab from a project row
  // jumped to the (previously invisible) `+`, and the user couldn't
  // tell whether focus was on a folder or on the add-button. The fix
  // sets `tabIndex={-1}` so the `+` is excluded from the natural Tab
  // order. Mouse users keep the hover-reveal `+`; keyboard users
  // create new projects via ⌘⇧N.
  it('excludes the add-button from the Tab order (tabIndex=-1)', () => {
    renderWithProviders(<ProjectsSection onAdd={vi.fn()} />);
    const btn = screen.getByRole('button', { name: /add project/i });
    expect(btn.getAttribute('tabindex')).toBe('-1');
  });

  it('renders no rows when the projects list is empty (header only)', () => {
    renderWithProviders(<ProjectsSection />);
    // Only the "Add project" button — no project treeitems.
    expect(screen.queryByRole('treeitem', { name: /open project/i })).toBeNull();
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

    const alpha = screen.getByRole('treeitem', { name: /open project alpha \(2 files\)/i });
    const beta = screen.getByRole('treeitem', { name: /open project beta \(1 file\)/i });

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

    const row = screen.getByRole('treeitem', { name: /open project deep \(3 files\)/i });
    expect(row.textContent).toMatch(/3/);
  });

  it('hides the file count when the project fileTree has not been hydrated yet', () => {
    setProjects([{ path: '/Users/me/Notesage/pending', fileTree: [] }]);

    renderWithProviders(<ProjectsSection />);

    // aria-label should be the "no count" variant.
    const row = screen.getByRole('treeitem', { name: /^open project pending$/i });
    // Nothing "0" in the trailing position — the row text must not end with 0.
    expect(row.textContent?.trim()).toBe('pending');
  });

  it('marks the row for the active tab with aria-current="true"', () => {
    setProjects([
      { path: '/Users/me/Notesage/alpha', fileTree: [makeFile('note.md', '/Users/me/Notesage/alpha/note.md')] },
      { path: '/Users/me/Notesage/beta', fileTree: [makeFile('note.md', '/Users/me/Notesage/beta/note.md')] },
    ]);
    useEditorStore.setState({
      openDocuments: [
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

    const alpha = screen.getByRole('treeitem', { name: /open project alpha/i });
    const beta = screen.getByRole('treeitem', { name: /open project beta/i });
    expect(alpha.getAttribute('aria-current')).toBeNull();
    expect(beta.getAttribute('aria-current')).toBe('true');
  });

  // Live-test 2026-04-28 finding #1 — click on a project row now
  // toggles inline-expand instead of opening the README. README is
  // still reachable via right-click "Open" (which calls openProject).
  // The previous click-opens-README tests are replaced by a single
  // toggle-expand assertion below; the README open flow is still
  // covered by the context-menu test suite for the right-click path.
  it('clicking a project row toggles inline-expand (sidebar live #1)', async () => {
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
    const row = screen.getByRole('treeitem', { name: /open project alpha/i });
    expect(row.getAttribute('aria-expanded')).toBe('false');

    fireEvent.click(row);
    expect(
      screen.getByRole('treeitem', { name: /open project alpha/i })
        .getAttribute('aria-expanded'),
    ).toBe('true');

    fireEvent.click(screen.getByRole('treeitem', { name: /open project alpha/i }));
    expect(
      screen.getByRole('treeitem', { name: /open project alpha/i })
        .getAttribute('aria-expanded'),
    ).toBe('false');
  });

  it.skip('is a no-op when the project has no markdown files', async () => {
    const readFile = vi.fn(() => '');
    setMockInvokeHandler('read_file', readFile as (args?: Record<string, unknown>) => unknown);

    setProjects([
      {
        path: '/Users/me/Notesage/empty',
        fileTree: [makeFile('image.png', '/Users/me/Notesage/empty/image.png')],
      },
    ]);

    renderWithProviders(<ProjectsSection />);
    fireEvent.click(screen.getByRole('treeitem', { name: /open project empty/i }));

    // No read_file invocation, no tab opened.
    expect(readFile).not.toHaveBeenCalled();
    expect(useEditorStore.getState().openDocuments).toHaveLength(0);
  });
});

// ----------------------------------------------------------------------------
// Keyboard navigation — task #37
// ----------------------------------------------------------------------------

// useTreeOverlayStore was removed by sidebar-simplification task #20.

describe('ProjectsSection — keyboard navigation (#37)', () => {
  beforeEach(() => {
    // tree-overlay-store was removed in sidebar-simplification task #20.
    // Nothing to reset here; left as an anchor for the per-test setup
    // pattern in case other resets get added later.
  });

  // Children land in derivePeekChildren order:
  //   folders alphabetical: ["docs"]
  //   files alphabetical (case-insensitive): ["note.md", "README.md"]
  // so the rendered row sequence is: alpha, docs, note.md, README.md, …
  const projectWithChildren: WorkspaceProject = {
    path: '/Users/me/Notesage/alpha',
    fileTree: [
      makeDir('docs', '/Users/me/Notesage/alpha/docs', [
        makeFile('intro.md', '/Users/me/Notesage/alpha/docs/intro.md'),
      ]),
      makeFile('README.md', '/Users/me/Notesage/alpha/README.md'),
      makeFile('note.md', '/Users/me/Notesage/alpha/note.md'),
    ],
  };

  const secondProject: WorkspaceProject = {
    path: '/Users/me/Notesage/beta',
    fileTree: [makeFile('beta.md', '/Users/me/Notesage/beta/beta.md')],
  };

  it('ArrowRight on a collapsed project sets aria-expanded="true" and renders children', () => {
    setProjects([projectWithChildren]);
    renderWithProviders(<ProjectsSection />);

    const row = screen.getByRole('treeitem', {
      name: /open project alpha/i,
    }) as HTMLElement;
    expect(row.getAttribute('aria-expanded')).toBe('false');

    fireEvent.keyDown(row, { key: 'ArrowRight' });

    const expanded = screen.getByRole('treeitem', {
      name: /open project alpha/i,
    });
    expect(expanded.getAttribute('aria-expanded')).toBe('true');

    // Children rendered inline: a folder ("docs") and two files.
    expect(screen.getByRole('treeitem', { name: /open folder docs/i })).toBeTruthy();
    expect(screen.getByRole('treeitem', { name: /open file README\.md/i })).toBeTruthy();
    expect(screen.getByRole('treeitem', { name: /open file note\.md/i })).toBeTruthy();
  });

  // Sidebar-simplification task #3 polish — collapsed projects render
  // a closed-folder glyph; expanded projects swap to the open-folder
  // glyph. This is the visual mirror of `aria-expanded` for sighted
  // keyboard users (screen readers already announce the state). Lucide
  // ships both icons with stable `lucide-folder` / `lucide-folder-open`
  // classes on the rendered SVG.
  it('swaps Folder ↔ FolderOpen icon on expand/collapse', () => {
    setProjects([projectWithChildren]);
    const { container } = renderWithProviders(<ProjectsSection />);

    const row = screen.getByRole('treeitem', {
      name: /open project alpha/i,
    }) as HTMLElement;

    // Collapsed: closed-folder glyph rendered, open-folder absent.
    expect(row.querySelector('.lucide-folder')).toBeTruthy();
    expect(row.querySelector('.lucide-folder-open')).toBeNull();

    fireEvent.keyDown(row, { key: 'ArrowRight' });

    // Re-query the row — React re-rendered.
    const expandedRow = screen.getByRole('treeitem', {
      name: /open project alpha/i,
    }) as HTMLElement;
    expect(expandedRow.querySelector('.lucide-folder-open')).toBeTruthy();
    expect(expandedRow.querySelector('.lucide-folder:not(.lucide-folder-open)')).toBeNull();

    // Touch `container` to silence the unused-variable lint — the
    // `screen.getByRole` queries above are the actual assertions.
    expect(container).toBeTruthy();
  });

  // Sidebar-simplification task #3 polish — `ArrowRight` on a project
  // with NO children must NOT enter the expanded state. Without this
  // guard the project would render `aria-expanded="true"` and the
  // open-folder glyph but show no body, which is a confusing dead-end
  // for keyboard users.
  it('ArrowRight on a project with no children is a no-op (no phantom expand state)', () => {
    const emptyProject: WorkspaceProject = {
      path: '/Users/me/Notesage/empty',
      fileTree: [],
    };
    setProjects([emptyProject]);
    renderWithProviders(<ProjectsSection />);

    const row = screen.getByRole('treeitem', {
      name: /open project empty/i,
    }) as HTMLElement;
    expect(row.getAttribute('aria-expanded')).toBe('false');

    fireEvent.keyDown(row, { key: 'ArrowRight' });

    // aria-expanded stays false — no phantom expand state was written.
    expect(row.getAttribute('aria-expanded')).toBe('false');
  });

  it('ArrowRight on an expanded project moves focus to the first child', () => {
    setProjects([projectWithChildren]);
    renderWithProviders(<ProjectsSection />);

    const row = screen.getByRole('treeitem', { name: /open project alpha/i });
    fireEvent.keyDown(row, { key: 'ArrowRight' }); // expand
    fireEvent.keyDown(row, { key: 'ArrowRight' }); // descend

    const firstChild = screen.getByRole('treeitem', { name: /open folder docs/i });
    expect(document.activeElement).toBe(firstChild);
  });

  it('ArrowLeft on an expanded project collapses it', () => {
    setProjects([projectWithChildren]);
    renderWithProviders(<ProjectsSection />);

    const row = screen.getByRole('treeitem', { name: /open project alpha/i });
    fireEvent.keyDown(row, { key: 'ArrowRight' }); // expand
    expect(row.getAttribute('aria-expanded')).toBe('true');
    fireEvent.keyDown(row, { key: 'ArrowLeft' });
    expect(row.getAttribute('aria-expanded')).toBe('false');
    // Children gone.
    expect(screen.queryByRole('treeitem', { name: /open folder docs/i })).toBeNull();
  });

  it('ArrowLeft on a collapsed project is a no-op', () => {
    setProjects([projectWithChildren]);
    renderWithProviders(<ProjectsSection />);

    const row = screen.getByRole('treeitem', { name: /open project alpha/i });
    expect(row.getAttribute('aria-expanded')).toBe('false');
    fireEvent.keyDown(row, { key: 'ArrowLeft' });
    // Still collapsed, still only one treeitem visible.
    expect(row.getAttribute('aria-expanded')).toBe('false');
    expect(screen.getAllByRole('treeitem')).toHaveLength(1);
  });

  it('ArrowLeft on a focused child row moves focus back to the parent project', () => {
    setProjects([projectWithChildren]);
    renderWithProviders(<ProjectsSection />);

    const row = screen.getByRole('treeitem', { name: /open project alpha/i });
    fireEvent.keyDown(row, { key: 'ArrowRight' });
    fireEvent.keyDown(row, { key: 'ArrowRight' }); // focus first child

    const firstChild = screen.getByRole('treeitem', { name: /open folder docs/i });
    expect(document.activeElement).toBe(firstChild);

    fireEvent.keyDown(firstChild, { key: 'ArrowLeft' });
    expect(document.activeElement).toBe(row);
  });

  it('ArrowDown / ArrowUp walk visible rows including expanded children', () => {
    setProjects([projectWithChildren, secondProject]);
    renderWithProviders(<ProjectsSection />);

    const alpha = screen.getByRole('treeitem', { name: /open project alpha/i });
    const beta = screen.getByRole('treeitem', { name: /open project beta/i });

    // Collapsed: ArrowDown from alpha → beta.
    fireEvent.keyDown(alpha, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(beta);

    fireEvent.keyDown(beta, { key: 'ArrowUp' });
    expect(document.activeElement).toBe(alpha);

    // Expand alpha → docs / note.md / README.md intervene between alpha and beta
    // (folders first, then files in case-insensitive alphabetical order).
    fireEvent.keyDown(alpha, { key: 'ArrowRight' });
    fireEvent.keyDown(alpha, { key: 'ArrowDown' });
    const docs = screen.getByRole('treeitem', { name: /open folder docs/i });
    expect(document.activeElement).toBe(docs);

    // From the last child, ArrowDown should reach project beta.
    const readme = screen.getByRole('treeitem', { name: /open file README\.md/i });
    fireEvent.keyDown(readme, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(beta);

    // ArrowUp from beta lands back on README.md.
    fireEvent.keyDown(beta, { key: 'ArrowUp' });
    expect(document.activeElement).toBe(readme);
  });

  it('Enter on a child file row opens the file via read_file', async () => {
    const readFile = vi.fn(() => '# body');
    setMockInvokeHandler('read_file', readFile as (args?: Record<string, unknown>) => unknown);

    setProjects([projectWithChildren]);
    renderWithProviders(<ProjectsSection />);

    const row = screen.getByRole('treeitem', { name: /open project alpha/i });
    fireEvent.keyDown(row, { key: 'ArrowRight' });
    fireEvent.keyDown(row, { key: 'ArrowRight' }); // focus docs

    const docs = screen.getByRole('treeitem', { name: /open folder docs/i });
    // Walk down from docs → first file (note.md, case-insensitive sort).
    fireEvent.keyDown(docs, { key: 'ArrowDown' });
    const note = screen.getByRole('treeitem', { name: /open file note\.md/i });
    expect(document.activeElement).toBe(note);

    fireEvent.keyDown(note, { key: 'Enter' });

    await waitFor(() => {
      expect(readFile).toHaveBeenCalledWith(
        expect.objectContaining({ path: '/Users/me/Notesage/alpha/note.md' })
      );
    });
    await waitFor(() => {
      const tabs = useEditorStore.getState().openDocuments;
      expect(tabs).toHaveLength(1);
      expect(tabs[0].filePath).toBe('/Users/me/Notesage/alpha/note.md');
    });
  });

  // Sidebar-simplification task #20 — Enter on a child folder used to
  // open TreeOverlay (now deleted). Today it's a silent no-op until
  // the multi-level inline-expand follow-up lands. Test asserts the
  // no-op so a future implementation can flip the assertion in one
  // place.
  it('Enter on a child folder row is a no-op (multi-level inline expand TBD)', () => {
    setProjects([projectWithChildren]);
    renderWithProviders(<ProjectsSection />);

    const row = screen.getByRole('treeitem', { name: /open project alpha/i });
    fireEvent.keyDown(row, { key: 'ArrowRight' });
    fireEvent.keyDown(row, { key: 'ArrowRight' }); // focus docs

    const docs = screen.getByRole('treeitem', { name: /open folder docs/i });
    fireEvent.keyDown(docs, { key: 'Enter' });

    // Silent no-op: focus stays on the folder row, no extra rows
    // rendered, no error thrown.
    expect(
      screen.getByRole('treeitem', { name: /open folder docs/i }),
    ).toBeTruthy();
  });

  it('filters projects by basename substring when `filter` is provided (#43)', () => {
    setProjects([
      { path: '/Users/me/Notesage/alpha', fileTree: [] },
      { path: '/Users/me/Notesage/beta', fileTree: [] },
      { path: '/Users/me/Notesage/alphabet-soup', fileTree: [] },
    ]);
    renderWithProviders(<ProjectsSection filter="alpha" />);
    expect(screen.getByRole('treeitem', { name: /open project alpha$/i })).toBeTruthy();
    expect(
      screen.getByRole('treeitem', { name: /open project alphabet-soup/i }),
    ).toBeTruthy();
    expect(screen.queryByRole('treeitem', { name: /open project beta/i })).toBeNull();
  });

  it('renders no rows when no project matches the filter (#43)', () => {
    setProjects([
      { path: '/Users/me/Notesage/alpha', fileTree: [] },
      { path: '/Users/me/Notesage/beta', fileTree: [] },
    ]);
    renderWithProviders(<ProjectsSection filter="zzz" />);
    expect(screen.queryByRole('treeitem')).toBeNull();
  });

  it('empty filter passes through all projects (#43)', () => {
    setProjects([
      { path: '/Users/me/Notesage/alpha', fileTree: [] },
      { path: '/Users/me/Notesage/beta', fileTree: [] },
    ]);
    renderWithProviders(<ProjectsSection filter="" />);
    expect(screen.getAllByRole('treeitem')).toHaveLength(2);
  });

  it('renders children that match the FolderPeek hover popover listing', () => {
    // Mix of hidden entries + varied casing + files + folders to exercise
    // the shared `derivePeekChildren` contract inside the inline expansion.
    const project: WorkspaceProject = {
      path: '/Users/me/Notesage/alpha',
      fileTree: [
        makeFile('.hidden.md', '/Users/me/Notesage/alpha/.hidden.md'),
        makeFile('.DS_Store', '/Users/me/Notesage/alpha/.DS_Store'),
        makeFile('zeta.md', '/Users/me/Notesage/alpha/zeta.md'),
        makeDir('Beta', '/Users/me/Notesage/alpha/Beta'),
        makeDir('alpha-dir', '/Users/me/Notesage/alpha/alpha-dir'),
        makeFile('alpha.md', '/Users/me/Notesage/alpha/alpha.md'),
      ],
    };
    setProjects([project]);
    renderWithProviders(<ProjectsSection />);
    const row = screen.getByRole('treeitem', { name: /open project alpha/i });
    fireEvent.keyDown(row, { key: 'ArrowRight' });

    // Folders first (alpha-dir, Beta), files second (alpha.md, zeta.md),
    // hidden entries filtered out.
    const names = screen
      .getAllByRole('treeitem')
      .filter((el) => el.getAttribute('aria-level') === '2')
      .map((el) => el.textContent?.trim());
    expect(names).toEqual(['alpha-dir', 'Beta', 'alpha.md', 'zeta.md']);
  });
});

// ----------------------------------------------------------------------------
// Task #40 — inline rename for child file rows
// ----------------------------------------------------------------------------

describe('ProjectsSection — inline rename (#40)', () => {
  const project: WorkspaceProject = {
    path: '/Users/me/Notesage/alpha',
    fileTree: [
      makeFile('note.md', '/Users/me/Notesage/alpha/note.md'),
      makeDir('docs', '/Users/me/Notesage/alpha/docs', [
        makeFile('intro.md', '/Users/me/Notesage/alpha/docs/intro.md'),
      ]),
    ],
  };

  it('F2 on an expanded child file row enters rename mode', async () => {
    setProjects([project]);
    renderWithProviders(<ProjectsSection />);

    const projectRow = screen.getByRole('treeitem', {
      name: /open project alpha/i,
    });
    fireEvent.keyDown(projectRow, { key: 'ArrowRight' }); // expand

    const noteRow = screen.getByRole('treeitem', {
      name: /open file note\.md/i,
    }) as HTMLElement;
    noteRow.focus();
    fireEvent.keyDown(noteRow, { key: 'F2' });

    const input = (await screen.findByLabelText(/rename/i)) as HTMLInputElement;
    expect(input.value).toBe('note.md');
  });

  it('F2 on a project row DOES enter rename mode (updated for #89)', async () => {
    setProjects([project]);
    renderWithProviders(<ProjectsSection />);

    const projectRow = screen.getByRole('treeitem', {
      name: /open project alpha/i,
    });
    projectRow.focus();
    fireEvent.keyDown(projectRow, { key: 'F2' });

    // Project-root rename was added in issue #89.
    const input = (await screen.findByLabelText(/rename/i)) as HTMLInputElement;
    expect(input.value).toBe('alpha');
  });

  it('F2 on a folder child row does NOT enter rename mode', () => {
    setProjects([project]);
    renderWithProviders(<ProjectsSection />);

    const projectRow = screen.getByRole('treeitem', {
      name: /open project alpha/i,
    });
    fireEvent.keyDown(projectRow, { key: 'ArrowRight' });

    const folderRow = screen.getByRole('treeitem', {
      name: /open folder docs/i,
    }) as HTMLElement;
    folderRow.focus();
    fireEvent.keyDown(folderRow, { key: 'F2' });

    expect(screen.queryByLabelText(/rename/i)).toBeNull();
  });

  it('double-click on a child file row enters rename mode (and does not open)', async () => {
    setProjects([project]);
    renderWithProviders(<ProjectsSection />);

    const projectRow = screen.getByRole('treeitem', {
      name: /open project alpha/i,
    });
    fireEvent.keyDown(projectRow, { key: 'ArrowRight' });

    const noteRow = screen.getByRole('treeitem', {
      name: /open file note\.md/i,
    }) as HTMLElement;
    fireEvent.click(noteRow, { detail: 2 });

    const input = await screen.findByLabelText(/rename/i);
    expect(input).toBeTruthy();
    // Should not open the file (no new tab created).
    expect(useEditorStore.getState().openDocuments).toHaveLength(0);
  });

  it('commits the rename by calling renamePath', async () => {
    const user = userEvent.setup();
    setProjects([project]);
    renderWithProviders(<ProjectsSection />);

    const projectRow = screen.getByRole('treeitem', {
      name: /open project alpha/i,
    });
    fireEvent.keyDown(projectRow, { key: 'ArrowRight' });

    const noteRow = screen.getByRole('treeitem', {
      name: /open file note\.md/i,
    }) as HTMLElement;
    noteRow.focus();
    fireEvent.keyDown(noteRow, { key: 'F2' });

    const input = (await screen.findByLabelText(/rename/i)) as HTMLInputElement;
    await user.clear(input);
    await user.type(input, 'renamed.md{Enter}');

    await waitFor(() => {
      expect(mockRenamePath).toHaveBeenCalledWith(
        '/Users/me/Notesage/alpha/note.md',
        '/Users/me/Notesage/alpha/renamed.md',
      );
    });
  });

  it('Escape cancels rename on a child file row', async () => {
    setProjects([project]);
    renderWithProviders(<ProjectsSection />);

    const projectRow = screen.getByRole('treeitem', {
      name: /open project alpha/i,
    });
    fireEvent.keyDown(projectRow, { key: 'ArrowRight' });

    const noteRow = screen.getByRole('treeitem', {
      name: /open file note\.md/i,
    }) as HTMLElement;
    noteRow.focus();
    fireEvent.keyDown(noteRow, { key: 'F2' });

    const input = await screen.findByLabelText(/rename/i);
    fireEvent.keyDown(input, { key: 'Escape' });

    await waitFor(() => {
      expect(screen.queryByLabelText(/rename/i)).toBeNull();
    });
    expect(mockRenamePath).not.toHaveBeenCalled();
  });

  it('SIDEBAR_ENTER_RENAME_MODE_EVENT on a visible child file path enters rename mode', async () => {
    setProjects([project]);
    renderWithProviders(<ProjectsSection />);

    // Expand the project so note.md is visible.
    const projectRow = screen.getByRole('treeitem', {
      name: /open project alpha/i,
    });
    fireEvent.keyDown(projectRow, { key: 'ArrowRight' });

    window.dispatchEvent(
      new CustomEvent('sidebar:enter-rename-mode', {
        detail: { filePath: '/Users/me/Notesage/alpha/note.md' },
      }),
    );

    const input = await screen.findByLabelText(/rename/i);
    expect(input).toBeTruthy();
  });

  it('SIDEBAR_ENTER_RENAME_MODE_EVENT on a NON-visible path is ignored', async () => {
    setProjects([project]);
    renderWithProviders(<ProjectsSection />);
    // Project is NOT expanded → note.md is not a visible row yet.

    window.dispatchEvent(
      new CustomEvent('sidebar:enter-rename-mode', {
        detail: { filePath: '/Users/me/Notesage/alpha/note.md' },
      }),
    );

    expect(screen.queryByLabelText(/rename/i)).toBeNull();
  });
});

// ----------------------------------------------------------------------------
// Task #62 — folder double-click rename
// ----------------------------------------------------------------------------

describe('ProjectsSection — folder double-click rename (#62)', () => {
  const project: WorkspaceProject = {
    path: '/Users/me/Notesage/alpha',
    fileTree: [
      makeFile('note.md', '/Users/me/Notesage/alpha/note.md'),
      makeDir('docs', '/Users/me/Notesage/alpha/docs', [
        makeFile('intro.md', '/Users/me/Notesage/alpha/docs/intro.md'),
      ]),
    ],
  };

  it('double-clicking a directory child row renders SidebarInlineEdit with the folder basename', async () => {
    setProjects([project]);
    renderWithProviders(<ProjectsSection />);

    const projectRow = screen.getByRole('treeitem', {
      name: /open project alpha/i,
    });
    fireEvent.keyDown(projectRow, { key: 'ArrowRight' }); // expand

    const folderRow = screen.getByRole('treeitem', {
      name: /open folder docs/i,
    }) as HTMLElement;
    fireEvent.click(folderRow, { detail: 2 });

    const input = (await screen.findByLabelText(/rename/i)) as HTMLInputElement;
    expect(input.value).toBe('docs');
    // Must NOT open the folder.
    expect(mockOpenFile).not.toHaveBeenCalled();
  });

  it('committing a folder rename calls renamePath with the new folder path', async () => {
    const user = userEvent.setup();
    setProjects([project]);
    renderWithProviders(<ProjectsSection />);

    const projectRow = screen.getByRole('treeitem', {
      name: /open project alpha/i,
    });
    fireEvent.keyDown(projectRow, { key: 'ArrowRight' });

    const folderRow = screen.getByRole('treeitem', {
      name: /open folder docs/i,
    }) as HTMLElement;
    fireEvent.click(folderRow, { detail: 2 });

    const input = (await screen.findByLabelText(/rename/i)) as HTMLInputElement;
    await user.clear(input);
    await user.type(input, 'documents{Enter}');

    await waitFor(() => {
      expect(mockRenamePath).toHaveBeenCalledWith(
        '/Users/me/Notesage/alpha/docs',
        '/Users/me/Notesage/alpha/documents',
      );
    });
  });

  it('Escape cancels folder rename without calling renamePath', async () => {
    setProjects([project]);
    renderWithProviders(<ProjectsSection />);

    const projectRow = screen.getByRole('treeitem', {
      name: /open project alpha/i,
    });
    fireEvent.keyDown(projectRow, { key: 'ArrowRight' });

    const folderRow = screen.getByRole('treeitem', {
      name: /open folder docs/i,
    }) as HTMLElement;
    fireEvent.click(folderRow, { detail: 2 });

    const input = await screen.findByLabelText(/rename/i);
    fireEvent.keyDown(input, { key: 'Escape' });

    await waitFor(() => {
      expect(screen.queryByLabelText(/rename/i)).toBeNull();
    });
    expect(mockRenamePath).not.toHaveBeenCalled();
  });

  it('double-clicking a project-root row DOES render SidebarInlineEdit with the project basename', async () => {
    setProjects([project]);
    renderWithProviders(<ProjectsSection />);

    const projectRow = screen.getByRole('treeitem', {
      name: /open project alpha/i,
    }) as HTMLElement;
    fireEvent.click(projectRow, { detail: 2 });

    const input = (await screen.findByLabelText(/rename/i)) as HTMLInputElement;
    expect(input.value).toBe('alpha');
    // Double-click must NOT open the project.
    expect(mockOpenFile).not.toHaveBeenCalled();
  });

  it('SIDEBAR_ENTER_RENAME_MODE_EVENT on a visible folder path enters rename mode', async () => {
    setProjects([project]);
    renderWithProviders(<ProjectsSection />);

    // Expand the project so docs/ is visible.
    const projectRow = screen.getByRole('treeitem', {
      name: /open project alpha/i,
    });
    fireEvent.keyDown(projectRow, { key: 'ArrowRight' });

    window.dispatchEvent(
      new CustomEvent('sidebar:enter-rename-mode', {
        detail: { filePath: '/Users/me/Notesage/alpha/docs' },
      }),
    );

    const input = await screen.findByLabelText(/rename/i);
    expect(input).toBeTruthy();
  });

  it('renaming a folder named "my.folder" preserves no extension (treated as directory)', async () => {
    const user = userEvent.setup();
    const projectWithDottedFolder: WorkspaceProject = {
      path: '/Users/me/Notesage/alpha',
      fileTree: [
        makeDir('my.folder', '/Users/me/Notesage/alpha/my.folder'),
      ],
    };
    setProjects([projectWithDottedFolder]);
    renderWithProviders(<ProjectsSection />);

    const projectRow = screen.getByRole('treeitem', {
      name: /open project alpha/i,
    });
    fireEvent.keyDown(projectRow, { key: 'ArrowRight' });

    const folderRow = screen.getByRole('treeitem', {
      name: /open folder my\.folder/i,
    }) as HTMLElement;
    fireEvent.click(folderRow, { detail: 2 });

    const input = (await screen.findByLabelText(/rename/i)) as HTMLInputElement;
    await user.clear(input);
    await user.type(input, 'my-folder{Enter}');

    await waitFor(() => {
      // isDirectory=true → resolveRenamePath must NOT preserve ".folder" extension
      expect(mockRenamePath).toHaveBeenCalledWith(
        '/Users/me/Notesage/alpha/my.folder',
        '/Users/me/Notesage/alpha/my-folder',
      );
    });
  });
});

// ----------------------------------------------------------------------------
// Task #41 — inline create note
// ----------------------------------------------------------------------------

import { useQuietSidebarStore } from '@/stores/quiet-sidebar-store';

describe('ProjectsSection — inline create (#41)', () => {
  const alpha: WorkspaceProject = {
    path: '/Users/me/Notesage/alpha',
    fileTree: [
      makeFile('note.md', '/Users/me/Notesage/alpha/note.md'),
      makeDir('docs', '/Users/me/Notesage/alpha/docs', [
        makeFile('intro.md', '/Users/me/Notesage/alpha/docs/intro.md'),
      ]),
    ],
  };

  beforeEach(() => {
    useQuietSidebarStore.setState({ pendingCreate: null });
  });

  it('renders a per-row + button with the new-note aria label', () => {
    setProjects([alpha]);
    renderWithProviders(<ProjectsSection />);
    expect(
      screen.getByRole('button', { name: /new note in alpha/i }),
    ).toBeTruthy();
  });

  it('per-row + button is visually hidden by default (opacity-0)', () => {
    setProjects([alpha]);
    renderWithProviders(<ProjectsSection />);
    const btn = screen.getByRole('button', { name: /new note in alpha/i });
    expect(btn.className).toMatch(/opacity-0/);
    expect(btn.className).toMatch(/group-hover\/row:opacity-100/);
  });

  it('clicking the per-row + button sets pending create at the project root', () => {
    setProjects([alpha]);
    renderWithProviders(<ProjectsSection />);
    const btn = screen.getByRole('button', { name: /new note in alpha/i });
    fireEvent.click(btn);
    expect(useQuietSidebarStore.getState().pendingCreate).toEqual({
      parentDir: '/Users/me/Notesage/alpha',
    });
  });

  it('clicking the per-row + button does NOT open the project (stopPropagation)', () => {
    setProjects([alpha]);
    renderWithProviders(<ProjectsSection />);
    const btn = screen.getByRole('button', { name: /new note in alpha/i });
    fireEvent.click(btn);
    expect(useEditorStore.getState().openDocuments).toHaveLength(0);
  });

  it('auto-expands the project and renders the inline create input when pending is set', async () => {
    setProjects([alpha]);
    renderWithProviders(<ProjectsSection />);

    // Project starts collapsed.
    const row = screen.getByRole('treeitem', { name: /open project alpha/i });
    expect(row.getAttribute('aria-expanded')).toBe('false');

    useQuietSidebarStore.getState().setPendingCreate({
      parentDir: '/Users/me/Notesage/alpha',
    });

    // After state update, project expands and the create input appears.
    await waitFor(() => {
      expect(row.getAttribute('aria-expanded')).toBe('true');
    });
    const input = (await screen.findByLabelText(/create/i)) as HTMLInputElement;
    expect(input.value).toBe('');
    expect(input.placeholder).toBe('note.md');
  });

  it('commits by calling createFile with .md appended and then openFile', async () => {
    const user = userEvent.setup();
    setProjects([alpha]);
    renderWithProviders(<ProjectsSection />);

    useQuietSidebarStore.getState().setPendingCreate({
      parentDir: '/Users/me/Notesage/alpha',
    });

    const input = (await screen.findByLabelText(/create/i)) as HTMLInputElement;
    await user.type(input, 'draft{Enter}');

    await waitFor(() => {
      expect(mockCreateFile).toHaveBeenCalledWith(
        '/Users/me/Notesage/alpha',
        'draft.md',
      );
    });
    await waitFor(() => {
      expect(mockOpenFile).toHaveBeenCalledWith(
        '/Users/me/Notesage/alpha/draft.md',
        'draft.md',
      );
    });
    // Pending signal cleared after commit.
    expect(useQuietSidebarStore.getState().pendingCreate).toBeNull();
  });

  it('preserves an explicit extension when the user types one', async () => {
    const user = userEvent.setup();
    setProjects([alpha]);
    renderWithProviders(<ProjectsSection />);

    useQuietSidebarStore.getState().setPendingCreate({
      parentDir: '/Users/me/Notesage/alpha',
    });
    const input = await screen.findByLabelText(/create/i);
    await user.type(input, 'notes.txt{Enter}');

    await waitFor(() => {
      expect(mockCreateFile).toHaveBeenCalledWith(
        '/Users/me/Notesage/alpha',
        'notes.txt',
      );
    });
  });

  it('Escape cancels the inline create — no createFile call', async () => {
    setProjects([alpha]);
    renderWithProviders(<ProjectsSection />);

    useQuietSidebarStore.getState().setPendingCreate({
      parentDir: '/Users/me/Notesage/alpha',
    });
    const input = await screen.findByLabelText(/create/i);
    fireEvent.keyDown(input, { key: 'Escape' });

    await waitFor(() => {
      expect(screen.queryByLabelText(/create/i)).toBeNull();
    });
    expect(mockCreateFile).not.toHaveBeenCalled();
    expect(useQuietSidebarStore.getState().pendingCreate).toBeNull();
  });

  it('validation rejects slashes in the new name', async () => {
    const user = userEvent.setup();
    setProjects([alpha]);
    renderWithProviders(<ProjectsSection />);

    useQuietSidebarStore.getState().setPendingCreate({
      parentDir: '/Users/me/Notesage/alpha',
    });
    const input = await screen.findByLabelText(/create/i);
    await user.type(input, 'a/b{Enter}');

    // No filesystem call, input stays open with an error message.
    expect(mockCreateFile).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toMatch(/slash/i);
  });

  // Regression for keyboard-only walkthrough finding #3 (2026-04-28).
  // After commit, the inline-edit input unmounts and focus has nowhere
  // to inherit unless we explicitly hand it to the editor. The
  // `notesage:focus-editor` event tells the Editor (which subscribes
  // via `FOCUS_EDITOR_EVENT`) to call `editor.commands.focus()`.
  it('dispatches notesage:focus-editor after the new file opens', async () => {
    const user = userEvent.setup();
    setProjects([alpha]);
    renderWithProviders(<ProjectsSection />);

    const focusListener = vi.fn();
    window.addEventListener('notesage:focus-editor', focusListener);
    try {
      useQuietSidebarStore.getState().setPendingCreate({
        parentDir: '/Users/me/Notesage/alpha',
      });
      const input = await screen.findByLabelText(/create/i);
      await user.type(input, 'draft{Enter}');

      // Wait for the openFile chain to settle — the focus event
      // fires AFTER `await openFile(...)` resolves, not during the
      // initial commit.
      await waitFor(() => {
        expect(mockOpenFile).toHaveBeenCalled();
      });
      await waitFor(() => {
        expect(focusListener).toHaveBeenCalledTimes(1);
      });
    } finally {
      window.removeEventListener('notesage:focus-editor', focusListener);
    }
  });

  it('does NOT dispatch notesage:focus-editor when commit fails', async () => {
    const user = userEvent.setup();
    setProjects([alpha]);
    renderWithProviders(<ProjectsSection />);

    // Make createFile reject so the try/catch routes to the toast
    // branch and the focus event must NOT fire.
    mockCreateFile.mockRejectedValueOnce(new Error('disk full'));

    const focusListener = vi.fn();
    window.addEventListener('notesage:focus-editor', focusListener);
    try {
      useQuietSidebarStore.getState().setPendingCreate({
        parentDir: '/Users/me/Notesage/alpha',
      });
      const input = await screen.findByLabelText(/create/i);
      await user.type(input, 'draft{Enter}');

      await waitFor(() => {
        expect(mockCreateFile).toHaveBeenCalled();
      });
      // Give the rejected promise a tick to settle.
      await new Promise((r) => setTimeout(r, 10));
      expect(focusListener).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener('notesage:focus-editor', focusListener);
    }
  });
});

// ----------------------------------------------------------------------------
// Task #42 — inline create project
// ----------------------------------------------------------------------------

import { buildProjectNameValidator } from '../ProjectsSection';
import { toast } from 'sonner';

describe('buildProjectNameValidator (#42)', () => {
  it('accepts a plain project name', () => {
    const validate = buildProjectNameValidator(new Set());
    expect(validate('new-project')).toBeNull();
  });

  it('rejects empty input by returning null (auto-cancel)', () => {
    const validate = buildProjectNameValidator(new Set());
    expect(validate('')).toBeNull();
    expect(validate('   ')).toBeNull();
  });

  it('rejects names containing slashes', () => {
    const validate = buildProjectNameValidator(new Set());
    expect(validate('a/b')).toMatch(/slash/i);
    expect(validate('/abs')).toMatch(/slash/i);
  });

  it('rejects names starting with a dot', () => {
    const validate = buildProjectNameValidator(new Set());
    expect(validate('.hidden')).toMatch(/dot/i);
  });

  it('rejects a name that collides with an existing project basename', () => {
    const validate = buildProjectNameValidator(new Set(['alpha', 'beta']));
    expect(validate('alpha')).toMatch(/already exists/i);
    expect(validate('gamma')).toBeNull();
  });
});

describe('ProjectsSection — inline create project (#42)', () => {
  beforeEach(() => {
    useQuietSidebarStore.setState({
      pendingCreate: null,
      pendingCreateProject: false,
    });
    // Default to an expanded notesRootPath so the commit handler can proceed.
    useSettingsStore.setState({ notesRootPath: '/Users/me/Notesage' });
    vi.mocked(toast.success).mockReset();
    vi.mocked(toast.error).mockReset();
  });

  it('renders NO inline project-create row when pendingCreateProject is false', () => {
    renderWithProviders(<ProjectsSection />);
    // Nothing with data-pending-create-project
    expect(
      document.querySelector('[data-pending-create-project]'),
    ).toBeNull();
  });

  it('renders the inline project-create row when pendingCreateProject is true', async () => {
    renderWithProviders(<ProjectsSection />);
    useQuietSidebarStore.getState().setPendingCreateProject(true);

    const input = (await screen.findByLabelText(/create/i)) as HTMLInputElement;
    expect(input.placeholder).toBe('New project');
    // Anchor present for row alignment
    expect(
      document.querySelector('[data-pending-create-project="true"]'),
    ).toBeTruthy();
  });

  it('renders the create row at the top — above existing projects', async () => {
    setProjects([
      { path: '/Users/me/Notesage/alpha', fileTree: [] },
    ]);
    renderWithProviders(<ProjectsSection />);
    useQuietSidebarStore.getState().setPendingCreateProject(true);

    // Find the tree and its direct `<li>` children; the first one should
    // be the pending-create marker.
    await waitFor(() => {
      const ul = screen.getByRole('tree', { name: /projects/i });
      const firstLi = ul.querySelector(':scope > li') as HTMLElement | null;
      expect(firstLi).toBeTruthy();
      expect(firstLi?.getAttribute('data-pending-create-project')).toBe('true');
    });
  });

  it('section-header + button flips pendingCreateProject on click (when onAdd wired)', () => {
    const onAdd = vi.fn(() => {
      useQuietSidebarStore.getState().setPendingCreateProject(true);
    });
    renderWithProviders(<ProjectsSection onAdd={onAdd} />);
    fireEvent.click(screen.getByRole('button', { name: /add project/i }));
    expect(onAdd).toHaveBeenCalledTimes(1);
    expect(useQuietSidebarStore.getState().pendingCreateProject).toBe(true);
  });

  it('commits by calling createFolder + addProject + clears pending', async () => {
    const user = userEvent.setup();
    // Simulate the freshly-created directory returning an empty tree.
    setMockInvokeHandler(
      'list_directory',
      () => [],
    );
    renderWithProviders(<ProjectsSection />);
    useQuietSidebarStore.getState().setPendingCreateProject(true);

    const input = await screen.findByLabelText(/create/i);
    await user.type(input, 'my-project{Enter}');

    await waitFor(() => {
      expect(mockCreateFolder).toHaveBeenCalledWith(
        '/Users/me/Notesage',
        'my-project',
      );
    });
    await waitFor(() => {
      const projects = useWorkspaceStore.getState().projects;
      expect(projects).toHaveLength(1);
      expect(projects[0].path).toBe('/Users/me/Notesage/my-project');
      expect(projects[0].fileTree).toEqual([]);
    });
    expect(useQuietSidebarStore.getState().pendingCreateProject).toBe(false);
    expect(vi.mocked(toast.success)).toHaveBeenCalledWith(
      expect.stringMatching(/my-project/i),
    );
  });

  it('Escape cancels — no createFolder, no new project, pending cleared', async () => {
    renderWithProviders(<ProjectsSection />);
    useQuietSidebarStore.getState().setPendingCreateProject(true);

    const input = await screen.findByLabelText(/create/i);
    fireEvent.keyDown(input, { key: 'Escape' });

    await waitFor(() => {
      expect(screen.queryByLabelText(/create/i)).toBeNull();
    });
    expect(mockCreateFolder).not.toHaveBeenCalled();
    expect(useWorkspaceStore.getState().projects).toHaveLength(0);
    expect(useQuietSidebarStore.getState().pendingCreateProject).toBe(false);
  });

  it('rejects slash in the name (no filesystem call)', async () => {
    const user = userEvent.setup();
    renderWithProviders(<ProjectsSection />);
    useQuietSidebarStore.getState().setPendingCreateProject(true);

    const input = await screen.findByLabelText(/create/i);
    await user.type(input, 'a/b{Enter}');

    expect(mockCreateFolder).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toMatch(/slash/i);
    // Input stays open — pending flag not cleared yet.
    expect(useQuietSidebarStore.getState().pendingCreateProject).toBe(true);
  });

  it('rejects dot-prefix in the name', async () => {
    const user = userEvent.setup();
    renderWithProviders(<ProjectsSection />);
    useQuietSidebarStore.getState().setPendingCreateProject(true);

    const input = await screen.findByLabelText(/create/i);
    await user.type(input, '.hidden{Enter}');

    expect(mockCreateFolder).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toMatch(/dot/i);
  });

  it('rejects a duplicate project name', async () => {
    const user = userEvent.setup();
    setProjects([
      { path: '/Users/me/Notesage/alpha', fileTree: [] },
    ]);
    renderWithProviders(<ProjectsSection />);
    useQuietSidebarStore.getState().setPendingCreateProject(true);

    const input = await screen.findByLabelText(/create/i);
    await user.type(input, 'alpha{Enter}');

    expect(mockCreateFolder).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toMatch(/already exists/i);
  });

  it('bails with an error toast when the library root is not expanded yet', async () => {
    const user = userEvent.setup();
    // Simulate pre-lifecycle state: notesRootPath still has the `~` prefix.
    useSettingsStore.setState({ notesRootPath: '~/Notesage' });
    renderWithProviders(<ProjectsSection />);
    useQuietSidebarStore.getState().setPendingCreateProject(true);

    const input = await screen.findByLabelText(/create/i);
    await user.type(input, 'my-project{Enter}');

    await waitFor(() => {
      expect(vi.mocked(toast.error)).toHaveBeenCalledWith(
        expect.stringMatching(/not ready/i),
      );
    });
    expect(mockCreateFolder).not.toHaveBeenCalled();
    expect(useQuietSidebarStore.getState().pendingCreateProject).toBe(false);
  });

  it('surfaces a toast.error when createFolder rejects', async () => {
    const user = userEvent.setup();
    mockCreateFolder.mockRejectedValueOnce(new Error('EACCES'));
    renderWithProviders(<ProjectsSection />);
    useQuietSidebarStore.getState().setPendingCreateProject(true);

    const input = await screen.findByLabelText(/create/i);
    await user.type(input, 'my-project{Enter}');

    await waitFor(() => {
      expect(vi.mocked(toast.error)).toHaveBeenCalledWith(
        expect.stringMatching(/failed to create project/i),
      );
    });
    // Pending was cleared up-front.
    expect(useQuietSidebarStore.getState().pendingCreateProject).toBe(false);
    // No project added.
    expect(useWorkspaceStore.getState().projects).toHaveLength(0);
  });
});

// ----------------------------------------------------------------------------
// Task #80 — ARIA + keyboard primitives
// ----------------------------------------------------------------------------

describe('ProjectsSection — ARIA + keyboard primitives (#80)', () => {
  const project: WorkspaceProject = {
    path: '/Users/me/Notesage/alpha',
    fileTree: [
      makeFile('note.md', '/Users/me/Notesage/alpha/note.md'),
      makeDir('docs', '/Users/me/Notesage/alpha/docs', [
        makeFile('intro.md', '/Users/me/Notesage/alpha/docs/intro.md'),
      ]),
    ],
  };

  it('F2 on a child file row surfaces a "Renaming <filename>" announcement', async () => {
    // Clear any leftover announcer node from previous tests (TTL is 2s).
    document
      .querySelectorAll('[data-sidebar-announcer]')
      .forEach((n) => n.remove());

    setProjects([project]);
    renderWithProviders(<ProjectsSection />);

    // Expand alpha so note.md becomes visible.
    const projectRow = screen.getByRole('treeitem', {
      name: /open project alpha/i,
    });
    fireEvent.keyDown(projectRow, { key: 'ArrowRight' });

    const noteRow = screen.getByRole('treeitem', {
      name: /open file note\.md/i,
    }) as HTMLElement;
    noteRow.focus();
    fireEvent.keyDown(noteRow, { key: 'F2' });

    await waitFor(() => {
      const announcer = document.querySelector(
        '[data-sidebar-announcer]',
      ) as HTMLElement | null;
      expect(announcer).toBeTruthy();
      expect(announcer?.textContent).toBe('Renaming note.md');
    });
  });

  it('the ContextMenu key on a child file row dispatches a contextmenu event', () => {
    setProjects([project]);
    renderWithProviders(<ProjectsSection />);

    const projectRow = screen.getByRole('treeitem', {
      name: /open project alpha/i,
    });
    fireEvent.keyDown(projectRow, { key: 'ArrowRight' });

    const noteRow = screen.getByRole('treeitem', {
      name: /open file note\.md/i,
    }) as HTMLElement;

    let captured: MouseEvent | null = null;
    noteRow.addEventListener('contextmenu', (e) => {
      captured = e as MouseEvent;
      e.preventDefault();
    });

    noteRow.focus();
    fireEvent.keyDown(noteRow, { key: 'ContextMenu' });

    expect(captured).not.toBeNull();
    expect(captured!.button).toBe(2);
  });

  it('the ContextMenu key on a project row dispatches a contextmenu event', () => {
    setProjects([project]);
    renderWithProviders(<ProjectsSection />);

    const projectRow = screen.getByRole('treeitem', {
      name: /open project alpha/i,
    }) as HTMLElement;

    let captured: MouseEvent | null = null;
    projectRow.addEventListener('contextmenu', (e) => {
      captured = e as MouseEvent;
      e.preventDefault();
    });

    projectRow.focus();
    fireEvent.keyDown(projectRow, { key: 'ContextMenu' });

    expect(captured).not.toBeNull();
    expect(captured!.button).toBe(2);
  });

  it('⌘⇧, on a project row also dispatches a contextmenu event', () => {
    setProjects([project]);
    renderWithProviders(<ProjectsSection />);

    const projectRow = screen.getByRole('treeitem', {
      name: /open project alpha/i,
    }) as HTMLElement;

    let captured: MouseEvent | null = null;
    projectRow.addEventListener('contextmenu', (e) => {
      captured = e as MouseEvent;
      e.preventDefault();
    });

    projectRow.focus();
    fireEvent.keyDown(projectRow, { key: ',', metaKey: true, shiftKey: true });

    expect(captured).not.toBeNull();
  });

  // -------------------------------------------------------------------------
  // #140 regression — `<SidebarContextMenu>` wraps each row so right-click
  // opens our custom menu instead of the OS native browser menu. The previous
  // attempt put the function-component row directly under
  // `<ContextMenuTrigger asChild>`, which silently dropped Radix's injected
  // `onContextMenu` handler (Slot's `cloneElement` adds the handler to the
  // function-component element's props, but the row destructures only its
  // explicit props and ignores the rest). The fix wraps each row in a
  // passthrough <div> so the trigger's prop injection lands on a real DOM
  // element. These tests assert the bubbling onContextMenu reaches a Radix
  // handler that calls preventDefault — the canonical signal that the OS
  // menu has been suppressed.
  // -------------------------------------------------------------------------

  it('right-click on a project row preventDefaults the contextmenu event (no OS native menu) (#140)', () => {
    setProjects([project]);
    renderWithProviders(<ProjectsSection />);

    const projectRow = screen.getByRole('treeitem', {
      name: /open project alpha/i,
    }) as HTMLElement;

    // Fire a real right-click. If our `<SidebarContextMenu>` wrapper is
    // wired correctly, Radix attaches an `onContextMenu` handler to the
    // wrapping <div> ancestor (via Slot's cloneElement onto a raw DOM
    // element). The handler calls preventDefault, suppressing the OS menu.
    const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2 });
    projectRow.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
  });

  it('right-click on a child file row preventDefaults the contextmenu event (#140)', () => {
    setProjects([project]);
    renderWithProviders(<ProjectsSection />);

    const projectRow = screen.getByRole('treeitem', {
      name: /open project alpha/i,
    });
    fireEvent.keyDown(projectRow, { key: 'ArrowRight' });

    const noteRow = screen.getByRole('treeitem', {
      name: /open file note\.md/i,
    }) as HTMLElement;

    const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2 });
    noteRow.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
  });

  it('ArrowRight on a project row reveals one level of children inline (keyboard parity with hover-peek)', () => {
    // Mix folders + files + hidden so the inline expansion mirrors what
    // the FolderPeek hover popover would show via `derivePeekChildren`.
    const richProject: WorkspaceProject = {
      path: '/Users/me/Notesage/rich',
      fileTree: [
        makeFile('.hidden.md', '/Users/me/Notesage/rich/.hidden.md'),
        makeDir('docs', '/Users/me/Notesage/rich/docs'),
        makeFile('readme.md', '/Users/me/Notesage/rich/readme.md'),
      ],
    };
    setProjects([richProject]);
    renderWithProviders(<ProjectsSection />);

    const projectRow = screen.getByRole('treeitem', {
      name: /open project rich/i,
    });
    expect(projectRow.getAttribute('aria-expanded')).toBe('false');

    fireEvent.keyDown(projectRow, { key: 'ArrowRight' });

    expect(projectRow.getAttribute('aria-expanded')).toBe('true');
    // Folder (docs) and file (readme.md) visible inline; hidden entry not.
    expect(
      screen.getByRole('treeitem', { name: /open folder docs/i }),
    ).toBeTruthy();
    expect(
      screen.getByRole('treeitem', { name: /open file readme\.md/i }),
    ).toBeTruthy();
    expect(screen.queryByText('.hidden.md')).toBeNull();
  });
});

// ----------------------------------------------------------------------------
// Issue #89 — project-root rename + system-folder safety + rename-input width
// ----------------------------------------------------------------------------

describe('ProjectsSection — project-root rename + system-folder safety + input width (#89)', () => {
  const project: WorkspaceProject = {
    path: '/Users/me/Notesage/alpha',
    fileTree: [
      makeFile('note.md', '/Users/me/Notesage/alpha/note.md'),
      makeDir('docs', '/Users/me/Notesage/alpha/docs', []),
    ],
  };

  // Project with dotfile (system) folders so we can test the safety gate.
  const projectWithSystemFolders: WorkspaceProject = {
    path: '/Users/me/Notesage/myproject',
    fileTree: [
      makeFile('readme.md', '/Users/me/Notesage/myproject/readme.md'),
      makeDir('.notesage', '/Users/me/Notesage/myproject/.notesage', []),
      makeDir('.git', '/Users/me/Notesage/myproject/.git', []),
      makeDir('.claude', '/Users/me/Notesage/myproject/.claude', []),
      makeDir('src', '/Users/me/Notesage/myproject/src', []),
    ],
  };

  // ── project-root double-click rename ──────────────────────────────────────

  it('double-clicking a project-root row renders SidebarInlineEdit pre-filled with the project basename', async () => {
    setProjects([project]);
    renderWithProviders(<ProjectsSection />);

    const projectRow = screen.getByRole('treeitem', {
      name: /open project alpha/i,
    }) as HTMLElement;
    fireEvent.click(projectRow, { detail: 2 });

    const input = (await screen.findByLabelText(/rename/i)) as HTMLInputElement;
    expect(input.value).toBe('alpha');
  });

  it('Escape on a project-root rename cancels without calling renamePath', async () => {
    setProjects([project]);
    renderWithProviders(<ProjectsSection />);

    const projectRow = screen.getByRole('treeitem', {
      name: /open project alpha/i,
    }) as HTMLElement;
    fireEvent.click(projectRow, { detail: 2 });

    const input = await screen.findByLabelText(/rename/i);
    fireEvent.keyDown(input, { key: 'Escape' });

    await waitFor(() => {
      expect(screen.queryByLabelText(/rename/i)).toBeNull();
    });
    expect(mockRenamePath).not.toHaveBeenCalled();
  });

  it('committing a project-root rename calls renamePath with the new path AND updates workspace-store', async () => {
    const user = userEvent.setup();
    setProjects([project]);
    renderWithProviders(<ProjectsSection />);

    const projectRow = screen.getByRole('treeitem', {
      name: /open project alpha/i,
    }) as HTMLElement;
    fireEvent.click(projectRow, { detail: 2 });

    const input = (await screen.findByLabelText(/rename/i)) as HTMLInputElement;
    await user.clear(input);
    await user.type(input, 'beta{Enter}');

    await waitFor(() => {
      expect(mockRenamePath).toHaveBeenCalledWith(
        '/Users/me/Notesage/alpha',
        '/Users/me/Notesage/beta',
      );
    });
    // workspace-store must also be updated so the sidebar reflects the new path.
    await waitFor(() => {
      const projects = useWorkspaceStore.getState().projects;
      expect(projects[0].path).toBe('/Users/me/Notesage/beta');
    });
  });

  // ── F2 on project-root row ─────────────────────────────────────────────────

  it('pressing F2 on a focused project-root row renders SidebarInlineEdit', async () => {
    setProjects([project]);
    renderWithProviders(<ProjectsSection />);

    const projectRow = screen.getByRole('treeitem', {
      name: /open project alpha/i,
    }) as HTMLElement;
    projectRow.focus();
    fireEvent.keyDown(projectRow, { key: 'F2' });

    const input = (await screen.findByLabelText(/rename/i)) as HTMLInputElement;
    expect(input.value).toBe('alpha');
  });

  // ── system-folder safety — double-click blocked ───────────────────────────

  it('double-clicking a .notesage child folder does NOT enter rename mode', async () => {
    // dotfile folders are hidden by default; show them explicitly.
    useSettingsStore.setState({ showHiddenFiles: true });
    setProjects([projectWithSystemFolders]);
    renderWithProviders(<ProjectsSection />);

    const projectRow = screen.getByRole('treeitem', {
      name: /open project myproject/i,
    });
    fireEvent.keyDown(projectRow, { key: 'ArrowRight' });

    const folderRow = screen.getByRole('treeitem', {
      name: /open folder \.notesage/i,
    }) as HTMLElement;
    fireEvent.click(folderRow, { detail: 2 });

    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByLabelText(/rename/i)).toBeNull();
  });

  it('double-clicking a .git child folder does NOT enter rename mode', async () => {
    useSettingsStore.setState({ showHiddenFiles: true });
    setProjects([projectWithSystemFolders]);
    renderWithProviders(<ProjectsSection />);

    const projectRow = screen.getByRole('treeitem', {
      name: /open project myproject/i,
    });
    fireEvent.keyDown(projectRow, { key: 'ArrowRight' });

    const folderRow = screen.getByRole('treeitem', {
      name: /open folder \.git/i,
    }) as HTMLElement;
    fireEvent.click(folderRow, { detail: 2 });

    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByLabelText(/rename/i)).toBeNull();
  });

  it('double-clicking a .claude child folder does NOT enter rename mode', async () => {
    useSettingsStore.setState({ showHiddenFiles: true });
    setProjects([projectWithSystemFolders]);
    renderWithProviders(<ProjectsSection />);

    const projectRow = screen.getByRole('treeitem', {
      name: /open project myproject/i,
    });
    fireEvent.keyDown(projectRow, { key: 'ArrowRight' });

    const folderRow = screen.getByRole('treeitem', {
      name: /open folder \.claude/i,
    }) as HTMLElement;
    fireEvent.click(folderRow, { detail: 2 });

    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByLabelText(/rename/i)).toBeNull();
  });

  it('double-clicking a non-system folder (src) still enters rename mode', async () => {
    useSettingsStore.setState({ showHiddenFiles: true });
    setProjects([projectWithSystemFolders]);
    renderWithProviders(<ProjectsSection />);

    const projectRow = screen.getByRole('treeitem', {
      name: /open project myproject/i,
    });
    fireEvent.keyDown(projectRow, { key: 'ArrowRight' });

    const folderRow = screen.getByRole('treeitem', {
      name: /open folder src/i,
    }) as HTMLElement;
    fireEvent.click(folderRow, { detail: 2 });

    const input = (await screen.findByLabelText(/rename/i)) as HTMLInputElement;
    expect(input.value).toBe('src');
  });

  // ── system-folder safety — SIDEBAR_ENTER_RENAME_MODE_EVENT blocked ─────────

  it('SIDEBAR_ENTER_RENAME_MODE_EVENT is blocked for .notesage child folders', async () => {
    useSettingsStore.setState({ showHiddenFiles: true });
    setProjects([projectWithSystemFolders]);
    renderWithProviders(<ProjectsSection />);

    // Expand so .notesage appears in visibleChildPaths.
    const projectRow = screen.getByRole('treeitem', {
      name: /open project myproject/i,
    });
    fireEvent.keyDown(projectRow, { key: 'ArrowRight' });

    window.dispatchEvent(
      new CustomEvent('sidebar:enter-rename-mode', {
        detail: { filePath: '/Users/me/Notesage/myproject/.notesage' },
      }),
    );

    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByLabelText(/rename/i)).toBeNull();
  });

  it('SIDEBAR_ENTER_RENAME_MODE_EVENT is blocked for .git child folders', async () => {
    useSettingsStore.setState({ showHiddenFiles: true });
    setProjects([projectWithSystemFolders]);
    renderWithProviders(<ProjectsSection />);

    const projectRow = screen.getByRole('treeitem', {
      name: /open project myproject/i,
    });
    fireEvent.keyDown(projectRow, { key: 'ArrowRight' });

    window.dispatchEvent(
      new CustomEvent('sidebar:enter-rename-mode', {
        detail: { filePath: '/Users/me/Notesage/myproject/.git' },
      }),
    );

    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByLabelText(/rename/i)).toBeNull();
  });

  // ── rename input width ─────────────────────────────────────────────────────

  it('the rename input rendered inside a child row has the w-full class (no overflow)', async () => {
    setProjects([project]);
    renderWithProviders(<ProjectsSection />);

    const projectRow = screen.getByRole('treeitem', {
      name: /open project alpha/i,
    });
    fireEvent.keyDown(projectRow, { key: 'ArrowRight' });

    const folderRow = screen.getByRole('treeitem', {
      name: /open folder docs/i,
    }) as HTMLElement;
    fireEvent.click(folderRow, { detail: 2 });

    const input = (await screen.findByLabelText(/rename/i)) as HTMLInputElement;
    expect(input.className).toMatch(/\bw-full\b/);
  });

  it('the rename input rendered for a project-root row has the w-full class', async () => {
    setProjects([project]);
    renderWithProviders(<ProjectsSection />);

    const projectRow = screen.getByRole('treeitem', {
      name: /open project alpha/i,
    }) as HTMLElement;
    fireEvent.click(projectRow, { detail: 2 });

    const input = (await screen.findByLabelText(/rename/i)) as HTMLInputElement;
    expect(input.className).toMatch(/\bw-full\b/);
  });
});
