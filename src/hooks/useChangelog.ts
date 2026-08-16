import { useState, useEffect, useCallback, useRef } from 'react';
import { fetch as tauriFetch } from '@tauri-apps/plugin-http';

export interface Release {
  version: string;
  date: string;
  previousVersion: string;
  sections: {
    features?: string[];
    fixes?: string[];
    improvements?: string[];
  };
  // Merged-PR dump, present only on alpha (prerelease) entries. Lets the
  // in-app changelog show what landed in each auto-cut alpha. Absent on stable.
  underTheHood?: string[];
}

export interface Changelog {
  releases: Release[];
}

// Stable channel → no `-` prerelease segment in the listing.
// Alpha channel → full list including alphas.
// File names + URLs mirror the build artifact naming in
// `scripts/generate-changelog.ts` and the workflow upload step.
const STABLE_CHANGELOG_URL =
  'https://github.com/PeterBlenessy/notesage/releases/latest/download/changelog.json';

/**
 * SemVer comparator (ASCENDING — standard).
 *
 * Returns +1 if a > b, -1 if a < b, 0 if equal. Used by `getChangesBetween`
 * to filter which releases land in the "what changed since" range.
 *
 * Handles prerelease suffixes correctly:
 *   - "0.44.0" > "0.44.0-alpha.3" (stable beats prerelease of same triple)
 *   - "0.44.0-alpha.3" > "0.44.0-alpha.0" (higher prerelease ordinal)
 *   - "0.44.0-beta.0" > "0.44.0-alpha.0" (lexical compare on identifier)
 *
 * Why this is here: previous implementation did `a.split('.').map(Number)`,
 * which produced NaN for "0-alpha" and made all prerelease comparisons return 0
 * (silently). The filter then included or excluded alphas inconsistently.
 *
 * NOTE: this is the standard ascending comparator. The build-time
 * `scripts/generate-changelog.ts` has a sibling DESCENDING variant with
 * the same logic but opposite return values, used to sort the JSON.
 */
function compareVersions(a: string, b: string): number {
  const [aTriple, aPre] = splitSemver(a);
  const [bTriple, bPre] = splitSemver(b);

  // Compare X.Y.Z triple first.
  for (let i = 0; i < 3; i++) {
    if (aTriple[i] > bTriple[i]) return 1;
    if (aTriple[i] < bTriple[i]) return -1;
  }

  // Triples equal. Stable beats prerelease.
  if (!aPre && !bPre) return 0;
  if (!aPre) return 1;  // a is stable, b is prerelease → a > b
  if (!bPre) return -1; // b is stable, a is prerelease → b > a

  // Both are prereleases. Compare identifiers lexically with numeric awareness.
  const aParts = aPre.split('.');
  const bParts = bPre.split('.');
  for (let i = 0; i < Math.max(aParts.length, bParts.length); i++) {
    const ap = aParts[i] ?? '';
    const bp = bParts[i] ?? '';
    if (ap === bp) continue;
    const aN = Number(ap);
    const bN = Number(bp);
    const aIsNum = ap !== '' && !Number.isNaN(aN);
    const bIsNum = bp !== '' && !Number.isNaN(bN);
    if (aIsNum && bIsNum) return aN > bN ? 1 : -1;
    return ap > bp ? 1 : -1;
  }
  return 0;
}

function splitSemver(v: string): [[number, number, number], string | null] {
  const dashIdx = v.indexOf('-');
  const triple = dashIdx === -1 ? v : v.slice(0, dashIdx);
  const pre = dashIdx === -1 ? null : v.slice(dashIdx + 1);
  const parts = triple.split('.').map((p) => Number(p) || 0);
  return [[parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0], pre];
}

export function useChangelog() {
  const [changelog, setChangelog] = useState<Changelog | null>(null);
  const [loading, setLoading] = useState(false);
  const fetchedRef = useRef(false);

  useEffect(() => {
    // One stream, one feed (PRD 2026-08-15-single-binary-feature-flags).
    if (fetchedRef.current) return;
    fetchedRef.current = true;

    const bundledUrl = '/changelog.json';
    const remoteUrl = STABLE_CHANGELOG_URL;

    let cancelled = false;

    async function load() {
      setLoading(true);

      // Load bundled changelog first (instant, always available)
      try {
        const res = await fetch(bundledUrl);
        if (res.ok) {
          const data = await res.json();
          if (!cancelled) setChangelog(data);
        }
      } catch {
        // Expected: bundled changelog may not exist in dev builds
      }

      // Then try remote for potentially newer data (via Tauri HTTP plugin to avoid CORS)
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 3000);
        const res = await tauriFetch(remoteUrl, { signal: controller.signal });
        clearTimeout(timeout);
        if (res.ok) {
          const data = await res.json();
          if (!cancelled) setChangelog(data);
        }
      } catch {
        // Expected: remote changelog unavailable (offline, timeout) — bundled data already loaded
      }

      if (!cancelled) setLoading(false);
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  const getChangesBetween = useCallback(
    (fromVersion: string, toVersion: string): Release[] => {
      if (!changelog) return [];
      return changelog.releases.filter(
        (r) =>
          compareVersions(r.version, fromVersion) > 0 &&
          compareVersions(r.version, toVersion) <= 0
      );
    },
    [changelog]
  );

  return { changelog, loading, getChangesBetween };
}
