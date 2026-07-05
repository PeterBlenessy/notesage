import { describe, it, expect, vi } from 'vitest';
import {
  cleanupKeyFor,
  runConvCleanup,
  runAllConvCleanups,
  registerConvCleanup,
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

describe('registerConvCleanup (deep-review #4b)', () => {
  it('runs the stale cleanup before overwriting the entry', () => {
    // A plain `map.set` overwrite leaked the previous closure — its listeners
    // stayed live alongside the new registration and double-wrote stream
    // events. Registration must tear the stale one down first.
    const stale = vi.fn();
    const fresh = vi.fn();
    const map: CleanupMap = new Map([['conv-A', stale]]);

    const hadStale = registerConvCleanup(map, 'conv-A', fresh);

    expect(hadStale).toBe(true);
    expect(stale).toHaveBeenCalledTimes(1);
    expect(fresh).not.toHaveBeenCalled(); // the NEW cleanup is registered, not run
    expect(map.get('conv-A')).toBe(fresh);
  });

  it('registers without running anything when no stale entry exists', () => {
    const fresh = vi.fn();
    const map: CleanupMap = new Map();

    expect(registerConvCleanup(map, 'conv-B', fresh)).toBe(false);
    expect(fresh).not.toHaveBeenCalled();
    expect(map.get('conv-B')).toBe(fresh);
  });

  it('survives a stale cleanup that deregisters itself by key (buildAcpChatCleanup clearSelf)', () => {
    // buildAcpChatCleanup's `clearSelf` deletes its own key when run. The
    // stale entry is removed BEFORE it runs and the fresh one is set AFTER,
    // so the self-deregistration cannot clobber the new registration.
    const map: CleanupMap = new Map();
    const stale = vi.fn(() => { map.delete('conv-A'); });
    map.set('conv-A', stale);
    const fresh = vi.fn();

    registerConvCleanup(map, 'conv-A', fresh);

    expect(stale).toHaveBeenCalledTimes(1);
    expect(map.get('conv-A')).toBe(fresh);
  });

  it('scopes to the named conversation only', () => {
    const staleA = vi.fn();
    const otherB = vi.fn();
    const map: CleanupMap = new Map([
      ['conv-A', staleA],
      ['conv-B', otherB],
    ]);

    registerConvCleanup(map, 'conv-A', vi.fn());

    expect(staleA).toHaveBeenCalledTimes(1);
    expect(otherB).not.toHaveBeenCalled();
    expect(map.get('conv-B')).toBe(otherB);
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
