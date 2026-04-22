// @vitest-environment jsdom

import '@/test/tauri-mock';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  renderWithProviders,
  screen,
  fireEvent,
  waitFor,
  setMockInvokeHandler,
} from '@/test/component-harness';
import type { IndexedTask } from '@/lib/tauri';
import TaskMode, { type TaskAction } from '@/components/cmd/modes/TaskMode';

// ---------------------------------------------------------------------------
// Mock workspace + settings stores so the picker can derive scan paths.
//
// TaskMode needs to know where to look for indexed tasks. We feed it a small
// fixed workspace: one project at /Users/me/Notesage/Project + a notes root.
// ---------------------------------------------------------------------------

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

function makeTask(overrides: Partial<IndexedTask> = {}): IndexedTask {
  return {
    path: '/Users/me/Notesage/Project/notes.md',
    file_name: 'notes.md',
    text: 'A task',
    done: false,
    position: 0,
    context_before: '',
    context_after: '',
    project_name: 'Project',
    ...overrides,
  };
}

beforeEach(() => {
  // Default: no tasks. Each test overrides this.
  setMockInvokeHandler('index_tasks', () => []);
});

describe('TaskMode', () => {
  it('renders top tasks when filter is empty', async () => {
    const tasks: IndexedTask[] = [
      makeTask({ text: 'Write the design doc', position: 1 }),
      makeTask({ text: 'Review PR #42', position: 2 }),
      makeTask({ text: 'Ship the feature', position: 3 }),
    ];
    setMockInvokeHandler('index_tasks', () => tasks);

    renderWithProviders(
      <TaskMode filter="" onPick={vi.fn()} isComposing={false} />,
    );

    await waitFor(() => {
      expect(screen.getByText('Write the design doc')).toBeTruthy();
      expect(screen.getByText('Review PR #42')).toBeTruthy();
      expect(screen.getByText('Ship the feature')).toBeTruthy();
    });
  });

  it('filters by case-insensitive substring on task text', async () => {
    const tasks: IndexedTask[] = [
      makeTask({ text: 'Write the design doc', position: 1 }),
      makeTask({ text: 'Review PR #42', position: 2 }),
      makeTask({ text: 'Ship the feature', position: 3 }),
    ];
    setMockInvokeHandler('index_tasks', () => tasks);

    renderWithProviders(
      <TaskMode filter="REVIEW" onPick={vi.fn()} isComposing={false} />,
    );

    await waitFor(() => {
      expect(screen.getByText('Review PR #42')).toBeTruthy();
    });
    expect(screen.queryByText('Write the design doc')).toBeNull();
    expect(screen.queryByText('Ship the feature')).toBeNull();
  });

  it('emits an attach action when composing', async () => {
    const tasks: IndexedTask[] = [
      makeTask({ text: 'Fix the bug', path: '/p/a.md', position: 7 }),
    ];
    setMockInvokeHandler('index_tasks', () => tasks);
    const onPick = vi.fn();

    renderWithProviders(
      <TaskMode filter="" onPick={onPick} isComposing={true} />,
    );

    await waitFor(() => {
      expect(screen.getByText('Fix the bug')).toBeTruthy();
    });

    fireEvent.click(screen.getByText('Fix the bug').closest('[data-task-row]')!);

    expect(onPick).toHaveBeenCalledTimes(1);
    const action = onPick.mock.calls[0][0] as TaskAction;
    expect(action.kind).toBe('attach');
    if (action.kind === 'attach') {
      expect(action.chip.kind).toBe('task');
      expect(action.chip.name).toBe('Fix the bug');
      expect(action.chip.id).toContain('/p/a.md');
    }
  });

  it('emits a navigate action when not composing', async () => {
    const tasks: IndexedTask[] = [
      makeTask({
        text: 'Open doc',
        path: '/Users/me/Notesage/Project/doc.md',
        position: 24,
      }),
    ];
    setMockInvokeHandler('index_tasks', () => tasks);
    const onPick = vi.fn();

    renderWithProviders(
      <TaskMode filter="" onPick={onPick} isComposing={false} />,
    );

    await waitFor(() => {
      expect(screen.getByText('Open doc')).toBeTruthy();
    });

    fireEvent.click(screen.getByText('Open doc').closest('[data-task-row]')!);

    expect(onPick).toHaveBeenCalledTimes(1);
    const action = onPick.mock.calls[0][0] as TaskAction;
    expect(action.kind).toBe('navigate');
    if (action.kind === 'navigate') {
      expect(action.filePath).toBe('/Users/me/Notesage/Project/doc.md');
      expect(action.line).toBe(24);
    }
  });

  it('shows source path on each row', async () => {
    const tasks: IndexedTask[] = [
      makeTask({
        text: 'Task with source',
        path: '/Users/me/Notesage/Project/essays/draft.md',
        file_name: 'draft.md',
        position: 12,
      }),
    ];
    setMockInvokeHandler('index_tasks', () => tasks);

    renderWithProviders(
      <TaskMode filter="" onPick={vi.fn()} isComposing={false} />,
    );

    // The displayed path should be the basename + line — not the absolute path.
    await waitFor(() => {
      expect(screen.getByText(/draft\.md:12/)).toBeTruthy();
    });
  });

  it('Enter activates the highlighted row, ↓ moves to the second result', async () => {
    const tasks: IndexedTask[] = [
      makeTask({ text: 'First', path: '/p/1.md', position: 1 }),
      makeTask({ text: 'Second', path: '/p/2.md', position: 2 }),
      makeTask({ text: 'Third', path: '/p/3.md', position: 3 }),
    ];
    setMockInvokeHandler('index_tasks', () => tasks);
    const onPick = vi.fn();

    renderWithProviders(
      <TaskMode filter="" onPick={onPick} isComposing={false} />,
    );

    await waitFor(() => {
      expect(screen.getByText('First')).toBeTruthy();
    });

    // Send ↓ then Enter to the window — TaskMode mounts its key listener
    // there so the picker can react regardless of where focus is.
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

  it('renders an empty-state message when there are no matches', async () => {
    setMockInvokeHandler('index_tasks', () => []);

    renderWithProviders(
      <TaskMode filter="nothing-matches-this" onPick={vi.fn()} isComposing={false} />,
    );

    await waitFor(() => {
      expect(screen.getByText('No open tasks match')).toBeTruthy();
    });
  });
});
