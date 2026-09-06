/**
 * `.notesage/library.json` — the marker that makes a synced library
 * self-describing (PRD 2026-09-05-icloud-container-library, task #4).
 *
 * The fixture at `tests/fixtures/library-marker.json` is written by THIS
 * serializer and read back by the Rust round-trip test
 * (`src-tauri/src/library_marker.rs`), so the two platforms cannot drift
 * without one of the two tests noticing.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  LEGACY_CLOUD_DOCS_LIBRARY,
  LIBRARY_MARKER_REL_PATH,
  markMigrated,
  newLibraryMarker,
  parseLibraryMarker,
  serializeLibraryMarker,
  type LibraryMarker,
} from "@/lib/library-marker";

const FIXTURE = resolve(__dirname, "../../../tests/fixtures/library-marker.json");

const created: LibraryMarker = {
  version: 1,
  kind: "container",
  createdBy: "ios",
  createdAt: "2026-09-05T08:15:00Z",
};

describe("library marker", () => {
  it("lives beside the pins file, inside the library it describes", () => {
    expect(LIBRARY_MARKER_REL_PATH).toBe(".notesage/library.json");
  });

  it("round-trips a freshly created marker", () => {
    const text = serializeLibraryMarker(created);
    expect(text).toBe(
      '{\n  "version": 1,\n  "kind": "container",\n  "createdBy": "ios",\n  "createdAt": "2026-09-05T08:15:00Z"\n}\n',
    );
    expect(parseLibraryMarker(text)).toEqual(created);
  });

  it("round-trips a migrated marker with the keys in canonical order", () => {
    const migrated = markMigrated(created, {
      from: LEGACY_CLOUD_DOCS_LIBRARY,
      by: "Peter's MacBook Pro",
      at: "2026-09-12T19:30:00Z",
    });
    const text = serializeLibraryMarker(migrated);
    expect(Object.keys(JSON.parse(text))).toEqual([
      "version",
      "kind",
      "createdBy",
      "createdAt",
      "migratedFrom",
      "migratedAt",
      "migratedBy",
    ]);
    expect(parseLibraryMarker(text)).toEqual(migrated);
  });

  it("matches the shared fixture byte-for-byte (the Rust side reads this same file)", () => {
    const migrated = markMigrated(created, {
      from: LEGACY_CLOUD_DOCS_LIBRARY,
      by: "Peter's MacBook Pro",
      at: "2026-09-12T19:30:00Z",
    });
    expect(serializeLibraryMarker(migrated)).toBe(readFileSync(FIXTURE, "utf8"));
  });

  it("tolerates unknown fields — a newer writer must not break an older reader", () => {
    const text = JSON.stringify({ ...created, futureKey: { nested: true } });
    expect(parseLibraryMarker(text)).toEqual(created);
  });

  it("rejects the wrong version, the wrong kind, junk, and a missing field", () => {
    expect(parseLibraryMarker("nope")).toBeNull();
    expect(parseLibraryMarker("[]")).toBeNull();
    expect(parseLibraryMarker("null")).toBeNull();
    expect(parseLibraryMarker(JSON.stringify({ ...created, version: 2 }))).toBeNull();
    expect(parseLibraryMarker(JSON.stringify({ ...created, kind: "folder" }))).toBeNull();
    expect(parseLibraryMarker(JSON.stringify({ ...created, createdBy: "android" }))).toBeNull();
    expect(parseLibraryMarker(JSON.stringify({ ...created, createdAt: "" }))).toBeNull();
    expect(parseLibraryMarker(JSON.stringify({ version: 1, kind: "container" }))).toBeNull();
  });

  it("rejects a migration from a source it does not know how to follow", () => {
    expect(
      parseLibraryMarker(JSON.stringify({ ...created, migratedFrom: "Dropbox/Notesage" })),
    ).toBeNull();
  });

  it("markMigrated is pure and records only the first migration", () => {
    const first = markMigrated(created, {
      from: LEGACY_CLOUD_DOCS_LIBRARY,
      by: "A",
      at: "2026-09-12T19:30:00Z",
    });
    expect(created.migratedFrom).toBeUndefined();
    const second = markMigrated(first, {
      from: LEGACY_CLOUD_DOCS_LIBRARY,
      by: "B",
      at: "2026-10-01T00:00:00Z",
    });
    expect(second).toEqual(first);
    expect(second).not.toBe(first);
  });

  it("newLibraryMarker stamps the creator and an ISO timestamp", () => {
    const m = newLibraryMarker("macos", "2026-09-05T08:15:00Z");
    expect(m).toEqual({ ...created, createdBy: "macos" });
    expect(() => new Date(newLibraryMarker("ios").createdAt).toISOString()).not.toThrow();
  });
});
