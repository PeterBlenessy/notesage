// @vitest-environment jsdom

import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@/test/component-harness';
import { ActivityLog } from '../ActivityLog';
import type { AgentActivity } from '@/lib/ai/types';

const activity = (overrides: Partial<AgentActivity> = {}): AgentActivity => ({
  kind: 'tool_call',
  label: 'Ran a tool',
  status: 'done',
  timestamp: 1000,
  ...overrides,
});

describe('ActivityLog', () => {
  it('renders null when only attachment activities are present', () => {
    const { container } = render(
      <ActivityLog activities={[activity({ kind: 'attachment', label: 'file.md' })]} isActive={false} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders null for an empty activity list', () => {
    const { container } = render(<ActivityLog activities={[]} isActive={false} />);
    expect(container.firstChild).toBeNull();
  });

  it('shows a completed-step count header when inactive', () => {
    render(
      <ActivityLog
        activities={[activity({ label: 'Step 1' }), activity({ label: 'Step 2', timestamp: 1001 })]}
        isActive={false}
      />,
    );
    expect(screen.getByText('2 steps completed')).toBeTruthy();
  });

  it('uses a singular step label for one non-attachment activity', () => {
    render(<ActivityLog activities={[activity()]} isActive={false} />);
    expect(screen.getByText('1 step completed')).toBeTruthy();
  });

  it('shows a working header when active with a running step', () => {
    render(
      <ActivityLog activities={[activity({ status: 'running' })]} isActive={true} />,
    );
    expect(screen.getByText('Working (1 step)')).toBeTruthy();
  });

  it('excludes attachment activities from the visible step count', () => {
    render(
      <ActivityLog
        activities={[
          activity({ label: 'Tool step' }),
          activity({ kind: 'attachment', label: 'attached.md', timestamp: 1001 }),
        ]}
        isActive={false}
      />,
    );
    expect(screen.getByText('1 step completed')).toBeTruthy();
  });

  it('reveals labels and details on expand', () => {
    render(
      <ActivityLog
        activities={[activity({ label: 'Reading file', detail: 'config.ts' })]}
        isActive={false}
      />,
    );
    expect(screen.queryByText('Reading file')).toBeNull();
    fireEvent.click(screen.getByText('1 step completed'));
    expect(screen.getByText('Reading file')).toBeTruthy();
    expect(screen.getByText(/config\.ts/)).toBeTruthy();
  });
});
