import "@/test/local-storage";
import { beforeEach, describe, expect, it } from "vitest";
import { readingLine } from "../reading-progress";
import { useMobileStore } from "@/stores/mobile-store";

describe("readingLine", () => {
  it("says nothing without an estimate", () => {
    expect(readingLine(null, 0.5)).toBeNull();
  });
  it("shows the estimate before the article is opened", () => {
    expect(readingLine(4, 0)).toBe("4 min");
  });
  it("counts down as the article is read, never reaching zero", () => {
    expect(readingLine(4, 0.5)).toBe("2 of 4 min left");
    // 4 × 0.05 = 0.2 → still "1 of 4", not "0 of 4": a started article has
    // at least a minute left until it reads as done.
    expect(readingLine(4, 0.95)).toBe("1 of 4 min left");
  });
  it("does not report a short article's whole length as remaining", () => {
    // A 2 min piece read to 38% once said "2 of 2 min left" next to a bar
    // that was clearly a third full, because the remainder was ceiled.
    expect(readingLine(2, 0.38)).toBe("1 of 2 min left");
    expect(readingLine(5, 0.4)).toBe("3 of 5 min left");
  });
  it("reads as done past the threshold — the tail is footer, not article", () => {
    expect(readingLine(4, 0.97)).toBe("Read");
    expect(readingLine(4, 1)).toBe("Read");
  });
});

describe("mobile-store.rememberReadingProgress", () => {
  beforeEach(() => useMobileStore.setState({ readingProgress: {} }));

  it("only ever moves forward — scrolling back up must not un-read", () => {
    const s = useMobileStore.getState();
    s.rememberReadingProgress("Inbox/a.html", 0.6);
    s.rememberReadingProgress("Inbox/a.html", 0.3);
    expect(useMobileStore.getState().readingProgress["Inbox/a.html"]).toBe(0.6);
  });

  it("clamps to 0…1", () => {
    useMobileStore.getState().rememberReadingProgress("Inbox/a.html", 1.7);
    expect(useMobileStore.getState().readingProgress["Inbox/a.html"]).toBe(1);
  });

  it("follows a rename, like the other path-keyed maps", async () => {
    useMobileStore.getState().rememberReadingProgress("Inbox/a.html", 0.4);
    await useMobileStore.getState().rewritePath("Inbox/a.html", "Projects/a.html");
    expect(useMobileStore.getState().readingProgress["Projects/a.html"]).toBe(0.4);
    expect(useMobileStore.getState().readingProgress["Inbox/a.html"]).toBeUndefined();
  });
});
