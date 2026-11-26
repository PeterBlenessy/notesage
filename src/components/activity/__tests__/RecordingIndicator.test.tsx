// @vitest-environment jsdom
/**
 * The always-visible recording indicator (U2, U3, U5, U8, U9, U32).
 */
import { Profiler } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import '@/test/tauri-mock';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { emitMockEvent, registerRecordingHandlers } from '@/test/tauri-mock';
import { RecordingIndicator } from '../RecordingIndicator';
import { RecordingLevelMeter, levelToMeter } from '../RecordingLevelMeter';
import { RecordingStatusHost } from '../RecordingStatusHost';
import {
  publishRecordingLevels,
  resetRecordingLevels,
  useRecordingStore,
  type RecordingPhase,
  type RecordingSource,
} from '@/stores/recording-store';
import { useSettingsStore } from '@/stores/settings-store';
import { __resetLiveRecordingItemId, initRecordingEvents } from '@/hooks/useMeetingRecording';
import { stopRecordedTimeTicker } from '@/hooks/useRecording';

function live(phase: RecordingPhase, extra: Partial<ReturnType<typeof useRecordingStore.getState>> = {}) {
  useRecordingStore.setState({
    phase,
    isRecording: phase === 'recording' || phase === 'paused',
    isPaused: phase === 'paused',
    recordingSource: 'microphone' as RecordingSource,
    recordedSeconds: 0,
    inputDevice: null,
    outputDevice: null,
    warnings: [],
    discardConfirmOpen: false,
    ...extra,
  });
}

function bar(name: 'mic' | 'system'): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[data-level-bar="${name}"]`);
}

beforeEach(() => {
  vi.clearAllMocks();
  __resetLiveRecordingItemId();
  resetRecordingLevels();
  live('idle', { announcement: { text: '', seq: 0 } });
  useSettingsStore.setState({ sidebarPinned: true });
  registerRecordingHandlers();
});

afterEach(() => {
  stopRecordedTimeTicker();
  vi.useRealTimers();
});

describe('RecordingIndicator — states', () => {
  it('renders nothing while idle or starting', () => {
    const { container, rerender } = render(<RecordingIndicator variant="sidebar" />);
    expect(container.firstChild).toBeNull();
    act(() => live('starting'));
    rerender(<RecordingIndicator variant="sidebar" />);
    expect(container.firstChild).toBeNull();
  });

  for (const variant of ['sidebar', 'floating'] as const) {
    describe(variant, () => {
      it('recording: says so in words, with a filled dot, the time, the source and a meter', () => {
        live('recording', { recordedSeconds: 75 });
        render(<RecordingIndicator variant={variant} />);

        const group = screen.getByRole('group', { name: 'Recording controls' });
        expect(group.getAttribute('data-recording-phase')).toBe('recording');
        // Not colour alone: the word is there.
        expect(group.querySelector('[data-recording-state]')?.textContent).toBe('Recording');
        expect(group.querySelector('[data-recording-time]')?.textContent).toBe('01:15');
        expect(group.querySelector('[data-recording-source]')?.textContent).toBe('Microphone');
        expect(group.querySelector('[data-recording-dot="recording"]')).toBeTruthy();
        expect(screen.getByRole('img', { name: 'Microphone level' })).toBeTruthy();

        const pause = screen.getByRole('button', { name: 'Pause' });
        expect(pause.getAttribute('aria-pressed')).toBe('false');
        expect(screen.getByRole('button', { name: 'Stop and save' })).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Discard recording' })).toBeTruthy();
      });

      it('paused: a different word AND a different dot shape; the pause button is pressed', () => {
        live('paused', { recordedSeconds: 10 });
        render(<RecordingIndicator variant={variant} />);
        const group = screen.getByRole('group', { name: 'Recording controls' });
        expect(group.querySelector('[data-recording-state]')?.textContent).toBe('Paused');
        const dot = group.querySelector('[data-recording-dot="paused"]') as HTMLElement;
        // Hollow ring, not a dimmer fill.
        expect(dot.className).toContain('border-');
        expect(dot.className).not.toContain('bg-[var(--color-destructive)]');
        expect(screen.getByRole('button', { name: 'Resume' }).getAttribute('aria-pressed')).toBe('true');
      });

      it('saving: says Saving…, and nothing can be pressed while the audio is compressed', () => {
        live('stopping', { recordedSeconds: 4503 });
        render(<RecordingIndicator variant={variant} />);
        const group = screen.getByRole('group', { name: 'Recording controls' });
        expect(group.querySelector('[data-recording-state]')?.textContent).toBe('Saving…');
        expect(group.querySelector('[data-recording-time]')?.textContent).toBe('1:15:03');
        for (const name of ['Pause', 'Stop and save', 'Discard recording']) {
          expect((screen.getByRole('button', { name }) as HTMLButtonElement).disabled).toBe(true);
        }
        // The spinner respects reduced motion.
        expect(group.querySelector('[data-recording-dot="saving"]')?.getAttribute('class')).toContain(
          'motion-reduce:animate-none',
        );
      });

      it('uses real hit targets: every control is the 24px icon button', () => {
        live('recording');
        render(<RecordingIndicator variant={variant} />);
        for (const name of ['Pause', 'Stop and save', 'Discard recording']) {
          expect(screen.getByRole('button', { name }).className).toContain('size-6');
        }
      });
    });
  }

  it('is the destructive red, not the accent (grey in the default theme)', () => {
    live('recording');
    render(<RecordingIndicator variant="sidebar" />);
    const dot = document.querySelector('[data-recording-dot="recording"]') as HTMLElement;
    expect(dot.className).toContain('--color-destructive');
    expect(dot.className).not.toContain('accent');
    // The pulse stops for reduced motion.
    expect(dot.className).toContain('motion-reduce:animate-none');
  });

  it('names what is captured for each source, with one meter bar per captured source', () => {
    live('recording', { recordingSource: 'both' });
    const { unmount } = render(<RecordingIndicator variant="sidebar" />);
    expect(document.querySelector('[data-recording-source]')?.textContent).toBe('Microphone + system audio');
    expect(bar('mic')).toBeTruthy();
    expect(bar('system')).toBeTruthy();
    unmount();

    live('recording', { recordingSource: 'system' });
    render(<RecordingIndicator variant="sidebar" />);
    expect(document.querySelector('[data-recording-source]')?.textContent).toBe('System audio');
    expect(bar('mic')).toBeNull();
    expect(bar('system')).toBeTruthy();
  });

  it('carries the sidebar state the stylesheet switches on', () => {
    live('recording');
    const { unmount } = render(<RecordingIndicator variant="floating" />);
    expect(document.querySelector('[data-recording-chip]')?.getAttribute('data-sidebar-pinned')).toBe('true');
    unmount();
    useSettingsStore.setState({ sidebarPinned: false });
    render(<RecordingIndicator variant="floating" />);
    expect(document.querySelector('[data-recording-chip]')?.getAttribute('data-sidebar-pinned')).toBe('false');
  });

  it('the sidebar placement is not the floating chip (the stylesheet must never hide it)', () => {
    live('recording');
    render(<RecordingIndicator variant="sidebar" />);
    expect(document.querySelector('[data-recording-chip]')).toBeNull();
    expect(document.querySelector('[data-recording-indicator="sidebar"]')).toBeTruthy();
  });
});

describe('RecordingIndicator — controls', () => {
  it('pause, resume and stop drive the shared flow', async () => {
    const log = registerRecordingHandlers();
    live('recording');
    render(<RecordingIndicator variant="sidebar" />);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Pause' }));
    });
    expect(useRecordingStore.getState().phase).toBe('paused');
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Resume' }));
    });
    expect(useRecordingStore.getState().phase).toBe('recording');

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Stop and save' }));
    });
    // Stopping needs no confirmation.
    expect(log.calls).toContain('stop_recording');
    expect(useRecordingStore.getState().discardConfirmOpen).toBe(false);
  });

  it('discard only opens the confirmation', () => {
    const log = registerRecordingHandlers();
    live('recording');
    render(<RecordingIndicator variant="floating" />);
    fireEvent.click(screen.getByRole('button', { name: 'Discard recording' }));
    expect(useRecordingStore.getState().discardConfirmOpen).toBe(true);
    expect(log.calls).not.toContain('discard_recording');
  });
});

describe('RecordingIndicator — warnings', () => {
  it('shows each warning in words with the source named, and dismisses one at a time', () => {
    live('recording', {
      recordingSource: 'both',
      warnings: [
        { kind: 'silence', source: 'system' },
        { kind: 'low-disk', source: null },
      ],
    });
    render(<RecordingIndicator variant="sidebar" />);
    expect(screen.getByText('No sound is reaching the recording (System audio)')).toBeTruthy();
    expect(screen.getByText('Disk space is running low')).toBeTruthy();

    const dismiss = screen.getAllByRole('button', { name: 'Dismiss warning' });
    expect(dismiss).toHaveLength(2);
    fireEvent.click(dismiss[0]);
    expect(useRecordingStore.getState().warnings).toEqual([{ kind: 'low-disk', source: null }]);
    expect(screen.queryByText('No sound is reaching the recording (System audio)')).toBeNull();
  });

  it('the floating chip stays one row: it shows the first warning in place of the source', () => {
    live('recording', { warnings: [{ kind: 'device-lost', source: null }] });
    render(<RecordingIndicator variant="floating" />);
    const chip = document.querySelector('[data-recording-chip]') as HTMLElement;
    expect(chip.querySelectorAll('[data-recording-warning]')).toHaveLength(1);
    expect(chip.querySelector('[data-recording-source]')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss warning' }));
    expect(chip.querySelector('[data-recording-source]')).toBeTruthy();
  });
});

describe('level meter (U8) — no React state per event', () => {
  it('maps a peak onto a decibel scale', () => {
    expect(levelToMeter(null)).toBe(0);
    expect(levelToMeter(0)).toBe(0);
    expect(levelToMeter(1)).toBe(1);
    // -20 dB is well up the bar, not 10% of it.
    expect(levelToMeter(0.1)).toBeGreaterThan(0.6);
    expect(levelToMeter(0.001)).toBeLessThan(0.05);
  });

  it('moves the bars from recording-level events with ZERO re-renders', async () => {
    vi.useFakeTimers();
    let commits = 0;
    live('recording', { recordingSource: 'both' });
    render(
      <Profiler id="indicator" onRender={() => { commits += 1; }}>
        <RecordingIndicator variant="sidebar" />
        <RecordingIndicator variant="floating" />
      </Profiler>,
    );
    const stopEvents = initRecordingEvents();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    const afterMount = commits;
    expect(afterMount).toBeGreaterThan(0);
    expect(bar('mic')!.style.transform).toBe('scaleX(0)');

    // A burst of events at the backend's rate, with frames in between.
    for (let i = 0; i < 100; i++) {
      emitMockEvent('recording-level', { mic: 0.5, system: 0.05 });
      await vi.advanceTimersByTimeAsync(16);
    }

    const mic = Number(bar('mic')!.style.transform.replace(/[^\d.]/g, ''));
    const system = Number(bar('system')!.style.transform.replace(/[^\d.]/g, ''));
    expect(mic).toBeGreaterThan(0.8);
    expect(system).toBeGreaterThan(0.3);
    expect(mic).toBeGreaterThan(system);
    // The DOM moved; React did not render once.
    expect(commits).toBe(afterMount);
    stopEvents();
  });

  it('falls back to zero when the levels stop arriving (a stalled capture reads as silence)', async () => {
    vi.useFakeTimers();
    render(<RecordingLevelMeter source="microphone" />);
    publishRecordingLevels({ mic: 0.8, system: null });
    await vi.advanceTimersByTimeAsync(100);
    expect(Number(bar('mic')!.style.transform.replace(/[^\d.]/g, ''))).toBeGreaterThan(0.8);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(Number(bar('mic')!.style.transform.replace(/[^\d.]/g, ''))).toBeLessThan(0.01);
  });

  it('rests at zero and stops its loop while paused', async () => {
    vi.useFakeTimers();
    publishRecordingLevels({ mic: 0.8, system: null });
    render(<RecordingLevelMeter source="microphone" paused />);
    await vi.advanceTimersByTimeAsync(200);
    expect(bar('mic')!.style.transform).toBe('scaleX(0.000)');
  });

  it('re-renders once a second for the timer and not otherwise', () => {
    let commits = 0;
    live('recording');
    render(
      <Profiler id="indicator" onRender={() => { commits += 1; }}>
        <RecordingIndicator variant="sidebar" />
      </Profiler>,
    );
    const afterMount = commits;
    act(() => {
      useRecordingStore.getState().setRecordedSeconds(1.2);
    });
    const afterSecond = commits;
    // The second changed: it rendered (Radix may commit twice for one render).
    expect(afterSecond).toBeGreaterThan(afterMount);
    expect(screen.getByText('00:01')).toBeTruthy();

    // More ticks of the 500 ms clock inside the same second: nothing.
    act(() => {
      for (let i = 0; i < 10; i++) useRecordingStore.getState().setRecordedSeconds(1.7);
    });
    expect(commits).toBe(afterSecond);
    // Unrelated store writes (a model download, an announcement): nothing.
    act(() => {
      useRecordingStore.setState({ activeDownloads: { base: { progress: 40 } } });
      useRecordingStore.getState().announce('Recording paused');
    });
    expect(commits).toBe(afterSecond);
  });
});

describe('RecordingStatusHost — live region and the discard confirmation (U10, U32)', () => {
  it('has exactly one live region, and it announces state changes only', () => {
    live('recording', { recordedSeconds: 3 });
    render(
      <>
        <RecordingIndicator variant="sidebar" />
        <RecordingStatusHost />
      </>,
    );
    const regions = screen.getAllByRole('status');
    expect(regions).toHaveLength(1);
    expect(regions[0].getAttribute('aria-live')).toBe('polite');
    expect(regions[0].textContent).toBe('');

    act(() => useRecordingStore.getState().announce('Recording paused'));
    expect(regions[0].textContent?.replace('\u200B', '')).toBe('Recording paused');

    // The timer ticking is NOT announced.
    const before = regions[0].textContent;
    act(() => useRecordingStore.getState().setRecordedSeconds(4));
    act(() => useRecordingStore.getState().setRecordedSeconds(5));
    expect(regions[0].textContent).toBe(before);
    expect(regions[0].textContent).not.toMatch(/\d\d:\d\d/);
  });

  it('announces the same sentence again when it happens again', () => {
    render(<RecordingStatusHost />);
    const region = screen.getByRole('status');
    act(() => useRecordingStore.getState().announce('Recording paused'));
    const first = region.textContent;
    act(() => useRecordingStore.getState().announce('Recording paused'));
    expect(region.textContent).not.toBe(first);
    expect(region.textContent?.replace('\u200B', '')).toBe('Recording paused');
  });

  it('announces start, pause, resume and warnings from the real flow', async () => {
    const { startMeetingRecording, togglePauseMeetingRecording, handleRecordingWarning } =
      await import('@/hooks/useMeetingRecording');
    render(<RecordingStatusHost />);
    const text = () => screen.getByRole('status').textContent?.replace('\u200B', '');

    await act(async () => {
      await startMeetingRecording();
    });
    expect(text()).toBe('Recording started: Microphone');
    await act(async () => {
      await togglePauseMeetingRecording();
    });
    expect(text()).toBe('Recording paused');
    await act(async () => {
      await togglePauseMeetingRecording();
    });
    expect(text()).toBe('Recording resumed');
    act(() => handleRecordingWarning({ kind: 'silence', message: '', fatal: false }));
    expect(text()).toBe('No sound is reaching the recording (Microphone)');
  });

  it('discard is confirmed in a dialog; cancelling keeps the recording', async () => {
    const log = registerRecordingHandlers();
    live('recording', { recordedSeconds: 75, discardConfirmOpen: true });
    render(<RecordingStatusHost />);

    const dialog = screen.getByRole('alertdialog');
    expect(dialog.textContent).toContain('Discard this recording?');
    expect(dialog.textContent).toContain('01:15 of audio will be deleted');

    fireEvent.click(screen.getByRole('button', { name: 'Keep recording' }));
    expect(useRecordingStore.getState().discardConfirmOpen).toBe(false);
    expect(log.calls).not.toContain('discard_recording');
    expect(useRecordingStore.getState().phase).toBe('recording');
  });

  it('confirming the dialog discards', async () => {
    const log = registerRecordingHandlers();
    live('recording', { discardConfirmOpen: true });
    render(<RecordingStatusHost />);
    await act(async () => {
      fireEvent.click(
        screen.getByRole('alertdialog').querySelector('button:last-of-type') as HTMLElement,
      );
    });
    expect(log.calls).toContain('discard_recording');
    expect(useRecordingStore.getState().phase).toBe('idle');
  });
});
