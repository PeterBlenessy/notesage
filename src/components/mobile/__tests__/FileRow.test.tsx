// @vitest-environment jsdom
import "@/test/tauri-mock";
import { describe, it, expect } from "vitest";
import { renderWithProviders, screen } from "@/test/component-harness";
import { FileRow, formatModified } from "@/components/mobile/FileRow";

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

describe("FileRow modified line", () => {
  it("renders the modified date beneath the name when present", () => {
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
    expect(screen.getByText(/2025/)).toBeTruthy();
  });

  it("omits the secondary line entirely when modified is absent", () => {
    renderWithProviders(
      <FileRow
        actionContext={noopActions}
        entry={{ name: "plain.md", path: "plain.md", is_directory: false, hidden: false }}
        onActivate={() => {}}
      />,
    );
    const name = screen.getByText("plain.md");
    // The name column has exactly one line — no metadata sibling.
    expect(name.parentElement?.childElementCount).toBe(1);
  });
});
