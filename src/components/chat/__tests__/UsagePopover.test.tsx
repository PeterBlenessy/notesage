// @vitest-environment jsdom
//
// Tests for UsagePopover (provider-usage-display #9): click-to-open detail
// rows, threshold captions at the PRD's 75/90 bands (mocked 76% / 91%
// snapshots per the quality gate), provenance footer, and the pure formatters.

import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@/test/component-harness';
import {
  UsagePopover,
  formatTokenCount,
  formatRateLimitType,
  formatRateLimitStatus,
  formatResetCountdown,
  thresholdCaption,
  ringThreshold,
} from '../UsagePopover';
import type { UsagePopoverData } from '../UsagePopover';

function makeData(overrides: Partial<UsagePopoverData> = {}): UsagePopoverData {
  return {
    contextUsed: 4_200,
    contextSize: 200_000,
    isEstimated: false,
    ...overrides,
  };
}

function openPopover(): void {
  fireEvent.click(screen.getByRole('button', { name: /context usage/i }));
}

describe('UsagePopover', () => {
  it('renders the pill with an accessible summary label and a decorative ring', () => {
    const { container } = render(<UsagePopover data={makeData()} />);
    const trigger = screen.getByRole('button', { name: /context usage: 4\.2K \/ 200\.0K \(2%\)/i });
    expect(trigger).toBeDefined();
    expect(container.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
  });

  it('opens on click with context row, percent, and provenance footer', () => {
    render(<UsagePopover data={makeData()} />);
    openPopover();

    expect(screen.getByText('4.2K / 200.0K')).toBeDefined();
    expect(screen.getByText('2%')).toBeDefined();
    expect(screen.getByText(/reported by agent/i)).toBeDefined();
    // No caption below 75%.
    expect(screen.queryByText(/context filling up/i)).toBeNull();
    expect(screen.queryByText(/start a new session soon/i)).toBeNull();
  });

  it('shows "Context filling up" at a 76% snapshot (75–90 band)', () => {
    render(<UsagePopover data={makeData({ contextUsed: 152_000 })} />);
    openPopover();
    expect(screen.getByText('Context filling up')).toBeDefined();
    expect(screen.queryByText(/start a new session soon/i)).toBeNull();
  });

  it('shows "Start a new session soon" at a 91% snapshot (≥90 band)', () => {
    render(<UsagePopover data={makeData({ contextUsed: 182_000 })} />);
    openPopover();
    const caption = screen.getByText('Start a new session soon');
    expect(caption.className).toContain('text-destructive');
  });

  it('renders the ≈ prefix and "Estimated locally" for estimated data', () => {
    render(<UsagePopover data={makeData({ isEstimated: true })} />);
    openPopover();
    expect(screen.getByText('≈4.2K / 200.0K')).toBeDefined();
    expect(screen.getByText(/estimated locally/i)).toBeDefined();
    expect(screen.queryByText(/reported by agent/i)).toBeNull();
  });

  it('renders the per-turn breakdown when present', () => {
    render(
      <UsagePopover
        data={makeData({
          lastTurnUsage: {
            totalTokens: 1_500,
            inputTokens: 1_000,
            outputTokens: 500,
            thoughtTokens: 120,
          },
        })}
      />,
    );
    openPopover();
    expect(screen.getByText('Last turn')).toBeDefined();
    expect(screen.getByText('Input')).toBeDefined();
    expect(screen.getByText('1.0K')).toBeDefined();
    expect(screen.getByText('Thinking')).toBeDefined();
    // Absent optionals render no row.
    expect(screen.queryByText('Cache read')).toBeNull();
  });

  it('renders cost and rate-limit rows with a warning status in destructive', () => {
    render(
      <UsagePopover
        data={makeData({
          cost: { amount: 0.42, currency: 'USD' },
          rateLimit: {
            status: 'allowed_warning',
            rateLimitType: 'five_hour',
            resetsAt: Math.floor(Date.now() / 1000) + 2 * 3600 + 15 * 60,
            utilization: 87,
          },
        })}
      />,
    );
    openPopover();

    expect(screen.getByText('Session cost')).toBeDefined();
    expect(screen.getByText('$0.42')).toBeDefined();
    expect(screen.getByText('Rate limit')).toBeDefined();
    expect(screen.getByText('5-hour limit')).toBeDefined();
    const status = screen.getByText('Approaching limit');
    expect(status.className).toContain('text-destructive');
    expect(screen.getByText('87%')).toBeDefined();
    expect(screen.getByText(/resets in 2h/i)).toBeDefined();
  });

  it('hides the rate-limit section entirely when no fields are present', () => {
    render(<UsagePopover data={makeData({ rateLimit: { raw: { odd: true } } })} />);
    openPopover();
    expect(screen.queryByText('Rate limit')).toBeNull();
  });
});

describe('formatters', () => {
  it('formatTokenCount', () => {
    expect(formatTokenCount(950)).toBe('950');
    expect(formatTokenCount(4_200)).toBe('4.2K');
    expect(formatTokenCount(1_200_000)).toBe('1.2M');
  });

  it('formatRateLimitType', () => {
    expect(formatRateLimitType('five_hour')).toBe('5-hour limit');
    expect(formatRateLimitType('seven_day')).toBe('Weekly limit');
    expect(formatRateLimitType('per_minute')).toBe('per minute limit');
  });

  it('formatRateLimitStatus', () => {
    expect(formatRateLimitStatus('allowed')).toBe('OK');
    expect(formatRateLimitStatus('allowed_warning')).toBe('Approaching limit');
    expect(formatRateLimitStatus('rejected')).toBe('Limit reached');
    expect(formatRateLimitStatus('something_else')).toBe('something else');
  });

  it('formatResetCountdown', () => {
    const now = 1_000_000_000_000; // ms
    const nowSec = now / 1000;
    expect(formatResetCountdown(nowSec + 30, now)).toBe('resets soon');
    expect(formatResetCountdown(nowSec - 100, now)).toBe('resets soon');
    expect(formatResetCountdown(nowSec + 45 * 60, now)).toBe('resets in 45m');
    expect(formatResetCountdown(nowSec + 2 * 3600 + 15 * 60, now)).toBe('resets in 2h 15m');
    expect(formatResetCountdown(nowSec + 72 * 3600, now)).toBe('resets in 3d');
  });

  it('thresholdCaption and ringThreshold band edges', () => {
    expect(thresholdCaption(0.74)).toBeUndefined();
    expect(thresholdCaption(0.75)).toBe('Context filling up');
    expect(thresholdCaption(0.89)).toBe('Context filling up');
    expect(thresholdCaption(0.9)).toBe('Start a new session soon');

    expect(ringThreshold(0.5)).toEqual({ opacity: 0.7 });
    expect(ringThreshold(0.76)).toEqual({ className: 'text-foreground', opacity: 1 });
    expect(ringThreshold(0.91)).toEqual({ className: 'text-destructive', opacity: 1 });
  });
});
