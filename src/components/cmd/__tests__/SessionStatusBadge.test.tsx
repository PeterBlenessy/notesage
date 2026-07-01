// @vitest-environment jsdom

import { describe, it, expect, beforeEach } from 'vitest';
import '@/test/tauri-mock';
import { render, screen } from '@/test/component-harness';
import { SessionStatusBadge, HistoryRowLeadingIcon } from '../SessionStatusBadge';
import { useSessionRunStore } from '@/stores/session-run-store';

beforeEach(() => {
  useSessionRunStore.setState({ runs: {}, foregroundConversationId: null });
});

describe('SessionStatusBadge (task #9)', () => {
  const cases = [
    ['running', 'session-status-running', 'Running'],
    ['awaiting_permission', 'session-status-awaiting', 'Awaiting permission'],
    ['queued', 'session-status-queued', 'Queued'],
    ['error', 'session-status-error', 'Error'],
  ] as const;

  for (const [status, testid, label] of cases) {
    it(`renders the ${status} indicator`, () => {
      useSessionRunStore.getState().setRun('c', { status });
      render(<SessionStatusBadge conversationId="c" />);
      expect(screen.getByTestId(testid)).toBeTruthy();
      expect(screen.getByLabelText(label)).toBeTruthy();
    });
  }

  it('renders nothing when the conversation has no run', () => {
    const { container } = render(<SessionStatusBadge conversationId="c" />);
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing when idle', () => {
    useSessionRunStore.getState().setRun('c', { status: 'idle' });
    const { container } = render(<SessionStatusBadge conversationId="c" />);
    expect(container.firstChild).toBeNull();
  });
});

describe('HistoryRowLeadingIcon', () => {
  it('shows the default chat glyph when there is no live run', () => {
    const { container } = render(<HistoryRowLeadingIcon conversationId="c" />);
    // lucide MessageSquare renders an <svg> with the lucide-message-square class.
    expect(container.querySelector('svg.lucide-message-square')).toBeTruthy();
    expect(screen.queryByTestId('session-status-running')).toBeNull();
  });

  it('shows the status badge when the conversation has a live run', () => {
    useSessionRunStore.getState().setRun('c', { status: 'running' });
    const { container } = render(<HistoryRowLeadingIcon conversationId="c" />);
    expect(screen.getByTestId('session-status-running')).toBeTruthy();
    expect(container.querySelector('svg.lucide-message-square')).toBeNull();
  });
});
