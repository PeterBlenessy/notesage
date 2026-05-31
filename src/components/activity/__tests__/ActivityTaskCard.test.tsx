// @vitest-environment jsdom

/**
 * Tests for ActivityTaskCard — approval badges, path tooltip (task #22).
 *
 * Covers:
 * - Activity rows render approval badges matching `approvalMode` (auto/user/denied).
 * - Full path/detail appears in a tooltip on hover.
 * - Legacy activities without `approvalMode` render no badge (backward compat).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderWithProviders, screen, fireEvent, waitFor, act } from '@/test/component-harness';
import { ActivityTaskCard } from '../ActivityTaskCard';
import { useActivityStore, type AgentTask } from '@/stores/activity-store';
import { useWorkspaceStore } from '@/stores/workspace-store';
import type { ActivityApprovalMode } from '@/lib/ai/types';

// `sonner` is mocked by `@/test/tauri-mock` (imported via component-harness);
// `toast.success` / `toast.error` are `vi.fn()` spies we read directly.
import { toast } from 'sonner';
const toastSuccess = toast.success as ReturnType<typeof vi.fn>;
const toastError = toast.error as ReturnType<typeof vi.fn>;

// Hoisted spy — `vi.mock` factories are hoisted above the module body, so any
// variable they close over must be created via `vi.hoisted` to exist at that point.
const { moveBundleToProjectMock } = vi.hoisted(() => ({
  moveBundleToProjectMock: vi.fn<(dir: string, root: string) => Promise<string>>(),
}));

// Mock the bundle move so the move-to-project flow doesn't touch Tauri.
vi.mock('@/lib/transcription/bundle', async () => {
  const actual = await vi.importActual<typeof import('@/lib/transcription/bundle')>(
    '@/lib/transcription/bundle',
  );
  return {
    ...actual,
    moveBundleToProject: (dir: string, root: string) => moveBundleToProjectMock(dir, root),
  };
});

// Radix DropdownMenu uses PointerEvent APIs jsdom lacks — stub them so the
// menu opens in tests (mirrors the polyfills in AgentOrb.test.tsx).
for (const m of ['hasPointerCapture', 'releasePointerCapture', 'setPointerCapture', 'scrollIntoView'] as const) {
  if (!(m in HTMLElement.prototype)) {
    Object.defineProperty(HTMLElement.prototype, m, {
      configurable: true,
      value: vi.fn(() => false),
    });
  }
}
if (typeof window !== 'undefined' && !('ResizeObserver' in window)) {
  class ResizeObserverStub { observe() {} unobserve() {} disconnect() {} }
  (window as unknown as { ResizeObserver: typeof ResizeObserverStub }).ResizeObserver = ResizeObserverStub;
}

function makeTask(overrides: Partial<AgentTask> = {}): AgentTask {
  return {
    id: 'task-1',
    kind: 'agent',
    type: 'chat',
    label: 'Test Task',
    status: 'done',
    activities: [],
    startedAt: Date.now() - 5000,
    completedAt: Date.now(),
    ...overrides,
  };
}

function makeActivity(
  label: string,
  approvalMode?: ActivityApprovalMode,
  detail?: string,
) {
  return {
    label,
    detail,
    status: 'done' as const,
    timestamp: Date.now(),
    approvalMode,
  };
}

describe('ActivityTaskCard — approval mode badges', () => {
  it('renders an "Auto" badge for auto-approved activities', () => {
    const task = makeTask({
      activities: [makeActivity('read_file', 'auto', '/Users/test/project/readme.md')],
    });
    renderWithProviders(<ActivityTaskCard task={task} />);

    // Expand the activity log
    fireEvent.click(screen.getByText(/1 step/));
    expect(screen.getByText('Auto')).toBeTruthy();
  });

  it('renders an "Approved" badge for user-approved activities', () => {
    const task = makeTask({
      activities: [makeActivity('write_file', 'user', '/Users/test/project/out.md')],
    });
    renderWithProviders(<ActivityTaskCard task={task} />);

    fireEvent.click(screen.getByText(/1 step/));
    expect(screen.getByText('Approved')).toBeTruthy();
  });

  it('renders a "Denied" badge for denied activities', () => {
    const task = makeTask({
      activities: [makeActivity('write_file', 'denied', '/Users/test/secret.txt')],
    });
    renderWithProviders(<ActivityTaskCard task={task} />);

    fireEvent.click(screen.getByText(/1 step/));
    expect(screen.getByText('Denied')).toBeTruthy();
  });

  it('renders no badge when approvalMode is undefined (legacy activity)', () => {
    const task = makeTask({
      activities: [makeActivity('tool_call')],
    });
    renderWithProviders(<ActivityTaskCard task={task} />);

    fireEvent.click(screen.getByText(/1 step/));
    // No badge for legacy activities — backward compat
    expect(screen.queryByText('Auto')).toBeNull();
    expect(screen.queryByText('Approved')).toBeNull();
    expect(screen.queryByText('Denied')).toBeNull();
  });

  it('shows all three badges when mixed modes are present', () => {
    const task = makeTask({
      activities: [
        makeActivity('read_file', 'auto', '/a.md'),
        makeActivity('write_file', 'user', '/b.md'),
        makeActivity('out_of_scope', 'denied', '/c.md'),
      ],
    });
    renderWithProviders(<ActivityTaskCard task={task} />);

    fireEvent.click(screen.getByText(/3 steps/));
    expect(screen.getByText('Auto')).toBeTruthy();
    expect(screen.getByText('Approved')).toBeTruthy();
    expect(screen.getByText('Denied')).toBeTruthy();
  });
});

describe('ActivityTaskCard — full path tooltip', () => {
  it('wires the truncated row as a tooltip trigger with the full path available', () => {
    // Radix Tooltip in jsdom can't fully open (no ResizeObserver / no real portal),
    // so we assert the contract: the truncated row is a `data-slot="tooltip-trigger"`,
    // which is the hook Radix uses to expose the full-path TooltipContent on hover.
    const longPath = '/Users/test/very-long-project-name/nested/dir/with/a/deeply-nested/file.md';
    const task = makeTask({
      activities: [makeActivity('read_file', 'auto', longPath)],
    });
    renderWithProviders(<ActivityTaskCard task={task} />);

    fireEvent.click(screen.getByText(/1 step/));

    // The truncated visible row starts with the path and ends with ellipsis.
    const truncated = screen.getByText(/\/Users\/test\/very-long-project-name.*\u2026$/);
    expect(truncated).toBeTruthy();
    // Must be a tooltip trigger — proves we attached the tooltip to this element.
    expect(truncated.getAttribute('data-slot')).toBe('tooltip-trigger');
    // Hover hint for the user
    expect(truncated.className).toContain('cursor-help');
  });

  it('shorter details (under 60 chars) are displayed inline and also in tooltip', () => {
    const shortPath = '/tmp/short.md';
    const task = makeTask({
      activities: [makeActivity('read_file', 'auto', shortPath)],
    });
    renderWithProviders(<ActivityTaskCard task={task} />);

    fireEvent.click(screen.getByText(/1 step/));
    // Short path rendered verbatim (no truncation)
    expect(screen.getAllByText(shortPath).length).toBeGreaterThanOrEqual(1);
  });
});

// ===========================================================================
// kind === 'transcription'
// ===========================================================================

describe('ActivityTaskCard — transcription kind', () => {
  beforeEach(() => {
    moveBundleToProjectMock.mockReset();
    toastSuccess.mockReset();
    toastError.mockReset();
    useWorkspaceStore.setState({ projects: [] });
    useActivityStore.setState({ tasks: [] });
  });

  function txTask(overrides: Partial<AgentTask> = {}): AgentTask {
    return makeTask({
      id: 'tx-1',
      kind: 'transcription',
      type: 'workflow',
      label: 'Meeting 2026-05-30',
      status: 'running',
      progress: 0,
      audioPath: '/Users/me/Notesage/Recordings/Meeting 2026-05-30/audio.wav',
      completedAt: undefined,
      ...overrides,
    });
  }

  it('shows a spinner + "Starting…" while running with progress 0', () => {
    renderWithProviders(<ActivityTaskCard task={txTask({ progress: 0 })} />);
    expect(screen.getByText('Meeting 2026-05-30')).toBeTruthy();
    expect(screen.getByText(/transcribing/i)).toBeTruthy();
    expect(screen.getByText(/starting/i)).toBeTruthy();
  });

  it('renders a progress bar with the percentage while running', () => {
    renderWithProviders(<ActivityTaskCard task={txTask({ progress: 42 })} />);
    expect(screen.getByText('42%')).toBeTruthy();
    // No "Move to project" while still running
    expect(screen.queryByText(/move to project/i)).toBeNull();
  });

  it('shows "Move to project" on completion and not before', () => {
    useWorkspaceStore.setState({ projects: [{ path: '/Users/me/Code/acme', fileTree: [] }] });
    renderWithProviders(
      <ActivityTaskCard
        task={txTask({ status: 'done', progress: 100, completedAt: Date.now() })}
      />,
    );
    expect(screen.getByText(/transcript ready/i)).toBeTruthy();
    expect(screen.getByText(/move to project/i)).toBeTruthy();
  });

  it('does not show "Move to project" once moved', () => {
    useWorkspaceStore.setState({ projects: [{ path: '/Users/me/Code/acme', fileTree: [] }] });
    renderWithProviders(
      <ActivityTaskCard task={txTask({ status: 'done', moved: true, completedAt: Date.now() })} />,
    );
    expect(screen.queryByText(/move to project/i)).toBeNull();
  });

  it('shows the error state for a failed transcription', () => {
    renderWithProviders(
      <ActivityTaskCard task={txTask({ status: 'error', completedAt: Date.now() })} />,
    );
    expect(screen.getByText(/re-runnable from the inbox/i)).toBeTruthy();
    expect(screen.queryByText(/move to project/i)).toBeNull();
  });

  it('moves the bundle to the picked project, toasts, and records the move', async () => {
    moveBundleToProjectMock.mockResolvedValue('/Users/me/Code/acme/Meeting 2026-05-30');
    useWorkspaceStore.setState({ projects: [{ path: '/Users/me/Code/acme', fileTree: [] }] });
    // Seed the store so setTranscriptionMoved has a task to patch.
    useActivityStore.getState().addTranscriptionJob({
      id: 'tx-1',
      label: 'Meeting 2026-05-30',
      audioPath: '/Users/me/Notesage/Recordings/Meeting 2026-05-30/audio.wav',
    });
    useActivityStore.getState().setTranscriptionDone(
      'tx-1',
      '/Users/me/Notesage/Recordings/Meeting 2026-05-30/transcript.md',
    );

    const task = useActivityStore.getState().tasks.find((t) => t.id === 'tx-1')!;
    renderWithProviders(<ActivityTaskCard task={task} />);

    // Open the Radix DropdownMenu — it triggers on pointerdown.
    const trigger = screen.getByText(/move to project/i).closest('button')!;
    act(() => {
      fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false });
      fireEvent.pointerUp(trigger, { button: 0 });
      fireEvent.click(trigger);
    });
    // Pick the project from the dropdown.
    const item = await screen.findByRole('menuitem', { name: 'acme' });
    act(() => {
      fireEvent.click(item);
    });

    await waitFor(() => {
      expect(moveBundleToProjectMock).toHaveBeenCalledWith(
        '/Users/me/Notesage/Recordings/Meeting 2026-05-30',
        '/Users/me/Code/acme',
      );
    });
    await waitFor(() => {
      expect(toastSuccess).toHaveBeenCalledWith(expect.stringMatching(/moved to acme/i));
    });
    // Store recorded the move and repointed the transcript at the new bundle.
    const moved = useActivityStore.getState().tasks.find((t) => t.id === 'tx-1');
    expect(moved?.moved).toBe(true);
    expect(moved?.transcriptPath).toBe('/Users/me/Code/acme/Meeting 2026-05-30/transcript.md');
  });
});

// ===========================================================================
// kind === 'recording'
// ===========================================================================

describe('ActivityTaskCard — recording kind', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders a recording indicator with a live MM:SS stopwatch', () => {
    const startedAt = Date.now();
    const task = makeTask({
      id: 'rec-1',
      kind: 'recording',
      type: 'workflow',
      label: 'Recording',
      status: 'running',
      recordingStartedAt: startedAt,
      completedAt: undefined,
    });
    renderWithProviders(<ActivityTaskCard task={task} />);

    // Status line specifically (label is "Recording", status is "Recording…").
    expect(screen.getByText('Recording…')).toBeTruthy();
    expect(screen.getByText('00:00')).toBeTruthy();

    // Advance 65s — the stopwatch ticks to 01:05.
    act(() => {
      vi.advanceTimersByTime(65_000);
    });
    expect(screen.getByText('01:05')).toBeTruthy();
  });
});
