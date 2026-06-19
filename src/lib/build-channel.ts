/**
 * Build-channel detection for runtime feature gating.
 *
 * `isAlphaBuild` is resolved once at startup from the app version's SemVer
 * prerelease suffix (e.g. `0.47.0-alpha.5` → true) and cached synchronously so
 * keyboard `when()` predicates and other hot paths can read it without an async
 * call. Reuses `isPrereleaseVersion` so the definition of "prerelease" stays in
 * one place (shared with the updater's channel-isolation guard).
 *
 * In dev (`import.meta.env.DEV`) we always treat the build as alpha-or-better so
 * developer affordances (devtools) are available before the version resolves.
 */
import { getVersion } from "@tauri-apps/api/app";

import { isPrereleaseVersion } from "@/hooks/useAutoUpdate";

let alphaBuild = import.meta.env.DEV;

/** Synchronous accessor — true in dev and on alpha/prerelease builds. */
export function isAlphaBuild(): boolean {
  return alphaBuild;
}

/**
 * Resolve the running app version and cache whether this is an alpha build.
 * Call once at startup (from `App.tsx`). Best-effort: on failure the dev
 * default is retained.
 */
export async function initBuildChannel(): Promise<void> {
  if (import.meta.env.DEV) return; // already true; skip the IPC round-trip
  try {
    const version = await getVersion();
    alphaBuild = isPrereleaseVersion(version);
  } catch {
    // Leave the default (false in a packaged build) — devtools simply stays
    // hidden if we can't determine the channel.
  }
}
