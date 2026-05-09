// @vitest-environment jsdom

/**
 * Unit tests for useAutoUpdate — covers both stable and alpha release channels.
 *
 * Stable channel: existing Tauri check() path (regression guard).
 * Alpha channel: manual fetch from ALPHA_UPDATE_ENDPOINT.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

// ---------------------------------------------------------------------------
// vi.hoisted — runs before vi.mock factories
// ---------------------------------------------------------------------------

const {
  mockCheck,
  mockGetVersion,
  mockRelaunch,
  mockSetLastUpdateCheck,
  mockSetDismissedVersion,
  channelRef,
  autoCheckRef,
} = vi.hoisted(() => {
  const mockCheck = vi.fn();
  const mockGetVersion = vi.fn().mockResolvedValue('0.42.0');
  const mockRelaunch = vi.fn();
  const mockSetLastUpdateCheck = vi.fn();
  const mockSetDismissedVersion = vi.fn();
  // Writable refs so individual tests can change channel/autoCheck
  const channelRef = { value: 'stable' as 'stable' | 'alpha' };
  const autoCheckRef = { value: false };
  return {
    mockCheck,
    mockGetVersion,
    mockRelaunch,
    mockSetLastUpdateCheck,
    mockSetDismissedVersion,
    channelRef,
    autoCheckRef,
  };
});

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock('@tauri-apps/plugin-updater', () => ({
  check: mockCheck,
}));

vi.mock('@tauri-apps/api/app', () => ({
  getVersion: mockGetVersion,
}));

vi.mock('@tauri-apps/plugin-process', () => ({
  relaunch: mockRelaunch,
}));

vi.mock('@/lib/logger', () => ({
  log: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('@/stores/settings-store', () => ({
  useSettingsStore: vi.fn((selector: (s: Record<string, unknown>) => unknown) =>
    selector({
      autoCheckUpdates: autoCheckRef.value,
      dismissedVersion: null,
      releaseChannel: channelRef.value,
      setLastUpdateCheck: mockSetLastUpdateCheck,
      setDismissedVersion: mockSetDismissedVersion,
    }),
  ),
}));

// ---------------------------------------------------------------------------
// Import hook AFTER mocks
// ---------------------------------------------------------------------------

import { useAutoUpdate, ALPHA_UPDATE_ENDPOINT } from '../useAutoUpdate';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildTauriUpdate(version: string) {
  return {
    version,
    body: `Release notes for ${version}`,
    date: '2026-05-09',
    downloadAndInstall: vi.fn().mockResolvedValue(undefined),
  };
}

function buildAlphaManifest(version: string, url = 'https://example.com/app.tar.gz') {
  return {
    version,
    notes: `Alpha release notes for ${version}`,
    pub_date: '2026-05-09T00:00:00Z',
    platforms: {
      'darwin-aarch64': { signature: 'fakesig', url },
    },
  };
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  channelRef.value = 'stable';
  autoCheckRef.value = false;
  mockCheck.mockResolvedValue(null);
  mockGetVersion.mockResolvedValue('0.42.0');
  // Inject fetch mock
  globalThis.fetch = vi.fn();
});

// ===========================================================================
// ALPHA_UPDATE_ENDPOINT constant
// ===========================================================================

describe('ALPHA_UPDATE_ENDPOINT', () => {
  it('is exported and is a non-empty string', () => {
    expect(typeof ALPHA_UPDATE_ENDPOINT).toBe('string');
    expect(ALPHA_UPDATE_ENDPOINT.length).toBeGreaterThan(0);
  });

  it('points to the latest-alpha release manifest', () => {
    expect(ALPHA_UPDATE_ENDPOINT).toContain('latest-alpha');
    expect(ALPHA_UPDATE_ENDPOINT).toContain('latest.json');
  });
});

// ===========================================================================
// Stable channel — existing behavior (regression guards)
// ===========================================================================

describe('stable channel (regression guard)', () => {
  it('calls Tauri check() when channel is stable', async () => {
    channelRef.value = 'stable';
    mockCheck.mockResolvedValue(null);

    const { result } = renderHook(() => useAutoUpdate());
    await act(async () => {
      await result.current.checkForUpdate();
    });

    expect(mockCheck).toHaveBeenCalledTimes(1);
  });

  it('does NOT call global fetch for stable channel', async () => {
    channelRef.value = 'stable';
    mockCheck.mockResolvedValue(null);

    const { result } = renderHook(() => useAutoUpdate());
    await act(async () => {
      await result.current.checkForUpdate();
    });

    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('returns available status when Tauri check returns update', async () => {
    channelRef.value = 'stable';
    mockCheck.mockResolvedValue(buildTauriUpdate('0.43.0'));

    const { result } = renderHook(() => useAutoUpdate());
    await act(async () => {
      await result.current.checkForUpdate();
    });

    expect(result.current.state.status).toBe('available');
    expect(result.current.state.updateInfo?.version).toBe('0.43.0');
  });
});

// ===========================================================================
// Alpha channel
// ===========================================================================

describe('alpha channel', () => {
  it('fetches from ALPHA_UPDATE_ENDPOINT when channel is alpha', async () => {
    channelRef.value = 'alpha';
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue(buildAlphaManifest('0.43.0-alpha.1')),
    });

    const { result } = renderHook(() => useAutoUpdate());
    await act(async () => {
      await result.current.checkForUpdate();
    });

    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    expect(globalThis.fetch).toHaveBeenCalledWith(ALPHA_UPDATE_ENDPOINT);
  });

  it('does NOT call Tauri check() when channel is alpha', async () => {
    channelRef.value = 'alpha';
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue(buildAlphaManifest('0.43.0-alpha.1')),
    });

    const { result } = renderHook(() => useAutoUpdate());
    await act(async () => {
      await result.current.checkForUpdate();
    });

    expect(mockCheck).not.toHaveBeenCalled();
  });

  it('sets status available when alpha manifest has newer version', async () => {
    channelRef.value = 'alpha';
    mockGetVersion.mockResolvedValue('0.42.0');
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue(buildAlphaManifest('0.43.0-alpha.1')),
    });

    const { result } = renderHook(() => useAutoUpdate());
    await act(async () => {
      await result.current.checkForUpdate();
    });

    expect(result.current.state.status).toBe('available');
    expect(result.current.state.updateInfo?.version).toBe('0.43.0-alpha.1');
  });

  it('sets status idle when alpha manifest version matches current', async () => {
    channelRef.value = 'alpha';
    mockGetVersion.mockResolvedValue('0.43.0-alpha.1');
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue(buildAlphaManifest('0.43.0-alpha.1')),
    });

    const { result } = renderHook(() => useAutoUpdate());
    await act(async () => {
      await result.current.checkForUpdate();
    });

    expect(result.current.state.status).toBe('idle');
    expect(result.current.state.updateInfo).toBeNull();
  });

  it('sets status error when alpha endpoint returns non-ok response', async () => {
    channelRef.value = 'alpha';
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      status: 404,
      statusText: 'Not Found',
    });

    const { result } = renderHook(() => useAutoUpdate());
    await act(async () => {
      await result.current.checkForUpdate();
    });

    expect(result.current.state.status).toBe('error');
    expect(result.current.state.error).toBeTruthy();
  });

  it('sets status error when alpha endpoint fetch throws', async () => {
    channelRef.value = 'alpha';
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Network failure'));

    const { result } = renderHook(() => useAutoUpdate());
    await act(async () => {
      await result.current.checkForUpdate();
    });

    expect(result.current.state.status).toBe('error');
    expect(result.current.state.error).toContain('Network failure');
  });

  it('calls setLastUpdateCheck after alpha check completes', async () => {
    channelRef.value = 'alpha';
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue(buildAlphaManifest('0.43.0-alpha.1')),
    });

    const { result } = renderHook(() => useAutoUpdate());
    await act(async () => {
      await result.current.checkForUpdate();
    });

    expect(mockSetLastUpdateCheck).toHaveBeenCalledTimes(1);
  });
});
