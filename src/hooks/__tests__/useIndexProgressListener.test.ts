// @vitest-environment jsdom

/**
 * The one listener for the index's progress events.
 *
 * `listen()` resolves asynchronously, so an unmount that races the
 * registration must unlisten the late registrations instead of leaking them
 * (the mounted-flag pattern from `useSandboxViolations`; this lifecycle used
 * to be tested on `useBackgroundActivity`, which no longer listens at all).
 */

import '@/test/tauri-mock';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { emitMockEvent, getListenerCount } from '@/test/tauri-mock';
import { useIndexProgressListener } from '../useIndexProgressListener';
import {
  SHOW_DELAY_MS,
  resetIndexProgressForTests,
  useIndexProgressStore,
} from '@/stores/index-progress-store';
import { useSettingsStore } from '@/stores/settings-store';
import { useWorkspaceStore } from '@/stores/workspace-store';

async function flushListenRegistration(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

const status = () => useIndexProgressStore.getState().status;

describe('useIndexProgressListener', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetIndexProgressForTests();
    useSettingsStore.setState({ indexReady: true });
    useWorkspaceStore.setState({ projects: [{ path: '/lib/Work', fileTree: [] }] });
  });

  afterEach(() => {
    resetIndexProgressForTests();
    vi.useRealTimers();
  });

  it('registers both listeners once mounted and removes them on unmount', async () => {
    const { unmount } = renderHook(() => useIndexProgressListener());
    await flushListenRegistration();

    expect(getListenerCount('index-progress')).toBe(1);
    expect(getListenerCount('index-ready')).toBe(1);

    unmount();
    expect(getListenerCount('index-progress')).toBe(0);
    expect(getListenerCount('index-ready')).toBe(0);
  });

  it('unmount BEFORE the registrations resolve unlistens the late registrations', async () => {
    const { unmount } = renderHook(() => useIndexProgressListener());
    unmount();
    await flushListenRegistration();

    expect(getListenerCount('index-progress')).toBe(0);
    expect(getListenerCount('index-ready')).toBe(0);
    expect(() => emitMockEvent('index-progress', { current: 1, total: 2 })).not.toThrow();
  });

  it('turns per-scope progress events into the store status, and index-ready ends the scope', async () => {
    renderHook(() => useIndexProgressListener());
    await flushListenRegistration();

    act(() => {
      emitMockEvent('index-progress', { project_path: '/lib/Work', current: 50, total: 200 });
      emitMockEvent('index-progress', { project_path: null, current: 10, total: 100 });
      vi.advanceTimersByTime(SHOW_DELAY_MS);
    });
    expect(status()).toMatchObject({ active: true, filesDone: 60, filesTotal: 300 });

    act(() => {
      emitMockEvent('index-ready', { project_path: '/lib/Work' });
    });
    expect(status()).toMatchObject({ filesDone: 210, filesTotal: 300, currentScopes: [''] });

    act(() => {
      emitMockEvent('index-ready', { project_path: null });
    });
    expect(status()).toMatchObject({ active: true, fraction: 1 });
  });

  it('follows settings.indexReady without waiting for a render', async () => {
    useSettingsStore.setState({ indexReady: false });
    renderHook(() => useIndexProgressListener());
    await flushListenRegistration();

    act(() => {
      emitMockEvent('index-progress', { project_path: '/lib/Work', current: 200, total: 200 });
      emitMockEvent('index-ready', { project_path: '/lib/Work' });
      vi.advanceTimersByTime(SHOW_DELAY_MS * 10);
    });
    // Every scope is ready, but startup has not settled.
    expect(status().active).toBe(true);

    act(() => {
      useSettingsStore.getState().setIndexReady(true);
      vi.advanceTimersByTime(5_000);
    });
    expect(status().active).toBe(false);
  });

  it('drops a project that leaves the workspace mid-pass, and ignores a mere tree change', async () => {
    useWorkspaceStore.setState({
      projects: [
        { path: '/lib/Work', fileTree: [] },
        { path: '/lib/Home', fileTree: [] },
      ],
    });
    renderHook(() => useIndexProgressListener());
    await flushListenRegistration();

    act(() => {
      emitMockEvent('index-progress', { project_path: '/lib/Work', current: 50, total: 200 });
      emitMockEvent('index-progress', { project_path: '/lib/Home', current: 5, total: 40 });
      vi.advanceTimersByTime(SHOW_DELAY_MS);
    });
    expect(status()).toMatchObject({ filesDone: 55, filesTotal: 240 });

    // Same roots, new array (what every file event does): nothing is dropped.
    act(() => {
      useWorkspaceStore.setState({
        projects: [
          { path: '/lib/Work', fileTree: [] },
          { path: '/lib/Home', fileTree: [] },
        ],
      });
    });
    expect(status()).toMatchObject({ filesDone: 55, filesTotal: 240 });

    act(() => {
      useWorkspaceStore.setState({ projects: [{ path: '/lib/Home', fileTree: [] }] });
      emitMockEvent('index-progress', { project_path: '/lib/Work', current: 100, total: 200 });
    });
    expect(status()).toMatchObject({ filesDone: 5, filesTotal: 40, currentScopes: ['/lib/Home'] });
  });
});
