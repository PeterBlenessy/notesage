// @vitest-environment jsdom
import "@/test/tauri-mock";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { setMockInvokeHandler } from "@/test/tauri-mock";
import { useMobileStore } from "@/stores/mobile-store";
import {
  INBOX_SIDECAR_REL,
  localInboxProgress,
  pullInboxProgress,
  pushInboxProgress,
  resetInboxProgressSync,
  startInboxProgressSync,
} from "@/lib/inbox-progress-sync";
import { parseReadingProgress, tombstone } from "@/lib/reading-progress-file";

describe("inbox-progress-sync (the phone's write-through of the sidecar)", () => {
  let disk: Record<string, string>;
  let ensured: string[];

  beforeEach(() => {
    resetInboxProgressSync();
    disk = {};
    ensured = [];
    useMobileStore.setState({ readingProgress: {}, speechPositions: {}, openDoc: null, recentlyRead: [] });
    setMockInvokeHandler("ios_read_file", (args) => {
      const a = args as { relPath: string };
      if (a.relPath in disk) return disk[a.relPath];
      throw new Error("not found");
    });
    setMockInvokeHandler("ios_write_file", (args) => {
      const a = args as { relPath: string; content: string };
      disk[a.relPath] = a.content;
    });
    setMockInvokeHandler("ios_ensure_directory", (args) => {
      ensured.push((args as { relPath: string }).relPath);
    });
    vi.useFakeTimers();
  });

  it("pushes nothing it has not changed itself — stale local entries stay silent", async () => {
    // The local store still knows an item the Mac trashed weeks ago.
    useMobileStore.setState({ readingProgress: { "Inbox/old.html": 0.9, "Notes/b.html": 0.9 } });
    disk[INBOX_SIDECAR_REL] = JSON.stringify({ version: 2, items: { "old.html": tombstone(new Date()) } });
    startInboxProgressSync();
    await pushInboxProgress();
    expect(localInboxProgress().items).toEqual({});
    expect(ensured).toEqual([]);
    expect(parseReadingProgress(disk[INBOX_SIDECAR_REL]).items["old.html"].deleted).toBe(true);
  });

  it("pull merges live entries forward-only and skips tombstones", async () => {
    useMobileStore.setState({ readingProgress: { "Inbox/a.html": 0.6 } });
    disk[INBOX_SIDECAR_REL] = JSON.stringify({
      version: 2,
      items: {
        "a.html": { fraction: 0.3, openedAt: null },
        "b.pdf": { fraction: 0.8, openedAt: "2026-09-03T00:00:00Z", speech: { paragraph: 2 } },
        "gone.html": { fraction: 0, openedAt: null, updatedAt: "2026-09-03T00:00:00Z", deleted: true },
      },
    });
    await pullInboxProgress();
    const s = useMobileStore.getState();
    expect(s.readingProgress["Inbox/a.html"]).toBe(0.6); // not pulled backwards
    expect(s.readingProgress["Inbox/b.pdf"]).toBe(0.8);
    expect(s.speechPositions["Inbox/b.pdf"]).toBe(2);
    expect(s.readingProgress["Inbox/gone.html"]).toBeUndefined();
  });

  it("what a pull adopts from disk is not pushed back as this device's change", async () => {
    disk[INBOX_SIDECAR_REL] = JSON.stringify({
      version: 2,
      items: { "b.pdf": { fraction: 0.8, openedAt: "2026-09-03T00:00:00Z", updatedAt: "2026-09-03T00:00:00Z", speech: { paragraph: 2 } } },
    });
    startInboxProgressSync();
    await pullInboxProgress();
    expect(localInboxProgress().items).toEqual({});
    await vi.advanceTimersByTimeAsync(2000);
    expect(ensured).toEqual([]);
  });

  it("a change made here is pushed with its time, merged over what is on disk", async () => {
    disk[INBOX_SIDECAR_REL] = JSON.stringify({ version: 2, items: { "z.html": { fraction: 1, openedAt: "2026-09-01T00:00:00Z" } } });
    startInboxProgressSync();
    useMobileStore.getState().rememberReadingProgress("Inbox/a.html", 0.5);
    await vi.advanceTimersByTimeAsync(2000);
    expect(ensured).toEqual(["Inbox/.notesage"]);
    const written = parseReadingProgress(disk[INBOX_SIDECAR_REL]);
    expect(written.items["a.html"].fraction).toBe(0.5);
    expect(written.items["a.html"].updatedAt).toBeTruthy();
    expect(written.items["z.html"].fraction).toBe(1); // the Mac's entry survives
    // Pushed once; a second push with nothing new writes nothing.
    ensured.length = 0;
    await pushInboxProgress();
    expect(ensured).toEqual([]);
  });

  it("a first open here clears the unread state on disk, once", async () => {
    startInboxProgressSync();
    useMobileStore.getState().openDocument({ relPath: "Inbox/a.html", name: "a.html" });
    useMobileStore.getState().rememberReadingProgress("Notes/x.html", 0.9); // not an Inbox item
    await vi.advanceTimersByTimeAsync(2000);
    const written = parseReadingProgress(disk[INBOX_SIDECAR_REL]);
    expect(written.items["a.html"].openedAt).not.toBeNull();
    expect(written.items["x.html"]).toBeUndefined();
  });

  it("the phone's change is newer than a Mac tombstone only when it really is", async () => {
    // Trashed on the Mac an hour ago; the phone reads the same name now (re-shared).
    const stone = tombstone(new Date(Date.now() - 3_600_000));
    disk[INBOX_SIDECAR_REL] = JSON.stringify({ version: 2, items: { "a.html": stone } });
    startInboxProgressSync();
    useMobileStore.getState().openDocument({ relPath: "Inbox/a.html", name: "a.html" });
    await vi.advanceTimersByTimeAsync(2000);
    const written = parseReadingProgress(disk[INBOX_SIDECAR_REL]);
    expect(written.items["a.html"].deleted).toBeUndefined();
    expect(written.items["a.html"].openedAt).not.toBeNull();
  });
});
