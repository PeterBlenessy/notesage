import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import path from 'path';

const { join, dirname } = path;

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
  /** Absent = every platform. Tauri accepts linux/macOS/windows/android/iOS. */
  platforms?: string[];
}

function loadTauriConf(): TauriConf {
  return JSON.parse(readFileSync(tauriConfPath, 'utf8')) as TauriConf;
}

function loadDefaultCapability(): DefaultCapability {
  return JSON.parse(readFileSync(defaultCapPath, 'utf8')) as DefaultCapability;
}

/** Load a capability by file stem, e.g. `desktop-telemetry`. */
function loadCapability(name: string): DefaultCapability {
  const path = join(dirname(defaultCapPath), `${name}.json`);
  return JSON.parse(readFileSync(path, 'utf8')) as DefaultCapability;
}

/**
 * Every permission identifier granted across ALL capability files.
 *
 * Capabilities were split by platform once the iOS target arrived, so a check
 * that reads only `default.json` can be silently bypassed by adding a second
 * file. Anything asserting "we grant exactly X" should scan the directory.
 */
function allCapabilityPermissions(): string[] {
  const dir = dirname(defaultCapPath);
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .flatMap((f) => {
      const cap = JSON.parse(readFileSync(join(dir, f), 'utf8')) as DefaultCapability;
      return (cap.permissions ?? []).map((p) => (typeof p === 'string' ? p : p.identifier));
    });
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

  it('frame-src permits the htmlpreview scheme for the HTML viewer iframe', () => {
    // The HTML viewer's sandboxed-iframe paths serve their document from the
    // `htmlpreview://` custom scheme so it renders under its OWN empty CSP rather
    // than inheriting the app's `frame-ancestors 'none'` (which blanked the old
    // `blob:`-served frame in production). Dropping this re-breaks the viewer.
    const conf = loadTauriConf();
    const csp = conf.app?.security?.csp ?? '';
    const frameSrc = csp
      .split(';')
      .map((d) => d.trim())
      .find((d) => d.startsWith('frame-src'));
    expect(frameSrc, 'csp must define frame-src').toBeTruthy();
    expect(frameSrc).toContain('htmlpreview:');
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

  it('grants aptabase:allow-track-event, and ONLY that, across every capability file', () => {
    // `tauri-plugin-aptabase` exposes only the `track_event` command and ships
    // NO `aptabase:default` set, so the command must be granted explicitly. We
    // invoke it directly through the v2 IPC (the npm JS binding is pinned to the
    // Tauri v1 API and can't reach the v2 bridge). Like sentry, this is an
    // invoke permission, NOT a network permission — egress is Rust-side
    // `reqwest`, so it does not widen the frontend HTTP surface.
    //
    // It lives in `desktop-telemetry.json` rather than `default.json` because
    // the plugin does not compile for iOS, so the dependency is gated off there
    // — and a capability naming a permission from a plugin that isn't built
    // fails the build. Scanning EVERY capability file (rather than one) is the
    // stronger check: it also catches a broader aptabase scope smuggled into a
    // new file.
    const perms = allCapabilityPermissions().filter((id) => id.startsWith('aptabase:'));
    expect(perms).toEqual(['aptabase:allow-track-event']);
  });

  it('keeps telemetry off the iOS build by platform-scoping its capability', () => {
    // If this capability ever loses its `platforms` field, the iOS build breaks
    // at the manifest step with "Permission aptabase:allow-track-event not
    // found" — an error that reads like a typo rather than a platform issue.
    const cap = loadCapability('desktop-telemetry');
    expect(cap.platforms).toBeDefined();
    expect(cap.platforms).not.toContain('iOS');
    expect(cap.platforms).toContain('macOS');
  });

  it('grants clipboard-manager READ-only (no write/clear/image surface)', () => {
    // ⌘⇧V paste-plain reads the OS clipboard via the clipboard-manager plugin
    // (Rust-side, no WebKit paste-permission menu). Only read-text is needed —
    // writes still go through `navigator.clipboard`. Lock the surface so a
    // future edit can't quietly grant clipboard write/clear/read-image.
    const cap = loadDefaultCapability();
    const clipboardPerms = cap.permissions
      .map((perm) => (typeof perm === 'string' ? perm : perm.identifier))
      .filter((id) => id.startsWith('clipboard-manager:'));
    expect(clipboardPerms).toEqual(['clipboard-manager:allow-read-text']);
  });

  it('grants process:allow-restart only (no JS-driven exit)', () => {
    // `relaunch()` after an update install (useAutoUpdate) needs restart; the
    // renderer never calls `exit()`. `process:default` bundles allow-exit +
    // allow-restart, handing any WebView JS a self-DoS `exit()` primitive with
    // no legitimate use. Lock the surface to restart only so a future edit
    // can't quietly re-grant exit. Security audit 2026-07-05 (LOW).
    const cap = loadDefaultCapability();
    const processPerms = cap.permissions
      .map((perm) => (typeof perm === 'string' ? perm : perm.identifier))
      .filter((id) => id.startsWith('process:'));
    expect(processPerms).toEqual(['process:allow-restart']);
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
