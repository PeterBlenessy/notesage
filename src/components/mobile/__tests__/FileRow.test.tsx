// @vitest-environment jsdom
import "@/test/tauri-mock";
import { describe, it, expect } from "vitest";
import { renderWithProviders, screen } from "@/test/component-harness";
import { FileRow, formatModified, classifyFile, iconFor } from "@/components/mobile/FileRow";

/** Minimal long-press action context (#680) — these suites cover rendering
 *  and activation, not the menu; the menu has its own suite. */
const noopActions = {
  isPinned: () => false,
  togglePin: async () => {},
};


describe("formatModified (#588 — Files-app row metadata)", () => {
  // A fixed "now" keeps every branch deterministic regardless of wall clock.
  const now = new Date(2026, 7, 11, 15, 30); // 11 Aug 2026, 15:30 local

  it("shows the time for a same-day modification", () => {
    const today = new Date(2026, 7, 11, 9, 5).getTime() / 1000;
    // Locale-dependent rendering — assert the shape (hour + minute), not the exact string.
    expect(formatModified(today, now)).toMatch(/9.*05|09.*05/);
  });

  it("shows Yesterday for the previous day", () => {
    const yesterday = new Date(2026, 7, 10, 23, 59).getTime() / 1000;
    expect(formatModified(yesterday, now)).toBe("Yesterday");
  });

  it("omits the year within the current year, includes it otherwise", () => {
    const juneThisYear = new Date(2026, 5, 2, 12, 0).getTime() / 1000;
    const lastYear = new Date(2025, 5, 2, 12, 0).getTime() / 1000;
    expect(formatModified(juneThisYear, now)).not.toMatch(/2026/);
    expect(formatModified(lastYear, now)).toMatch(/2025/);
  });
});

describe("FileRow layout (#684)", () => {
  it("is a single line — the date lives in the section header, not the row", () => {
    renderWithProviders(
      <FileRow
        actionContext={noopActions}
        entry={{
          name: "note.md",
          path: "note.md",
          is_directory: false,
          hidden: false,
          modified: new Date(2025, 5, 2, 12, 0).getTime() / 1000,
        }}
        onActivate={() => {}}
      />,
    );
    expect(screen.getByText("note.md")).toBeTruthy();
    // A second line under the name is what made the icon look unaligned.
    expect(screen.queryByText(/2025/)).toBeNull();
  });

  it("shows a folder's item count, and nothing for a file", () => {
    const { unmount } = renderWithProviders(
      <FileRow
        actionContext={noopActions}
        entry={{
          name: "Ideas",
          path: "Ideas",
          is_directory: true,
          hidden: false,
          child_count: 12,
        }}
        onActivate={() => {}}
      />,
    );
    expect(screen.getByText("12")).toBeTruthy();
    unmount();

    renderWithProviders(
      <FileRow
        actionContext={noopActions}
        entry={{ name: "plain.md", path: "plain.md", is_directory: false, hidden: false }}
        onActivate={() => {}}
      />,
    );
    expect(screen.queryByText(/^\d+$/)).toBeNull();
  });

  it("shows an empty folder as 0 rather than omitting the count", () => {
    renderWithProviders(
      <FileRow
        actionContext={noopActions}
        entry={{
          name: "Empty",
          path: "Empty",
          is_directory: true,
          hidden: false,
          child_count: 0,
        }}
        onActivate={() => {}}
      />,
    );
    expect(screen.getByText("0")).toBeTruthy();
  });
});

describe("classifyFile — capture-pipeline coverage", () => {
  /**
   * The guard that keeps thumbnails honest.
   *
   * `linked_document_for_content_type` (notesage-capture) decides which MIME
   * types the share extension will save as a real file. `classifyFile` decides
   * whether such a file gets a thumbnail, a meaningful icon, and the native
   * viewer — anything it calls `other` gets none of the three.
   *
   * These two lists live in different languages in different trees and drifted
   * apart exactly as you would expect: odt/odp/rtf/tiff/webm/ogg/flac became
   * capturable and stayed unclassified, landing as grey generic rows with no
   * preview. Restating the extensions here would drift the same way, so the
   * test PARSES the Rust table it is guarding.
   */
  it("classifies every extension the capture pipeline can produce", async () => {
    const { readFileSync } = await import("node:fs");
    const path = await import("node:path");
    // `import.meta.url` is an http:// URL under jsdom — resolve from __dirname,
    // the convention the capability-surface suite already uses.
    const repoRoot = path.resolve(__dirname, "..", "..", "..", "..");
    const src = readFileSync(
      path.join(repoRoot, "src-tauri/crates/notesage-capture/src/lib.rs"),
      "utf8",
    );
    const start = src.indexOf("pub fn linked_document_for_content_type");
    expect(start, "linked_document_for_content_type not found — did it move?").toBeGreaterThan(-1);
    const body = src.slice(start, src.indexOf("\n}\n", start));

    const extensions = [...body.matchAll(/\bdoc\("([a-z0-9]+)",\s*"/g)].map((m) => m[1]);
    // Sanity-check the parse itself: a regex that silently matched nothing
    // would make this test pass while checking absolutely nothing.
    expect(extensions.length).toBeGreaterThanOrEqual(20);
    expect(extensions).toContain("pdf");

    const unclassified = extensions.filter((ext) => classifyFile(`shared.${ext}`) === "other");
    expect(
      unclassified,
      `These capture-pipeline formats fall through to "other", so they get no thumbnail, ` +
        `a generic icon, and the Reader's unsupported card instead of the native viewer. ` +
        `Add them to classifyFile.`,
    ).toEqual([]);
  });

  it("routes audio to an audio icon, not the video glyph", () => {
    const entry = (name: string) =>
      ({ name, path: name, is_directory: false, hidden: false }) as never;
    // Same kind, same viewer — different icon. For an artwork-less recording
    // the icon is the only visual the card will ever have.
    expect(classifyFile("memo.m4a")).toBe("media");
    expect(classifyFile("clip.mp4")).toBe("media");
    expect(iconFor(entry("memo.m4a"))).not.toBe(iconFor(entry("clip.mp4")));
  });
});
