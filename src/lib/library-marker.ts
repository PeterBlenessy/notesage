/**
 * The library marker — `<library root>/.notesage/library.json` — makes a
 * synced library self-describing (PRD `docs/prds/2026-09-05-icloud-container-library.md`,
 * Decision 3). Written by whichever device creates the root (the phone in
 * Phase 1, `createdBy: "ios"`), extended by the Mac's migration
 * (`migratedFrom` / `migratedAt` / `migratedBy`). The phone's `reconcile()`
 * and the Mac's root-resolution rule both read it, so a second Mac or a
 * bookmarked phone follows a migration performed elsewhere without a flag, a
 * setting, or a prompt.
 *
 * Framework agnostic on purpose, in the image of `pins-file.ts` and
 * `home-file.ts`: no Tauri imports. Mirrored in Rust
 * (`src-tauri/src/library_marker.rs`) for the Mac's read path and in a
 * minimal Swift writer/reader (`LibraryAccess.swift`); the three must agree,
 * which `tests/fixtures/library-marker.json` locks byte-for-byte between the
 * TS serializer and the Rust round-trip.
 */

export const LIBRARY_MARKER_REL_PATH = ".notesage/library.json";

/** The only source a migration can come from today. */
export const LEGACY_CLOUD_DOCS_LIBRARY = "com~apple~CloudDocs/Notesage";

export interface LibraryMarker {
  version: 1;
  kind: "container";
  createdBy: "ios" | "macos";
  /** ISO 8601. */
  createdAt: string;
  migratedFrom?: typeof LEGACY_CLOUD_DOCS_LIBRARY;
  /** ISO 8601. */
  migratedAt?: string;
  /** Device name, informational. */
  migratedBy?: string;
}

/**
 * Parse a marker. `null` for anything that is not a version-1 container
 * marker — junk, another version, another kind, a missing field — which the
 * caller treats as "no marker". Unknown fields are ignored so a newer writer
 * can add keys without breaking an older reader.
 */
export function parseLibraryMarker(text: string): LibraryMarker | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const raw = parsed as Record<string, unknown>;
  if (raw.version !== 1 || raw.kind !== "container") return null;
  if (raw.createdBy !== "ios" && raw.createdBy !== "macos") return null;
  if (typeof raw.createdAt !== "string" || !raw.createdAt) return null;

  const marker: LibraryMarker = {
    version: 1,
    kind: "container",
    createdBy: raw.createdBy,
    createdAt: raw.createdAt,
  };
  if (raw.migratedFrom !== undefined) {
    // A migration from anywhere else is not something this reader knows how
    // to follow; refuse the whole marker rather than half of it.
    if (raw.migratedFrom !== LEGACY_CLOUD_DOCS_LIBRARY) return null;
    marker.migratedFrom = raw.migratedFrom;
  }
  if (typeof raw.migratedAt === "string" && raw.migratedAt) marker.migratedAt = raw.migratedAt;
  if (typeof raw.migratedBy === "string" && raw.migratedBy) marker.migratedBy = raw.migratedBy;
  return marker;
}

/**
 * Canonical serialization: fixed key order, two-space indent, trailing
 * newline. The Rust side (`serde_json::to_string_pretty` over a struct with
 * the same field order) produces the identical bytes — locked by the shared
 * fixture — so a marker written by either platform diffs cleanly in iCloud.
 */
export function serializeLibraryMarker(marker: LibraryMarker): string {
  const ordered: Record<string, unknown> = {
    version: marker.version,
    kind: marker.kind,
    createdBy: marker.createdBy,
    createdAt: marker.createdAt,
  };
  if (marker.migratedFrom !== undefined) ordered.migratedFrom = marker.migratedFrom;
  if (marker.migratedAt !== undefined) ordered.migratedAt = marker.migratedAt;
  if (marker.migratedBy !== undefined) ordered.migratedBy = marker.migratedBy;
  return `${JSON.stringify(ordered, null, 2)}\n`;
}

/**
 * A fresh marker for a root this device just created.
 */
export function newLibraryMarker(
  createdBy: LibraryMarker["createdBy"],
  createdAt: string = new Date().toISOString(),
): LibraryMarker {
  return { version: 1, kind: "container", createdBy, createdAt };
}

/**
 * Record that the legacy library was moved into this root. Pure: returns a
 * new marker, never mutates the input. A marker that already records a
 * migration keeps its original record — the first migration is the one
 * every other device followed.
 */
export function markMigrated(
  marker: LibraryMarker,
  migration: { from: typeof LEGACY_CLOUD_DOCS_LIBRARY; by: string; at: string },
): LibraryMarker {
  if (marker.migratedFrom !== undefined) return { ...marker };
  return {
    ...marker,
    migratedFrom: migration.from,
    migratedAt: migration.at,
    migratedBy: migration.by,
  };
}
