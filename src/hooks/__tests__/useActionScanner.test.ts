// @vitest-environment jsdom

/**
 * `useActionScanner` waits for the index, not for the UI (S-1), and hands
 * every changed path to the store, which does the coalescing (S-5).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';

import { emitMockEvent, getListenerCount } from '@/test/tauri-mock';

const { fullScan, incrementalUpdate, refreshRoot } = vi.hoisted(() => ({
  fullScan: vi.fn(async () => undefined),
  incrementalUpdate: vi.fn(async () => undefined),
  refreshRoot: vi.fn(async () => undefined),
}));

vi.mock('@/stores/action-store', () => ({
  useActionStore: { getState: () => ({ fullScan, incrementalUpdate, refreshRoot }) },
}));

import { useActionScanner } from '../useActionScanner';
import { useSettingsStore } from '@/stores/settings-store';

const flush = () => act(async () => { await Promise.resolve(); });

beforeEach(() => {
  fullScan.mockClear();
  incrementalUpdate.mockClear();
  refreshRoot.mockClear();
  useSettingsStore.setState({ startupReady: false, indexReady: false });
});

describe('useActionScanner', () => {
  it('does not scan when the UI is ready but the index is not', async () => {
    renderHook(() => useActionScanner());
    act(() => useSettingsStore.setState({ startupReady: true }));
    await flush();

    expect(fullScan).not.toHaveBeenCalled();
    expect(getListenerCount('file-changed-batch')).toBe(0);
  });

  it('runs the full scan once when the index becomes ready', async () => {
    const { rerender } = renderHook(() => useActionScanner());
    act(() => useSettingsStore.setState({ startupReady: true }));
    act(() => useSettingsStore.setState({ indexReady: true }));
    await flush();
    rerender();

    expect(fullScan).toHaveBeenCalledTimes(1);
  });

  it('reports every changed path to the store and leaves the coalescing to it', async () => {
    renderHook(() => useActionScanner());
    act(() => useSettingsStore.setState({ indexReady: true }));
    await flush();
    expect(getListenerCount('file-changed-batch')).toBe(1);

    emitMockEvent('file-changed-batch', [
      { path: '/lib/Alpha/a.md', kind: 'modify' },
      { path: '/lib/Alpha/b.md', kind: 'modify' },
      { path: '/lib/Inbox/page.html', kind: 'create' },
    ]);

    expect(incrementalUpdate.mock.calls.map((c) => (c as unknown[])[0])).toEqual([
      '/lib/Alpha/a.md',
      '/lib/Alpha/b.md',
      '/lib/Inbox/page.html',
    ]);
    // A burst no longer turns into a project-wide full scan from here.
    expect(fullScan).toHaveBeenCalledTimes(1);
  });

  it('reports reindexed paths too, which is how an own save reaches the Actions view', async () => {
    renderHook(() => useActionScanner());
    act(() => useSettingsStore.setState({ indexReady: true }));
    await flush();
    expect(getListenerCount('links-reindexed')).toBe(1);

    // The app's own saves never appear in `file-changed-batch`.
    emitMockEvent('links-reindexed', ['/lib/Alpha/saved.md']);

    expect(incrementalUpdate.mock.calls.map((c) => (c as unknown[])[0])).toEqual(['/lib/Alpha/saved.md']);
  });

  it('rescans a project when its index pass finishes after startup', async () => {
    renderHook(() => useActionScanner());
    act(() => useSettingsStore.setState({ indexReady: true }));
    await flush();
    expect(getListenerCount('index-ready')).toBe(1);

    // A project added mid-session: its tasks are in the index only now, and
    // no file changed to announce them.
    emitMockEvent('index-ready', { project_path: '/lib/Added' });

    expect(refreshRoot.mock.calls.map((c) => (c as unknown[])[0])).toEqual(['/lib/Added']);
    expect(fullScan).toHaveBeenCalledTimes(1);

    // The global database's pass names no project.
    emitMockEvent('index-ready', { project_path: null });
    expect(refreshRoot).toHaveBeenCalledTimes(1);
  });

  it('ignores the index passes of startup itself: the full scan covers them', async () => {
    renderHook(() => useActionScanner());
    act(() => useSettingsStore.setState({ startupReady: true }));
    await flush();

    expect(getListenerCount('index-ready')).toBe(0);
  });

  it('stops listening on unmount', async () => {
    const { unmount } = renderHook(() => useActionScanner());
    act(() => useSettingsStore.setState({ indexReady: true }));
    await flush();
    expect(getListenerCount('file-changed-batch')).toBe(1);

    unmount();

    expect(getListenerCount('file-changed-batch')).toBe(0);
    expect(getListenerCount('links-reindexed')).toBe(0);
    expect(getListenerCount('index-ready')).toBe(0);
  });
});
