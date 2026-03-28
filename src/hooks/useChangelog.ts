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
}

export interface Changelog {
  releases: Release[];
}

const GITHUB_CHANGELOG_URL =
  'https://github.com/PeterBlenessy/notesage/releases/latest/download/changelog.json';

function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const na = pa[i] ?? 0;
    const nb = pb[i] ?? 0;
    if (na > nb) return 1;
    if (na < nb) return -1;
  }
  return 0;
}

export function useChangelog() {
  const [changelog, setChangelog] = useState<Changelog | null>(null);
  const [loading, setLoading] = useState(false);
  const fetchedRef = useRef(false);

  useEffect(() => {
    if (fetchedRef.current) return;
    fetchedRef.current = true;

    let cancelled = false;

    async function load() {
      setLoading(true);

      // Load bundled changelog first (instant, always available)
      try {
        const res = await fetch('/changelog.json');
        if (res.ok) {
          const data = await res.json();
          if (!cancelled) setChangelog(data);
        }
      } catch {
        // Expected: bundled changelog.json may not exist in dev builds
      }

      // Then try remote for potentially newer data (via Tauri HTTP plugin to avoid CORS)
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 3000);
        const res = await tauriFetch(GITHUB_CHANGELOG_URL, { signal: controller.signal });
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
      fetchedRef.current = false;
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
