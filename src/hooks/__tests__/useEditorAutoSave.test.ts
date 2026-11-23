// @vitest-environment jsdom
//
// The debounced auto-save that used to live inline in Editor.tsx, where the
// only thing exercising it was a real-E2E document-switching test (audit
// 2026-11-22, test coverage).

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';

vi.mock('sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));

import { toast } from 'sonner';
import { AUTO_SAVE_DELAY_MS, useEditorAutoSave } from '@/hooks/useEditorAutoSave';

interface Tab {
  id: string;
  filePath: string;
  content: string;
  isDirty: boolean;
}

type SaveFile = (filePath: string, content: string, tabId: string) => Promise<unknown>;

const tab = (over: Partial<Tab> = {}): Tab => ({
  id: 'tab-1',
  filePath: '/notes/a.md',
  content: 'hello',
  isDirty: true,
  ...over,
});

describe('useEditorAutoSave', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(toast.error).mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('saves a dirty document once, one second after the last change', async () => {
    const saveFile = vi.fn<SaveFile>().mockResolvedValue(undefined);
    renderHook(() => useEditorAutoSave({ activeTab: tab(), saveFile }));

    await vi.advanceTimersByTimeAsync(AUTO_SAVE_DELAY_MS - 1);
    expect(saveFile).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(saveFile).toHaveBeenCalledTimes(1);
    expect(saveFile).toHaveBeenCalledWith('/notes/a.md', 'hello', 'tab-1');

    // Nothing re-arms the timer while the document is unchanged.
    await vi.advanceTimersByTimeAsync(AUTO_SAVE_DELAY_MS * 5);
    expect(saveFile).toHaveBeenCalledTimes(1);
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('never saves a clean document', async () => {
    const saveFile = vi.fn<SaveFile>().mockResolvedValue(undefined);
    renderHook(() => useEditorAutoSave({ activeTab: tab({ isDirty: false }), saveFile }));

    await vi.advanceTimersByTimeAsync(AUTO_SAVE_DELAY_MS * 5);
    expect(saveFile).not.toHaveBeenCalled();
  });

  it('does nothing when no document is open', async () => {
    const saveFile = vi.fn<SaveFile>().mockResolvedValue(undefined);
    renderHook(() => useEditorAutoSave({ activeTab: null, saveFile }));

    await vi.advanceTimersByTimeAsync(AUTO_SAVE_DELAY_MS * 5);
    expect(saveFile).not.toHaveBeenCalled();
  });

  it('restarts the wait on every edit and saves only the latest content', async () => {
    const saveFile = vi.fn<SaveFile>().mockResolvedValue(undefined);
    const { rerender } = renderHook(
      ({ activeTab }: { activeTab: Tab }) => useEditorAutoSave({ activeTab, saveFile }),
      { initialProps: { activeTab: tab({ content: 'h' }) } },
    );

    await vi.advanceTimersByTimeAsync(600);
    rerender({ activeTab: tab({ content: 'he' }) });
    await vi.advanceTimersByTimeAsync(600);
    rerender({ activeTab: tab({ content: 'hel' }) });
    await vi.advanceTimersByTimeAsync(AUTO_SAVE_DELAY_MS - 1);
    expect(saveFile).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(saveFile).toHaveBeenCalledTimes(1);
    expect(saveFile).toHaveBeenCalledWith('/notes/a.md', 'hel', 'tab-1');
  });

  it('does not save the previous document after a switch inside the debounce window', async () => {
    const saveFile = vi.fn<SaveFile>().mockResolvedValue(undefined);
    const { rerender } = renderHook(
      ({ activeTab }: { activeTab: Tab }) => useEditorAutoSave({ activeTab, saveFile }),
      { initialProps: { activeTab: tab() } },
    );

    await vi.advanceTimersByTimeAsync(500);
    rerender({ activeTab: tab({ id: 'tab-2', filePath: '/notes/b.md', content: 'other', isDirty: false }) });
    await vi.advanceTimersByTimeAsync(AUTO_SAVE_DELAY_MS * 5);

    expect(saveFile).not.toHaveBeenCalled();
  });

  it('cancels the pending save on unmount', async () => {
    const saveFile = vi.fn<SaveFile>().mockResolvedValue(undefined);
    const { unmount } = renderHook(() => useEditorAutoSave({ activeTab: tab(), saveFile }));

    await vi.advanceTimersByTimeAsync(500);
    unmount();
    await vi.advanceTimersByTimeAsync(AUTO_SAVE_DELAY_MS * 5);

    expect(saveFile).not.toHaveBeenCalled();
  });

  it('reports a failed save with a toast and does not retry on its own', async () => {
    const saveFile = vi.fn<SaveFile>().mockRejectedValue(new Error('disk full'));
    const activeTab = tab();
    renderHook(() => useEditorAutoSave({ activeTab, saveFile }));

    await vi.advanceTimersByTimeAsync(AUTO_SAVE_DELAY_MS);
    expect(saveFile).toHaveBeenCalledTimes(1);
    expect(toast.error).toHaveBeenCalledTimes(1);
    expect(toast.error).toHaveBeenCalledWith('Auto-save failed: Error: disk full');

    // The hook never touches the dirty flag: a failed write leaves the
    // document dirty, so the next edit schedules another attempt.
    expect(activeTab.isDirty).toBe(true);
    await vi.advanceTimersByTimeAsync(AUTO_SAVE_DELAY_MS * 5);
    expect(saveFile).toHaveBeenCalledTimes(1);
  });

  it('tries again on the next edit after a failed save', async () => {
    const saveFile = vi
      .fn<SaveFile>()
      .mockRejectedValueOnce(new Error('disk full'))
      .mockResolvedValue(undefined);
    const { rerender } = renderHook(
      ({ activeTab }: { activeTab: Tab }) => useEditorAutoSave({ activeTab, saveFile }),
      { initialProps: { activeTab: tab({ content: 'one' }) } },
    );

    await vi.advanceTimersByTimeAsync(AUTO_SAVE_DELAY_MS);
    expect(toast.error).toHaveBeenCalledTimes(1);

    rerender({ activeTab: tab({ content: 'two' }) });
    await vi.advanceTimersByTimeAsync(AUTO_SAVE_DELAY_MS);
    expect(saveFile).toHaveBeenCalledTimes(2);
    expect(saveFile).toHaveBeenLastCalledWith('/notes/a.md', 'two', 'tab-1');
    expect(toast.error).toHaveBeenCalledTimes(1);
  });
});
