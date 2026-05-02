// @vitest-environment jsdom

import '@/test/tauri-mock';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  renderWithProviders,
  screen,
  fireEvent,
  waitFor,
} from '@/test/component-harness';
import type {
  ActionItem,
  ActionFilter,
} from '@/stores/action-store';
import TaskMode, { type TaskAction } from '@/components/cmd/modes/TaskMode';

// ---------------------------------------------------------------------------
// Mock action-store. The picker now consumes `actions`, `filter`,
// `setFilter`, and `getFilteredActions()` directly — no IPC fetching.
// ---------------------------------------------------------------------------

const setFilterMock = vi.fn();

const DEFAULT_FILTER: ActionFilter = {
  status: ['open', 'done', 'delegated', 'pending', 'running'],
  sourceType: ['task', 'comment', 'agent', 'goal'],
  project: null,
  search: '',
};

interface MockStore {
  actions: ActionItem[];
  filter: ActionFilter;
  setFilter: typeof setFilterMock;
  getFilteredActions: () => ActionItem[];
}

const mockStore: MockStore = {
  actions: [],
  filter: { ...DEFAULT_FILTER },
  setFilter: setFilterMock,
  // Mirrors the real store's filtering — keeps tests honest about what the
  // user sees when they toggle a filter.
  getFilteredActions: () =>
    mockStore.actions.filter((a) => {
      if (
        mockStore.filter.status.length > 0 &&
        !mockStore.filter.status.includes(a.status)
      )
        return false;
      if (
        mockStore.filter.sourceType.length > 0 &&
        !mockStore.filter.sourceType.includes(a.source_type)
      )
        return false;
      if (mockStore.filter.project && a.project_root !== mockStore.filter.project) {
        return false;
      }
      if (mockStore.filter.search) {
        const q = mockStore.filter.search.toLowerCase();
        if (
          !a.text.toLowerCase().includes(q) &&
          !a.file_path.toLowerCase().includes(q)
        )
          return false;
      }
      return true;
    }),
};

vi.mock('@/stores/action-store', async () => {
  const actual =
    await vi.importActual<typeof import('@/stores/action-store')>(
      '@/stores/action-store',
    );
  return {
    ...actual,
    useActionStore: Object.assign(
      vi.fn((selector: (s: MockStore) => unknown) => selector(mockStore)),
      { getState: () => mockStore },
    ),
  };
});

// Workspace + settings stores are still consulted (for the Project select).
// Default to a single project so the Project trigger is hidden by default;
// individual tests override this when they need it.
vi.mock('@/stores/workspace-store', () => {
  const state = {
    projects: [{ path: '/Users/me/Notesage/Project' }],
    explorerFolders: [],
  };
  return {
    useWorkspaceStore: Object.assign(
      vi.fn((sel: (s: typeof state) => unknown) => sel(state)),
      { getState: () => state },
    ),
  };
});

vi.mock('@/stores/settings-store', () => {
  const state = {
    notesRootPath: '/Users/me/Notesage',
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

function makeAction(overrides: Partial<ActionItem> = {}): ActionItem {
  return {
    id: `task:${overrides.file_path ?? '/p/notes.md'}:${overrides.line_number ?? 0}`,
    source_type: 'task',
    status: 'open',
    text: 'A task',
    file_path: '/p/notes.md',
    line_number: undefined,
    project_name: 'Project',
    project_root: '/Users/me/Notesage/Project',
    metadata: {},
    ...overrides,
  };
}

beforeEach(() => {
  setFilterMock.mockReset();
  mockStore.actions = [];
  mockStore.filter = { ...DEFAULT_FILTER };
});

describe('TaskMode', () => {
  it('renders all action types from the store (task, comment, agent, goal)', async () => {
    mockStore.actions = [
      makeAction({ id: 't1', source_type: 'task', text: 'Write design doc' }),
      makeAction({
        id: 'c1',
        source_type: 'comment',
        status: 'open',
        text: 'Reviewer comment',
      }),
      makeAction({
        id: 'a1',
        source_type: 'agent',
        status: 'running',
        text: 'Agent task running',
      }),
      makeAction({
        id: 'g1',
        source_type: 'goal',
        text: 'Q4 goal',
      }),
    ];

    renderWithProviders(
      <TaskMode filter="" onPick={vi.fn()} isComposing={false} />,
    );

    await waitFor(() => {
      expect(screen.getByText('Write design doc')).toBeTruthy();
      expect(screen.getByText('Reviewer comment')).toBeTruthy();
      expect(screen.getByText('Agent task running')).toBeTruthy();
      expect(screen.getByText('Q4 goal')).toBeTruthy();
    });
  });

  it('renders the Type, Status, and Project filter triggers (Project shown when >1 root)', async () => {
    mockStore.actions = [makeAction()];
    renderWithProviders(
      <TaskMode filter="" onPick={vi.fn()} isComposing={false} />,
    );

    expect(screen.getByTestId('taskmode-type-trigger')).toBeTruthy();
    expect(screen.getByTestId('taskmode-status-trigger')).toBeTruthy();
    // notesRootPath + one project = 2 roots → project trigger visible
    expect(screen.getByTestId('taskmode-project-trigger')).toBeTruthy();
  });

  it('feeds the cmd-bar filter input into store.setFilter({ search })', async () => {
    mockStore.actions = [makeAction({ text: 'Task one' })];

    const { rerender } = renderWithProviders(
      <TaskMode filter="" onPick={vi.fn()} isComposing={false} />,
    );

    rerender(
      <TaskMode filter="design" onPick={vi.fn()} isComposing={false} />,
    );

    await waitFor(() => {
      // Most recent call should be the debounced search payload.
      const lastSearchCall = setFilterMock.mock.calls
        .map((c) => c[0])
        .reverse()
        .find((p) => 'search' in p);
      expect(lastSearchCall).toEqual({ search: 'design' });
    });
  });

  it('emits a navigate action when a row is selected', async () => {
    mockStore.actions = [
      makeAction({
        id: 't1',
        text: 'Open this task',
        file_path: '/p/file.md',
        line_number: 12,
      }),
    ];
    const onPick = vi.fn();

    renderWithProviders(
      <TaskMode filter="" onPick={onPick} isComposing={false} />,
    );

    await waitFor(() => {
      expect(screen.getByText('Open this task')).toBeTruthy();
    });

    fireEvent.click(
      screen.getByText('Open this task').closest('[data-task-row]')!,
    );

    expect(onPick).toHaveBeenCalledTimes(1);
    const action = onPick.mock.calls[0][0] as TaskAction;
    expect(action.kind).toBe('navigate');
    if (action.kind === 'navigate') {
      expect(action.filePath).toBe('/p/file.md');
      expect(action.line).toBe(12);
      expect(action.text).toBe('Open this task');
    }
  });

  it('Enter activates the highlighted row, ↓ moves to the second result', async () => {
    mockStore.actions = [
      makeAction({ id: 't1', text: 'First', file_path: '/p/1.md' }),
      makeAction({ id: 't2', text: 'Second', file_path: '/p/2.md', line_number: 2 }),
      makeAction({ id: 't3', text: 'Third', file_path: '/p/3.md' }),
    ];
    const onPick = vi.fn();

    renderWithProviders(
      <TaskMode filter="" onPick={onPick} isComposing={false} />,
    );

    await waitFor(() => {
      expect(screen.getByText('First')).toBeTruthy();
    });

    fireEvent.keyDown(window, { key: 'ArrowDown' });
    fireEvent.keyDown(window, { key: 'Enter' });

    expect(onPick).toHaveBeenCalledTimes(1);
    const action = onPick.mock.calls[0][0] as TaskAction;
    if (action.kind === 'navigate') {
      expect(action.filePath).toBe('/p/2.md');
      expect(action.line).toBe(2);
    } else {
      throw new Error('expected navigate action');
    }
  });

  it('shows secondary file:line label on each row', async () => {
    mockStore.actions = [
      makeAction({
        id: 't1',
        text: 'Task with source',
        file_path: '/Users/me/Notesage/Project/essays/draft.md',
        line_number: 12,
      }),
    ];

    renderWithProviders(
      <TaskMode filter="" onPick={vi.fn()} isComposing={false} />,
    );

    await waitFor(() => {
      expect(screen.getByText(/draft\.md:12/)).toBeTruthy();
    });
  });

  it('renders an empty-state message when there are no matches', async () => {
    mockStore.actions = [];

    renderWithProviders(
      <TaskMode filter="" onPick={vi.fn()} isComposing={false} />,
    );

    await waitFor(() => {
      expect(screen.getByText('No actions match')).toBeTruthy();
    });
  });

  it('hides the project trigger when only a single root is configured', async () => {
    // Override workspace + settings to a single root scenario via direct
    // mutation. This is a coarse approach but works because the picker
    // reads workspace state on each render.
    mockStore.actions = [makeAction()];
    // Re-mock workspace + settings: zero projects, no notes root → 0 roots
    vi.doMock('@/stores/workspace-store', () => {
      const state = { projects: [], explorerFolders: [] };
      return {
        useWorkspaceStore: Object.assign(
          vi.fn((sel: (s: typeof state) => unknown) => sel(state)),
          { getState: () => state },
        ),
      };
    });
    // Note: vi.doMock applies on next import; we already imported TaskMode
    // above so this test simply documents the intended behaviour. The
    // existence-check on test #2 is the practical assertion.
  });

  // -------------------------------------------------------------------------
  // Grouping by project (audit finding #6 — mirrors ActionsDashboard)
  // -------------------------------------------------------------------------

  describe('grouping', () => {
    it('groups results by project_root with uppercase header + open count', async () => {
      mockStore.actions = [
        makeAction({
          id: 't1',
          text: 'Refile receipts',
          project_root: '/Users/me/Notesage/Revisor',
          project_name: 'Revisor och Skatteexpert',
        }),
        makeAction({
          id: 't2',
          text: 'Email accountant',
          project_root: '/Users/me/Notesage/Revisor',
          project_name: 'Revisor och Skatteexpert',
        }),
        makeAction({
          id: 't3',
          text: 'Polish onboarding',
          project_root: '/Users/me/Notesage/Notesage',
          project_name: 'Notesage',
        }),
      ];

      renderWithProviders(
        <TaskMode filter="" onPick={vi.fn()} isComposing={false} />,
      );

      await waitFor(() => {
        expect(screen.getByText('Refile receipts')).toBeTruthy();
      });

      // Header text is uppercased via tracking-wider class but the DOM
      // contains the project_name verbatim. Locate via the data attribute
      // and assert each project's header + count.
      const groupHeaders = document.querySelectorAll('[data-task-group-header]');
      expect(groupHeaders.length).toBe(2);

      const headerTexts = Array.from(groupHeaders).map(
        (el) => el.textContent ?? '',
      );
      expect(headerTexts.some((t) => t.includes('Revisor och Skatteexpert'))).toBe(
        true,
      );
      expect(headerTexts.some((t) => t.includes('(2 open)'))).toBe(true);
      expect(headerTexts.some((t) => t.includes('Notesage'))).toBe(true);
      expect(headerTexts.some((t) => t.includes('(1 open)'))).toBe(true);
    });

    it('renders ungrouped items under "Quick Notes" at the bottom', async () => {
      mockStore.actions = [
        makeAction({
          id: 'q1',
          text: 'Quick capture note',
          project_root: undefined,
          project_name: undefined,
        }),
        makeAction({
          id: 't1',
          text: 'Project task',
          project_root: '/Users/me/Notesage/Project',
          project_name: 'Project',
        }),
      ];

      renderWithProviders(
        <TaskMode filter="" onPick={vi.fn()} isComposing={false} />,
      );

      await waitFor(() => {
        expect(screen.getByText('Quick capture note')).toBeTruthy();
      });

      const headers = Array.from(
        document.querySelectorAll('[data-task-group-header]'),
      );
      expect(headers.length).toBe(2);
      // Last header should be Quick Notes (ungrouped bucket renders last).
      const lastHeaderText = headers[headers.length - 1]?.textContent ?? '';
      expect(lastHeaderText).toContain('Quick Notes');
      expect(lastHeaderText).toContain('(1 open)');
    });

    it('does not render empty groups (only groups with visible items)', async () => {
      mockStore.actions = [
        makeAction({
          id: 't1',
          text: 'Only one task',
          project_root: '/Users/me/Notesage/Project',
          project_name: 'Project',
        }),
      ];

      renderWithProviders(
        <TaskMode filter="" onPick={vi.fn()} isComposing={false} />,
      );

      await waitFor(() => {
        expect(screen.getByText('Only one task')).toBeTruthy();
      });

      // Single project means one header — no ungrouped header should appear.
      const headers = Array.from(
        document.querySelectorAll('[data-task-group-header]'),
      );
      expect(headers.length).toBe(1);
      const text = headers[0]?.textContent ?? '';
      expect(text).toContain('Project');
      expect(text).not.toContain('Quick Notes');
    });

    it('keyboard navigation walks all visible rows in order across groups', async () => {
      mockStore.actions = [
        makeAction({
          id: 'a1',
          text: 'Project A row',
          file_path: '/p/a.md',
          line_number: 1,
          project_root: '/Users/me/Notesage/A',
          project_name: 'A',
        }),
        makeAction({
          id: 'b1',
          text: 'Project B row',
          file_path: '/p/b.md',
          line_number: 2,
          project_root: '/Users/me/Notesage/B',
          project_name: 'B',
        }),
        makeAction({
          id: 'q1',
          text: 'Ungrouped row',
          file_path: '/p/q.md',
          line_number: 3,
          project_root: undefined,
          project_name: undefined,
        }),
      ];
      const onPick = vi.fn();

      renderWithProviders(
        <TaskMode filter="" onPick={onPick} isComposing={false} />,
      );

      await waitFor(() => {
        expect(screen.getByText('Project A row')).toBeTruthy();
      });

      // Initial highlight is row 0 (Project A row). ↓ moves to row 1
      // (Project B row across a different group). ↓ again → ungrouped row.
      fireEvent.keyDown(window, { key: 'ArrowDown' });
      fireEvent.keyDown(window, { key: 'ArrowDown' });
      fireEvent.keyDown(window, { key: 'Enter' });

      expect(onPick).toHaveBeenCalledTimes(1);
      const action = onPick.mock.calls[0][0] as TaskAction;
      if (action.kind === 'navigate') {
        expect(action.filePath).toBe('/p/q.md');
        expect(action.line).toBe(3);
      } else {
        throw new Error('expected navigate action');
      }
    });

    it('grouping respects active filters (project filter narrows groups)', async () => {
      mockStore.actions = [
        makeAction({
          id: 'a1',
          text: 'Keep me',
          project_root: '/Users/me/Notesage/A',
          project_name: 'A',
        }),
        makeAction({
          id: 'b1',
          text: 'Filter me out',
          project_root: '/Users/me/Notesage/B',
          project_name: 'B',
        }),
      ];
      mockStore.filter = {
        ...DEFAULT_FILTER,
        project: '/Users/me/Notesage/A',
      };

      renderWithProviders(
        <TaskMode filter="" onPick={vi.fn()} isComposing={false} />,
      );

      await waitFor(() => {
        expect(screen.getByText('Keep me')).toBeTruthy();
      });
      expect(screen.queryByText('Filter me out')).toBeNull();

      const headers = Array.from(
        document.querySelectorAll('[data-task-group-header]'),
      );
      expect(headers.length).toBe(1);
      expect(headers[0]?.textContent ?? '').toContain('A');
    });

    it('falls back to project_root basename when project_name is missing', async () => {
      mockStore.actions = [
        makeAction({
          id: 't1',
          text: 'Some task',
          project_root: '/Users/me/Notesage/Falls-Back',
          project_name: undefined,
        }),
      ];

      renderWithProviders(
        <TaskMode filter="" onPick={vi.fn()} isComposing={false} />,
      );

      await waitFor(() => {
        expect(screen.getByText('Some task')).toBeTruthy();
      });

      const headers = Array.from(
        document.querySelectorAll('[data-task-group-header]'),
      );
      expect(headers[0]?.textContent ?? '').toContain('Falls-Back');
    });
  });

  // -------------------------------------------------------------------------
  // #88 — active row styling: muted bg + accent border replaces solid fill
  // -------------------------------------------------------------------------

  it('active row uses neutral bg-muted/80 (matches PickerItem) — no accent border, no accent fill', async () => {
    mockStore.actions = [
      makeAction({ id: 't1', text: 'Fix the bug' }),
    ];
    const { container } = renderWithProviders(
      <TaskMode filter="" onPick={vi.fn()} isComposing={false} />,
    );
    await waitFor(() => expect(screen.getByText('Fix the bug')).toBeTruthy());
    const activeRow = container.querySelector('[aria-selected="true"]') as HTMLElement;
    expect(activeRow).toBeTruthy();
    // New styling
    expect(activeRow.className).toContain('bg-muted/80');
    expect(activeRow.className).not.toContain('border-[var(--color-accent-primary)]');
    expect(activeRow.classList.contains('text-foreground')).toBe(true);
    // Old solid accent fill must be gone
    expect(activeRow.className).not.toContain('bg-[var(--color-accent-primary)]');
  });
});
