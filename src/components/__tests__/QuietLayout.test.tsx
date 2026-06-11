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

// Stub the TitleBar. Always echoes data-titlebar-mode="quiet" so the
// .app.focus-mode CSS hook regression-lock keeps working — the real
// TitleBar applies the same constant attribute post-Classic-removal.
vi.mock('@/components/TitleBar', () => ({
  TitleBar: () => (
    <div data-testid="titlebar" data-titlebar-mode="quiet">
      TitleBar
    </div>
  ),
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

// Stub the Editor mount (#101). The real Editor pulls in Tiptap, the
// markdown serializer, the file watcher, Copilot LSP / local-completion
// hooks, and a half-dozen other heavy dependencies — none of which add
// signal to a layout-shell test. The stub lets us assert that QuietLayout
// reaches the mount point with the correct props.
vi.mock('@/components/editor/Editor', () => ({
  Editor: (props: Record<string, unknown>) => (
    <div
      data-testid="editor-stub"
      data-focus-mode={props.focusMode ? 'true' : 'false'}
    />
  ),
}));

// ---------------------------------------------------------------------------
// Mock settings-store so QuietLayout can read `cmdBarPinned` to decide
// whether to apply right-padding to the document area.
// ---------------------------------------------------------------------------

let mockCmdBarPinned = false;
let mockSidebarPinned = true;
let mockQuietChromeTransparent = false;
// Default the TitleBar ON in tests so the existing mount/CSS-hook assertions
// exercise the enabled path. The real store default is OFF (see settings-store
// + the "hides the TitleBar by default" test below).
let mockShowTitleBar = true;

vi.mock('@/stores/settings-store', () => {
  const state = {
    get cmdBarPinned() { return mockCmdBarPinned; },
    get sidebarPinned() { return mockSidebarPinned; },
    get quietChromeTransparent() { return mockQuietChromeTransparent; },
    get showTitleBar() { return mockShowTitleBar; },
    sidebarWidth: 252,
    setSidebarWidth: () => {},
    // Quiet-chrome (#51) — the real store seeds these defaults on startup.
    // QuietLayout mounts `useQuietChrome()` which reads both slices, so the
    // mock has to supply them or the hook crashes with "undefined.toolbar".
    quietChromePreset: 'default' as const,
    quietChromeOverrides: {
      toolbar: true,
      status: true,
      docHead: true,
      sidebar: false,
      orb: false,
      titlebar: false,
      cmdbar: false,
    },
  };
  return {
    useSettingsStore: Object.assign(
      vi.fn((sel: (s: typeof state) => unknown) => sel(state)),
      { getState: () => state },
    ),
    // QuietSidebar imports these named constants from the (mocked) module.
    SIDEBAR_MIN_WIDTH: 200,
    SIDEBAR_MAX_WIDTH: 500,
    SIDEBAR_DEFAULT_WIDTH: 252,
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
    mockSidebarPinned = true;
    mockQuietChromeTransparent = false;
    mockShowTitleBar = true;
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

  it('hides the TitleBar and sits the document flush to the top (sidebar shown)', () => {
    mockShowTitleBar = false;
    mockSidebarPinned = true;
    const { container } = renderWithProviders(<QuietLayout {...defaultProps()} />);
    // No TitleBar mounted.
    expect(screen.queryByTestId('titlebar')).toBeNull();
    // Root advertises the hidden state for the CSS clearance overrides.
    const root = container.querySelector('[data-quiet-layout-root]');
    expect(root?.getAttribute('data-titlebar-hidden')).toBe('true');
    // Flush: the document area reserves NO top padding — the sidebar covers the
    // traffic-light corner, so the column starts at y=0.
    const docArea = container.querySelector('[data-quiet-layout-document-area]');
    expect(docArea?.className).not.toMatch(/\bpt-/);
    // No doc-column drag strip when the sidebar is present (it owns dragging).
    expect(
      container.querySelector('div[aria-hidden][data-tauri-drag-region]'),
    ).toBeNull();
  });

  it('flows the editor flush under a transparent drag strip when title bar AND sidebar are hidden', () => {
    mockShowTitleBar = false;
    mockSidebarPinned = false;
    const { container } = renderWithProviders(<QuietLayout {...defaultProps()} />);
    const docArea = container.querySelector('[data-quiet-layout-document-area]');
    // Flush — no opaque top band; the editor surface flows to y=0 and the CSS
    // (data-titlebar-hidden + data-sidebar-pinned="false") pushes editor content
    // down to clear the traffic lights.
    expect(docArea?.className).not.toMatch(/\bpt-/);
    expect(docArea?.getAttribute('data-sidebar-pinned')).toBe('false');
    // A transparent drag region covers the traffic-light zone for window moves.
    expect(
      container.querySelector('div[aria-hidden][data-tauri-drag-region]'),
    ).toBeTruthy();
  });

  it('marks the root data-titlebar-hidden="false" when showTitleBar is on', () => {
    const { container } = renderWithProviders(<QuietLayout {...defaultProps()} />);
    const root = container.querySelector('[data-quiet-layout-root]');
    expect(root?.getAttribute('data-titlebar-hidden')).toBe('false');
  });

  it('mounts the TitleBar with data-titlebar-mode="quiet"', () => {
    // TitleBar's `data-titlebar-mode="quiet"` is a load-bearing CSS hook
    // for `.app.focus-mode [data-titlebar-mode="quiet"]` in globals.css
    // (which hides the bar entirely in focus mode). Post-Classic-removal
    // (#325) the attribute is a constant; the test locks it in so a
    // future TitleBar refactor doesn't silently break the CSS.
    renderWithProviders(<QuietLayout {...defaultProps()} />);
    const titlebar = screen.getByTestId('titlebar');
    expect(titlebar.getAttribute('data-titlebar-mode')).toBe('quiet');
  });

  it('renders the QuietSidebar and real Editor mount without a right column', () => {
    const { container } = renderWithProviders(<QuietLayout {...defaultProps()} />);
    // Sidebar is the real QuietSidebar (#30); centre column hosts the real
    // Editor (#101) instead of the old "Document area (placeholder)" stub.
    // The right column is gone (#102) — FloatingCommandBar IS the chat
    // surface in Quiet Composer, so a third zone would duplicate it.
    expect(screen.getByRole('navigation', { name: /workspace sidebar/i })).toBeTruthy();
    expect(screen.getByTestId('editor-stub')).toBeTruthy();
    // Old placeholder text and its `data-doc-area-placeholder` hook must be gone.
    expect(screen.queryByText(/Document area \(placeholder\)/i)).toBeNull();
    expect(container.querySelector('[data-doc-area-placeholder]')).toBeNull();
    // The new mount carries `data-doc-area` so the focus-mode CSS rule applies.
    expect(container.querySelector('[data-doc-area]')).toBeTruthy();
    // The pre-#102 reserved placeholder must not render.
    expect(screen.queryByText(/Reserved \(placeholder\)/i)).toBeNull();
  });

  it('renders sidebar at the layout-root level and a single-column doc area (#102, post live-test 2026-04-25 restructure)', () => {
    const { container } = renderWithProviders(<QuietLayout {...defaultProps()} />);
    // Sidebar is now a SIBLING of the doc-area column (not inside the
    // doc-area grid). Layout root is `flex` (row) with the sidebar
    // first and a flex-col content column second.
    const root = container.querySelector('[data-quiet-layout-root]') as HTMLElement;
    expect(root).toBeTruthy();
    const sidebar = root.querySelector('nav[aria-label="Workspace sidebar"]');
    const docArea = root.querySelector('[data-quiet-layout-document-area]') as HTMLElement;
    expect(sidebar).toBeTruthy();
    expect(docArea).toBeTruthy();
    // The sidebar is NOT a descendant of the doc-area in the new layout.
    expect(docArea?.contains(sidebar)).toBe(false);
    // The layout root publishes `--quiet-sidebar-width` so the
    // FloatingCommandBar can centre on the doc-area's centre.
    expect(document.documentElement.style.getPropertyValue('--quiet-sidebar-width')).toBe('252px');
  });

  it('mounts the FloatingCommandBar', () => {
    renderWithProviders(<QuietLayout {...defaultProps()} />);
    expect(screen.getByTestId('cmd-bar-stub')).toBeTruthy();
  });

  it('mounts the AgentOrb (#29)', () => {
    renderWithProviders(<QuietLayout {...defaultProps()} />);
    expect(screen.getByTestId('agent-orb-stub')).toBeTruthy();
  });

  it('forwards a falsy focusMode to the Editor by default', () => {
    renderWithProviders(<QuietLayout {...defaultProps()} />);
    const editor = screen.getByTestId('editor-stub') as HTMLElement;
    expect(editor.getAttribute('data-focus-mode')).toBe('false');
  });

  it('forwards focusMode=true when the App-level prop is set', () => {
    renderWithProviders(
      <QuietLayout {...defaultProps({ focusMode: true })} />,
    );
    const editor = screen.getByTestId('editor-stub') as HTMLElement;
    expect(editor.getAttribute('data-focus-mode')).toBe('true');
  });

  // -------------------------------------------------------------------------
  // Focus mode title bar visibility (#150)
  // -------------------------------------------------------------------------

  it('renders TitleBar with data-titlebar-mode="quiet" so .app.focus-mode CSS can hide it (#150)', () => {
    // mockup-f calls for the title bar to be HIDDEN entirely in focus mode
    // (display: none, not just dimmed). The hide rule lives in globals.css
    // and targets `[data-titlebar-mode="quiet"]` under `.app.focus-mode`;
    // this test locks the attribute in so the rule doesn't silently stop
    // matching after a TitleBar refactor.
    const { container } = renderWithProviders(<QuietLayout {...defaultProps()} />);
    const titlebar = container.querySelector('[data-testid="titlebar"]') as HTMLElement;
    expect(titlebar.getAttribute('data-titlebar-mode')).toBe('quiet');
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

  // -------------------------------------------------------------------------
  // Translucent chrome (#142)
  // -------------------------------------------------------------------------

  describe('translucent chrome (#142)', () => {
    it('does NOT add pt-11 to the doc area when transparent (so editor scrolls behind frosted title bar)', () => {
      mockQuietChromeTransparent = true;
      const { container } = renderWithProviders(<QuietLayout {...defaultProps()} />);
      const docArea = container.querySelector(
        '[data-quiet-layout-document-area]',
      ) as HTMLElement;
      // The earlier #132 implementation added `pt-11` to clear the title
      // bar — that defeated the frosted-glass effect because no content
      // ever passed behind it. The clearance now lives inside the editor's
      // scroll content (and the floating pill toolbar) via globals.css
      // selectors keyed on `data-quiet-chrome-transparent="true"`.
      expect(docArea.className).not.toMatch(/\bpt-11\b/);
    });

    it('marks the layout root with data-quiet-chrome-transparent so editor CSS rules can attach', () => {
      mockQuietChromeTransparent = true;
      const { container } = renderWithProviders(<QuietLayout {...defaultProps()} />);
      const root = container.querySelector(
        '[data-quiet-layout-root]',
      ) as HTMLElement;
      expect(root.getAttribute('data-quiet-chrome-transparent')).toBe('true');
    });

    it('marks the layout root with data-quiet-chrome-transparent="false" when off', () => {
      mockQuietChromeTransparent = false;
      const { container } = renderWithProviders(<QuietLayout {...defaultProps()} />);
      const root = container.querySelector(
        '[data-quiet-layout-root]',
      ) as HTMLElement;
      expect(root.getAttribute('data-quiet-chrome-transparent')).toBe('false');
    });
  });

  // -------------------------------------------------------------------------
  // Sidebar visibility toggle (#123 — ⌘⇧L observer side)
  // -------------------------------------------------------------------------
  //
  // `⌘⇧L` flips `settings-store.sidebarPinned` (done in
  // `useKeyboardShortcuts`); QuietLayout observes the flag and either
  // renders the sidebar with a 240px grid track, or omits it entirely with
  // a single `1fr` column. These tests cover the observer side only — the
  // chord wiring has its own test in `useKeyboardShortcuts.test.tsx`.

  describe('sidebar visibility (#123, post live-test 2026-04-25 restructure)', () => {
    it('renders QuietSidebar and publishes --quiet-sidebar-width=252px when pinned', () => {
      mockSidebarPinned = true;
      const { container } = renderWithProviders(<QuietLayout {...defaultProps()} />);
      expect(
        screen.getByRole('navigation', { name: /workspace sidebar/i }),
      ).toBeTruthy();
      const docArea = container.querySelector(
        '[data-quiet-layout-document-area]',
      ) as HTMLElement;
      expect(document.documentElement.style.getPropertyValue('--quiet-sidebar-width')).toBe('252px');
      expect(docArea.getAttribute('data-sidebar-pinned')).toBe('true');
    });

    it('omits QuietSidebar and publishes --quiet-sidebar-width=0px when unpinned', () => {
      mockSidebarPinned = false;
      const { container } = renderWithProviders(<QuietLayout {...defaultProps()} />);
      expect(
        screen.queryByRole('navigation', { name: /workspace sidebar/i }),
      ).toBeNull();
      const docArea = container.querySelector(
        '[data-quiet-layout-document-area]',
      ) as HTMLElement;
      expect(document.documentElement.style.getPropertyValue('--quiet-sidebar-width')).toBe('0px');
      expect(docArea.getAttribute('data-sidebar-pinned')).toBe('false');
    });

    it('flips visibility between renders when sidebarPinned changes', () => {
      mockSidebarPinned = true;
      const { rerender } = renderWithProviders(
        <QuietLayout {...defaultProps()} />,
      );
      expect(
        screen.queryByRole('navigation', { name: /workspace sidebar/i }),
      ).toBeTruthy();

      mockSidebarPinned = false;
      rerender(<QuietLayout {...defaultProps()} />);

      expect(
        screen.queryByRole('navigation', { name: /workspace sidebar/i }),
      ).toBeNull();
      expect(document.documentElement.style.getPropertyValue('--quiet-sidebar-width')).toBe('0px');
    });

    it('regression: sidebar hidden + cmd bar pinned coexist (var=0px, doc-area padding preserved)', () => {
      mockSidebarPinned = false;
      mockCmdBarPinned = true;
      const { container } = renderWithProviders(<QuietLayout {...defaultProps()} />);
      const docArea = container.querySelector(
        '[data-quiet-layout-document-area]',
      ) as HTMLElement;
      expect(document.documentElement.style.getPropertyValue('--quiet-sidebar-width')).toBe('0px');
      // Pinned cmd bar still reserves right padding via the CSS variable.
      expect(docArea.style.paddingRight).toContain('--cmd-bar-pinned-width');
      expect(docArea.getAttribute('data-sidebar-pinned')).toBe('false');
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
    mockSidebarPinned = true;
    vi.mocked(mockedToast.info).mockReset();
    useQuietSidebarStore.setState({ pendingCreate: null });
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
      openDocuments: [
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
      openDocuments: [
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
      openDocuments: [
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
      openDocuments: [
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
      openDocuments: [
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
    mockSidebarPinned = true;
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
      openDocuments: [],
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
      openDocuments: [
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

// =============================================================================
// QuietLayout — Cmd+Shift+E TreeOverlay handler (#139) — REMOVED in #20
// =============================================================================
//
// The capture-phase listener in QuietLayout that preempted the legacy
// Export-as-PDF chord was deleted alongside TreeOverlay in
// sidebar-simplification task #20. ⌘⇧E now bubbles to
// `useKeyboardShortcuts` and opens the multi-format Export dialog.
// The original #139 regression test asserted the preempt; with
// TreeOverlay gone there's nothing to preempt and nothing to test here.
