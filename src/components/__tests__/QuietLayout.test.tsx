// @vitest-environment jsdom

import '@/test/tauri-mock';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  renderWithProviders,
  screen,
  registerDefaultHandlers,
} from '@/test/component-harness';
import {
  QuietLayout,
  resolveCreateParent,
  type QuietLayoutProps,
} from '@/components/QuietLayout';
import { useQuietSidebarStore } from '@/stores/quiet-sidebar-store';
import { useEditorStore } from '@/stores/editor-store';
import { useWorkspaceStore, type WorkspaceProject } from '@/stores/workspace-store';

// Mock sonner so the Cmd+N toast fallback is observable without rendering
// the real Toaster component.
vi.mock('sonner', () => ({
  toast: {
    info: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
    warning: vi.fn(),
    loading: vi.fn(),
    dismiss: vi.fn(),
  },
  Toaster: () => null,
}));

// Import after mock so `toast` resolves to the mocked instance.
import { toast as mockedToast } from 'sonner';

// ---------------------------------------------------------------------------
// Mock TitleBar — heavy dependency tree, not relevant to placeholder shell
// ---------------------------------------------------------------------------

vi.mock('@/components/TitleBar', () => ({
  TitleBar: () => <div data-testid="titlebar">TitleBar</div>,
}));

// Stub FloatingCommandBar so we can assert it's mounted without pulling in
// its real implementation (portal, hooks, etc.).
vi.mock('@/components/cmd/FloatingCommandBar', () => ({
  default: () => <div data-testid="cmd-bar-stub" />,
}));

// Stub AgentOrb (#29) so we can assert it's mounted without pulling its
// real implementation (it has its own dedicated test file).
vi.mock('@/components/activity/AgentOrb', () => ({
  AgentOrb: () => <div data-testid="agent-orb-stub" />,
}));

// ---------------------------------------------------------------------------
// Mock settings-store so QuietLayout can read `cmdBarPinned` to decide
// whether to apply right-padding to the document area.
// ---------------------------------------------------------------------------

let mockCmdBarPinned = false;

vi.mock('@/stores/settings-store', () => {
  const state = {
    get cmdBarPinned() { return mockCmdBarPinned; },
  };
  return {
    useSettingsStore: Object.assign(
      vi.fn((sel: (s: typeof state) => unknown) => sel(state)),
      { getState: () => state },
    ),
  };
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function defaultProps(overrides: Partial<QuietLayoutProps> = {}): QuietLayoutProps {
  return {
    focusMode: false,
    stripExpanded: false,
    onNewNote: vi.fn(),
    onNewProject: vi.fn(),
    onOpenFolder: vi.fn(),
    onOpenProject: vi.fn(),
    onOpenFile: vi.fn(),
    exportOpen: false,
    onExportOpenChange: vi.fn(),
    outlineOpen: false,
    onOutlineOpenChange: vi.fn(),
    updateAvailable: false,
    updateVersion: null,
    onUpdateClick: vi.fn(),
    onShortcutsOpen: vi.fn(),
    onOpenActions: vi.fn(),
    onOpenSettings: vi.fn(),
    onBrowseForProject: vi.fn(),
    onOpenProjectSettings: vi.fn(),
    onMakeProject: vi.fn(),
    onExportFile: vi.fn(),
    onCancelTask: vi.fn(async () => {}),
    onClickTask: vi.fn(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('QuietLayout (placeholder)', () => {
  beforeEach(() => {
    registerDefaultHandlers();
    mockCmdBarPinned = false;
  });

  it('renders without crashing', () => {
    const { container } = renderWithProviders(<QuietLayout {...defaultProps()} />);
    expect(container).toBeTruthy();
  });

  it('renders the placeholder wrapper with data-quiet-layout-placeholder', () => {
    const { container } = renderWithProviders(<QuietLayout {...defaultProps()} />);
    expect(container.querySelector('[data-quiet-layout-placeholder]')).toBeTruthy();
  });

  it('renders the title bar at the top', () => {
    renderWithProviders(<QuietLayout {...defaultProps()} />);
    expect(screen.getByTestId('titlebar')).toBeTruthy();
  });

  it('renders the QuietSidebar plus placeholder document + reserved zones', () => {
    renderWithProviders(<QuietLayout {...defaultProps()} />);
    // Sidebar is now the real QuietSidebar (#30), centre + right remain placeholders.
    expect(screen.getByRole('navigation', { name: /workspace sidebar/i })).toBeTruthy();
    expect(screen.getByText(/Document area \(placeholder\)/i)).toBeTruthy();
    expect(screen.getByText(/Reserved \(placeholder\)/i)).toBeTruthy();
  });

  it('mounts the FloatingCommandBar', () => {
    renderWithProviders(<QuietLayout {...defaultProps()} />);
    expect(screen.getByTestId('cmd-bar-stub')).toBeTruthy();
  });

  it('mounts the AgentOrb (#29)', () => {
    renderWithProviders(<QuietLayout {...defaultProps()} />);
    expect(screen.getByTestId('agent-orb-stub')).toBeTruthy();
  });

  // -------------------------------------------------------------------------
  // Pinned-panel padding (#28)
  // -------------------------------------------------------------------------

  describe('pinned-panel padding (#28)', () => {
    it('does NOT apply padding-right to the document area when not pinned', () => {
      mockCmdBarPinned = false;
      const { container } = renderWithProviders(<QuietLayout {...defaultProps()} />);
      const docArea = container.querySelector(
        '[data-quiet-layout-document-area]',
      ) as HTMLElement;
      expect(docArea).toBeTruthy();
      // No padding-right inline style applied.
      expect(docArea.style.paddingRight).toBe('');
    });

    it('applies padding-right via the CSS variable when pinned', () => {
      mockCmdBarPinned = true;
      const { container } = renderWithProviders(<QuietLayout {...defaultProps()} />);
      const docArea = container.querySelector(
        '[data-quiet-layout-document-area]',
      ) as HTMLElement;
      expect(docArea).toBeTruthy();
      // Inline style references the CSS variable with a 400px fallback.
      expect(docArea.style.paddingRight).toContain('--cmd-bar-pinned-width');
    });

    it('marks the wrapper with data-cmd-bar-pinned when pinned', () => {
      mockCmdBarPinned = true;
      const { container } = renderWithProviders(<QuietLayout {...defaultProps()} />);
      const wrapper = container.querySelector(
        '[data-quiet-layout-placeholder]',
      ) as HTMLElement;
      expect(wrapper.getAttribute('data-cmd-bar-pinned')).toBe('true');
    });
  });
});

// ---------------------------------------------------------------------------
// resolveCreateParent — pure helper
// ---------------------------------------------------------------------------

describe('resolveCreateParent (#41)', () => {
  const projects: WorkspaceProject[] = [
    { path: '/Users/me/Notesage/alpha', fileTree: [] },
    { path: '/Users/me/Notesage/beta', fileTree: [] },
  ];

  it('returns the active tab parent dir when the file is inside a project', () => {
    expect(
      resolveCreateParent('/Users/me/Notesage/alpha/notes/a.md', projects),
    ).toBe('/Users/me/Notesage/alpha/notes');
  });

  it('returns the project root when the active file is at the project root', () => {
    expect(
      resolveCreateParent('/Users/me/Notesage/alpha/a.md', projects),
    ).toBe('/Users/me/Notesage/alpha');
  });

  it('returns null when there are no projects', () => {
    expect(resolveCreateParent('/Users/me/Notesage/alpha/a.md', [])).toBeNull();
  });

  it('returns null when the active file is outside every project', () => {
    expect(
      resolveCreateParent('/Users/me/elsewhere/a.md', projects),
    ).toBeNull();
  });

  it('returns null when there is no active file', () => {
    expect(resolveCreateParent(null, projects)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Cmd+N keyboard handler (#41)
// ---------------------------------------------------------------------------

describe('QuietLayout — Cmd+N keyboard handler (#41)', () => {
  beforeEach(() => {
    registerDefaultHandlers();
    mockCmdBarPinned = false;
    vi.mocked(mockedToast.info).mockReset();
    useQuietSidebarStore.setState({ pendingCreate: null });
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
  });

  function dispatchCmdN(modifiers: Partial<KeyboardEventInit> = {}) {
    window.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'n',
        metaKey: true,
        bubbles: true,
        cancelable: true,
        ...modifiers,
      }),
    );
  }

  it('Cmd+N with an active tab inside a project sets pending create with that parent', () => {
    useWorkspaceStore.setState({
      projects: [
        { path: '/Users/me/Notesage/alpha', fileTree: [] },
      ],
    });
    useEditorStore.setState({
      tabs: [
        {
          id: 't1',
          filePath: '/Users/me/Notesage/alpha/docs/intro.md',
          fileName: 'intro.md',
          isDirty: false,
          content: '',
          frontmatter: null,
          fileType: 'markdown',
          contentLoaded: true,
        },
      ],
      activeTabId: 't1',
      persistedTabs: [],
      persistedActiveFilePath: null,
    });

    renderWithProviders(<QuietLayout {...defaultProps()} />);
    dispatchCmdN();

    expect(useQuietSidebarStore.getState().pendingCreate).toEqual({
      parentDir: '/Users/me/Notesage/alpha/docs',
    });
    expect(vi.mocked(mockedToast.info)).not.toHaveBeenCalled();
  });

  it('Cmd+N with active tab at the project root sets pending at the project root', () => {
    useWorkspaceStore.setState({
      projects: [
        { path: '/Users/me/Notesage/alpha', fileTree: [] },
      ],
    });
    useEditorStore.setState({
      tabs: [
        {
          id: 't1',
          filePath: '/Users/me/Notesage/alpha/note.md',
          fileName: 'note.md',
          isDirty: false,
          content: '',
          frontmatter: null,
          fileType: 'markdown',
          contentLoaded: true,
        },
      ],
      activeTabId: 't1',
      persistedTabs: [],
      persistedActiveFilePath: null,
    });

    renderWithProviders(<QuietLayout {...defaultProps()} />);
    dispatchCmdN();

    expect(useQuietSidebarStore.getState().pendingCreate).toEqual({
      parentDir: '/Users/me/Notesage/alpha',
    });
  });

  it('Cmd+N with no matching project shows a toast and leaves pending null', () => {
    useWorkspaceStore.setState({
      projects: [{ path: '/Users/me/Notesage/alpha', fileTree: [] }],
    });
    useEditorStore.setState({
      tabs: [
        {
          id: 't1',
          filePath: '/tmp/elsewhere.md',
          fileName: 'elsewhere.md',
          isDirty: false,
          content: '',
          frontmatter: null,
          fileType: 'markdown',
          contentLoaded: true,
        },
      ],
      activeTabId: 't1',
      persistedTabs: [],
      persistedActiveFilePath: null,
    });

    renderWithProviders(<QuietLayout {...defaultProps()} />);
    dispatchCmdN();

    expect(useQuietSidebarStore.getState().pendingCreate).toBeNull();
    expect(vi.mocked(mockedToast.info)).toHaveBeenCalledWith(
      expect.stringMatching(/open a project/i),
    );
  });

  it('Cmd+N while typing in an input is a no-op', () => {
    useWorkspaceStore.setState({
      projects: [{ path: '/Users/me/Notesage/alpha', fileTree: [] }],
    });
    useEditorStore.setState({
      tabs: [
        {
          id: 't1',
          filePath: '/Users/me/Notesage/alpha/a.md',
          fileName: 'a.md',
          isDirty: false,
          content: '',
          frontmatter: null,
          fileType: 'markdown',
          contentLoaded: true,
        },
      ],
      activeTabId: 't1',
      persistedTabs: [],
      persistedActiveFilePath: null,
    });

    renderWithProviders(<QuietLayout {...defaultProps()} />);

    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();

    input.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'n',
        metaKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );

    expect(useQuietSidebarStore.getState().pendingCreate).toBeNull();
    input.remove();
  });

  it('Cmd+Shift+N does NOT set the note-level pendingCreate signal', () => {
    // Cmd+N owns the note-create signal (`pendingCreate`); Cmd+Shift+N
    // belongs to the project-create handler below and must not spill over
    // into the note-create code path.
    useWorkspaceStore.setState({
      projects: [{ path: '/Users/me/Notesage/alpha', fileTree: [] }],
    });
    useEditorStore.setState({
      tabs: [
        {
          id: 't1',
          filePath: '/Users/me/Notesage/alpha/a.md',
          fileName: 'a.md',
          isDirty: false,
          content: '',
          frontmatter: null,
          fileType: 'markdown',
          contentLoaded: true,
        },
      ],
      activeTabId: 't1',
      persistedTabs: [],
      persistedActiveFilePath: null,
    });

    renderWithProviders(<QuietLayout {...defaultProps()} />);
    dispatchCmdN({ shiftKey: true });

    expect(useQuietSidebarStore.getState().pendingCreate).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Cmd+Shift+N keyboard handler (#42) — project-create
// ---------------------------------------------------------------------------

describe('QuietLayout — Cmd+Shift+N keyboard handler (#42)', () => {
  beforeEach(() => {
    registerDefaultHandlers();
    mockCmdBarPinned = false;
    useQuietSidebarStore.setState({
      pendingCreate: null,
      pendingCreateProject: false,
    });
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
  });

  function dispatchCmdShiftN(modifiers: Partial<KeyboardEventInit> = {}) {
    window.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'n',
        metaKey: true,
        shiftKey: true,
        bubbles: true,
        cancelable: true,
        ...modifiers,
      }),
    );
  }

  it('Cmd+Shift+N sets pendingCreateProject to true', () => {
    renderWithProviders(<QuietLayout {...defaultProps()} />);
    dispatchCmdShiftN();

    expect(useQuietSidebarStore.getState().pendingCreateProject).toBe(true);
    // Note-create signal left untouched so the two flows don't fight.
    expect(useQuietSidebarStore.getState().pendingCreate).toBeNull();
  });

  it('Cmd+N alone does NOT set pendingCreateProject (#41 territory)', () => {
    useWorkspaceStore.setState({
      projects: [{ path: '/Users/me/Notesage/alpha', fileTree: [] }],
    });
    useEditorStore.setState({
      tabs: [
        {
          id: 't1',
          filePath: '/Users/me/Notesage/alpha/a.md',
          fileName: 'a.md',
          isDirty: false,
          content: '',
          frontmatter: null,
          fileType: 'markdown',
          contentLoaded: true,
        },
      ],
      activeTabId: 't1',
      persistedTabs: [],
      persistedActiveFilePath: null,
    });

    renderWithProviders(<QuietLayout {...defaultProps()} />);
    window.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'n',
        metaKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );

    expect(useQuietSidebarStore.getState().pendingCreateProject).toBe(false);
  });

  it('Cmd+Shift+N while typing in an input is a no-op', () => {
    renderWithProviders(<QuietLayout {...defaultProps()} />);

    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();

    input.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'n',
        metaKey: true,
        shiftKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );

    expect(useQuietSidebarStore.getState().pendingCreateProject).toBe(false);
    input.remove();
  });

  it('Ctrl+Shift+N works on non-mac paths (ctrlKey alternative to metaKey)', () => {
    renderWithProviders(<QuietLayout {...defaultProps()} />);
    window.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'n',
        ctrlKey: true,
        shiftKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );

    expect(useQuietSidebarStore.getState().pendingCreateProject).toBe(true);
  });
});
