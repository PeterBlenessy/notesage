/**
 * App-version helpers — pure and dependency-free so they're safe to import from
 * anywhere, including Zustand stores (no import cycle, no React/Tauri pull-in).
 *
 * The build channel ("is this an alpha/prerelease build?") is derived
 * synchronously from the Vite-injected `__APP_VERSION__`, so it is correct from
 * the very first module evaluation — unlike the async `isAlphaBuild()` in
 * `build-channel.ts`, which resolves the version over IPC after startup. The
 * synchronous form is required by the telemetry consent default, which is read
 * during store rehydration (before any startup hook has run).
 */

/**
 * SemVer prerelease check: a version with a `-suffix` (e.g. `0.48.0-alpha.2`) is
 * a prerelease; a plain `0.48.0` is not. Build metadata (`+…`) is stripped first.
 * Single source of truth for "prerelease", shared by the updater's
 * channel-isolation guard, build-channel detection, and telemetry defaults.
 */
export function isPrereleaseVersion(version: string): boolean {
  // Strip build metadata (`+...`) before checking for a prerelease suffix.
  const withoutBuild = version.split("+", 1)[0];
  return withoutBuild.includes("-");
}

/**
 * The version this binary was built from (Vite `define` injects `__APP_VERSION__`
 * from package.json). Returns `""` when unavailable — e.g. under vitest, where
 * the define isn't applied — so callers degrade to "not an alpha build".
 */
export function appVersion(): string {
  return typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : "";
}

