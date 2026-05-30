// @vitest-environment jsdom

/**
 * Tests for AgentOrb (#29 + #79) — the 46 px ambient orb at bottom-right of
 * the QuietLayout. Verifies:
 *  - count badge appears only when running tasks > 0
 *  - the `orb-pulsing` class is added/removed based on running count
 *  - reduced motion suppresses the pulse class entirely
 *  - the orb is hidden (display: none) when the FloatingCommandBar is pinned
 *  - aria-label updates with the live task count
 *  - click invokes the placeholder log handler without throwing
 *
 * Plus (#79 — AgentPanel integration):
 *  - clicking the orb opens the AgentPanel popover
 *  - Enter while orb is focused opens the panel
 *  - Esc closes the panel and restores focus to the orb
 *  - panel shows empty state when no tasks
 *  - panel renders task list when tasks exist
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  renderWithProviders,
  screen,
  fireEvent,
  act,
  waitFor,
} from '@/test/component-harness';
import type { AgentTask } from '@/stores/activity-store';

// ---------------------------------------------------------------------------
// Radix polyfills for jsdom
// ---------------------------------------------------------------------------
//
// Radix Popover uses PointerEvent APIs + ResizeObserver that jsdom does not
// implement. Stub them so Popover open/close transitions run in tests.
//
if (!('hasPointerCapture' in HTMLElement.prototype)) {
  Object.defineProperty(HTMLElement.prototype, 'hasPointerCapture', {
    configurable: true,
    value: vi.fn<() => boolean>(() => false),
  });
}
if (!('releasePointerCapture' in HTMLElement.prototype)) {
  Object.defineProperty(HTMLElement.prototype, 'releasePointerCapture', {
    configurable: true,
    value: vi.fn(),
  });
}
if (!('setPointerCapture' in HTMLElement.prototype)) {
  Object.defineProperty(HTMLElement.prototype, 'setPointerCapture', {
    configurable: true,
    value: vi.fn(),
  });
}
if (!('scrollIntoView' in HTMLElement.prototype)) {
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
    configurable: true,
    value: vi.fn(),
  });
}
if (typeof window !== 'undefined' && !('ResizeObserver' in window)) {
  class ResizeObserverStub {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
  (window as unknown as { ResizeObserver: typeof ResizeObserverStub }).ResizeObserver = ResizeObserverStub;
}

// ---------------------------------------------------------------------------
// Mock useReducedMotion — flipped per-test
// ---------------------------------------------------------------------------

const useReducedMotionMock = vi.fn<() => boolean>(() => false);

vi.mock('@/hooks/useReducedMotion', () => ({
  useReducedMotion: () => useReducedMotionMock(),
}));

// ---------------------------------------------------------------------------
// Mock activity-store — controllable task list per test
// ---------------------------------------------------------------------------

let mockTasks: AgentTask[] = [];
const mockRemoveTask = vi.fn<(id: string) => void>();

vi.mock('@/stores/activity-store', () => {
  const state = {
    get tasks() {
      return mockTasks;
    },
    removeTask: (id: string) => mockRemoveTask(id),
  };
  return {
    useActivityStore: Object.assign(
      vi.fn((sel: (s: typeof state) => unknown) => sel(state)),
      { getState: () => state },
    ),
  };
});

// ---------------------------------------------------------------------------
// Mock settings-store — controllable cmdBarPinned per test
// ---------------------------------------------------------------------------

let mockCmdBarPinned = false;

vi.mock('@/stores/settings-store', () => {
  const state = {
    get cmdBarPinned() {
      return mockCmdBarPinned;
    },
  };
  return {
    useSettingsStore: Object.assign(
      vi.fn((sel: (s: typeof state) => unknown) => sel(state)),
      { getState: () => state },
    ),
  };
});

// ---------------------------------------------------------------------------
// Mock logger — spy on log.info to verify the placeholder click handler
// ---------------------------------------------------------------------------

const logInfoMock = vi.fn<(category: string, message: string, data?: unknown) => void>();

vi.mock('@/lib/logger', () => ({
  log: {
    debug: vi.fn(),
    info: (category: string, message: string, data?: unknown) =>
      logInfoMock(category, message, data),
    warn: vi.fn(),
    error: vi.fn(),
  },
  PERF: {
    orb: 'perf:orb',
  },
}));

// ---------------------------------------------------------------------------
// Mock ActivityTaskCard — the panel renders these when tasks exist. Using a
// real import would pull in a large React tree (comment-store, routing-store,
// etc.) that isn't under test here. A thin stub keeps assertions focused on
// the panel's list/empty switch.
// ---------------------------------------------------------------------------

vi.mock('../ActivityTaskCard', () => ({
  ActivityTaskCard: ({ task }: { task: AgentTask }) => (
    <div data-testid={`task-card-${task.id}`}>{task.label}</div>
  ),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTask(id: string, status: AgentTask['status']): AgentTask {
  return {
    id,
    kind: 'agent',
    type: 'chat',
    label: `Task ${id}`,
    status,
    activities: [],
    startedAt: Date.now(),
  };
}

// Lazy import after mocks
import { AgentOrb } from '../AgentOrb';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AgentOrb (#29)', () => {
  beforeEach(() => {
    useReducedMotionMock.mockReturnValue(false);
    mockTasks = [];
    mockCmdBarPinned = false;
    logInfoMock.mockReset();
    mockRemoveTask.mockReset();
  });

  it('renders a count badge when running tasks > 0', () => {
    mockTasks = [
      makeTask('t1', 'running'),
      makeTask('t2', 'running'),
      makeTask('t3', 'done'),
    ];
    renderWithProviders(<AgentOrb />);
    // Badge shows the count of running tasks (2), not total (3).
    const badge = screen.getByTestId('agent-orb-badge');
    expect(badge.textContent).toBe('2');
  });

  it('does not render a count badge when running tasks == 0', () => {
    mockTasks = [makeTask('t1', 'done'), makeTask('t2', 'error')];
    renderWithProviders(<AgentOrb />);
    expect(screen.queryByTestId('agent-orb-badge')).toBeNull();
  });

  it('adds the orb-pulsing class to the inner pulse wrapper when running tasks > 0', () => {
    mockTasks = [makeTask('t1', 'running')];
    renderWithProviders(<AgentOrb />);
    // #119: pulse class lives on the inner wrapper span, NOT the button —
    // moving it off the button lets the keyframe's `transform: scale(X)`
    // frame land without Tailwind's composed-transform chain from
    // `hover:scale-105` resolving to `scale(1)` and overriding.
    const pulse = screen.getByTestId('agent-orb-pulse');
    expect(pulse.className.split(/\s+/)).toContain('orb-pulsing');
    // The button itself must NOT carry the pulse class.
    const orb = screen.getByTestId('agent-orb');
    expect(orb.className.split(/\s+/)).not.toContain('orb-pulsing');
  });

  it('does NOT add the orb-pulsing class when running tasks == 0', () => {
    mockTasks = [];
    renderWithProviders(<AgentOrb />);
    const pulse = screen.getByTestId('agent-orb-pulse');
    expect(pulse.className.split(/\s+/)).not.toContain('orb-pulsing');
    // Button must stay clean in the idle state as well.
    const orb = screen.getByTestId('agent-orb');
    expect(orb.className.split(/\s+/)).not.toContain('orb-pulsing');
  });

  it('omits the orb-pulsing class when reduced motion is preferred (utility-omission approach)', () => {
    useReducedMotionMock.mockReturnValue(true);
    mockTasks = [makeTask('t1', 'running'), makeTask('t2', 'running')];
    renderWithProviders(<AgentOrb />);
    // Reduced motion: the pulse class is omitted entirely on BOTH the button
    // and the inner wrapper. The badge still renders because the count > 0 —
    // only the animation is suppressed.
    const orb = screen.getByTestId('agent-orb');
    const pulse = screen.getByTestId('agent-orb-pulse');
    expect(orb.className.split(/\s+/)).not.toContain('orb-pulsing');
    expect(pulse.className.split(/\s+/)).not.toContain('orb-pulsing');
    expect(screen.getByTestId('agent-orb-badge').textContent).toBe('2');
  });

  // #119 regression lock: the pulse animation must land on an element that does
  // NOT carry Tailwind's `hover:scale-*` utility. If someone re-adds the hover
  // scale to the pulse element (or moves the pulse class back onto the button),
  // Tailwind's composed-transform chain resolves to `scale(1)` while not
  // hovered and overrides the keyframe's `scale(1.05)` frame — the pulse would
  // silently stop animating visually. This asserts the invariant directly so
  // the regression surfaces at test time, not in manual QA.
  it('keeps the pulse and the hover-scale utility on different elements (#119)', () => {
    mockTasks = [makeTask('t1', 'running')];
    renderWithProviders(<AgentOrb />);
    const orb = screen.getByTestId('agent-orb');
    const pulse = screen.getByTestId('agent-orb-pulse');

    const pulseTokens = pulse.className.split(/\s+/);
    const orbTokens = orb.className.split(/\s+/);

    // Pulse carries the animation class.
    expect(pulseTokens).toContain('orb-pulsing');
    // Pulse must NOT carry any hover:scale-* or transition-transform utility —
    // those would re-engage Tailwind's composed-transform chain on the same
    // element the keyframe mutates.
    expect(
      pulseTokens.some((t) => t.startsWith('hover:scale-')),
    ).toBe(false);
    expect(pulseTokens).not.toContain('transition-transform');

    // Button keeps a hover-scale affordance. Live-test 2026-04-26 bumped
    // the scale from 1.05 → 1.10 (arbitrary value) so the orb reads as
    // more clearly interactive. Either is fine for the regression-lock —
    // we just need *some* `hover:scale-*` utility on the button.
    expect(
      orbTokens.some((t) => t.startsWith('hover:scale-')),
    ).toBe(true);
    expect(
      orbTokens.some(
        (t) =>
          t === 'transition-transform' ||
          t.startsWith('transition-[transform'),
      ),
    ).toBe(true);
  });

  // #119 follow-up regression (2026-04-24): an earlier iteration added
  // `'relative'` to the button's className to "establish a positioning
  // context for the inner pulse wrapper". Both `fixed` and `relative` set
  // the `position` property, and Tailwind's class order resolved `relative`
  // last — dropping the orb out of viewport-fixed positioning and into
  // document flow (user saw it rendered on the left, half-offscreen). The
  // fix is to rely on `fixed` alone (it already establishes a positioning
  // context for absolute children). This test fails if `relative` sneaks
  // back in.
  it('anchors the orb with `fixed` — never adds `relative` (regression)', () => {
    mockTasks = [];
    renderWithProviders(<AgentOrb />);
    const orb = screen.getByTestId('agent-orb');
    const tokens = orb.className.split(/\s+/);
    expect(tokens).toContain('fixed');
    // bottom-10 matches FloatingCommandBar's `bottom-10` — both sit on the
    // same vertical baseline so the orb and the bar share the bottom edge.
    expect(tokens).toContain('bottom-10');
    expect(tokens).toContain('right-6');
    expect(tokens).not.toContain('relative');
    // Earlier value; fails if someone regresses the alignment.
    expect(tokens).not.toContain('bottom-6');
  });

  it('hides the orb (display: none) when cmdBarPinned is true', () => {
    mockCmdBarPinned = true;
    mockTasks = [makeTask('t1', 'running')];
    renderWithProviders(<AgentOrb />);
    const orb = screen.getByTestId('agent-orb');
    expect(orb.style.display).toBe('none');
  });

  it('shows the orb (no display: none) when cmdBarPinned is false', () => {
    mockCmdBarPinned = false;
    mockTasks = [makeTask('t1', 'running')];
    renderWithProviders(<AgentOrb />);
    const orb = screen.getByTestId('agent-orb');
    expect(orb.style.display).not.toBe('none');
  });

  it('reflects the running-task count in the aria-label', () => {
    mockTasks = [
      makeTask('t1', 'running'),
      makeTask('t2', 'running'),
      makeTask('t3', 'running'),
    ];
    renderWithProviders(<AgentOrb />);
    const orb = screen.getByTestId('agent-orb');
    expect(orb.getAttribute('aria-label')).toBe('Agent — 3 tasks running');
  });

  it('uses singular "task" in aria-label when exactly one is running', () => {
    mockTasks = [makeTask('t1', 'running')];
    renderWithProviders(<AgentOrb />);
    expect(screen.getByTestId('agent-orb').getAttribute('aria-label')).toBe(
      'Agent — 1 task running',
    );
  });

  it('uses zero-tasks aria-label when no tasks are running', () => {
    mockTasks = [];
    renderWithProviders(<AgentOrb />);
    expect(screen.getByTestId('agent-orb').getAttribute('aria-label')).toBe(
      'Agent — 0 tasks running',
    );
  });

  it('renders as a <button> for native keyboard activation', () => {
    renderWithProviders(<AgentOrb />);
    const orb = screen.getByTestId('agent-orb');
    expect(orb.tagName).toBe('BUTTON');
    expect(orb.getAttribute('type')).toBe('button');
  });

  it('shows a recording indicator + elapsed time when a recording is active (#13)', () => {
    // recordingStartedAt 90s in the past → elapsed renders 01:30.
    mockTasks = [
      {
        id: 'rec-1',
        kind: 'recording',
        type: 'workflow',
        label: 'Recording',
        status: 'running',
        activities: [],
        startedAt: Date.now() - 90_000,
        recordingStartedAt: Date.now() - 90_000,
      },
    ];
    renderWithProviders(<AgentOrb />);
    // Recording indicator replaces the plain count badge.
    expect(screen.getByTestId('agent-orb-recording')).toBeTruthy();
    expect(screen.queryByTestId('agent-orb-badge')).toBeNull();
    expect(screen.getByText('01:30')).toBeTruthy();
    // aria-label narrates the recording leg.
    expect(screen.getByTestId('agent-orb').getAttribute('aria-label')).toMatch(
      /^Recording — 01:30$/,
    );
  });

  it('still pulses for a recording, and reduced motion suppresses the pulse (#13)', () => {
    mockTasks = [
      {
        id: 'rec-1',
        kind: 'recording',
        type: 'workflow',
        label: 'Recording',
        status: 'running',
        activities: [],
        startedAt: Date.now(),
        recordingStartedAt: Date.now(),
      },
    ];
    // Motion allowed → pulse present.
    const { unmount } = renderWithProviders(<AgentOrb />);
    expect(
      screen.getByTestId('agent-orb-pulse').className.split(/\s+/),
    ).toContain('orb-pulsing');
    unmount();

    // Reduced motion → no pulse class, but the recording indicator stays.
    useReducedMotionMock.mockReturnValue(true);
    renderWithProviders(<AgentOrb />);
    expect(
      screen.getByTestId('agent-orb-pulse').className.split(/\s+/),
    ).not.toContain('orb-pulsing');
    expect(screen.getByTestId('agent-orb-recording')).toBeTruthy();
  });

  it('falls back to the count badge when running tasks are not recordings', () => {
    mockTasks = [makeTask('t1', 'running')];
    renderWithProviders(<AgentOrb />);
    expect(screen.queryByTestId('agent-orb-recording')).toBeNull();
    expect(screen.getByTestId('agent-orb-badge').textContent).toBe('1');
  });

  it('fires the placeholder log on click without throwing', () => {
    mockTasks = [makeTask('t1', 'running')];
    renderWithProviders(<AgentOrb />);
    const orb = screen.getByTestId('agent-orb');
    expect(() => fireEvent.click(orb)).not.toThrow();
    // Verify the placeholder log emits with the perf:orb category and the
    // current running-task count in the payload.
    expect(logInfoMock).toHaveBeenCalledWith(
      'perf:orb',
      expect.stringMatching(/orb clicked/i),
      expect.objectContaining({ runningTasks: 1 }),
    );
  });
});

// ---------------------------------------------------------------------------
// #79 — AgentPanel popover integration
// ---------------------------------------------------------------------------

describe('AgentOrb (#79) — panel popover', () => {
  beforeEach(() => {
    useReducedMotionMock.mockReturnValue(false);
    mockTasks = [];
    mockCmdBarPinned = false;
    logInfoMock.mockReset();
    mockRemoveTask.mockReset();
  });

  it('does not render the panel before the orb is clicked', () => {
    renderWithProviders(<AgentOrb />);
    expect(screen.queryByRole('region', { name: /activity/i })).toBeNull();
  });

  it('opens the panel when the orb is clicked', () => {
    renderWithProviders(<AgentOrb />);
    const orb = screen.getByTestId('agent-orb');
    act(() => {
      fireEvent.click(orb);
    });
    // The panel renders a <region> anchored by the "Activity" heading,
    // and the PopoverContent carries `aria-label="Agent activity"`.
    expect(screen.getByRole('region', { name: /activity/i })).toBeTruthy();
  });

  it('opens the panel when Enter is pressed with the orb focused', () => {
    renderWithProviders(<AgentOrb />);
    const orb = screen.getByTestId('agent-orb');
    orb.focus();
    act(() => {
      // Radix listens to keydown for trigger activation; a native <button>
      // also dispatches click on Enter. Fire both to cover either path.
      fireEvent.keyDown(orb, { key: 'Enter', code: 'Enter' });
      fireEvent.keyUp(orb, { key: 'Enter', code: 'Enter' });
      fireEvent.click(orb);
    });
    expect(screen.getByRole('region', { name: /activity/i })).toBeTruthy();
  });

  it('renders the empty state when there are no agent tasks', () => {
    renderWithProviders(<AgentOrb />);
    act(() => {
      fireEvent.click(screen.getByTestId('agent-orb'));
    });
    expect(screen.getByTestId('agent-panel-empty')).toBeTruthy();
    expect(screen.getByText(/nothing happening yet/i)).toBeTruthy();
  });

  it('renders the task list when tasks exist', () => {
    mockTasks = [
      makeTask('alpha', 'running'),
      makeTask('beta', 'done'),
    ];
    renderWithProviders(<AgentOrb />);
    act(() => {
      fireEvent.click(screen.getByTestId('agent-orb'));
    });
    expect(screen.getByTestId('task-card-alpha')).toBeTruthy();
    expect(screen.getByTestId('task-card-beta')).toBeTruthy();
    // Empty-state sentinel must NOT be present when tasks exist.
    expect(screen.queryByTestId('agent-panel-empty')).toBeNull();
  });

  it('closes the panel on Escape and restores focus to the orb', async () => {
    renderWithProviders(<AgentOrb />);
    const orb = screen.getByTestId('agent-orb');
    // Start with focus on the orb so Radix has a trigger to restore to — in
    // real usage the user either clicks (which focuses the button) or tabs in.
    orb.focus();
    act(() => {
      fireEvent.click(orb);
    });
    // Sanity: the panel is open.
    const region = screen.getByRole('region', { name: /activity/i });
    expect(region).toBeTruthy();

    // Radix Popover listens for Escape on the content layer. Fire from inside
    // the panel so the dismissable-layer handler catches it reliably.
    act(() => {
      fireEvent.keyDown(region, {
        key: 'Escape',
        code: 'Escape',
      });
    });

    // Panel dismissed (wait — Radix's dismissable-layer cleanup runs after
    // the synchronous Escape handler as the Content unmounts).
    await waitFor(() => {
      expect(screen.queryByRole('region', { name: /activity/i })).toBeNull();
    });
    // Focus returned to the trigger — Radix's FocusScope `onUnmountAutoFocus`
    // restores focus when the content unmounts. Wait for the microtask.
    await waitFor(() => {
      expect(document.activeElement).toBe(orb);
    });
  });
});
