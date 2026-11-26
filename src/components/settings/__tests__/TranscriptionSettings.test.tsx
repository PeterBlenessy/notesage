// @vitest-environment jsdom
/**
 * Settings → Transcription (U30, U32, U34).
 */
import { Profiler } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import '@/test/tauri-mock';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { emitMockEvent, setMockInvokeHandler } from '@/test/tauri-mock';
import { TranscriptionSettings, downloadProgressText } from '../TranscriptionSettings';
import { buildSettingsNav } from '../v2/SettingsDialogV2';
import { useRecordingStore, type ModelInfo } from '@/stores/recording-store';
import { setLocale } from '@/lib/i18n';

const MB = 1024 * 1024;

const QUALITY: ModelInfo = { name: 'large-v3-turbo-q5_0', size_bytes: 547 * MB, downloaded: false };
const BASE: ModelInfo = { name: 'base', size_bytes: 142 * MB, downloaded: false };

function models(list: ModelInfo[]) {
  setMockInvokeHandler('list_whisper_models', () => list);
}

async function settle() {
  await act(async () => {
    for (let i = 0; i < 6; i++) await Promise.resolve();
  });
}

function row(name: string): HTMLElement {
  return document.querySelector(`[data-model-row="${name}"]`) as HTMLElement;
}

beforeEach(() => {
  vi.clearAllMocks();
  setLocale('en');
  useRecordingStore.setState({
    phase: 'idle',
    availableModels: [],
    modelsLoaded: false,
    activeDownloads: {},
    downloadErrors: {},
    defaultModel: 'large-v3-turbo-q5_0',
    speechLanguage: 'en',
    lastUsedSource: 'microphone',
  });
  setMockInvokeHandler('get_model_metadata', () => {
    throw new Error('offline');
  });
  setMockInvokeHandler('recording_preflight', () => ({
    microphone: 'granted',
    system_audio: 'available',
    input_device: null,
    output_device: null,
    free_bytes: 1e10,
  }));
});

describe('the settings page is called Transcription (U34)', () => {
  it('in the navigation, in both languages', () => {
    const label = () =>
      buildSettingsNav()
        .flatMap((group) => group.items)
        .find((item) => item.id === 'voice')?.label;
    expect(label()).toBe('Transcription');
    setLocale('sv');
    expect(label()).toBe('Transkribering');
    setLocale('en');
  });
});

describe('TranscriptionSettings — the selected model is not downloaded (U30)', () => {
  it('never shows a blank select: the model is named, marked not downloaded, with a download button', async () => {
    models([QUALITY, BASE]);
    const download = vi.fn(() => new Promise(() => {}));
    setMockInvokeHandler('download_whisper_model', download);
    render(<TranscriptionSettings />);
    await settle();

    const select = screen.getByRole('combobox', { name: 'Transcription model' });
    expect(select.textContent).toBe('Large V3 Turbo Q5_0 (not downloaded)');

    const notice = document.querySelector('[data-selected-model-missing]') as HTMLElement;
    expect(notice.textContent).toContain('is selected but not downloaded');
    expect(notice.textContent).toContain('cannot be transcribed');

    fireEvent.click(
      notice.querySelector('button') as HTMLElement,
    );
    await settle();
    expect(download).toHaveBeenCalledWith({ size: 'large-v3-turbo-q5_0' });
    // While it downloads the button says so and cannot be pressed again.
    expect((notice.querySelector('button') as HTMLButtonElement).disabled).toBe(true);
    expect(notice.querySelector('button')?.textContent).toContain('Downloading…');
  });

  it('says "Not downloaded" on each such row, next to its download button', async () => {
    models([QUALITY, { ...BASE, downloaded: true }]);
    render(<TranscriptionSettings />);
    await settle();
    expect(row('large-v3-turbo-q5_0').textContent).toContain('Not downloaded');
    expect(row('base').textContent).toContain('Downloaded');
    expect(row('base').textContent).not.toContain('Not downloaded');
    expect(
      within(row('large-v3-turbo-q5_0')).getByRole('button', { name: 'Download Large V3 Turbo Q5_0' }),
    ).toBeTruthy();
  });

  it('claims nothing before the model list has loaded', async () => {
    setMockInvokeHandler('list_whisper_models', () => new Promise(() => {}));
    render(<TranscriptionSettings />);
    await settle();
    expect(document.querySelector('[data-selected-model-missing]')).toBeNull();
  });

  it('shows no notice once the selected model is on disk', async () => {
    models([{ ...QUALITY, downloaded: true }, BASE]);
    render(<TranscriptionSettings />);
    await settle();
    expect(document.querySelector('[data-selected-model-missing]')).toBeNull();
    expect(screen.getByRole('combobox', { name: 'Transcription model' }).textContent).toBe(
      'Large V3 Turbo Q5_0',
    );
  });
});

describe('TranscriptionSettings — downloading (U30)', () => {
  it('shows megabytes done of total, the speed and the time left', () => {
    expect(
      downloadProgressText({
        progress: 38,
        downloadedBytes: 212 * MB,
        totalBytes: 547 * MB,
        bytesPerSec: 4.1 * MB,
        etaSecs: 82,
      }),
    ).toBe('212 of 547 MB · 4.1 MB/s · 1 min left');
    expect(
      downloadProgressText({ progress: 99, downloadedBytes: 540 * MB, totalBytes: 547 * MB, bytesPerSec: 12 * MB, etaSecs: 1 }),
    ).toBe('540 of 547 MB · 12 MB/s · 1 s left');
    // Nothing measured yet: just the bytes.
    expect(downloadProgressText({ progress: 0, downloadedBytes: 0, totalBytes: 547 * MB, bytesPerSec: 0, etaSecs: null })).toBe(
      '0 of 547 MB',
    );
  });

  it('with an unknown total: megabytes and speed, an indeterminate bar, and no stuck 0%', async () => {
    models([QUALITY]);
    render(<TranscriptionSettings />);
    await settle();
    act(() => {
      useRecordingStore.setState({
        activeDownloads: {
          'large-v3-turbo-q5_0': {
            progress: 0,
            downloadedBytes: 212 * MB,
            totalBytes: 0,
            bytesPerSec: 3 * MB,
            etaSecs: null,
          },
        },
      });
    });
    const text = row('large-v3-turbo-q5_0').querySelector('[data-download-progress]')?.textContent;
    expect(text).toBe('212 MB · 3.0 MB/s');
    expect(text).not.toContain('%');
    const bar = screen.getByRole('progressbar', { name: 'Downloading Large V3 Turbo Q5_0' });
    expect(bar.getAttribute('aria-valuenow')).toBeNull();
    expect(bar.getAttribute('data-state')).toBe('indeterminate');
  });

  it('with a known total: an integer percent and a determinate, named bar', async () => {
    models([QUALITY]);
    render(<TranscriptionSettings />);
    await settle();
    act(() => {
      useRecordingStore.setState({
        activeDownloads: {
          'large-v3-turbo-q5_0': {
            progress: 38,
            downloadedBytes: 212 * MB,
            totalBytes: 547 * MB,
            bytesPerSec: 4.1 * MB,
            etaSecs: 82,
          },
        },
      });
    });
    expect(row('large-v3-turbo-q5_0').querySelector('[data-download-progress]')?.textContent).toBe(
      '38% · 212 of 547 MB · 4.1 MB/s · 1 min left',
    );
    expect(
      screen.getByRole('progressbar', { name: 'Downloading Large V3 Turbo Q5_0' }).getAttribute('aria-valuenow'),
    ).toBe('38');
    expect(screen.getByRole('button', { name: 'Cancel downloading Large V3 Turbo Q5_0' })).toBeTruthy();
  });

  it('a stream of progress events re-renders the page at most once per percent', async () => {
    models([QUALITY, BASE]);
    setMockInvokeHandler('download_whisper_model', () => new Promise(() => {}));
    let commits = 0;
    render(
      <Profiler id="settings" onRender={() => { commits += 1; }}>
        <TranscriptionSettings />
      </Profiler>,
    );
    await settle();
    act(() => useRecordingStore.getState().downloadModel('base'));
    await settle();
    const before = commits;

    const total = 142 * MB;
    // 600 events (a minute at the backend's rate) covering 0 → 3%.
    act(() => {
      for (let i = 0; i <= 600; i++) {
        emitMockEvent('model-download-progress', { model: 'base', downloaded: (i / 20_000) * total, total });
      }
    });
    expect(useRecordingStore.getState().activeDownloads.base.progress).toBe(3);
    // One batched update inside this `act`; never one per event.
    expect(commits - before).toBeLessThanOrEqual(2);

    // And across separate events: only a changed percent renders.
    const mid = commits;
    for (let i = 0; i < 50; i++) {
      act(() => {
        emitMockEvent('model-download-progress', { model: 'base', downloaded: 0.031 * total, total });
      });
    }
    expect(commits).toBe(mid);
  });

  it('a recording ticking away does not re-render the page', async () => {
    models([{ ...QUALITY, downloaded: true }]);
    let commits = 0;
    render(
      <Profiler id="settings" onRender={() => { commits += 1; }}>
        <TranscriptionSettings />
      </Profiler>,
    );
    await settle();
    const before = commits;
    act(() => {
      for (let s = 1; s <= 30; s++) useRecordingStore.getState().setRecordedSeconds(s);
    });
    expect(commits).toBe(before);
  });
});

describe('TranscriptionSettings — a failed download (U30)', () => {
  it('says why on the row and offers Retry, which starts the download again', async () => {
    models([QUALITY]);
    let attempts = 0;
    setMockInvokeHandler('download_whisper_model', () => {
      attempts += 1;
      if (attempts === 1) throw new Error('Download stalled: no data received for 30 seconds');
      return new Promise(() => {});
    });
    render(<TranscriptionSettings />);
    await settle();

    fireEvent.click(
      within(row('large-v3-turbo-q5_0')).getByRole('button', { name: 'Download Large V3 Turbo Q5_0' }),
    );
    await waitFor(() => expect(document.querySelector('[data-model-error]')).toBeTruthy());

    const error = document.querySelector('[data-model-error]') as HTMLElement;
    expect(error.getAttribute('role')).toBe('alert');
    expect(error.textContent).toBe('Download failed: Download stalled: no data received for 30 seconds');

    const retry = screen.getByRole('button', { name: 'Retry downloading Large V3 Turbo Q5_0' });
    expect(retry.textContent).toContain('Retry');
    fireEvent.click(retry);
    await settle();
    expect(attempts).toBe(2);
    // The old error is gone while the new attempt runs.
    expect(document.querySelector('[data-model-error]')).toBeNull();
    expect(screen.getByRole('progressbar', { name: 'Downloading Large V3 Turbo Q5_0' })).toBeTruthy();
  });
});

describe('TranscriptionSettings — preferences and accessibility', () => {
  it('every icon-only button has an accessible name that says which model (U32)', async () => {
    models([{ ...QUALITY, downloaded: true }, { ...BASE, downloaded: true }]);
    render(<TranscriptionSettings />);
    await settle();
    expect(screen.getByRole('button', { name: 'Delete Large V3 Turbo Q5_0' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Delete Base' })).toBeTruthy();
    for (const button of screen.getAllByRole('button')) {
      const name = button.getAttribute('aria-label') ?? button.textContent ?? '';
      expect(name.trim().length, button.outerHTML.slice(0, 120)).toBeGreaterThan(0);
    }
  });

  it('offers the default recording source, shared with the Record controls', async () => {
    models([{ ...QUALITY, downloaded: true }]);
    render(<TranscriptionSettings />);
    await settle();
    const group = screen.getByRole('radiogroup', { name: 'Record from' });
    fireEvent.click(group.querySelector('[data-source="both"]') as HTMLElement);
    expect(useRecordingStore.getState().lastUsedSource).toBe('both');
  });

  it('locks the source while a recording is live', async () => {
    models([{ ...QUALITY, downloaded: true }]);
    useRecordingStore.setState({ phase: 'recording' });
    render(<TranscriptionSettings />);
    await settle();
    expect(document.querySelector('[data-source="system"]')?.getAttribute('aria-disabled')).toBe('true');
  });

  it('says the language follows the last recording, and names both selects', async () => {
    models([{ ...QUALITY, downloaded: true }]);
    render(<TranscriptionSettings />);
    await settle();
    expect(screen.getByText(/becomes the default for the next/)).toBeTruthy();
    expect(screen.getByRole('combobox', { name: 'Recording language' })).toBeTruthy();
  });

  it('is fully translated: Swedish shows no English from this page', async () => {
    setLocale('sv');
    models([QUALITY]);
    render(<TranscriptionSettings />);
    await settle();
    expect(row('large-v3-turbo-q5_0').textContent).toContain('Inte nedladdad');
    expect(screen.getByRole('radiogroup', { name: 'Spela in från' })).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'Mikrofon' })).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'Mikrofon + systemljud' })).toBeTruthy();
    expect(document.querySelector('[data-selected-model-missing]')?.textContent).toContain('inte nedladdad');
    setLocale('en');
  });
});
