import { describe, it, expect } from "vitest";
import { groupByDate } from "@/components/inbox/inbox-grouping";

const now = new Date(2026, 8, 3, 21, 0); // 3 Sep 2026, 21:00 local
const secs = (d: Date) => Math.floor(d.getTime() / 1000);

describe("groupByDate (Inbox sections)", () => {
  it("buckets Today, Yesterday, Previous 7 Days, then months — newest first", () => {
    const items = [
      { path: "old", modified: secs(new Date(2026, 6, 10)) },
      { path: "today-early", modified: secs(new Date(2026, 8, 3, 8, 0)) },
      { path: "week", modified: secs(new Date(2026, 8, 1, 12, 0)) },
      { path: "today-late", modified: secs(new Date(2026, 8, 3, 20, 52)) },
      { path: "yesterday", modified: secs(new Date(2026, 8, 2, 23, 59)) },
      { path: "last-year", modified: secs(new Date(2025, 11, 24)) },
    ];
    const groups = groupByDate(items, now);
    expect(groups.map((g) => g.key)).toEqual(["today", "yesterday", "week", "2026-07", "2025-12"]);
    expect(groups[0].items.map((i) => i.path)).toEqual(["today-late", "today-early"]);
    expect(groups[3].title).toMatch(/jul/i);
    expect(groups[4].title).toMatch(/2025/);
  });

  it("sinks undated items to the end and keeps their order", () => {
    const groups = groupByDate(
      [{ path: "b" }, { path: "a" }, { path: "dated", modified: secs(now) }],
      now,
    );
    expect(groups.map((g) => g.key)).toEqual(["today", "older"]);
    expect(groups[1].items.map((i) => i.path)).toEqual(["b", "a"]);
  });

  it("returns no groups for no items", () => {
    expect(groupByDate([], now)).toEqual([]);
  });
});
