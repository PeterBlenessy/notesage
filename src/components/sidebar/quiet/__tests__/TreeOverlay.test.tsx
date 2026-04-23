// @vitest-environment jsdom

/**
 * Tests for TreeOverlay — the slide-in workspace-tree panel
 * (PRD `2026-04-21-ui-refresh`, task #38).
 *
 * We exercise behaviour, not pixel positions: store gating, focus
 * management (restore), ARIA structure, filter behaviour, keyboard nav
 * (Arrow keys, Enter/Space, Home/End, Escape), expand/collapse, and the
 * file-open callback. The workspace-store is set directly to a small
 * controlled tree per test.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act } from 'react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders, screen, within, fireEvent } from '@/test/component-harness';

import { TreeOverlay } from '../TreeOverlay';
import { useTreeOverlayStore } from '@/stores/tree-overlay-store';
import { useWorkspaceStore } from '@/stores/workspace-store';
import { useEditorStore } from '@/stores/editor-store';
import type { FileEntry } from '@/lib/tauri';

// ---------------------------------------------------------------------------
// Mock useFileOperations — TreeOverlay calls openFile on file click / Enter.
// ---------------------------------------------------------------------------

const mockOpenFile = vi.fn();

vi.mock('@/hooks/useFileOperations', () => ({
  useFileOperations: vi.fn(() => ({
    openFile: mockOpenFile,
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

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

function file(name: string, path: string): FileEntry {
  return { name, path, is_directory: false, hidden: false };
}

function dir(name: string, path: string, children: FileEntry[] = []): FileEntry {
  return {
    name,
    path,
    is_directory: true,
    children,
    hidden: false,
  };
}

function resetStores(): void {
  useWorkspaceStore.setState({
    explorerFolders: [],
    projects: [],
    recentProjects: [],
    notesTree: [],
    pinnedFiles: [],
    expandedFolders: new Set<string>(),
    explorerCollapsed: false,
    projectsCollapsed: false,
    notesCollapsed: false,
  });
  useEditorStore.setState({
    openDocuments: [],
    activeTabId: null,
  });
  useTreeOverlayStore.setState({ open: false, focusedPath: null });
}

/**
 * Builds a small two-project workspace:
 *   alpha/
 *     docs/
 *       intro.md
 *     readme.md
 *   beta/
 *     notes.md
 */
function seedWorkspace(): void {
  useWorkspaceStore.setState({
    projects: [
      {
        path: '/w/alpha',
        fileTree: [
          dir('docs', '/w/alpha/docs', [file('intro.md', '/w/alpha/docs/intro.md')]),
          file('readme.md', '/w/alpha/readme.md'),
        ],
      },
      {
        path: '/w/beta',
        fileTree: [file('notes.md', '/w/beta/notes.md')],
      },
    ],
  });
}

beforeEach(() => {
  resetStores();
  mockOpenFile.mockReset();
  mockOpenFile.mockResolvedValue(undefined);
});

// ---------------------------------------------------------------------------
// Render + open
// ---------------------------------------------------------------------------

describe('TreeOverlay — visibility', () => {
  it('renders nothing when the store is closed', () => {
    renderWithProviders(<TreeOverlay />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('renders the dialog when openOverlay() is called', () => {
    renderWithProviders(<TreeOverlay />);
    act(() => {
      useTreeOverlayStore.getState().openOverlay();
    });
    const dialog = screen.getByRole('dialog', { name: /workspace tree/i });
    expect(dialog).toBeTruthy();
  });

  it('auto-focuses the search input on open', async () => {
    renderWithProviders(<TreeOverlay />);
    act(() => {
      useTreeOverlayStore.getState().openOverlay();
    });
    // requestAnimationFrame is invoked inside the effect — wait for it.
    await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
    const input = screen.getByRole('searchbox', { name: /filter workspace tree/i });
    expect(document.activeElement).toBe(input);
  });
});

// ---------------------------------------------------------------------------
// Esc closes + restores focus
// ---------------------------------------------------------------------------

describe('TreeOverlay — Escape closes and restores focus', () => {
  it('closes the overlay and returns focus to the previously-focused element', async () => {
    // Element to "own" focus before the overlay opens.
    const trigger = document.createElement('button');
    trigger.textContent = 'before-open';
    document.body.appendChild(trigger);
    trigger.focus();
    expect(document.activeElement).toBe(trigger);

    seedWorkspace();
    renderWithProviders(<TreeOverlay />);
    act(() => {
      useTreeOverlayStore.getState().openOverlay();
    });
    // Wait for the rAF-scheduled focus move to the search input.
    await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
    const input = screen.getByRole('searchbox');
    expect(document.activeElement).toBe(input);

    // Press Escape inside the overlay.
    fireEvent.keyDown(input, { key: 'Escape' });

    // Overlay closes synchronously…
    expect(useTreeOverlayStore.getState().open).toBe(false);
    expect(screen.queryByRole('dialog')).toBeNull();

    // …and focus is restored on the next rAF tick.
    await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
    expect(document.activeElement).toBe(trigger);

    document.body.removeChild(trigger);
  });
});

// ---------------------------------------------------------------------------
// ARIA structure
// ---------------------------------------------------------------------------

describe('TreeOverlay — ARIA', () => {
  it('renders role="tree" with one treeitem per visible node', () => {
    seedWorkspace();
    renderWithProviders(<TreeOverlay />);
    act(() => {
      useTreeOverlayStore.getState().openOverlay();
    });

    const tree = screen.getByRole('tree', { name: /workspace tree/i });
    expect(tree).toBeTruthy();

    // Default: project roots expanded (alpha, beta), so we see:
    //   alpha, docs, readme.md, beta, notes.md  =  5 treeitems.
    // `docs` starts collapsed so intro.md is not yet visible.
    const items = within(tree).getAllByRole('treeitem');
    expect(items.map((el) => el.textContent)).toEqual([
      'alpha',
      'docs',
      'readme.md',
      'beta',
      'notes.md',
    ]);
  });

  it('sets aria-level and aria-expanded on directory items', () => {
    seedWorkspace();
    renderWithProviders(<TreeOverlay />);
    act(() => {
      useTreeOverlayStore.getState().openOverlay();
    });

    const tree = screen.getByRole('tree');
    const items = within(tree).getAllByRole('treeitem');

    const alpha = items.find((el) => el.textContent === 'alpha')!;
    expect(alpha.getAttribute('aria-level')).toBe('1');
    expect(alpha.getAttribute('aria-expanded')).toBe('true');

    const docs = items.find((el) => el.textContent === 'docs')!;
    expect(docs.getAttribute('aria-level')).toBe('2');
    expect(docs.getAttribute('aria-expanded')).toBe('false');
  });
});

// ---------------------------------------------------------------------------
// Caret toggle
// ---------------------------------------------------------------------------

describe('TreeOverlay — expand/collapse', () => {
  it('clicking a directory toggles its expansion and reveals children', async () => {
    seedWorkspace();
    renderWithProviders(<TreeOverlay />);
    act(() => {
      useTreeOverlayStore.getState().openOverlay();
    });
    const user = userEvent.setup();

    // `docs` starts collapsed — intro.md is not visible.
    expect(screen.queryByText('intro.md')).toBeNull();

    const docsRow = screen.getByText('docs');
    await user.click(docsRow);

    expect(screen.getByText('intro.md')).toBeTruthy();

    // Clicking again collapses.
    await user.click(screen.getByText('docs'));
    expect(screen.queryByText('intro.md')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Filter
// ---------------------------------------------------------------------------

describe('TreeOverlay — filter', () => {
  it('hides non-matching nodes and keeps ancestors of matches visible', async () => {
    seedWorkspace();
    renderWithProviders(<TreeOverlay />);
    act(() => {
      useTreeOverlayStore.getState().openOverlay();
    });

    const input = screen.getByRole('searchbox') as HTMLInputElement;
    const user = userEvent.setup();
    await user.type(input, 'intro');

    // `readme.md`, `notes.md`, `beta` should be filtered out.
    // `alpha > docs > intro.md` stays because `intro.md` matches.
    expect(screen.getByText('alpha')).toBeTruthy();
    expect(screen.getByText('docs')).toBeTruthy();
    expect(screen.getByText('intro.md')).toBeTruthy();
    expect(screen.queryByText('readme.md')).toBeNull();
    expect(screen.queryByText('beta')).toBeNull();
    expect(screen.queryByText('notes.md')).toBeNull();
  });

  it('is case-insensitive', async () => {
    seedWorkspace();
    renderWithProviders(<TreeOverlay />);
    act(() => {
      useTreeOverlayStore.getState().openOverlay();
    });
    const input = screen.getByRole('searchbox');
    const user = userEvent.setup();
    await user.type(input, 'INTRO');
    expect(screen.getByText('intro.md')).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Keyboard navigation
// ---------------------------------------------------------------------------

function getOverlayDialog(): HTMLElement {
  return screen.getByRole('dialog', { name: /workspace tree/i });
}

function getFocusedNode(): HTMLElement | null {
  return document.querySelector('[data-tree-node][data-focused="true"]');
}

describe('TreeOverlay — keyboard navigation', () => {
  beforeEach(() => {
    seedWorkspace();
  });

  it('ArrowDown/ArrowUp move focus through visible nodes', async () => {
    renderWithProviders(<TreeOverlay />);
    act(() => {
      useTreeOverlayStore.getState().openOverlay();
    });
    const dialog = getOverlayDialog();

    // Press ArrowDown while the search input is focused — jumps to first node.
    const input = screen.getByRole('searchbox');
    fireEvent.keyDown(input, { key: 'ArrowDown' });

    expect(getFocusedNode()?.textContent).toBe('alpha');

    // ArrowDown on the first node moves to the next visible node.
    fireEvent.keyDown(dialog, { key: 'ArrowDown' });
    expect(getFocusedNode()?.textContent).toBe('docs');

    fireEvent.keyDown(dialog, { key: 'ArrowDown' });
    expect(getFocusedNode()?.textContent).toBe('readme.md');

    // ArrowUp walks back.
    fireEvent.keyDown(dialog, { key: 'ArrowUp' });
    expect(getFocusedNode()?.textContent).toBe('docs');
  });

  it('ArrowRight on collapsed directory expands it; second press moves to first child', () => {
    renderWithProviders(<TreeOverlay />);
    act(() => {
      useTreeOverlayStore.getState().openOverlay();
    });
    const dialog = getOverlayDialog();

    // Move focus to `docs` (collapsed).
    const input = screen.getByRole('searchbox');
    fireEvent.keyDown(input, { key: 'ArrowDown' }); // focus → alpha
    fireEvent.keyDown(dialog, { key: 'ArrowDown' }); // focus → docs
    expect(getFocusedNode()?.textContent).toBe('docs');

    // First ArrowRight → expand `docs`.
    fireEvent.keyDown(dialog, { key: 'ArrowRight' });
    expect(screen.getByText('intro.md')).toBeTruthy();

    // Second ArrowRight → move to first child.
    fireEvent.keyDown(dialog, { key: 'ArrowRight' });
    expect(getFocusedNode()?.textContent).toBe('intro.md');
  });

  it('ArrowLeft on expanded directory collapses it; on a file moves to parent', () => {
    renderWithProviders(<TreeOverlay />);
    act(() => {
      useTreeOverlayStore.getState().openOverlay();
    });
    const dialog = getOverlayDialog();
    const input = screen.getByRole('searchbox');

    // Focus `alpha` (expanded by default), then collapse.
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(getFocusedNode()?.textContent).toBe('alpha');
    fireEvent.keyDown(dialog, { key: 'ArrowLeft' });

    // `docs` and `readme.md` should no longer be rendered.
    expect(screen.queryByText('docs')).toBeNull();
    expect(screen.queryByText('readme.md')).toBeNull();

    // Re-expand to set up the "ArrowLeft on file → parent" case.
    fireEvent.keyDown(dialog, { key: 'ArrowRight' });
    fireEvent.keyDown(dialog, { key: 'ArrowDown' }); // focus → docs
    fireEvent.keyDown(dialog, { key: 'ArrowDown' }); // focus → readme.md
    expect(getFocusedNode()?.textContent).toBe('readme.md');
    fireEvent.keyDown(dialog, { key: 'ArrowLeft' });
    expect(getFocusedNode()?.textContent).toBe('alpha');
  });

  it('Enter on a file invokes openFile with (path, name)', async () => {
    renderWithProviders(<TreeOverlay />);
    act(() => {
      useTreeOverlayStore.getState().openOverlay();
    });
    const dialog = getOverlayDialog();
    const input = screen.getByRole('searchbox');

    // Focus `readme.md`.
    fireEvent.keyDown(input, { key: 'ArrowDown' }); // alpha
    fireEvent.keyDown(dialog, { key: 'ArrowDown' }); // docs
    fireEvent.keyDown(dialog, { key: 'ArrowDown' }); // readme.md
    expect(getFocusedNode()?.textContent).toBe('readme.md');

    fireEvent.keyDown(dialog, { key: 'Enter' });

    // openFile is async → give it a tick.
    await Promise.resolve();
    expect(mockOpenFile).toHaveBeenCalledWith('/w/alpha/readme.md', 'readme.md');
  });

  it('clicking a file row invokes openFile with (path, name)', async () => {
    renderWithProviders(<TreeOverlay />);
    act(() => {
      useTreeOverlayStore.getState().openOverlay();
    });

    const user = userEvent.setup();
    await user.click(screen.getByText('readme.md'));

    expect(mockOpenFile).toHaveBeenCalledWith('/w/alpha/readme.md', 'readme.md');
  });
});

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------

describe('TreeOverlay — empty state', () => {
  it('shows "No projects open" when the projects list is empty', () => {
    renderWithProviders(<TreeOverlay />);
    act(() => {
      useTreeOverlayStore.getState().openOverlay();
    });
    expect(screen.getByText(/no projects open/i)).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Focus trap — Tab/Shift+Tab cycle within the overlay only (task #81)
// ---------------------------------------------------------------------------

describe('TreeOverlay — focus trap', () => {
  beforeEach(() => {
    seedWorkspace();
  });

  /**
   * Renders a sibling button outside the overlay and returns it. Used to
   * assert that Tab cannot escape the overlay — if focus ever lands on
   * this button, the trap has leaked.
   */
  function mountSiblingButton(): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.textContent = 'outside-overlay';
    btn.setAttribute('data-testid', 'outside-overlay');
    document.body.appendChild(btn);
    return btn;
  }

  it('Tab from the last focusable wraps back to the first (search input)', async () => {
    const sibling = mountSiblingButton();
    renderWithProviders(<TreeOverlay />);
    act(() => {
      useTreeOverlayStore.getState().openOverlay();
    });
    await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));

    const dialog = getOverlayDialog();
    const input = screen.getByRole('searchbox') as HTMLInputElement;
    expect(document.activeElement).toBe(input);

    // Move keyboard focus onto the last focusable inside the overlay: the
    // currently-focused tree row (the only treeitem with tabIndex=0).
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    const focusedRow = getFocusedNode();
    expect(focusedRow).not.toBeNull();
    expect(document.activeElement).toBe(focusedRow);

    // Tab on the last focusable should wrap back to the first (search).
    fireEvent.keyDown(dialog, { key: 'Tab' });
    expect(document.activeElement).toBe(input);

    // Sanity: focus never escaped to the outside sibling.
    expect(document.activeElement).not.toBe(sibling);

    document.body.removeChild(sibling);
  });

  it('Shift+Tab from the first focusable (search input) wraps to the last', async () => {
    const sibling = mountSiblingButton();
    renderWithProviders(<TreeOverlay />);
    act(() => {
      useTreeOverlayStore.getState().openOverlay();
    });
    await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));

    const dialog = getOverlayDialog();
    const input = screen.getByRole('searchbox') as HTMLInputElement;
    expect(document.activeElement).toBe(input);

    // Shift+Tab on the first focusable should wrap to the last — which
    // is the currently-focused tree row (alpha, the first visible node).
    fireEvent.keyDown(dialog, { key: 'Tab', shiftKey: true });
    const focusedRow = getFocusedNode();
    expect(focusedRow).not.toBeNull();
    expect(document.activeElement).toBe(focusedRow);

    // Sanity: focus never escaped to the outside sibling.
    expect(document.activeElement).not.toBe(sibling);

    document.body.removeChild(sibling);
  });

  it('Tab does not move focus to elements outside the overlay', async () => {
    const sibling = mountSiblingButton();
    renderWithProviders(<TreeOverlay />);
    act(() => {
      useTreeOverlayStore.getState().openOverlay();
    });
    await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));

    const dialog = getOverlayDialog();
    const input = screen.getByRole('searchbox') as HTMLInputElement;

    // Move onto the last focusable (the focused tree row)…
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(getFocusedNode());

    // Tab and Shift+Tab repeatedly — focus should cycle within the
    // overlay only, never landing on the outside sibling.
    for (let i = 0; i < 5; i += 1) {
      fireEvent.keyDown(dialog, { key: 'Tab' });
      expect(document.activeElement).not.toBe(sibling);
      expect(dialog.contains(document.activeElement)).toBe(true);

      fireEvent.keyDown(dialog, { key: 'Tab', shiftKey: true });
      expect(document.activeElement).not.toBe(sibling);
      expect(dialog.contains(document.activeElement)).toBe(true);
    }

    document.body.removeChild(sibling);
  });
});
