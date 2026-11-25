// @vitest-environment jsdom

/**
 * `useBackgroundActivity` — indexing (from `index-progress-store`) and model
 * downloads (from `recording-store`) as one activity. The hook registers no
 * Tauri listeners any more; that lifecycle is `useIndexProgressListener`'s.
 */

import '@/test/tauri-mock';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { getListenerCount } from '@/test/tauri-mock';
import { useBackgroundActivity } from '../use-background-activity';
import { showIndexingForTests } from '@/stores/index-progress-store';
import { useRecordingStore } from '@/stores/recording-store';
import { setLocale } from '@/lib/i18n';

describe('useBackgroundActivity', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    showIndexingForTests(null);
    useRecordingStore.setState({ activeDownloads: {} });
    setLocale('en');
  });

  afterEach(() => {
    showIndexingForTests(null);
    useRecordingStore.setState({ activeDownloads: {} });
    setLocale(null);
    vi.useRealTimers();
  });

  it('is idle with nothing running, and registers no Tauri listeners of its own', async () => {
    const { result } = renderHook(() => useBackgroundActivity());
    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current).toMatchObject({ active: false, kind: null, label: null });
    expect(getListenerCount('index-progress')).toBe(0);
    expect(getListenerCount('index-ready')).toBe(0);
  });

  it('reports indexing with one overall count and a determinate fraction', () => {
    showIndexingForTests({ filesDone: 1200, filesTotal: 3000, fraction: 0.4 });
    const { result } = renderHook(() => useBackgroundActivity());
    expect(result.current).toEqual({
      active: true,
      kind: 'indexing',
      fraction: 0.4,
      label: 'Indexing your library, 1,200 of 3,000 files',
      indeterminate: false,
    });
  });

  it('is indeterminate, without numbers, until a pass has reported a total', () => {
    showIndexingForTests({});
    const { result } = renderHook(() => useBackgroundActivity());
    expect(result.current).toMatchObject({
      active: true,
      indeterminate: true,
      fraction: null,
      label: 'Indexing your library…',
    });
  });

  it('labels indexing in Swedish', () => {
    setLocale('sv');
    showIndexingForTests({ filesDone: 5, filesTotal: 10, fraction: 0.5 });
    const { result } = renderHook(() => useBackgroundActivity());
    expect(result.current.label).toBe('Indexerar ditt bibliotek, 5 av 10 filer');
  });

  it('reports a model download as before: determinate, averaged, lingering after it ends', () => {
    useRecordingStore.setState({ activeDownloads: { base: { progress: 40 } } });
    const { result } = renderHook(() => useBackgroundActivity());
    expect(result.current).toMatchObject({
      active: true,
      kind: 'download',
      indeterminate: false,
      label: 'Downloading model 40%',
    });
    expect(result.current.fraction).toBeCloseTo(0.4);

    act(() => {
      useRecordingStore.setState({ activeDownloads: { base: { progress: 20 }, small: { progress: 60 } } });
    });
    expect(result.current.label).toBe('Downloading 2 models 40%');

    act(() => {
      useRecordingStore.setState({ activeDownloads: {} });
    });
    // Grace period: still showing the last state.
    act(() => {
      vi.advanceTimersByTime(699);
    });
    expect(result.current.active).toBe(true);
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(result.current.active).toBe(false);
  });

  it('indexing wins while both are live, and the download shows again when it ends', () => {
    useRecordingStore.setState({ activeDownloads: { base: { progress: 40 } } });
    showIndexingForTests({ filesDone: 1, filesTotal: 4, fraction: 0.25 });
    const { result } = renderHook(() => useBackgroundActivity());
    expect(result.current.kind).toBe('indexing');

    act(() => showIndexingForTests(null));
    expect(result.current).toMatchObject({ kind: 'download', label: 'Downloading model 40%' });
  });
});
