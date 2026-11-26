// @vitest-environment jsdom
/**
 * The source choice (N1): Microphone / System audio / Both, with the default
 * persisted and unavailable options explained.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import '@/test/tauri-mock';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { setMockInvokeHandler } from '@/test/tauri-mock';
import { RecordingSourcePicker } from '../RecordingSourcePicker';
import { useRecordingStore } from '@/stores/recording-store';
import type { RecordingPreflight } from '@/lib/tauri';

const AVAILABLE: RecordingPreflight = {
  microphone: 'granted',
  system_audio: 'available',
  input_device: 'MacBook Pro Microphone',
  output_device: 'MacBook Pro Speakers',
  free_bytes: 1e10,
};

function preflight(result: Partial<RecordingPreflight> | Error) {
  setMockInvokeHandler('recording_preflight', () => {
    if (result instanceof Error) throw result;
    return { ...AVAILABLE, ...result };
  });
}

function option(source: string): HTMLElement {
  return document.querySelector(`[data-source="${source}"]`) as HTMLElement;
}

async function settle() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  useRecordingStore.setState({ lastUsedSource: 'microphone', inputDevice: null, outputDevice: null });
});

describe('RecordingSourcePicker', () => {
  it('offers the three sources as one radio group, with the stored choice checked', async () => {
    preflight({});
    useRecordingStore.setState({ lastUsedSource: 'both' });
    render(<RecordingSourcePicker />);
    await settle();

    expect(screen.getByRole('radiogroup', { name: 'Record from' })).toBeTruthy();
    const radios = screen.getAllByRole('radio');
    expect(radios.map((r) => r.textContent)).toEqual(['Microphone', 'System audio', 'Both']);
    expect(radios.map((r) => r.getAttribute('aria-checked'))).toEqual(['false', 'false', 'true']);
    // The full name is what a screen reader hears for the short "Both".
    expect(option('both').getAttribute('aria-label')).toBe('Microphone + system audio');
    expect(document.querySelector('[data-recording-source-reason]')).toBeNull();
  });

  it('choosing a source stores it as the default for the next recording', async () => {
    preflight({});
    render(<RecordingSourcePicker />);
    await settle();
    fireEvent.click(option('system'));
    expect(useRecordingStore.getState().lastUsedSource).toBe('system');
    expect(option('system').getAttribute('aria-checked')).toBe('true');
    expect(option('microphone').getAttribute('aria-checked')).toBe('false');
  });

  it('on macOS before 14.2: system audio and both cannot be chosen, and say why', async () => {
    preflight({ system_audio: 'unsupported' });
    render(<RecordingSourcePicker />);
    await waitFor(() => expect(option('system').getAttribute('aria-disabled')).toBe('true'));

    expect(option('both').getAttribute('aria-disabled')).toBe('true');
    expect(option('microphone').getAttribute('aria-disabled')).toBe('false');
    // The reason is on the option for assistive tech…
    expect(option('system').getAttribute('aria-label')).toBe('System audio. Needs macOS 14.2 or later');
    // …and in plain sight, once, naming the options it applies to.
    const reasons = document.querySelectorAll('[data-recording-source-reason]');
    expect(reasons).toHaveLength(1);
    expect(reasons[0].textContent).toBe('System audio, Both: Needs macOS 14.2 or later');

    // Clicking a refused option changes nothing.
    fireEvent.click(option('both'));
    expect(useRecordingStore.getState().lastUsedSource).toBe('microphone');
  });

  it('when audio capture is denied, points at the setting to change', async () => {
    preflight({ system_audio: 'denied' });
    render(<RecordingSourcePicker />);
    await waitFor(() => expect(option('system').getAttribute('aria-disabled')).toBe('true'));
    expect(document.querySelector('[data-recording-source-reason]')?.textContent).toBe(
      'System audio, Both: Allow audio capture in System Settings → Privacy & Security',
    );
  });

  it('when the microphone is denied, only system audio remains, with both reasons distinct', async () => {
    preflight({ microphone: 'denied', system_audio: 'unsupported' });
    render(<RecordingSourcePicker />);
    await waitFor(() => expect(option('microphone').getAttribute('aria-disabled')).toBe('true'));
    expect(option('system').getAttribute('aria-disabled')).toBe('true');
    const reasons = [...document.querySelectorAll('[data-recording-source-reason]')].map((r) => r.textContent);
    expect(reasons).toHaveLength(2);
    expect(reasons.some((r) => r?.startsWith('Microphone: Allow the microphone'))).toBe(true);
    expect(reasons.some((r) => r === 'System audio, Both: Needs macOS 14.2 or later')).toBe(true);
  });

  it('an undetermined permission is not a refusal: macOS asks when the capture starts', async () => {
    preflight({ microphone: 'undetermined', system_audio: 'unknown' });
    render(<RecordingSourcePicker />);
    await settle();
    for (const source of ['microphone', 'system', 'both']) {
      expect(option(source).getAttribute('aria-disabled')).toBe('false');
    }
  });

  it('with no preflight answer, everything stays selectable', async () => {
    preflight(new Error('unknown command'));
    render(<RecordingSourcePicker />);
    await settle();
    fireEvent.click(option('both'));
    expect(useRecordingStore.getState().lastUsedSource).toBe('both');
  });

  it('keeps showing a stored choice that has become unavailable, with its reason', async () => {
    preflight({ system_audio: 'denied' });
    useRecordingStore.setState({ lastUsedSource: 'both' });
    render(<RecordingSourcePicker />);
    await waitFor(() => expect(option('both').getAttribute('aria-disabled')).toBe('true'));
    expect(option('both').getAttribute('aria-checked')).toBe('true');
  });

  it('cannot be changed while a recording is live', async () => {
    preflight({});
    render(<RecordingSourcePicker disabled />);
    await settle();
    fireEvent.click(option('system'));
    expect(useRecordingStore.getState().lastUsedSource).toBe('microphone');
    expect(option('system').getAttribute('aria-disabled')).toBe('true');
  });

  it('remembers the device names the preflight reported', async () => {
    preflight({});
    render(<RecordingSourcePicker />);
    await waitFor(() => expect(useRecordingStore.getState().inputDevice).toBe('MacBook Pro Microphone'));
    expect(useRecordingStore.getState().outputDevice).toBe('MacBook Pro Speakers');
  });
});
