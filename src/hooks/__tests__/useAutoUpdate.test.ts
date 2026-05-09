// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import '@/test/tauri-mock';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockCheck = vi.fn();
const mockGetVersion = vi.fn().mockResolvedValue('0.42.0');

vi.mock('@tauri-apps/plugin-updater', () => ({
  check: (...args: unknown[]) => mockCheck(...args),
}));

vi.mock('@tauri-apps/plugin-process', () => ({
  relaunch: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@tauri-apps/api/app', () => ({
  getVersion: () => mockGetVersion(),
}));

// Settings store mock — must support both selector-form and no-arg form.
let mockReleaseChannel: 'stable' | 'alpha' = 'stable';
const mockSetLastUpdateCheck = vi.fn();
const mockSetDismissedVersion = vi.fn();

const settingsStoreState = () => ({
  autoCheckUpdates: true,
  dismissedVersion: null,
  releaseChannel: mockReleaseChannel,
  setLastUpdateCheck: mockSetLastUpdateCheck,
  setDismissedVersion: mockSetDismissedVersion,
});

vi.mock('@/stores/settings-store', () => ({
  useSettingsStore: vi.fn((selector?: (s: ReturnType<typeof settingsStoreState>) => unknown) => {
    const state = settingsStoreState();
    return selector ? selector(state) : state;
  }),
}));

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------

import { useAutoUpdate, ALPHA_UPDATE_ENDPOINT } from '../useAutoUpdate';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useAutoUpdate — channel routing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockReleaseChannel = 'stable';
    mockCheck.mockResolvedValue(null);
    // Reset global fetch mock
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        version: '0.42.0-alpha.1',
        notes: 'Alpha release notes',
        pub_date: '2026-05-09T00:00:00Z',
        platforms: {},
      }),
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // -------------------------------------------------------------------------
  // stable channel — existing behaviour unchanged
  // -------------------------------------------------------------------------

  it('calls check() (Tauri updater) when releaseChannel is stable', async () => {
    mockReleaseChannel = 'stable';
    mockCheck.mockResolvedValue(null);

    const { result } = renderHook(() => useAutoUpdate());

    await act(async () => {
      await result.current.checkForUpdate();
    });

    expect(mockCheck).toHaveBeenCalledTimes(1);
  });

  it('does NOT call fetch() for alpha endpoint when releaseChannel is stable', async () => {
    mockReleaseChannel = 'stable';
    mockCheck.mockResolvedValue(null);
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    const { result } = renderHook(() => useAutoUpdate());

    await act(async () => {
      await result.current.checkForUpdate();
    });

    // fetch may not be called at all, or if called must not be with alpha endpoint
    const alphaFetchCalls = fetchSpy.mock.calls.filter(
      (call) => typeof call[0] === 'string' && call[0].includes('alpha'),
    );
    expect(alphaFetchCalls).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // ALPHA_UPDATE_ENDPOINT constant
  // -------------------------------------------------------------------------

  it('ALPHA_UPDATE_ENDPOINT is exported as a non-empty string constant', () => {
    expect(typeof ALPHA_UPDATE_ENDPOINT).toBe('string');
    expect(ALPHA_UPDATE_ENDPOINT.length).toBeGreaterThan(0);
  });

  // -------------------------------------------------------------------------
  // alpha channel — routes to ALPHA_UPDATE_ENDPOINT via fetch
  // -------------------------------------------------------------------------

  it('does NOT call check() (Tauri updater) when releaseChannel is alpha', async () => {
    mockReleaseChannel = 'alpha';

    const { result } = renderHook(() => useAutoUpdate());

    await act(async () => {
      await result.current.checkForUpdate();
    });

    expect(mockCheck).not.toHaveBeenCalled();
  });

  it('calls fetch(ALPHA_UPDATE_ENDPOINT) when releaseChannel is alpha', async () => {
    mockReleaseChannel = 'alpha';
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    const { result } = renderHook(() => useAutoUpdate());

    await act(async () => {
      await result.current.checkForUpdate();
    });

    expect(fetchSpy).toHaveBeenCalledWith(ALPHA_UPDATE_ENDPOINT);
  });

  it('sets updateInfo when alpha manifest has a newer version', async () => {
    mockReleaseChannel = 'alpha';
    mockGetVersion.mockResolvedValue('0.42.0');

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        version: '0.42.1-alpha.1',
        notes: 'Alpha release notes',
        pub_date: '2026-05-09T00:00:00Z',
        platforms: {},
      }),
    });

    const { result } = renderHook(() => useAutoUpdate());

    await act(async () => {
      await result.current.checkForUpdate();
    });

    await waitFor(() => {
      expect(result.current.state.updateInfo).not.toBeNull();
      expect(result.current.state.updateInfo?.version).toBe('0.42.1-alpha.1');
    });
  });

  it('returns idle (no update) when alpha manifest version equals current version', async () => {
    mockReleaseChannel = 'alpha';
    mockGetVersion.mockResolvedValue('0.42.1-alpha.1');

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        version: '0.42.1-alpha.1',
        notes: 'Alpha release notes',
        pub_date: '2026-05-09T00:00:00Z',
        platforms: {},
      }),
    });

    const { result } = renderHook(() => useAutoUpdate());

    await act(async () => {
      await result.current.checkForUpdate();
    });

    await waitFor(() => {
      expect(result.current.state.status).toBe('idle');
      expect(result.current.state.updateInfo).toBeNull();
    });
  });

  it('sets error status when alpha fetch fails', async () => {
    mockReleaseChannel = 'alpha';

    globalThis.fetch = vi.fn().mockRejectedValue(new Error('Network error'));

    const { result } = renderHook(() => useAutoUpdate());

    await act(async () => {
      await result.current.checkForUpdate();
    });

    await waitFor(() => {
      expect(result.current.state.status).toBe('error');
    });
  });
});
