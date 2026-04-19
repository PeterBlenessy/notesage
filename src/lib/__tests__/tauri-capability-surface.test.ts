import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

// Regression-lock for task #21 (project-data-isolation).
// `assetProtocol.scope.allow = ["**"]` would let the renderer load any file on
// disk via `convertFileSrc(...)` — a silent exfil surface for agents that can
// inject HTML/markdown into the editor. These tests lock in the narrowed scope
// and the dropped `fs:allow-*` capabilities so a future config tweak can't
// silently re-open the hole.

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const tauriConfPath = path.join(repoRoot, 'src-tauri', 'tauri.conf.json');
const defaultCapPath = path.join(
  repoRoot,
  'src-tauri',
  'capabilities',
  'default.json',
);

interface TauriConf {
  app?: {
    security?: {
      assetProtocol?: {
        enable?: boolean;
        scope?: {
          allow?: string[];
          deny?: string[];
          requireLiteralLeadingDot?: boolean;
        };
      };
    };
  };
}

interface DefaultCapability {
  permissions: Array<string | { identifier: string; allow?: unknown }>;
}

function loadTauriConf(): TauriConf {
  return JSON.parse(readFileSync(tauriConfPath, 'utf8')) as TauriConf;
}

function loadDefaultCapability(): DefaultCapability {
  return JSON.parse(readFileSync(defaultCapPath, 'utf8')) as DefaultCapability;
}

describe('tauri asset protocol scope', () => {
  it('does NOT include the wildcard "**" glob', () => {
    // If this fails, someone re-opened the exfil surface from the v1 audit.
    // The wildcard made every file on disk reachable via convertFileSrc().
    const conf = loadTauriConf();
    const allow = conf.app?.security?.assetProtocol?.scope?.allow ?? [];
    expect(allow).not.toContain('**');
  });

  it('keeps the asset protocol enabled so viewers still work', () => {
    const conf = loadTauriConf();
    expect(conf.app?.security?.assetProtocol?.enable).toBe(true);
  });

  it('scope is a finite, explicit allow-list', () => {
    const conf = loadTauriConf();
    const allow = conf.app?.security?.assetProtocol?.scope?.allow;
    expect(Array.isArray(allow)).toBe(true);
    expect((allow ?? []).length).toBeGreaterThan(0);
    // Every entry must be a scoped glob — no bare "*" / "**" / "/".
    for (const entry of allow ?? []) {
      expect(entry).not.toBe('**');
      expect(entry).not.toBe('*');
      expect(entry).not.toBe('/');
      // Scope must be rooted under a Tauri path variable ($HOME, $APPDATA,
      // etc.) — a bare "/**" would be equivalent to "**".
      expect(entry.startsWith('$')).toBe(true);
    }
  });
});

describe('tauri default capability permissions', () => {
  it('drops all fs:allow-* plugin permissions', () => {
    // The frontend never imports `@tauri-apps/plugin-fs`; all filesystem I/O
    // goes through our vetted Rust commands in `commands/file.rs`. Granting
    // any `fs:allow-*` here would let a compromised dependency bypass that
    // boundary.
    const cap = loadDefaultCapability();
    const fsPermissions = cap.permissions.filter((perm) => {
      const identifier = typeof perm === 'string' ? perm : perm.identifier;
      return identifier.startsWith('fs:');
    });
    expect(fsPermissions).toEqual([]);
  });
});
