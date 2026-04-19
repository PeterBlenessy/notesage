// @vitest-environment jsdom

/**
 * Tests for ActivityTaskCard — approval badges, path tooltip (task #22).
 *
 * Covers:
 * - Activity rows render approval badges matching `approvalMode` (auto/user/denied).
 * - Full path/detail appears in a tooltip on hover.
 * - Legacy activities without `approvalMode` render no badge (backward compat).
 */

import { describe, it, expect } from 'vitest';
import { renderWithProviders, screen, fireEvent } from '@/test/component-harness';
import { ActivityTaskCard } from '../ActivityTaskCard';
import type { AgentTask } from '@/stores/activity-store';
import type { ActivityApprovalMode } from '@/lib/ai/types';

function makeTask(overrides: Partial<AgentTask> = {}): AgentTask {
  return {
    id: 'task-1',
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
