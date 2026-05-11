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
  mockTauriFetch,
  mockOpenUrl,
  channelRef,
  autoCheckRef,
} = vi.hoisted(() => {
  const mockCheck = vi.fn();
  const mockGetVersion = vi.fn().mockResolvedValue('0.42.0');
  const mockRelaunch = vi.fn();
  const mockSetLastUpdateCheck = vi.fn();
  const mockSetDismissedVersion = vi.fn();
  // `tauriFetch` from `@tauri-apps/plugin-http` — used by the alpha-channel
  // manifest fetch (routes through Rust to bypass WKWebView CORS on the
  // cross-origin redirect from github.com → release-assets.githubusercontent.com).
  const mockTauriFetch = vi.fn();
  // `openUrl` from `@tauri-apps/plugin-opener` — used when the alpha-channel
  // install path opens the tagged release in the system browser.
  const mockOpenUrl = vi.fn();
  // Writable refs so individual tests can change channel/autoCheck
  const channelRef = { value: 'stable' as 'stable' | 'alpha' };
  const autoCheckRef = { value: false };
  return {
    mockCheck,
    mockGetVersion,
    mockRelaunch,
    mockSetLastUpdateCheck,
    mockSetDismissedVersion,
    mockTauriFetch,
    mockOpenUrl,
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

vi.mock('@tauri-apps/plugin-http', () => ({
  fetch: mockTauriFetch,
}));

vi.mock('@tauri-apps/plugin-opener', () => ({
  openUrl: mockOpenUrl,
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
  ALPHA_UPDATE_ENDPOINT,
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
  mockTauriFetch.mockReset();
  mockOpenUrl.mockReset();
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

  it('does NOT call the alpha-channel HTTP fetch when channel is stable', async () => {
    channelRef.value = 'stable';
    mockCheck.mockResolvedValue(null);

    const { result } = renderHook(() => useAutoUpdate());
    await act(async () => {
      await result.current.checkForUpdate();
    });

    expect(mockTauriFetch).not.toHaveBeenCalled();
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
  function mockAlphaFetchOk(version: string) {
    mockTauriFetch.mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue(buildAlphaManifest(version)),
    });
  }

  it('fetches from ALPHA_UPDATE_ENDPOINT via the Tauri HTTP plugin', async () => {
    channelRef.value = 'alpha';
    mockAlphaFetchOk('0.43.0-alpha.1');

    const { result } = renderHook(() => useAutoUpdate());
    await act(async () => {
      await result.current.checkForUpdate();
    });

    // Tauri plugin-http fetch — Rust-routed, bypasses WKWebView CORS on the
    // cross-origin redirect from github.com → release-assets.githubusercontent.com.
    expect(mockTauriFetch).toHaveBeenCalledTimes(1);
    expect(mockTauriFetch).toHaveBeenCalledWith(ALPHA_UPDATE_ENDPOINT);
  });

  it('does NOT call Tauri check() when channel is alpha', async () => {
    channelRef.value = 'alpha';
    mockAlphaFetchOk('0.43.0-alpha.1');

    const { result } = renderHook(() => useAutoUpdate());
    await act(async () => {
      await result.current.checkForUpdate();
    });

    expect(mockCheck).not.toHaveBeenCalled();
  });

  it('sets status available when alpha manifest has newer version', async () => {
    channelRef.value = 'alpha';
    mockGetVersion.mockResolvedValue('0.42.0');
    mockAlphaFetchOk('0.43.0-alpha.1');

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
    mockAlphaFetchOk('0.43.0-alpha.1');

    const { result } = renderHook(() => useAutoUpdate());
    await act(async () => {
      await result.current.checkForUpdate();
    });

    expect(result.current.state.status).toBe('idle');
    expect(result.current.state.updateInfo).toBeNull();
  });

  it('sets status error when alpha endpoint returns non-ok response', async () => {
    channelRef.value = 'alpha';
    mockTauriFetch.mockResolvedValue({
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
    mockTauriFetch.mockRejectedValue(new Error('Network failure'));

    const { result } = renderHook(() => useAutoUpdate());
    await act(async () => {
      await result.current.checkForUpdate();
    });

    expect(result.current.state.status).toBe('error');
    expect(result.current.state.error).toContain('Network failure');
  });

  it('calls setLastUpdateCheck after alpha check completes', async () => {
    channelRef.value = 'alpha';
    mockAlphaFetchOk('0.43.0-alpha.1');

    const { result } = renderHook(() => useAutoUpdate());
    await act(async () => {
      await result.current.checkForUpdate();
    });

    expect(mockSetLastUpdateCheck).toHaveBeenCalledTimes(1);
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

  it('alpha channel is UNAFFECTED by the prerelease guard (alphas are expected there)', async () => {
    channelRef.value = 'alpha';
    mockGetVersion.mockResolvedValue('0.42.0');
    mockTauriFetch.mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue(buildAlphaManifest('0.44.0-alpha.3')),
    });

    const { result } = renderHook(() => useAutoUpdate());
    await act(async () => {
      await result.current.checkForUpdate();
    });

    // Alpha channel offers the prerelease — exactly what the user signed up for.
    expect(result.current.state.status).toBe('available');
    expect(result.current.state.updateInfo?.version).toBe('0.44.0-alpha.3');
  });
});

// ===========================================================================
// Alpha install flow — opens GitHub release in browser (no plugin-updater path)
// ===========================================================================

describe('alpha channel install flow', () => {
  it('downloadAndInstall on alpha opens the tagged release in the browser', async () => {
    channelRef.value = 'alpha';
    mockGetVersion.mockResolvedValue('0.44.0-alpha.1');
    mockTauriFetch.mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue(buildAlphaManifest('0.44.0-alpha.2')),
    });
    mockOpenUrl.mockResolvedValue(undefined);

    const { result } = renderHook(() => useAutoUpdate());
    await act(async () => {
      await result.current.checkForUpdate();
    });
    expect(result.current.state.status).toBe('available');

    await act(async () => {
      await result.current.downloadAndInstall();
    });

    expect(mockOpenUrl).toHaveBeenCalledTimes(1);
    expect(mockOpenUrl).toHaveBeenCalledWith(
      'https://github.com/PeterBlenessy/notesage/releases/tag/v0.44.0-alpha.2',
    );
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

// ===========================================================================
// Auto-check on channel change
// ===========================================================================

describe('auto-check on channel change', () => {
  it('triggers a fresh check when the user switches alpha → stable', async () => {
    channelRef.value = 'alpha';
    mockGetVersion.mockResolvedValue('0.44.0-alpha.3');
    mockTauriFetch.mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue(buildAlphaManifest('0.44.0-alpha.3')),
    });
    mockCheck.mockResolvedValue(null);

    const { rerender } = renderHook(() => useAutoUpdate());

    // Mount triggers no auto-check (autoCheckUpdates is false in beforeEach).
    expect(mockCheck).not.toHaveBeenCalled();
    expect(mockTauriFetch).not.toHaveBeenCalled();

    // Switch channel. The `checkForUpdate` effect should re-fire on the new channel.
    channelRef.value = 'stable';
    await act(async () => {
      rerender();
      // Wait for the async checkForUpdate to settle.
      await Promise.resolve();
      await Promise.resolve();
    });

    // Stable channel was checked, alpha was not (channel changed before).
    expect(mockCheck).toHaveBeenCalled();
  });

  it('does NOT trigger a check on initial mount (no false fire)', () => {
    channelRef.value = 'stable';
    mockGetVersion.mockResolvedValue('0.43.0');
    mockCheck.mockResolvedValue(null);

    renderHook(() => useAutoUpdate());

    // The "channel-change" effect tracks initial mount via lastChannelRef and
    // skips it. Only the auto-check-on-mount effect (gated by autoCheckUpdates,
    // which is false here) would fire — and we've already mocked that off.
    expect(mockCheck).not.toHaveBeenCalled();
  });
});
