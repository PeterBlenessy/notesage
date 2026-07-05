// @vitest-environment jsdom

/**
 * Regression tests for the listener lifecycle of `useBackgroundActivity`
 * (deep-review batch 2, item #1).
 *
 * The hook registers two Tauri event listeners (`index-progress`,
 * `index-ready`) behind a dynamic `import("@tauri-apps/api/event")`, so the
 * registrations resolve asynchronously. An unmount that races the resolution
 * used to leak both listeners (and setState on the unmounted hook). The fix
 * is the mounted-flag pattern from `useSandboxViolations`: late-resolving
 * registrations are unlistened immediately when the hook is already gone.
 */

import '@/test/tauri-mock';
import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { emitMockEvent, getListenerCount } from '@/test/tauri-mock';
import { useBackgroundActivity } from '../use-background-activity';

/**
 * Flush the async registration chain: the dynamic module import plus the two
 * `listen()` promises all resolve on microtasks; one macrotask hop makes the
 * flush robust against extra chaining.
 */
async function flushListenRegistration(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

describe('useBackgroundActivity — listener lifecycle', () => {
  it('registers both listeners once mounted and removes them on unmount', async () => {
    const { unmount } = renderHook(() => useBackgroundActivity());
    await flushListenRegistration();

    expect(getListenerCount('index-progress')).toBe(1);
    expect(getListenerCount('index-ready')).toBe(1);

    unmount();
    expect(getListenerCount('index-progress')).toBe(0);
    expect(getListenerCount('index-ready')).toBe(0);
  });

  it('unmount BEFORE the listen registrations resolve does not throw and unlistens the late registrations', async () => {
    const { unmount } = renderHook(() => useBackgroundActivity());

    // Unmount synchronously — the dynamic import / listen() promises have not
    // resolved yet, so the registrations arrive after cleanup already ran.
    unmount();

    // Let the late registrations resolve; the mounted-flag must immediately
    // unlisten them instead of storing dead unlisteners in the closure.
    await flushListenRegistration();

    expect(getListenerCount('index-progress')).toBe(0);
    expect(getListenerCount('index-ready')).toBe(0);

    // Nothing left to receive the event — emitting must be a no-op, not a
    // setState on an unmounted component.
    expect(() => emitMockEvent('index-progress', { current: 1, total: 2 })).not.toThrow();
  });

  it('reflects index-progress events while mounted (sanity for the guarded handlers)', async () => {
    const { result } = renderHook(() => useBackgroundActivity());
    await flushListenRegistration();

    act(() => {
      emitMockEvent('index-progress', { current: 1, total: 4 });
    });

    expect(result.current.active).toBe(true);
    expect(result.current.indeterminate).toBe(true);
    expect(result.current.label).toBe('Indexing 1/4');
  });
});
