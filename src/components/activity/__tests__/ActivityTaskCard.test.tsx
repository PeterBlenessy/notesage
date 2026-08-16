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
import { renderHook } from '@testing-library/react';
import { setMockInvokeHandler } from '@/test/tauri-mock';
import { ActivityTaskCard } from '../ActivityTaskCard';
import { useActivityStore, type AgentTask } from '@/stores/activity-store';
import { useWorkspaceStore } from '@/stores/workspace-store';
import { useRecordingStore } from '@/stores/recording-store';
import { useMeetingRecording, __resetLiveRecordingItemId } from '@/hooks/useMeetingRecording';
import type { ActivityApprovalMode } from '@/lib/ai/types';

// `sonner` is mocked by `@/test/tauri-mock` (imported via component-harness);
// `toast.success` / `toast.error` are `vi.fn()` spies we read directly.
import { toast } from 'sonner';
const toastSuccess = toast.success as ReturnType<typeof vi.fn>;
const toastError = toast.error as ReturnType<typeof vi.fn>;

// Hoisted spy — `vi.mock` factories are hoisted above the module body, so any
// variable they close over must be created via `vi.hoisted` to exist at that point.
const { moveBundleToProjectMock, openFileMock, startTranscriptionMock } = vi.hoisted(() => ({
  moveBundleToProjectMock: vi.fn<(dir: string, root: string) => Promise<string>>(),
  openFileMock: vi.fn<(path: string, name: string) => Promise<void>>(),
  startTranscriptionMock: vi.fn(),
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

// Mock the file-open hook — TranscriptionCard's click-to-open goes through it.
vi.mock('@/hooks/useFileOperations', () => ({
  useFileOperations: () => ({ openFile: openFileMock }),
}));

// Mock the transcription-job trigger — the re-run action (#698) dispatches
// through it; assert on the payload without mounting the real background job.
vi.mock('@/hooks/useTranscriptionJob', () => ({
  startTranscription: (detail: unknown) => startTranscriptionMock(detail),
}));

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
    openFileMock.mockReset();
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
      label: 'Recording 2026-05-30',
      status: 'running',
      progress: 0,
      audioPath: '/Users/me/Notesage/Recordings/Recording 2026-05-30/audio.wav',
      completedAt: undefined,
      ...overrides,
    });
  }

  it('shows a spinner + "Starting…" while running with progress 0', () => {
    renderWithProviders(<ActivityTaskCard task={txTask({ progress: 0 })} />);
    expect(screen.getByText('Recording 2026-05-30')).toBeTruthy();
    expect(screen.getByText(/transcribing/i)).toBeTruthy();
    expect(screen.getByText(/starting/i)).toBeTruthy();
  });

  it('renders a progress bar with the percentage while running', () => {
    renderWithProviders(<ActivityTaskCard task={txTask({ progress: 42 })} />);
    expect(screen.getByText('42%')).toBeTruthy();
    // No "Move to project" while still running
    expect(screen.queryByRole('button', { name: /move to project/i })).toBeNull();
  });

  it('shows "Move to project" on completion and not before', () => {
    useWorkspaceStore.setState({ projects: [{ path: '/Users/me/Code/acme', fileTree: [] }] });
    renderWithProviders(
      <ActivityTaskCard
        task={txTask({ status: 'done', progress: 100, completedAt: Date.now() })}
      />,
    );
    expect(screen.getByText(/transcript ready/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: /move to project/i })).toBeTruthy();
  });

  it('does not show "Move to project" once moved', () => {
    useWorkspaceStore.setState({ projects: [{ path: '/Users/me/Code/acme', fileTree: [] }] });
    renderWithProviders(
      <ActivityTaskCard task={txTask({ status: 'done', moved: true, completedAt: Date.now() })} />,
    );
    expect(screen.queryByRole('button', { name: /move to project/i })).toBeNull();
  });

  it('shows the error state for a failed transcription', () => {
    renderWithProviders(
      <ActivityTaskCard task={txTask({ status: 'error', completedAt: Date.now() })} />,
    );
    expect(screen.getByText(/re-runnable from the inbox/i)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /move to project/i })).toBeNull();
  });

  it('opens the transcript when a completed card is clicked', async () => {
    openFileMock.mockResolvedValue(undefined);
    const task = txTask({
      status: 'done',
      progress: 100,
      completedAt: Date.now(),
      transcriptPath: '/Users/me/Notesage/Recordings/Recording 2026-05-30/transcript.md',
    });
    renderWithProviders(<ActivityTaskCard task={task} />);

    expect(screen.getByText(/click to open/i)).toBeTruthy();
    fireEvent.click(screen.getByText('Recording 2026-05-30'));

    await waitFor(() => {
      expect(openFileMock).toHaveBeenCalledWith(
        '/Users/me/Notesage/Recordings/Recording 2026-05-30/transcript.md',
        'transcript.md',
      );
    });
  });

  it('reveals the transcript in Finder when the reveal button is clicked', async () => {
    const revealHandler = vi.fn(() => undefined);
    setMockInvokeHandler('reveal_in_finder', revealHandler);
    const task = txTask({
      status: 'done',
      completedAt: Date.now(),
      transcriptPath: '/Users/me/Notesage/Recordings/Recording 2026-05-30/transcript.md',
    });
    renderWithProviders(<ActivityTaskCard task={task} />);

    fireEvent.click(screen.getByRole('button', { name: /reveal in finder/i }));
    await waitFor(() => {
      expect(revealHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          path: '/Users/me/Notesage/Recordings/Recording 2026-05-30/transcript.md',
        }),
      );
    });
  });

  it('reveals the raw audio when transcription failed before a note was written', async () => {
    const revealHandler = vi.fn(() => undefined);
    setMockInvokeHandler('reveal_in_finder', revealHandler);
    const task = txTask({ status: 'error', completedAt: Date.now() }); // no transcriptPath
    renderWithProviders(<ActivityTaskCard task={task} />);

    fireEvent.click(screen.getByRole('button', { name: /reveal in finder/i }));
    await waitFor(() => {
      expect(revealHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          path: '/Users/me/Notesage/Recordings/Recording 2026-05-30/audio.wav',
        }),
      );
    });
  });

  it('renders a start–stop · length info row when recording metadata is present', () => {
    // 14:02:00 → 14:08:00 wall clock, 5 min 30 s recorded (pause-aware).
    const start = new Date(2026, 4, 30, 14, 2, 0).getTime();
    const stop = new Date(2026, 4, 30, 14, 8, 0).getTime();
    renderWithProviders(
      <ActivityTaskCard
        task={txTask({
          status: 'done',
          completedAt: stop,
          transcriptPath: '/Users/me/Notesage/Recordings/Recording 2026-05-30/transcript.md',
          recordingStartedAt: start,
          recordingStoppedAt: stop,
          recordingDurationSecs: 330,
        })}
      />,
    );
    // Length renders as M:SS.
    expect(screen.getByText(/5:30/)).toBeTruthy();
    // The info row carries both the start–stop span and the length.
    const row = screen.getByText(/·/);
    expect(row.textContent).toMatch(/–/); // start – stop span present
    expect(row.textContent).toMatch(/5:30/);
  });

  it('recovers the start time from the bundle folder name for legacy jobs', () => {
    // No recording* metadata — but the path encodes the stamp the backend wrote.
    renderWithProviders(
      <ActivityTaskCard
        task={txTask({
          status: 'done',
          completedAt: Date.now(),
          transcriptPath: '/Users/me/Notesage/Recordings/Recording 2026-05-30 14-02-33/transcript.md',
        })}
      />,
    );
    // 14:02 in 24-hour form derived from the folder name.
    expect(screen.getByText(/14:02/)).toBeTruthy();
  });

  it('also recovers from older "Meeting" bundle folder names', () => {
    renderWithProviders(
      <ActivityTaskCard
        task={txTask({
          status: 'done',
          completedAt: Date.now(),
          transcriptPath: '/x/Meeting 2026-01-02 09-30-00/transcript.md',
        })}
      />,
    );
    expect(screen.getByText(/09:30/)).toBeTruthy();
  });

  it('omits the info row when neither metadata nor a parseable path exists', () => {
    renderWithProviders(
      <ActivityTaskCard
        task={txTask({
          status: 'done',
          completedAt: Date.now(),
          transcriptPath: '/x/transcript.md',
          audioPath: undefined,
        })}
      />,
    );
    expect(screen.queryByText(/·/)).toBeNull();
    expect(screen.queryByText(/\d{2}:\d{2}/)).toBeNull();
  });

  it('orders the top-right cluster [Move to project] [Reveal] [Remove]', () => {
    setMockInvokeHandler('reveal_in_finder', () => undefined);
    useWorkspaceStore.setState({ projects: [{ path: '/Users/me/Code/acme', fileTree: [] }] });
    renderWithProviders(
      <ActivityTaskCard
        task={txTask({
          status: 'done',
          completedAt: Date.now(),
          transcriptPath: '/x/transcript.md',
        })}
        onRemove={() => {}}
      />,
    );
    // Exact names — the remove button's tooltip mentions "Reveal in Finder",
    // so a regex would match two buttons.
    const move = screen.getByRole('button', { name: 'Move to project' });
    const reveal = screen.getByRole('button', { name: 'Reveal in Finder' });
    const remove = screen.getByRole('button', {
      name: /^Remove from this list/,
    });
    // Move → Reveal → Remove, in DOM order.
    expect(move.compareDocumentPosition(reveal) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(reveal.compareDocumentPosition(remove) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('does not put a native title tooltip on the card label', () => {
    renderWithProviders(
      <ActivityTaskCard task={txTask({ status: 'done', completedAt: Date.now() })} />,
    );
    expect(screen.getByText('Recording 2026-05-30').getAttribute('title')).toBeNull();
  });

  it('does not open anything while still transcribing or without a transcript path', () => {
    const { unmount } = renderWithProviders(
      <ActivityTaskCard task={txTask({ status: 'running', progress: 50 })} />,
    );
    fireEvent.click(screen.getByText('Recording 2026-05-30'));
    expect(openFileMock).not.toHaveBeenCalled();
    unmount();

    // Done but no transcriptPath (legacy item) — still not clickable.
    renderWithProviders(
      <ActivityTaskCard task={txTask({ status: 'done', completedAt: Date.now() })} />,
    );
    fireEvent.click(screen.getByText('Recording 2026-05-30'));
    expect(openFileMock).not.toHaveBeenCalled();
    expect(screen.queryByText(/click to open/i)).toBeNull();
  });

  it('moves the bundle to the picked project, toasts, and records the move', async () => {
    moveBundleToProjectMock.mockResolvedValue('/Users/me/Code/acme/Recording 2026-05-30');
    useWorkspaceStore.setState({ projects: [{ path: '/Users/me/Code/acme', fileTree: [] }] });
    // Seed the store so setTranscriptionMoved has a task to patch.
    useActivityStore.getState().addTranscriptionJob({
      id: 'tx-1',
      label: 'Recording 2026-05-30',
      audioPath: '/Users/me/Notesage/Recordings/Recording 2026-05-30/audio.wav',
    });
    useActivityStore.getState().setTranscriptionDone(
      'tx-1',
      '/Users/me/Notesage/Recordings/Recording 2026-05-30/transcript.md',
    );

    const task = useActivityStore.getState().tasks.find((t) => t.id === 'tx-1')!;
    renderWithProviders(<ActivityTaskCard task={task} />);

    // Open the Radix DropdownMenu — it triggers on pointerdown.
    const trigger = screen.getByRole('button', { name: /move to project/i });
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
        '/Users/me/Notesage/Recordings/Recording 2026-05-30',
        '/Users/me/Code/acme',
      );
    });
    await waitFor(() => {
      expect(toastSuccess).toHaveBeenCalledWith(expect.stringMatching(/moved to acme/i));
    });
    // Store recorded the move and repointed the transcript at the new bundle.
    const moved = useActivityStore.getState().tasks.find((t) => t.id === 'tx-1');
    expect(moved?.moved).toBe(true);
    expect(moved?.transcriptPath).toBe('/Users/me/Code/acme/Recording 2026-05-30/transcript.md');
    // Regression fix (#698): the retained audioPath must follow the move too —
    // it used to keep pointing at the now-deleted inbox location, which broke
    // "re-run transcription" and "reveal in Finder" after a move.
    expect(moved?.audioPath).toBe('/Users/me/Code/acme/Recording 2026-05-30/audio.wav');
  });

  // -------------------------------------------------------------------------
  // Bundle path display (#698)
  // -------------------------------------------------------------------------

  describe('bundle path display (#698)', () => {
    it("shows the bundle's on-disk path text next to Reveal", () => {
      const task = txTask({
        status: 'done',
        completedAt: Date.now(),
        transcriptPath: '/Users/me/Notesage/Recordings/Recording 2026-05-30/transcript.md',
      });
      renderWithProviders(<ActivityTaskCard task={task} />);
      expect(screen.getByText('/Users/me/Notesage/Recordings/Recording 2026-05-30')).toBeTruthy();
    });

    it("falls back to the audio's folder when transcription failed before a note was written", () => {
      const task = txTask({ status: 'error', completedAt: Date.now() }); // no transcriptPath
      renderWithProviders(<ActivityTaskCard task={task} />);
      expect(screen.getByText('/Users/me/Notesage/Recordings/Recording 2026-05-30')).toBeTruthy();
    });

    it('omits the path row while still transcribing', () => {
      renderWithProviders(<ActivityTaskCard task={txTask({ status: 'running', progress: 40 })} />);
      expect(screen.queryByText('/Users/me/Notesage/Recordings/Recording 2026-05-30')).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // Re-run transcription (#698)
  // -------------------------------------------------------------------------

  describe('re-run transcription (#698)', () => {
    beforeEach(() => {
      startTranscriptionMock.mockReset();
      useRecordingStore.setState({
        availableModels: [
          { name: 'base', size_bytes: 1, downloaded: true },
          { name: 'small', size_bytes: 2, downloaded: false },
          { name: 'large-v3', size_bytes: 3, downloaded: true },
        ],
      });
    });

    function openRerunMenu() {
      const trigger = screen.getByRole('button', { name: /re-run transcription/i });
      act(() => {
        fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false });
        fireEvent.pointerUp(trigger, { button: 0 });
        fireEvent.click(trigger);
      });
    }

    it('lists only downloaded models', async () => {
      const task = txTask({ status: 'done', completedAt: Date.now(), transcriptPath: '/x/transcript.md' });
      renderWithProviders(<ActivityTaskCard task={task} />);

      openRerunMenu();

      expect(await screen.findByRole('menuitem', { name: 'Base' })).toBeTruthy();
      expect(await screen.findByRole('menuitem', { name: 'Large V3' })).toBeTruthy();
      expect(screen.queryByRole('menuitem', { name: 'Small' })).toBeNull();
    });

    it('picking a model re-transcribes the retained audio, reusing the same card via jobId', async () => {
      const task = txTask({
        status: 'done',
        completedAt: Date.now(),
        transcriptPath: '/x/transcript.md',
        language: 'sv',
      });
      renderWithProviders(<ActivityTaskCard task={task} />);

      openRerunMenu();
      const item = await screen.findByRole('menuitem', { name: 'Large V3' });
      act(() => {
        fireEvent.click(item);
      });

      expect(startTranscriptionMock).toHaveBeenCalledWith(
        expect.objectContaining({
          audioPath: task.audioPath,
          jobId: 'tx-1',
          model: 'large-v3',
          language: 'sv',
        }),
      );
    });

    it('is hidden while a transcription is running', () => {
      renderWithProviders(<ActivityTaskCard task={txTask({ status: 'running', progress: 40 })} />);
      expect(screen.queryByRole('button', { name: /re-run transcription/i })).toBeNull();
    });

    it('is offered for a failed transcription too (re-runnable from the inbox)', () => {
      renderWithProviders(
        <ActivityTaskCard task={txTask({ status: 'error', completedAt: Date.now() })} />,
      );
      expect(screen.getByRole('button', { name: /re-run transcription/i })).toBeTruthy();
    });
  });
});

// ===========================================================================
// kind === 'recording'
// ===========================================================================

describe('ActivityTaskCard — recording kind', () => {
  function recTask(overrides: Partial<AgentTask> = {}): AgentTask {
    return makeTask({
      id: 'rec-1',
      kind: 'recording',
      type: 'workflow',
      label: 'Recording',
      status: 'running',
      recordingStartedAt: Date.now(),
      completedAt: undefined,
      ...overrides,
    });
  }

  /** Seed the live-capture state the card's hooks read. */
  function seedRecordingStore() {
    useRecordingStore.setState({
      isRecording: true,
      recordingSource: 'microphone',
      recordingStartTime: Date.now(),
      isPaused: false,
      pauseStartedAt: null,
      pausedTotalMs: 0,
    });
  }

  beforeEach(() => {
    __resetLiveRecordingItemId();
    useActivityStore.setState({ tasks: [] });
    setMockInvokeHandler('pause_recording', () => undefined);
    setMockInvokeHandler('resume_recording', () => undefined);
    setMockInvokeHandler('stop_recording', () => ({
      path: '/tmp/rec/audio.wav',
      duration_secs: 1,
      sample_rate: 16000,
      source: 'microphone',
      rms: 0.05,
      peak: 0.3,
    }));
  });

  describe('stopwatch (fake timers)', () => {
    beforeEach(() => {
      vi.useFakeTimers();
      seedRecordingStore();
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it('renders a recording indicator with a live MM:SS stopwatch', () => {
      renderWithProviders(<ActivityTaskCard task={recTask()} />);

      // Status line specifically (label is "Recording", status is "Recording…").
      expect(screen.getByText('Recording…')).toBeTruthy();
      expect(screen.getByText('00:00')).toBeTruthy();

      // Advance 65s — the stopwatch ticks to 01:05.
      act(() => {
        vi.advanceTimersByTime(65_000);
      });
      expect(screen.getByText('01:05')).toBeTruthy();
    });

    it('freezes the stopwatch while paused and excludes the paused stretch', () => {
      renderWithProviders(<ActivityTaskCard task={recTask()} />);

      act(() => {
        vi.advanceTimersByTime(10_000);
      });
      expect(screen.getByText('00:10')).toBeTruthy();

      // Pause (store-level — the invoke round-trip is covered separately).
      act(() => {
        useRecordingStore.getState().pauseRecording();
      });
      expect(screen.getByText('Paused')).toBeTruthy();
      act(() => {
        vi.advanceTimersByTime(30_000);
      });
      // Frozen at the pause instant — the 30 paused seconds don't count.
      expect(screen.getByText('00:10')).toBeTruthy();

      act(() => {
        useRecordingStore.getState().resumeRecording();
      });
      expect(screen.getByText('Recording…')).toBeTruthy();
      act(() => {
        vi.advanceTimersByTime(5_000);
      });
      expect(screen.getByText('00:15')).toBeTruthy();
    });
  });

  describe('controls (real timers)', () => {
    beforeEach(() => {
      seedRecordingStore();
    });

    it('pause and resume buttons drive the backend + store', async () => {
      renderWithProviders(<ActivityTaskCard task={recTask()} />);

      fireEvent.click(screen.getByRole('button', { name: /pause recording/i }));
      await waitFor(() => {
        expect(useRecordingStore.getState().isPaused).toBe(true);
      });
      expect(screen.getByText('Paused')).toBeTruthy();

      fireEvent.click(screen.getByRole('button', { name: /resume recording/i }));
      await waitFor(() => {
        expect(useRecordingStore.getState().isPaused).toBe(false);
      });
      expect(screen.getByText('Recording…')).toBeTruthy();
    });

    it('stop button stops a capture started from another surface and clears the orb item', async () => {
      // Start from a DIFFERENT surface (the MicButton-equivalent hook instance)
      // so the live-item id is registered exactly as in production.
      setMockInvokeHandler('start_recording', () => undefined);
      useRecordingStore.setState({ isRecording: false, recordingStartTime: null });
      const starter = renderHook(() => useMeetingRecording());
      await act(async () => {
        await starter.result.current.toggleRecording();
      });
      starter.unmount();
      const task = useActivityStore.getState().tasks.find((t) => t.kind === 'recording')!;
      expect(task).toBeTruthy();

      // Stop from the orb panel's RecordingCard.
      renderWithProviders(<ActivityTaskCard task={task} />);
      fireEvent.click(screen.getByRole('button', { name: /stop recording/i }));

      await waitFor(() => {
        expect(useRecordingStore.getState().isRecording).toBe(false);
      });
      // The orb's recording item is cleared — no stuck indicator.
      await waitFor(() => {
        expect(
          useActivityStore.getState().tasks.filter((t) => t.kind === 'recording'),
        ).toHaveLength(0);
      });
    });
  });

  // -------------------------------------------------------------------------
  // Per-recording language picker (#698)
  // -------------------------------------------------------------------------

  describe('language picker (#698)', () => {
    beforeEach(() => {
      seedRecordingStore();
      useRecordingStore.setState({ speechLanguage: 'auto' });
    });

    it('defaults to the global recording language when the task has no override', () => {
      renderWithProviders(<ActivityTaskCard task={recTask()} />);
      const trigger = document.querySelector('[role="combobox"][aria-label="Recording language"]');
      expect(trigger?.textContent).toMatch(/auto-detect/i);
    });

    it('shows the per-recording override when the task already has one', () => {
      renderWithProviders(<ActivityTaskCard task={recTask({ language: 'sv' })} />);
      const trigger = document.querySelector('[role="combobox"][aria-label="Recording language"]');
      expect(trigger?.textContent).toMatch(/swedish/i);
    });

    it('selecting a language updates the task, not the global setting', async () => {
      // Seed the store — `setRecordingLanguage` looks the task up by id, so
      // the task must actually exist in the store, not just be passed as a prop.
      useActivityStore.getState().addRecordingItem({ id: 'rec-1', label: 'Recording' });
      const task = useActivityStore.getState().tasks[0];
      renderWithProviders(<ActivityTaskCard task={task} />);
      const trigger = document.querySelector(
        '[role="combobox"][aria-label="Recording language"]',
      ) as HTMLElement;
      fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false });
      fireEvent.click(trigger);
      await Promise.resolve();
      const option = Array.from(document.querySelectorAll('[role="option"]')).find(
        (el) => el.textContent?.trim() === 'Swedish',
      ) as HTMLElement | undefined;
      expect(option).toBeTruthy();
      if (option) fireEvent.click(option);

      await waitFor(() => {
        expect(useActivityStore.getState().tasks.find((t) => t.id === 'rec-1')?.language).toBe('sv');
      });
      expect(useRecordingStore.getState().speechLanguage).toBe('auto');
    });
  });
});
