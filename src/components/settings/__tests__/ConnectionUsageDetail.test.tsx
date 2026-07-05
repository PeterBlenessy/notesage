// @vitest-environment jsdom
//
// Tests for the connection-card usage surface (provider-usage-display #10):
// the usage detail popover (populated / empty), the "Free account" plan pill,
// and the no-polling invariant (no timers registered by rendering).

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@/test/component-harness';
import '@/test/tauri-mock';
import { ConnectionUsageDetail } from '../ConnectionUsageDetail';
import { ConnectionCard } from '../ConnectionCard';
import { useUsageStore } from '@/stores/usage-store';
import type { Connection } from '@/lib/ai/connections';

function makeConnection(overrides: Partial<Connection> = {}): Connection {
  return {
    id: 'conn-detail',
    provider: 'anthropic',
    authMethod: 'agent_managed',
    status: 'connected',
    label: 'Claude Code',
    credentials: { type: 'agent_managed', agentBinary: 'claude-agent-acp' },
    capabilities: ['interactive'],
    createdAt: Date.now(),
    ...overrides,
  };
}

function openDetail(): void {
  fireEvent.click(screen.getByRole('button', { name: /usage details/i }));
}

describe('ConnectionUsageDetail', () => {
  beforeEach(() => {
    useUsageStore.setState({ snapshots: {} });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows the empty state when no snapshot exists', () => {
    render(<ConnectionUsageDetail connection={makeConnection()} />);
    openDetail();
    expect(
      screen.getByText(/no usage reported yet — data appears after chatting with this provider/i),
    ).toBeDefined();
  });

  it('renders a populated snapshot with all sections and the provenance footer', () => {
    useUsageStore.getState().recordUsage('conn-detail', {
      contextUsed: 152_000,
      contextSize: 200_000,
      cost: { amount: 1.5, currency: 'USD' },
      rateLimit: {
        status: 'allowed_warning',
        rateLimitType: 'seven_day',
        resetsAt: Math.floor(Date.now() / 1000) + 3600,
        utilization: 91,
      },
      lastTurnUsage: { totalTokens: 1500, inputTokens: 1000, outputTokens: 500 },
      source: 'acp',
      confidence: 'exact',
    });

    render(<ConnectionUsageDetail connection={makeConnection()} />);
    openDetail();

    expect(screen.getByText('Context')).toBeDefined();
    expect(screen.getByText('152.0K / 200.0K (76%)')).toBeDefined();
    expect(screen.getByText('Session cost')).toBeDefined();
    expect(screen.getByText('$1.50')).toBeDefined();
    expect(screen.getByText('Rate limit')).toBeDefined();
    expect(screen.getByText('Weekly limit')).toBeDefined();
    // Warning status carries the same destructive urgency cue as the chat popover.
    expect(screen.getByText('Approaching limit').className).toContain('text-destructive');
    expect(screen.getByText('91%')).toBeDefined();
    expect(screen.getByText(/resets in/i)).toBeDefined();
    expect(screen.getByText('Last turn')).toBeDefined();
    expect(screen.getByText(/reported by agent · /i)).toBeDefined();
  });

  it('marks estimated snapshots with ≈ and "Estimated locally"', () => {
    useUsageStore.getState().recordUsage('conn-detail', {
      contextUsed: 1_000,
      contextSize: 4_096,
      source: 'estimate',
      confidence: 'estimated',
    });

    render(<ConnectionUsageDetail connection={makeConnection()} />);
    openDetail();

    expect(screen.getByText('≈1.0K / 4.1K (24%)')).toBeDefined();
    expect(screen.getByText(/estimated locally · /i)).toBeDefined();
  });

  it('introduces no timers or intervals (no-polling invariant)', () => {
    vi.useFakeTimers();
    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval');

    useUsageStore.getState().recordUsage('conn-detail', {
      contextUsed: 100,
      contextSize: 4_096,
      source: 'estimate',
      confidence: 'estimated',
    });
    render(<ConnectionUsageDetail connection={makeConnection()} />);
    openDetail();

    expect(setIntervalSpy).not.toHaveBeenCalled();
    setIntervalSpy.mockRestore();
  });
});

describe('ConnectionCard plan pill (#10)', () => {
  beforeEach(() => {
    useUsageStore.setState({ snapshots: {} });
  });

  it('shows the "Free account" pill when connection.freeAccount is set', () => {
    render(<ConnectionCard connection={makeConnection({ freeAccount: true })} />);
    expect(screen.getByText('Free account')).toBeDefined();
  });

  it('hides the plan pill when the account tier is unknown', () => {
    render(<ConnectionCard connection={makeConnection()} />);
    expect(screen.queryByText('Free account')).toBeNull();
  });

  it('exposes the usage-detail affordance on the card (empty-state path)', () => {
    render(<ConnectionCard connection={makeConnection()} />);
    fireEvent.click(screen.getByRole('button', { name: /usage details for claude code/i }));
    expect(screen.getByText(/no usage reported yet/i)).toBeDefined();
  });
});
