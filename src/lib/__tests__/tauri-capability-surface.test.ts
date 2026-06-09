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
      csp?: string | null;
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

interface HttpAllowEntry {
  url: string;
}

interface DefaultCapability {
  permissions: Array<
    string | { identifier: string; allow?: HttpAllowEntry[] }
  >;
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
      // Scope must be rooted under a Tauri path variable ($APPDATA, $RESOURCE,
      // etc.) — a bare "/**" would be equivalent to "**".
      expect(entry.startsWith('$')).toBe(true);
    }
  });

  it('has a non-null Content-Security-Policy (security audit MEDIUM)', () => {
    // The live window must ship a CSP — `csp: null` leaves a content app that
    // renders untrusted markdown/agent output with no defense-in-depth if any
    // HTML-injection sink ever regresses.
    const conf = loadTauriConf();
    const csp = conf.app?.security?.csp;
    expect(typeof csp).toBe('string');
    expect(csp).toBeTruthy();
  });

  it('CSP hardens the high-value directives without an inline-script allowance', () => {
    const conf = loadTauriConf();
    const csp = conf.app?.security?.csp ?? '';
    // Strict script source: no `unsafe-inline` / `unsafe-eval` in script-src.
    const scriptSrc = csp
      .split(';')
      .map((d) => d.trim())
      .find((d) => d.startsWith('script-src'));
    expect(scriptSrc, 'csp must define script-src').toBeTruthy();
    expect(scriptSrc).not.toContain("'unsafe-inline'");
    expect(scriptSrc).not.toContain("'unsafe-eval'");
    // Lock down the classic injection vectors.
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("default-src 'self'");
  });

  it('does NOT statically expose the home directory (security H1)', () => {
    // `$HOME/**` (or any $HOME-rooted glob) re-opens the ENTIRE home dir to the
    // asset protocol — `.ssh`, `.aws`, `.env`, browser profiles, other
    // projects — and those asset reads are NOT gated by the agent Seatbelt
    // profile. User-content roots (the Notesage library, opened projects,
    // explorer folders) are now granted at runtime via the `allow_asset_dir`
    // command in `useStartWatchers`, NOT blanket-allowed here. The old test
    // only rejected a literal `**`, so `$HOME/**` slipped through and gave
    // false assurance that the v1 exfil surface was closed.
    const conf = loadTauriConf();
    const allow = conf.app?.security?.assetProtocol?.scope?.allow ?? [];
    expect(allow).not.toContain('$HOME/**');
    for (const entry of allow) {
      expect(
        entry.startsWith('$HOME'),
        `asset scope entry "${entry}" is $HOME-rooted — grant user roots at runtime via allow_asset_dir instead`,
      ).toBe(false);
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

  it('grants sentry:default (telemetry crash-report invoke bridge)', () => {
    // `tauri-plugin-sentry` routes frontend errors through Rust via `invoke`;
    // `sentry:default` enables that bridge. It is an invoke permission, NOT a
    // network permission — egress originates from the Rust SDK, so this does
    // not widen the frontend's HTTP surface. See PRD 2026-06-07-telemetry.
    const cap = loadDefaultCapability();
    const identifiers = cap.permissions.map((perm) =>
      typeof perm === 'string' ? perm : perm.identifier,
    );
    expect(identifiers).toContain('sentry:default');
  });

  it('keeps http:default narrowly scoped to the GitHub release endpoints', () => {
    // Telemetry must NOT widen the JS HTTP surface — all telemetry egress is
    // Rust-side `reqwest`, which Tauri capabilities don't govern. This locks the
    // http:default allow-list to exactly the two GitHub release URLs so a future
    // edit can't quietly add a telemetry (or any other) endpoint here.
    const cap = loadDefaultCapability();
    const httpPerm = cap.permissions.find(
      (perm) => typeof perm !== 'string' && perm.identifier === 'http:default',
    );
    expect(httpPerm).toBeDefined();
    const allow =
      typeof httpPerm === 'string' ? [] : (httpPerm?.allow ?? []);
    const urls = allow.map((entry) => entry.url).sort();
    expect(urls).toEqual([
      'https://github.com/PeterBlenessy/notesage/**',
      'https://release-assets.githubusercontent.com/**',
    ]);
  });
});
