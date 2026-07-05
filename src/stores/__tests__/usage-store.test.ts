// @vitest-environment jsdom
/**
 * Unit tests for usage-store (provider-usage-display #6).
 *
 * Covers: recordUsage merge semantics, updatedAt stamping, sparse writes not
 * erasing prior fields, clearUsage, and the NOT-persisted invariant (no
 * localStorage key — stale persisted quota is worse than none).
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { useUsageStore } from '../usage-store';

describe('usage-store', () => {
  beforeEach(() => {
    useUsageStore.setState({ snapshots: {} });
    localStorage.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('records a snapshot with connectionId and updatedAt stamped', () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_751_700_000_000);

    useUsageStore.getState().recordUsage('conn-a', {
      contextUsed: 4200,
      contextSize: 200_000,
      source: 'acp',
      confidence: 'exact',
    });

    const snap = useUsageStore.getState().getSnapshot('conn-a');
    expect(snap).toEqual({
      connectionId: 'conn-a',
      contextUsed: 4200,
      contextSize: 200_000,
      source: 'acp',
      confidence: 'exact',
      updatedAt: 1_751_700_000_000,
    });
  });

  it('merges subsequent writes and re-stamps updatedAt', () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    useUsageStore.getState().recordUsage('conn-a', {
      contextUsed: 100,
      contextSize: 200_000,
      source: 'acp',
      confidence: 'exact',
    });

    vi.setSystemTime(2_000);
    useUsageStore.getState().recordUsage('conn-a', {
      rateLimit: { status: 'allowed_warning', rateLimitType: 'five_hour' },
      source: 'acp',
      confidence: 'exact',
    });

    const snap = useUsageStore.getState().getSnapshot('conn-a')!;
    // Prior context fields survive the sparse rate-limit-only write.
    expect(snap.contextUsed).toBe(100);
    expect(snap.contextSize).toBe(200_000);
    expect(snap.rateLimit?.status).toBe('allowed_warning');
    expect(snap.updatedAt).toBe(2_000);
  });

  it('drops undefined-valued keys from the patch instead of erasing prior fields', () => {
    useUsageStore.getState().recordUsage('conn-a', {
      contextUsed: 100,
      contextSize: 200_000,
      cost: { amount: 0.42, currency: 'USD' },
      source: 'acp',
      confidence: 'exact',
    });

    useUsageStore.getState().recordUsage('conn-a', {
      contextUsed: 150,
      contextSize: 200_000,
      cost: undefined, // explicit undefined must NOT erase the stored cost
      rateLimit: undefined,
      source: 'acp',
      confidence: 'exact',
    });

    const snap = useUsageStore.getState().getSnapshot('conn-a')!;
    expect(snap.contextUsed).toBe(150);
    expect(snap.cost).toEqual({ amount: 0.42, currency: 'USD' });
  });

  it('keeps snapshots independent per connection', () => {
    useUsageStore.getState().recordUsage('conn-a', { contextUsed: 1, source: 'acp', confidence: 'exact' });
    useUsageStore.getState().recordUsage('conn-b', { contextUsed: 2, source: 'estimate', confidence: 'estimated' });

    expect(useUsageStore.getState().getSnapshot('conn-a')?.contextUsed).toBe(1);
    expect(useUsageStore.getState().getSnapshot('conn-b')?.contextUsed).toBe(2);
    expect(useUsageStore.getState().getSnapshot('conn-b')?.confidence).toBe('estimated');
  });

  it('a later write can flip provenance (most recent writer wins)', () => {
    useUsageStore.getState().recordUsage('conn-a', { contextUsed: 1, source: 'estimate', confidence: 'estimated' });
    useUsageStore.getState().recordUsage('conn-a', { contextUsed: 2, source: 'acp', confidence: 'exact' });

    const snap = useUsageStore.getState().getSnapshot('conn-a')!;
    expect(snap.source).toBe('acp');
    expect(snap.confidence).toBe('exact');
  });

  it('clearUsage removes only the targeted connection', () => {
    useUsageStore.getState().recordUsage('conn-a', { source: 'acp', confidence: 'exact' });
    useUsageStore.getState().recordUsage('conn-b', { source: 'acp', confidence: 'exact' });

    useUsageStore.getState().clearUsage('conn-a');

    expect(useUsageStore.getState().getSnapshot('conn-a')).toBeUndefined();
    expect(useUsageStore.getState().getSnapshot('conn-b')).toBeDefined();
  });

  it('getSnapshot returns undefined for unknown connections', () => {
    expect(useUsageStore.getState().getSnapshot('nope')).toBeUndefined();
  });

  it('is NOT persisted — writing usage leaves no localStorage key behind', () => {
    useUsageStore.getState().recordUsage('conn-a', {
      contextUsed: 4200,
      contextSize: 200_000,
      source: 'acp',
      confidence: 'exact',
    });

    // No persist middleware → nothing lands in localStorage, under any key.
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)!;
      expect(key.toLowerCase()).not.toContain('usage');
    }
    expect(localStorage.getItem('notesage-usage')).toBeNull();
  });
});
