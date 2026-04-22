// @vitest-environment jsdom

/**
 * Tests for AgentOrb (#29) — the 46 px ambient orb at bottom-right of the
 * QuietLayout. Verifies:
 *  - count badge appears only when running tasks > 0
 *  - the `orb-pulsing` class is added/removed based on running count
 *  - reduced motion suppresses the pulse class entirely
 *  - the orb is hidden (display: none) when the FloatingCommandBar is pinned
 *  - aria-label updates with the live task count
 *  - click invokes the placeholder log handler without throwing
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderWithProviders, screen, fireEvent } from '@/test/component-harness';
import type { AgentTask } from '@/stores/activity-store';

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

vi.mock('@/stores/activity-store', () => {
  const state = {
    get tasks() {
      return mockTasks;
    },
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
// Helpers
// ---------------------------------------------------------------------------

function makeTask(id: string, status: AgentTask['status']): AgentTask {
  return {
    id,
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

  it('adds the orb-pulsing class when running tasks > 0', () => {
    mockTasks = [makeTask('t1', 'running')];
    renderWithProviders(<AgentOrb />);
    const orb = screen.getByTestId('agent-orb');
    expect(orb.className.split(/\s+/)).toContain('orb-pulsing');
  });

  it('does NOT add the orb-pulsing class when running tasks == 0', () => {
    mockTasks = [];
    renderWithProviders(<AgentOrb />);
    const orb = screen.getByTestId('agent-orb');
    expect(orb.className.split(/\s+/)).not.toContain('orb-pulsing');
  });

  it('omits the orb-pulsing class when reduced motion is preferred (utility-omission approach)', () => {
    useReducedMotionMock.mockReturnValue(true);
    mockTasks = [makeTask('t1', 'running'), makeTask('t2', 'running')];
    renderWithProviders(<AgentOrb />);
    const orb = screen.getByTestId('agent-orb');
    // Reduced motion: the pulse class is omitted entirely. The badge still
    // renders because the count > 0 — only the animation is suppressed.
    expect(orb.className.split(/\s+/)).not.toContain('orb-pulsing');
    expect(screen.getByTestId('agent-orb-badge').textContent).toBe('2');
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

  it('uses idle aria-label when no tasks are running', () => {
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
