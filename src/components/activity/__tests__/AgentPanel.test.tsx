// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach } from 'vitest';
import '@/test/tauri-mock';
import { render, screen, fireEvent } from '@/test/component-harness';
import { AgentPanel } from '../AgentPanel';
import { useSessionRunStore } from '@/stores/session-run-store';
import { useChatStore } from '@/stores/chat-store';
import { useActivityStore } from '@/stores/activity-store';

function seedConversations(ids: string[]) {
  useChatStore.setState({
    conversations: ids.map((id) => ({ id, title: `Chat ${id}`, messages: [], createdAt: 0, updatedAt: 0, projectPaths: [], segments: [], activeSegmentIndex: 0, activeLeafId: null })) as never,
    activeConversationId: null,
  });
}

beforeEach(() => {
  useSessionRunStore.setState({ runs: {}, foregroundConversationId: null });
  useActivityStore.setState({ tasks: [] });
  useChatStore.setState({ conversations: [], activeConversationId: null });
});

describe('AgentPanel — unwatched sessions (tasks #12, #14)', () => {
  it('shows the empty state when there are no tasks and no unwatched sessions', () => {
    render(<AgentPanel />);
    expect(screen.getByTestId('agent-panel-empty')).toBeTruthy();
  });

  it('lists running/awaiting sessions that are NOT the foreground one', () => {
    seedConversations(['A', 'B', 'C']);
    useSessionRunStore.setState({ foregroundConversationId: 'A' });
    useSessionRunStore.getState().setRun('A', { status: 'running' }); // foreground — excluded
    useSessionRunStore.getState().setRun('B', { status: 'running' });
    useSessionRunStore.getState().setRun('C', { status: 'awaiting_permission' });

    render(<AgentPanel />);
    const rows = screen.getAllByTestId('agent-panel-session-row');
    expect(rows).toHaveLength(2); // B and C, not A
    // Needs-you (C) sorts first.
    expect(rows[0].textContent).toContain('Chat C');
    expect(rows[0].textContent).toContain('Needs you');
    expect(rows[1].textContent).toContain('Chat B');
    expect(rows[1].textContent).toContain('Running');
  });

  it('clicking a session row foregrounds it via onSelectSession', () => {
    seedConversations(['A', 'B']);
    useSessionRunStore.setState({ foregroundConversationId: 'A' });
    useSessionRunStore.getState().setRun('A', { status: 'running' });
    useSessionRunStore.getState().setRun('B', { status: 'running' });
    const onSelectSession = vi.fn();

    render(<AgentPanel onSelectSession={onSelectSession} />);
    fireEvent.click(screen.getByTestId('agent-panel-session-row'));
    expect(onSelectSession).toHaveBeenCalledWith('B');
  });
});
