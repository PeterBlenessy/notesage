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
  mockInvoke,
  StubUpdate,
  channelRef,
  autoCheckRef,
} = vi.hoisted(() => {
  const mockCheck = vi.fn();
  const mockGetVersion = vi.fn().mockResolvedValue('0.42.0');
  const mockRelaunch = vi.fn();
  const mockSetLastUpdateCheck = vi.fn();
  const mockSetDismissedVersion = vi.fn();
  // `invoke` from `@tauri-apps/api/core` — the alpha-channel check now
  // calls our custom Rust command `alpha_check(url)` which drives
  // plugin-updater's `UpdaterBuilder` with the alpha rolling-pointer URL
  // and returns `Option<UpdateMetadata>` (same shape plugin-updater's
  // own `check()` returns).
  const mockInvoke = vi.fn();
  // Stub for `Update` (the real class extends Resource and has a private
  // rid; we just need a constructor + downloadAndInstall on the JS side).
  class StubUpdate {
    rid: number;
    currentVersion: string;
    version: string;
    date?: string;
    body?: string;
    rawJson: Record<string, unknown>;
    downloadAndInstall: ReturnType<typeof vi.fn>;
    constructor(metadata: {
      rid: number;
      currentVersion: string;
      version: string;
      date?: string;
      body?: string;
      rawJson: Record<string, unknown>;
    }) {
      this.rid = metadata.rid;
      this.currentVersion = metadata.currentVersion;
      this.version = metadata.version;
      this.date = metadata.date;
      this.body = metadata.body;
      this.rawJson = metadata.rawJson;
      this.downloadAndInstall = vi.fn().mockResolvedValue(undefined);
    }
  }
  // Writable refs so individual tests can change channel/autoCheck
  const channelRef = { value: 'stable' as 'stable' | 'alpha' };
  const autoCheckRef = { value: false };
  return {
    mockCheck,
    mockGetVersion,
    mockRelaunch,
    mockSetLastUpdateCheck,
    mockSetDismissedVersion,
    mockInvoke,
    StubUpdate,
    channelRef,
    autoCheckRef,
  };
});

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock('@tauri-apps/plugin-updater', () => ({
  check: mockCheck,
  Update: StubUpdate,
}));

vi.mock('@tauri-apps/api/app', () => ({
  getVersion: mockGetVersion,
}));

vi.mock('@tauri-apps/api/core', () => ({
  invoke: mockInvoke,
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

import {
  useAutoUpdate,
  isPrereleaseVersion,
  isLeaveAlphaDowngrade,
} from '../useAutoUpdate';

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


// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  channelRef.value = 'stable';
  autoCheckRef.value = false;
  mockCheck.mockResolvedValue(null);
  mockGetVersion.mockResolvedValue('0.42.0');
  mockInvoke.mockReset();
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

  it('does NOT invoke alpha_check when channel is stable', async () => {
    channelRef.value = 'stable';
    mockCheck.mockResolvedValue(null);

    const { result } = renderHook(() => useAutoUpdate());
    await act(async () => {
      await result.current.checkForUpdate();
    });

    expect(mockInvoke).not.toHaveBeenCalled();
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
// HARD GUARANTEE: stable channel must NEVER offer a prerelease build.
// See feedback_channel_isolation_hard_guarantee.md.
// ===========================================================================

describe('stable channel — prerelease guard (HARD GUARANTEE)', () => {
  it.each([
    ['0.44.0-alpha.0'],
    ['0.44.0-alpha.1'],
    ['0.44.0-alpha.2'],
    ['0.44.0-beta.1'],
    ['0.44.0-rc.1'],
    ['1.0.0-alpha'],
  ])('REJECTS prerelease manifest version %s on stable channel', async (prereleaseVersion) => {
    channelRef.value = 'stable';
    mockGetVersion.mockResolvedValue('0.43.0');
    // Server returned a prerelease (e.g. server-side flag mistake) — the
    // app MUST refuse it.
    mockCheck.mockResolvedValue(buildTauriUpdate(prereleaseVersion));

    const { result } = renderHook(() => useAutoUpdate());
    await act(async () => {
      await result.current.checkForUpdate();
    });

    // State must be idle (no update offered), updateInfo must be null
    // (no "View Update" banner in Settings either).
    expect(result.current.state.status).toBe('idle');
    expect(result.current.state.updateInfo).toBeNull();
  });

  it.each([
    ['0.44.0'],
    ['1.0.0'],
    ['10.20.30'],
    ['0.44.0+build.123'], // build metadata is NOT a prerelease
  ])('ACCEPTS non-prerelease manifest version %s on stable channel', async (stableVersion) => {
    channelRef.value = 'stable';
    mockGetVersion.mockResolvedValue('0.42.0');
    mockCheck.mockResolvedValue(buildTauriUpdate(stableVersion));

    const { result } = renderHook(() => useAutoUpdate());
    await act(async () => {
      await result.current.checkForUpdate();
    });

    expect(result.current.state.status).toBe('available');
    expect(result.current.state.updateInfo?.version).toBe(stableVersion);
  });

});


// ===========================================================================
// isPrereleaseVersion — unit tests
// ===========================================================================

describe('isPrereleaseVersion', () => {
  it.each([
    ['0.44.0-alpha.0', true],
    ['0.44.0-alpha.1', true],
    ['0.44.0-alpha.2', true],
    ['0.44.0-beta.1', true],
    ['0.44.0-rc.1', true],
    ['1.0.0-alpha', true],
    ['0.44.0', false],
    ['1.0.0', false],
    ['10.20.30', false],
    ['0.44.0+build.123', false],
    ['0.44.0+meta-data', false], // hyphen in build metadata, not a prerelease
  ])('isPrereleaseVersion(%s) === %s', (version, expected) => {
    expect(isPrereleaseVersion(version)).toBe(expected);
  });
});

// ===========================================================================
// isLeaveAlphaDowngrade — unit tests
// ===========================================================================

describe('isLeaveAlphaDowngrade', () => {
  it.each([
    // Current alpha, manifest stable triple < alpha triple → DOWNGRADE
    ['0.44.0-alpha.3', '0.43.1', true],
    ['0.44.0-alpha.0', '0.43.0', true],
    ['1.0.0-beta.1', '0.99.0', true],
    // Current alpha, manifest stable triple == alpha triple → NOT downgrade (upgrade)
    ['0.44.0-alpha.3', '0.44.0', false],
    // Current alpha, manifest stable triple > alpha triple → NOT downgrade (upgrade)
    ['0.44.0-alpha.3', '0.45.0', false],
    ['0.44.0-alpha.3', '1.0.0', false],
    // Current is stable — never a "leave alpha"
    ['0.43.0', '0.43.1', false],
    ['0.43.0', '0.42.0', false],
    // Manifest is also prerelease — handled by the prerelease guard upstream,
    // never reaches this helper in production but the helper still returns false.
    ['0.44.0-alpha.3', '0.44.0-alpha.4', false],
  ])('isLeaveAlphaDowngrade(%s, %s) === %s', (current, manifest, expected) => {
    expect(isLeaveAlphaDowngrade(current, manifest)).toBe(expected);
  });
});

// ===========================================================================
// Leave-alpha flow — stable channel, current binary is a prerelease
// ===========================================================================

describe('leave-alpha flow (stable channel + current is prerelease)', () => {
  it('passes allowDowngrades: true to check() when on a prerelease binary', async () => {
    channelRef.value = 'stable';
    mockGetVersion.mockResolvedValue('0.44.0-alpha.3');
    mockCheck.mockResolvedValue(null);

    const { result } = renderHook(() => useAutoUpdate());
    await act(async () => {
      await result.current.checkForUpdate();
    });

    expect(mockCheck).toHaveBeenCalledWith({ allowDowngrades: true });
  });

  it('does NOT pass allowDowngrades when current binary is stable', async () => {
    channelRef.value = 'stable';
    mockGetVersion.mockResolvedValue('0.43.0');
    mockCheck.mockResolvedValue(null);

    const { result } = renderHook(() => useAutoUpdate());
    await act(async () => {
      await result.current.checkForUpdate();
    });

    expect(mockCheck).toHaveBeenCalledWith({ allowDowngrades: false });
  });

  it('flags update as isLeaveAlphaDowngrade when stable triple < current alpha triple', async () => {
    channelRef.value = 'stable';
    mockGetVersion.mockResolvedValue('0.44.0-alpha.3');
    mockCheck.mockResolvedValue(buildTauriUpdate('0.43.1'));

    const { result } = renderHook(() => useAutoUpdate());
    await act(async () => {
      await result.current.checkForUpdate();
    });

    expect(result.current.state.status).toBe('available');
    expect(result.current.state.updateInfo?.version).toBe('0.43.1');
    expect(result.current.state.updateInfo?.isLeaveAlphaDowngrade).toBe(true);
  });

  it('does NOT flag isLeaveAlphaDowngrade when stable triple matches current alpha triple', async () => {
    channelRef.value = 'stable';
    mockGetVersion.mockResolvedValue('0.44.0-alpha.3');
    // 0.44.0 stable supersedes 0.44.0-alpha.3 — that's a real upgrade, not a downgrade.
    mockCheck.mockResolvedValue(buildTauriUpdate('0.44.0'));

    const { result } = renderHook(() => useAutoUpdate());
    await act(async () => {
      await result.current.checkForUpdate();
    });

    expect(result.current.state.status).toBe('available');
    expect(result.current.state.updateInfo?.isLeaveAlphaDowngrade).toBe(false);
  });

  it('does NOT flag isLeaveAlphaDowngrade for stable-to-stable updates', async () => {
    channelRef.value = 'stable';
    mockGetVersion.mockResolvedValue('0.43.0');
    mockCheck.mockResolvedValue(buildTauriUpdate('0.43.1'));

    const { result } = renderHook(() => useAutoUpdate());
    await act(async () => {
      await result.current.checkForUpdate();
    });

    expect(result.current.state.updateInfo?.isLeaveAlphaDowngrade).toBe(false);
  });
});

