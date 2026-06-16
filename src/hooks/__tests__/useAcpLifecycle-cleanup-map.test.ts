import { describe, it, expect, vi } from 'vitest';
import {
  cleanupKeyFor,
  runConvCleanup,
  runAllConvCleanups,
  type CleanupMap,
} from '@/hooks/useAcpLifecycle';

// The per-conversation stream-cleanup map (review #3). A single `cleanupRef`
// previously let one conversation's send overwrite another's cleanup — the
// first leaked its listeners and the first's completion ran the second's
// cleanup, killing the second's live stream. These tests lock the map
// semantics: each conversation's cleanup is independent.

describe('cleanupKeyFor', () => {
  it('uses the conversation id as the key when present', () => {
    expect(cleanupKeyFor('conv-A')).toBe('conv-A');
  });

  it('falls back to the agent-registry default key for null/undefined', () => {
    // Must match the ACP agent registry sentinel so the agent-exited handler
    // (which only knows the registry key) can find the matching cleanup.
    expect(cleanupKeyFor(null)).toBe('__default__');
    expect(cleanupKeyFor(undefined)).toBe('__default__');
  });
});

describe('runConvCleanup (review #3)', () => {
  it('runs and removes only the named conversation, leaving others intact', () => {
    const a = vi.fn();
    const b = vi.fn();
    const map: CleanupMap = new Map([
      ['conv-A', a],
      ['conv-B', b],
    ]);

    runConvCleanup(map, 'conv-A', true);

    expect(a).toHaveBeenCalledTimes(1);
    expect(a).toHaveBeenCalledWith(true);
    expect(b).not.toHaveBeenCalled(); // the OTHER stream is untouched
    expect(map.has('conv-A')).toBe(false);
    expect(map.has('conv-B')).toBe(true);
  });

  it('is a no-op when nothing is registered for the conversation', () => {
    const map: CleanupMap = new Map();
    expect(() => runConvCleanup(map, 'conv-missing')).not.toThrow();
  });

  it('forwards the cancelled flag (defaults undefined)', () => {
    const a = vi.fn();
    runConvCleanup(new Map([['conv-A', a]]), 'conv-A');
    expect(a).toHaveBeenCalledWith(undefined);
  });
});

describe('runAllConvCleanups (review #3)', () => {
  it('runs and clears every registered cleanup', () => {
    const a = vi.fn();
    const b = vi.fn();
    const map: CleanupMap = new Map([
      ['conv-A', a],
      ['conv-B', b],
    ]);

    runAllConvCleanups(map, true);

    expect(a).toHaveBeenCalledWith(true);
    expect(b).toHaveBeenCalledWith(true);
    expect(map.size).toBe(0);
  });
});
