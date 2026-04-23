// @vitest-environment jsdom

/**
 * Tests for QuietSidebar — the flat-list sidebar shell (task #30) and the
 * type-to-filter behavior layered on top of it (task #43).
 *
 * The shell should render the four stub sections in a fixed order (Pinned,
 * Projects, Recent, Tags). The #43 tests cover the keyboard filter state
 * (printable keys append, Backspace removes, Esc clears), the filter badge
 * visibility, and the input-skip rule that keeps nested text-entry
 * surfaces (TreeOverlay search, contenteditable cells) typeable.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  fireEvent,
  renderWithProviders,
  screen,
  within,
} from '@/test/component-harness';
import { QuietSidebar } from '../QuietSidebar';
import { useWorkspaceStore } from '@/stores/workspace-store';
import { useEditorStore } from '@/stores/editor-store';
import { useSettingsStore } from '@/stores/settings-store';

// ---------------------------------------------------------------------------
// Mocks that keep the heavier sections quiet — we exercise data filtering
// in the per-section test files; here we only care about QuietSidebar's
// keyboard / badge logic.
// ---------------------------------------------------------------------------

vi.mock('@/hooks/useFileOperations', () => ({
  useFileOperations: () => ({
    openFile: vi.fn(),
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

// Stub `indexTags` so TagsSection's async effect doesn't explode in jsdom.
vi.mock('@/lib/tauri', async () => {
  const actual = await vi.importActual<typeof import('@/lib/tauri')>('@/lib/tauri');
  return {
    ...actual,
    tauriApi: {
      ...actual.tauriApi,
      indexTags: vi.fn().mockResolvedValue([]),
    },
  };
});

function resetStores() {
  useWorkspaceStore.setState({
    explorerFolders: [],
    projects: [],
    recentProjects: [],
    notesTree: [],
    pinnedFiles: [],
  });
  useEditorStore.setState({
    openDocuments: [],
    activeTabId: null,
    recentFiles: [],
  });
  // Reset sidebar composition settings so tests don't bleed hidden state
  // across each other.
  useSettingsStore.setState({
    sidebarRecentCap: 5,
    sidebarTagsCap: 5,
    sidebarTagsHidden: false,
  });
}

beforeEach(() => {
  resetStores();
});

describe('QuietSidebar — shell', () => {
  it('renders a nav with an accessible name', () => {
    renderWithProviders(<QuietSidebar />);
    const nav = screen.getByRole('navigation', { name: /workspace sidebar/i });
    expect(nav).toBeTruthy();
  });

  it('renders all four sections in fixed order: Pinned, Projects, Recent, Tags', () => {
    renderWithProviders(<QuietSidebar />);
    const sections = screen.getAllByRole('region');
    // Each <section aria-label="..."> shows up as a region.
    expect(sections).toHaveLength(4);
    expect(sections.map((s) => s.getAttribute('aria-label'))).toEqual([
      'Pinned',
      'Projects',
      'Recent',
      'Tags',
    ]);
  });

  it('renders each section header as an h2 with the uppercase label', () => {
    renderWithProviders(<QuietSidebar />);
    const headings = screen.getAllByRole('heading', { level: 2 });
    expect(headings.map((h) => h.textContent)).toEqual([
      'Pinned',
      'Projects',
      'Recent',
      'Tags',
    ]);
  });

  it('renders empty section bodies (no items yet — G2 wires data)', () => {
    renderWithProviders(<QuietSidebar />);
    // Each section should contain only its header; no list items exist today.
    for (const section of screen.getAllByRole('region')) {
      expect(within(section).queryAllByRole('listitem')).toHaveLength(0);
    }
  });
});

// ---------------------------------------------------------------------------
// Task #43 — type-to-filter keyboard + badge
// ---------------------------------------------------------------------------

describe('QuietSidebar — type-to-filter (#43)', () => {
  it('does not render the filter badge when no filter is active', () => {
    renderWithProviders(<QuietSidebar />);
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('appends printable characters to the filter when a sidebar row is focused', () => {
    useWorkspaceStore.setState({
      pinnedFiles: ['/p/readme.md', '/p/notes.md'],
    });
    renderWithProviders(<QuietSidebar />);
    const nav = screen.getByRole('navigation', { name: /workspace sidebar/i });

    // Simulate typing "re" — first key makes the badge appear.
    fireEvent.keyDown(nav, { key: 'r' });
    const badge = screen.getByRole('status');
    expect(badge.textContent).toContain('r');

    fireEvent.keyDown(nav, { key: 'e' });
    expect(screen.getByRole('status').textContent).toContain('re');
  });

  it('filters the pinned rows to match the typed filter substring', () => {
    useWorkspaceStore.setState({
      pinnedFiles: ['/p/readme.md', '/p/notes.md', '/p/ideas.md'],
    });
    renderWithProviders(<QuietSidebar />);
    const nav = screen.getByRole('navigation', { name: /workspace sidebar/i });

    // Pre-filter: all three rows visible.
    expect(screen.getByText('readme.md')).toBeTruthy();
    expect(screen.getByText('notes.md')).toBeTruthy();
    expect(screen.getByText('ideas.md')).toBeTruthy();

    // Type "read" — only readme.md should remain.
    for (const key of 'read') {
      fireEvent.keyDown(nav, { key });
    }
    expect(screen.getByText('readme.md')).toBeTruthy();
    expect(screen.queryByText('notes.md')).toBeNull();
    expect(screen.queryByText('ideas.md')).toBeNull();
  });

  it('Backspace removes the last character; repeated Backspace clears the filter', () => {
    renderWithProviders(<QuietSidebar />);
    const nav = screen.getByRole('navigation', { name: /workspace sidebar/i });

    fireEvent.keyDown(nav, { key: 'a' });
    fireEvent.keyDown(nav, { key: 'b' });
    fireEvent.keyDown(nav, { key: 'c' });
    expect(screen.getByRole('status').textContent).toContain('abc');

    fireEvent.keyDown(nav, { key: 'Backspace' });
    expect(screen.getByRole('status').textContent).toContain('ab');
    fireEvent.keyDown(nav, { key: 'Backspace' });
    fireEvent.keyDown(nav, { key: 'Backspace' });
    // Filter is empty → badge removed from the DOM.
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('Escape clears the filter', () => {
    renderWithProviders(<QuietSidebar />);
    const nav = screen.getByRole('navigation', { name: /workspace sidebar/i });

    fireEvent.keyDown(nav, { key: 'x' });
    fireEvent.keyDown(nav, { key: 'y' });
    expect(screen.getByRole('status').textContent).toContain('xy');

    fireEvent.keyDown(nav, { key: 'Escape' });
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('the filter badge Clear button resets state on click', () => {
    renderWithProviders(<QuietSidebar />);
    const nav = screen.getByRole('navigation', { name: /workspace sidebar/i });

    fireEvent.keyDown(nav, { key: 'z' });
    fireEvent.keyDown(nav, { key: 'z' });
    expect(screen.getByRole('status').textContent).toContain('zz');

    fireEvent.click(screen.getByRole('button', { name: /clear filter/i }));
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('shortcut combos (⌘⌥C) do NOT mutate the filter', () => {
    renderWithProviders(<QuietSidebar />);
    const nav = screen.getByRole('navigation', { name: /workspace sidebar/i });

    fireEvent.keyDown(nav, { key: 'c', metaKey: true, altKey: true });
    expect(screen.queryByRole('status')).toBeNull();

    // Plain cmd-key shortcuts (⌘K, ⌘1, ⌘S) likewise don't leak.
    fireEvent.keyDown(nav, { key: 'k', metaKey: true });
    fireEvent.keyDown(nav, { key: '1', metaKey: true });
    fireEvent.keyDown(nav, { key: 's', ctrlKey: true });
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('keystrokes originating inside an <input> nested in the sidebar do not update the filter', () => {
    // Nest an input inside the sidebar nav via an explicit TreeOverlay-like
    // sibling. We test the typing-target guard by dispatching a real bubbling
    // keydown event from the input — it reaches the nav's onKeyDown via the
    // capture/bubble cycle, but the isTypingTarget check should short-circuit.
    renderWithProviders(
      <div>
        <QuietSidebar />
      </div>,
    );
    const nav = screen.getByRole('navigation', { name: /workspace sidebar/i });
    // Simulate a nested input by temporarily inserting one into the nav —
    // this is what TreeOverlay's search box will look like at runtime.
    const input = document.createElement('input');
    nav.appendChild(input);
    input.focus();
    const ev = new KeyboardEvent('keydown', {
      key: 'q',
      bubbles: true,
      cancelable: true,
    });
    input.dispatchEvent(ev);
    expect(screen.queryByRole('status')).toBeNull();
    nav.removeChild(input);
  });

  it('keystrokes originating inside a <textarea> nested in the sidebar do not update the filter', () => {
    renderWithProviders(
      <div>
        <QuietSidebar />
      </div>,
    );
    const nav = screen.getByRole('navigation', { name: /workspace sidebar/i });
    const textarea = document.createElement('textarea');
    nav.appendChild(textarea);
    textarea.focus();
    const ev = new KeyboardEvent('keydown', {
      key: 'q',
      bubbles: true,
      cancelable: true,
    });
    textarea.dispatchEvent(ev);
    expect(screen.queryByRole('status')).toBeNull();
    nav.removeChild(textarea);
  });

  it('keystrokes originating inside a contenteditable element nested in the sidebar do not update the filter', () => {
    renderWithProviders(
      <div>
        <QuietSidebar />
      </div>,
    );
    const nav = screen.getByRole('navigation', { name: /workspace sidebar/i });
    const editable = document.createElement('div');
    editable.setAttribute('contenteditable', 'true');
    nav.appendChild(editable);
    editable.focus();
    const ev = new KeyboardEvent('keydown', {
      key: 'q',
      bubbles: true,
      cancelable: true,
    });
    editable.dispatchEvent(ev);
    expect(screen.queryByRole('status')).toBeNull();
    nav.removeChild(editable);
  });

  it('named keys (Enter, Tab, ArrowUp) do not update the filter', () => {
    renderWithProviders(<QuietSidebar />);
    const nav = screen.getByRole('navigation', { name: /workspace sidebar/i });
    fireEvent.keyDown(nav, { key: 'Enter' });
    fireEvent.keyDown(nav, { key: 'Tab' });
    fireEvent.keyDown(nav, { key: 'ArrowUp' });
    fireEvent.keyDown(nav, { key: 'ArrowDown' });
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('backspace with an empty filter does not prevent event propagation', () => {
    renderWithProviders(<QuietSidebar />);
    const nav = screen.getByRole('navigation', { name: /workspace sidebar/i });
    // Dispatch a keydown directly so we can inspect defaultPrevented.
    const ev = new KeyboardEvent('keydown', {
      key: 'Backspace',
      bubbles: true,
      cancelable: true,
    });
    nav.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Task #35 — sidebar composition (hide Tags section)
// ---------------------------------------------------------------------------

describe('QuietSidebar — sidebar composition (#35)', () => {
  it('renders the Tags section by default', () => {
    renderWithProviders(<QuietSidebar />);
    const sections = screen.getAllByRole('region');
    expect(sections.map((s) => s.getAttribute('aria-label'))).toContain('Tags');
  });

  it('does NOT render the Tags section when sidebarTagsHidden is true', () => {
    useSettingsStore.setState({ sidebarTagsHidden: true });
    renderWithProviders(<QuietSidebar />);

    const sections = screen.getAllByRole('region');
    expect(sections).toHaveLength(3);
    expect(sections.map((s) => s.getAttribute('aria-label'))).toEqual([
      'Pinned',
      'Projects',
      'Recent',
    ]);
    // Tags heading is gone.
    const headings = screen.getAllByRole('heading', { level: 2 });
    expect(headings.map((h) => h.textContent)).not.toContain('Tags');
  });

  it('re-renders Tags when sidebarTagsHidden flips back to false', () => {
    useSettingsStore.setState({ sidebarTagsHidden: true });
    const { rerender } = renderWithProviders(<QuietSidebar />);
    expect(screen.getAllByRole('region')).toHaveLength(3);

    useSettingsStore.setState({ sidebarTagsHidden: false });
    rerender(<QuietSidebar />);
    expect(screen.getAllByRole('region')).toHaveLength(4);
    expect(
      screen
        .getAllByRole('region')
        .map((s) => s.getAttribute('aria-label')),
    ).toContain('Tags');
  });
});
