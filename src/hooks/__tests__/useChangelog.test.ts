/**
 * Regression-lock for the SemVer comparator in `useChangelog.ts`.
 *
 * Previously the comparator did `a.split('.').map(Number)`, which produced
 * `NaN` for the "0-alpha" segment of "0.44.0-alpha.3". `NaN > NaN` is false
 * AND `NaN < NaN` is false, so the comparator silently returned 0 for any
 * pair of prereleases. The `getChangesBetween` filter then included or
 * excluded alpha releases inconsistently AND the in-app "What's new" dialog
 * surfaced alphas in the wrong order (oldest first).
 *
 * We can't directly import the internal `compareVersions` (it's not exported)
 * so we exercise it via `getChangesBetween`'s observable behaviour.
 */

// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";

// Mock global fetch for changelog.json loads.
const mockFetch = vi.fn();
beforeEach(() => {
  vi.clearAllMocks();
  globalThis.fetch = mockFetch as unknown as typeof fetch;
});

import { useChangelog } from "../useChangelog";

interface Release {
  version: string;
  date: string;
  previousVersion: string;
  sections: {
    features?: string[];
    improvements?: string[];
    fixes?: string[];
  };
}

function mockChangelog(versions: string[]) {
  const releases: Release[] = versions.map((v, i) => ({
    version: v,
    date: `2026-05-${(i + 1).toString().padStart(2, "0")}`,
    previousVersion: versions[i + 1] ?? "0.0.0",
    sections: { fixes: [`fix in ${v}`] },
  }));
  mockFetch.mockResolvedValue({
    ok: true,
    json: vi.fn().mockResolvedValue({ releases }),
  });
}

describe("useChangelog — getChangesBetween (SemVer comparator)", () => {
  it("handles prerelease vs stable comparison correctly", async () => {
    // Newest first per the changelog.json convention.
    mockChangelog([
      "0.44.0-alpha.3",
      "0.44.0-alpha.2",
      "0.44.0-alpha.1",
      "0.44.0-alpha.0",
      "0.43.1",
      "0.43.0",
    ]);

    const { result } = renderHook(() => useChangelog());
    await waitFor(() => expect(result.current.changelog).not.toBeNull());

    // From v0.43.0 to v0.44.0-alpha.3 — should include all alphas + v0.43.1.
    const range = result.current.getChangesBetween("0.43.0", "0.44.0-alpha.3");
    const versions = range.map((r) => r.version);
    expect(versions).toEqual([
      "0.44.0-alpha.3",
      "0.44.0-alpha.2",
      "0.44.0-alpha.1",
      "0.44.0-alpha.0",
      "0.43.1",
    ]);
  });

  it("correctly identifies that 0.44.0 (stable) > 0.44.0-alpha.3 (prerelease)", async () => {
    mockChangelog(["0.44.0", "0.44.0-alpha.3", "0.43.0"]);
    const { result } = renderHook(() => useChangelog());
    await waitFor(() => expect(result.current.changelog).not.toBeNull());

    // 0.44.0-alpha.3 to 0.44.0 — should include only the stable.
    const range = result.current.getChangesBetween("0.44.0-alpha.3", "0.44.0");
    expect(range.map((r) => r.version)).toEqual(["0.44.0"]);
  });

  it("correctly orders alpha prerelease ordinals (.10 after .2)", async () => {
    mockChangelog([
      "0.44.0-alpha.10",
      "0.44.0-alpha.3",
      "0.44.0-alpha.2",
      "0.43.0",
    ]);
    const { result } = renderHook(() => useChangelog());
    await waitFor(() => expect(result.current.changelog).not.toBeNull());

    // alpha.2 to alpha.10 — should include alpha.3 AND alpha.10.
    const range = result.current.getChangesBetween(
      "0.44.0-alpha.2",
      "0.44.0-alpha.10",
    );
    // Numeric ordering: alpha.10 > alpha.3 > alpha.2.
    expect(range.map((r) => r.version)).toEqual([
      "0.44.0-alpha.10",
      "0.44.0-alpha.3",
    ]);
  });

  it("excludes the starting version (exclusive lower bound)", async () => {
    mockChangelog(["0.43.1", "0.43.0", "0.42.0"]);
    const { result } = renderHook(() => useChangelog());
    await waitFor(() => expect(result.current.changelog).not.toBeNull());

    const range = result.current.getChangesBetween("0.43.0", "0.43.1");
    // Starting v0.43.0 should NOT be in the result; only 0.43.1.
    expect(range.map((r) => r.version)).toEqual(["0.43.1"]);
  });

  it("includes the ending version (inclusive upper bound)", async () => {
    mockChangelog(["0.43.1", "0.43.0"]);
    const { result } = renderHook(() => useChangelog());
    await waitFor(() => expect(result.current.changelog).not.toBeNull());

    const range = result.current.getChangesBetween("0.43.0", "0.43.1");
    expect(range[0]?.version).toBe("0.43.1");
  });

  it("handles cross-channel range (alpha install upgrading from stable)", async () => {
    mockChangelog([
      "0.44.0-alpha.3",
      "0.43.1",
      "0.43.0",
    ]);
    const { result } = renderHook(() => useChangelog());
    await waitFor(() => expect(result.current.changelog).not.toBeNull());

    // v0.43.0 → 0.44.0-alpha.3: both v0.43.1 and the alpha are between them.
    const range = result.current.getChangesBetween("0.43.0", "0.44.0-alpha.3");
    expect(range.map((r) => r.version)).toEqual([
      "0.44.0-alpha.3",
      "0.43.1",
    ]);
  });
});
