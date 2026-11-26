// @vitest-environment jsdom
//
// U18: `useTraySync` is mounted in `App`. It used to subscribe to the whole
// `tasks` array, so every transcription progress event (and every agent token)
// re-rendered the application root.

import { describe, it, expect, beforeEach } from 'vitest';
import '@/test/tauri-mock';
import { setMockInvokeHandler } from '@/test/tauri-mock';
import { act, render, waitFor } from '@testing-library/react';
import { useTraySync } from '@/hooks/useTraySync';
import { useActivityStore } from '@/stores/activity-store';

let renders = 0;
let badge: number[] = [];

function Root() {
  renders += 1;
  useTraySync();
  return null;
}

beforeEach(() => {
  renders = 0;
  badge = [];
  useActivityStore.setState({ tasks: [] });
  setMockInvokeHandler('update_tray_badge', (args) => {
    badge.push(Number(args?.count));
    return undefined;
  });
  setMockInvokeHandler('update_tray_recent', () => undefined);
});

describe('useTraySync', () => {
  it('does not re-render the root once across a whole progress stream', async () => {
    render(<Root />);
    act(() => {
      useActivityStore.getState().addTranscriptionJob({ id: 'tx-1', label: 'Recording', audioPath: '/r/audio.m4a' });
    });
    await waitFor(() => expect(badge).toEqual([0, 1]));
    const before = renders;

    // A full job: every percent, each announced three times over.
    act(() => {
      for (let percent = 0; percent <= 100; percent++) {
        for (let repeat = 0; repeat < 3; repeat++) {
          useActivityStore.getState().setTranscriptionProgress('tx-1', percent, 'transcribing');
        }
      }
    });

    expect(useActivityStore.getState().tasks[0].progress).toBe(100);
    expect(renders - before).toBe(0);
    // And the tray was not told the same count a hundred times.
    expect(badge).toEqual([0, 1]);
  });

  it('does not re-render for an agent task streaming output either', () => {
    render(<Root />);
    act(() => {
      useActivityStore.getState().addTask({ id: 'a-1', type: 'chat', label: 'Agent', status: 'running' });
    });
    const before = renders;
    act(() => {
      for (let i = 0; i < 50; i++) useActivityStore.getState().appendPartialOutput('a-1', 'token ');
    });
    expect(renders - before).toBe(0);
  });

  it('still updates the badge when a task starts or ends', async () => {
    render(<Root />);
    act(() => {
      useActivityStore.getState().addTranscriptionJob({ id: 'tx-1', label: 'Recording', audioPath: '/r/audio.m4a' });
    });
    act(() => {
      useActivityStore.getState().addTranscriptionJob({ id: 'tx-2', label: 'Recording', audioPath: '/s/audio.m4a' });
    });
    act(() => useActivityStore.getState().setTranscriptionDone('tx-1', '/r/t.md'));
    act(() => useActivityStore.getState().setTranscriptionCancelled('tx-2'));
    await waitFor(() => expect(badge).toEqual([0, 1, 2, 1, 0]));
  });
});
