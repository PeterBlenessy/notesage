import { describe, it, expect } from "vitest";
import {
  emptyReadingProgress,
  isFinished,
  isUnread,
  liveEntry,
  mergeEntry,
  mergeReadingProgress,
  parseReadingProgress,
  pruneReadingProgress,
  serializeReadingProgress,
  tombstone,
  TOMBSTONE_TTL_MS,
} from "@/lib/reading-progress-file";

const T = (h: number) => new Date(Date.UTC(2026, 8, 3, h)).toISOString();

describe("reading-progress sidecar (Inbox/.notesage/reading-progress.json)", () => {
  it("round-trips through serialize → parse with sorted, stable output", () => {
    const file = emptyReadingProgress();
    file.items["b.html"] = { fraction: 0.5, openedAt: T(1), updatedAt: T(2), device: "iPhone" };
    file.items["a.pdf"] = { fraction: 0, openedAt: null };
    file.items["gone.html"] = tombstone(new Date(T(3)));
    const text = serializeReadingProgress(file);
    expect(text.indexOf('"a.pdf"')).toBeLessThan(text.indexOf('"b.html"'));
    expect(text.endsWith("\n")).toBe(true);
    expect(parseReadingProgress(text)).toEqual({
      version: 2,
      items: {
        "a.pdf": { fraction: 0, openedAt: null },
        "b.html": { fraction: 0.5, openedAt: T(1), updatedAt: T(2), device: "iPhone" },
        "gone.html": { fraction: 0, openedAt: null, updatedAt: T(3), deleted: true },
      },
    });
  });

  it("survives garbage: invalid JSON, wrong shapes, bad values", () => {
    expect(parseReadingProgress("not json")).toEqual(emptyReadingProgress());
    expect(parseReadingProgress("[]")).toEqual(emptyReadingProgress());
    expect(parseReadingProgress('{"items": 5}')).toEqual(emptyReadingProgress());
    const parsed = parseReadingProgress(
      JSON.stringify({
        version: 9,
        items: {
          "ok.html": { fraction: 7, openedAt: "yesterday-ish", updatedAt: 12, resetAt: "", deleted: "yes", speech: { paragraph: 3.9, voice: 42 } },
          "": { fraction: 1, openedAt: null },
          "null.html": null,
          "str.html": "x",
        },
      }),
    );
    expect(parsed).toEqual({
      version: 2,
      items: { "ok.html": { fraction: 1, openedAt: null, speech: { paragraph: 3 } } },
    });
  });

  it("live ⨯ live: progress forward-only, earliest open, newest updatedAt", () => {
    const phone = { fraction: 0.8, openedAt: T(10), updatedAt: T(10), device: "iPhone" };
    const mac = { fraction: 0.3, openedAt: T(9), updatedAt: T(11), speech: { paragraph: 4 } };
    expect(mergeEntry(phone, mac)).toEqual({
      fraction: 0.8,
      openedAt: T(9),
      updatedAt: T(11),
      device: "iPhone",
      speech: { paragraph: 4 },
    });
    // openedAt never goes back to null once set.
    expect(mergeEntry({ fraction: 0, openedAt: T(9) }, { fraction: 0, openedAt: null }).openedAt).toBe(T(9));
  });

  it("a tombstone beats older live state and loses to newer live state", () => {
    const stone = tombstone(new Date(T(12)));
    const stale = { fraction: 0.9, openedAt: T(8), updatedAt: T(8) };
    // The phone's old copy cannot bring a trashed item back.
    expect(mergeEntry(stone, stale)).toEqual(stone);
    expect(mergeEntry(stale, stone)).toEqual(stone);
    // A capture re-shared under the same name is opened AFTER the stone: new life.
    const fresh = { fraction: 0, openedAt: T(13), updatedAt: T(13) };
    // …and the new life remembers when the deletion was, for late arrivals.
    expect(mergeEntry(stone, fresh)).toEqual({ ...fresh, deletedAt: T(12) });
    expect(mergeEntry(fresh, stone)).toEqual({ ...fresh, deletedAt: T(12) });
    // The phone's timestamp-free entry counts as oldest.
    expect(mergeEntry(stone, { fraction: 1, openedAt: T(1) })).toEqual(stone);
    expect(isUnread(stone)).toBe(true);
    expect(isFinished(stone)).toBe(false);
    expect(liveEntry(stone)).toBeUndefined();
  });

  it("the deletion stays void for a third device even after a new life", () => {
    const stale = { fraction: 0.9, openedAt: T(1), updatedAt: T(1) };
    const stone = tombstone(new Date(T(2)));
    const fresh = { fraction: 0, openedAt: T(3), updatedAt: T(3) };
    // Device C never saw the stone or the reopen; its copy rejoins later.
    const chain = mergeEntry(mergeEntry(mergeEntry(stale, stone), fresh), stale);
    expect(chain.fraction).toBe(0);
    expect(chain.openedAt).toBe(T(3));
    expect(chain.deletedAt).toBe(T(2));
    // …in any order.
    expect(mergeEntry(stale, mergeEntry(fresh, mergeEntry(stale, stone))).fraction).toBe(0);
    // Reading after the new life counts.
    const later = { fraction: 0.4, openedAt: T(3), updatedAt: T(4) };
    expect(mergeEntry(chain, later).fraction).toBe(0.4);
  });

  it("an old life still writing after the deletion does not come back", () => {
    // Phone opened at T1, Mac trashed at T2, the phone's stale session
    // writes again at T4 with the OLD openedAt: the stone holds.
    const stone = tombstone(new Date(T(2)));
    const continuing = { fraction: 0.35, openedAt: T(1), updatedAt: T(4) };
    expect(mergeEntry(stone, continuing)).toEqual(stone);
    expect(mergeEntry(continuing, stone)).toEqual(stone);
    // A genuine new capture under the same name afterwards starts unread.
    const fresh = { fraction: 0, openedAt: T(5), updatedAt: T(5) };
    const life = mergeEntry(mergeEntry(stone, continuing), fresh);
    expect(life.fraction).toBe(0);
    expect(life.openedAt).toBe(T(5));
    expect(life.deletedAt).toBe(T(2));
    // An entry never opened anywhere (progress with no open) after the stone is a new life too.
    expect(mergeEntry(stone, { fraction: 0, openedAt: null, updatedAt: T(3) }).deleted).toBeUndefined();
  });

  it("parse enforces the merge's invariants on hand-edited input", () => {
    const parsed = parseReadingProgress(
      JSON.stringify({
        version: 2,
        items: {
          "stone.html": { fraction: 0, openedAt: null, updatedAt: T(2), deleted: true, deletedAt: T(99) },
          "reset.html": { fraction: 0, openedAt: null, resetAt: T(7) },
          "late.html": { fraction: 0.5, openedAt: T(1), updatedAt: T(3), deletedAt: T(9) },
        },
      }),
    );
    expect(parsed.items["stone.html"]).toEqual({ fraction: 0, openedAt: null, updatedAt: T(2), deleted: true });
    expect(parsed.items["reset.html"]).toEqual({ fraction: 0, openedAt: null, updatedAt: T(7), resetAt: T(7) });
    expect(parsed.items["late.html"].updatedAt).toBe(T(9));
    // A claimed open later than the entry's own last change is capped.
    const capped = parseReadingProgress(JSON.stringify({ version: 2, items: { "x.html": { fraction: 0.5, openedAt: T(20), updatedAt: T(3) } } }));
    expect(capped.items["x.html"].openedAt).toBe(T(3));
  });

  it("a reset voids everything either device recorded before it", () => {
    const read = { fraction: 1, openedAt: T(5), updatedAt: T(6) };
    const reset = { fraction: 0, openedAt: null, updatedAt: T(7), resetAt: T(7) };
    const afterReset = mergeEntry(read, reset);
    expect(afterReset).toEqual({ fraction: 0, openedAt: null, updatedAt: T(7), resetAt: T(7) });
    expect(mergeEntry(reset, read)).toEqual(afterReset); // order-independent
    expect(isUnread(afterReset)).toBe(true);
    // Reading again after the reset counts.
    const again = { fraction: 0.4, openedAt: T(8), updatedAt: T(8) };
    expect(mergeEntry(afterReset, again)).toEqual({ fraction: 0.4, openedAt: T(8), updatedAt: T(8), resetAt: T(7) });
    // …and a stale copy from before the reset still cannot un-reset it.
    expect(mergeEntry(mergeEntry(afterReset, again), read).fraction).toBe(0.4);
  });

  it("merges files entry by entry without touching the other's extras", () => {
    const a = { version: 2, items: { "x.html": { fraction: 0.2, openedAt: null } } };
    const b = { version: 2, items: { "x.html": { fraction: 0.1, openedAt: T(1) }, "y.pdf": { fraction: 1, openedAt: null } } };
    expect(mergeReadingProgress(a, b)).toEqual({
      version: 2,
      items: {
        "x.html": { fraction: 0.2, openedAt: T(1) },
        "y.pdf": { fraction: 1, openedAt: null },
      },
    });
    expect(a.items["x.html"].fraction).toBe(0.2); // pure
  });

  it("prunes old tombstones and old orphans, keeps everything present or recent", () => {
    const now = new Date(T(12));
    const old = new Date(now.getTime() - TOMBSTONE_TTL_MS - 1000).toISOString();
    const file = {
      version: 2,
      items: {
        "old-stone.html": { fraction: 0, openedAt: null, updatedAt: old, deleted: true as const },
        "new-stone.html": tombstone(now),
        "orphan-old.html": { fraction: 0.5, openedAt: T(1), updatedAt: old },
        "orphan-new.html": { fraction: 0.5, openedAt: T(1), updatedAt: T(11) },
        "present-old.html": { fraction: 0.5, openedAt: T(1), updatedAt: old },
        "no-stamp.html": { fraction: 0.5, openedAt: T(1) },
      },
    };
    const pruned = pruneReadingProgress(file, new Set(["present-old.html"]), now);
    expect(Object.keys(pruned.items).sort()).toEqual(["new-stone.html", "no-stamp.html", "orphan-new.html", "present-old.html"]);
    // A stamp-less (pre-v2 phone) entry is stamped now, so it gets the same grace.
    expect(pruned.items["no-stamp.html"].updatedAt).toBe(now.toISOString());
  });

  it("defines unread as never opened and finished as ≥ 97 %", () => {
    expect(isUnread(undefined)).toBe(true);
    expect(isUnread({ fraction: 0.5, openedAt: null })).toBe(true);
    expect(isUnread({ fraction: 0, openedAt: T(1) })).toBe(false);
    expect(isFinished({ fraction: 0.96, openedAt: null })).toBe(false);
    expect(isFinished({ fraction: 0.97, openedAt: null })).toBe(true);
  });
});
