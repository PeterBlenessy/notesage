/**
 * Session-scoped consent for auto-fetching link-preview metadata.
 *
 * A `linkPreview` node that carries a `url` but no `title` triggers an outbound
 * OpenGraph fetch from the user's IP when it renders. For nodes the user just
 * created (the `/embed` slash command or accepting the paste prompt) that's the
 * intended behavior. But a bare `> [!link](url)` deserialized from disk —
 * including markdown authored by an AI agent — would fire the same zero-click
 * request to an attacker-chosen host on open, a tracking / IP-leak beacon
 * (2026-07-05 security audit, LOW).
 *
 * This module records the URLs the user has explicitly asked to preview in the
 * current session. The card auto-fetches only for consented URLs; everything
 * else shows a manual "Load preview" affordance. Consent is deliberately
 * in-memory (never persisted) so it resets each launch — a URL the user
 * approved last session doesn't silently auto-fetch after a restart.
 *
 * Keyed by URL rather than node id because the node id isn't stable across the
 * insert→render boundary. The worst case of a URL collision is a duplicate
 * user-typed URL auto-loading, which is harmless; the property we protect is
 * that a URL the user never asked to preview (disk/agent content) does not.
 */

const consented = new Set<string>();

/** Record that the user explicitly asked to preview this URL this session. */
export function markPreviewConsent(url: string): void {
  const trimmed = url.trim();
  if (trimmed) consented.add(trimmed);
}

/** True if the user opted into previewing this URL this session. */
export function hasPreviewConsent(url: string): boolean {
  return consented.has(url.trim());
}

/** Test-only: clear all recorded consent. */
export function __resetPreviewConsent(): void {
  consented.clear();
}
