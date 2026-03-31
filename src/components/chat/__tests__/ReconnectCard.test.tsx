// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@/test/component-harness';
import { ReconnectCard } from '../ReconnectCard';

// Mock stores used by the component
vi.mock('@/stores/connections-store', () => ({
  useConnectionsStore: vi.fn((selector) =>
    selector({ connections: [] })
  ),
}));

vi.mock('@/stores/routing-store', () => ({
  useRoutingStore: vi.fn((selector) =>
    selector({ routing: { interactive: { connectionId: null } } })
  ),
}));

vi.mock('@/lib/ai/connections', () => ({
  getCapabilities: vi.fn(() => []),
}));

describe('ReconnectCard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders reconnecting state with spinner and attempt info', () => {
    render(
      <ReconnectCard
        statusType="reconnecting"
        agentName="Claude Code"
        attempt={2}
        maxAttempts={3}
        messageId="msg-1"
      />
    );

    expect(screen.getByText('Connection interrupted')).toBeDefined();
    expect(screen.getByText(/reconnecting to Claude Code/)).toBeDefined();
    expect(screen.getByText(/attempt 2 of 3/)).toBeDefined();
  });

  it('renders reconnected state with checkmark', () => {
    render(
      <ReconnectCard
        statusType="reconnected"
        agentName="Claude Code"
        messageId="msg-1"
        dismissAt={Date.now() + 10000}
      />
    );

    expect(screen.getByText('Reconnected')).toBeDefined();
  });

  it('renders failed state with error message and Retry button', () => {
    const onRetry = vi.fn();
    render(
      <ReconnectCard
        statusType="failed"
        agentName="Claude Code"
        messageId="msg-1"
        onRetry={onRetry}
      />
    );

    expect(screen.getByText(/Unable to reach/)).toBeDefined();
    expect(screen.getByText(/Claude Code/)).toBeDefined();

    const retryButton = screen.getByRole('button', { name: /Retry/ });
    expect(retryButton).toBeDefined();
    retryButton.click();
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it('hides Switch provider button when no alternative connections exist', () => {
    render(
      <ReconnectCard
        statusType="failed"
        agentName="Claude Code"
        messageId="msg-1"
        onRetry={() => {}}
        onSelectConnection={() => {}}
      />
    );

    // No "Switch provider" button because connections store returns empty array
    expect(screen.queryByText(/Switch provider/)).toBeNull();
  });

  it('calls onDismiss after dismissAt for reconnected state', async () => {
    vi.useFakeTimers();
    const onDismiss = vi.fn();

    render(
      <ReconnectCard
        statusType="reconnected"
        agentName="Agent"
        messageId="msg-1"
        dismissAt={Date.now() + 3000}
        onDismiss={onDismiss}
      />
    );

    // Advance past the dismiss time
    vi.advanceTimersByTime(3100);

    expect(onDismiss).toHaveBeenCalledWith('msg-1');

    vi.useRealTimers();
  });
});
