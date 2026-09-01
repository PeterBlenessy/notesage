// @vitest-environment jsdom
/**
 * "Update from source" (#829) — the orchestration, not the splice.
 *
 * The splice decision is Rust's (`splice_article_header`, unit-tested there,
 * including that it refuses a blocked page and never replaces the body). What
 * is pinned here is the behaviour around it, because the failure modes are all
 * in the orchestration:
 *
 *   - a refetch that comes back with nothing must leave the file ALONE,
 *   - a network failure must not be reported as a successful update,
 *   - the write only happens when Rust actually produced a new document.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const invokeMock = vi.fn();
const inlineMock = vi.fn<(rel: string) => Promise<number>>();
const evictMock = vi.fn<(rel: string) => void>();
const writeMock = vi.fn<(rel: string, content: string) => Promise<void>>();
const readMock = vi.fn<(rel: string) => Promise<string>>();

vi.mock("@tauri-apps/api/core", () => ({ invoke: (...a: unknown[]) => invokeMock(...a) }));
vi.mock("@/lib/ios-api", () => ({
  iosReadFile: (rel: string) => readMock(rel),
  iosWriteFile: (rel: string, c: string) => writeMock(rel, c),
  iosInlineArticleImages: (rel: string) => inlineMock(rel),
}));
vi.mock("@/lib/mobile-thumbnails", () => ({ evictThumbnail: (rel: string) => evictMock(rel) }));

const SAVED = '<html><body><h1>T</h1><p class="source">Clipped from <a href="https://e.com/p">https://e.com/p</a></p></body></html>';
const REPAIRED = SAVED.replace("</h1>", '</h1><p class="byline">By A</p>');

/** The orchestration under test, mirroring Reader.tsx's `updateFromSource`. */
async function updateFromSource(relPath: string, sourceUrl: string) {
  const { invoke } = await import("@tauri-apps/api/core");
  const { iosReadFile, iosWriteFile } = await import("@/lib/ios-api");
  const saved = await iosReadFile(relPath);
  const res = await fetch(sourceUrl);
  if (!res.ok) throw new Error(String(res.status));
  const pageHtml = await res.text();
  const spliced = await invoke<string | null>("splice_article_header", { saved, pageHtml, sourceUrl });
  if (!spliced) return "unchanged" as const;
  await iosWriteFile(relPath, spliced);
  // The spliced hero is a REMOTE url; `article_lead_image` reads only inlined
  // `data:` images, so without this the gallery card keeps its old picture.
  const { iosInlineArticleImages } = await import("@/lib/ios-api");
  const { evictThumbnail } = await import("@/lib/mobile-thumbnails");
  try {
    await iosInlineArticleImages(relPath);
    evictThumbnail(relPath);
  } catch {
    // Best-effort: the article is already repaired on screen.
  }
  return "updated" as const;
}

beforeEach(() => {
  invokeMock.mockReset();
  writeMock.mockReset().mockResolvedValue(undefined);
  readMock.mockReset().mockResolvedValue(SAVED);
  inlineMock.mockReset().mockResolvedValue(1);
  evictMock.mockReset();
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, text: async () => "<html/>" }));
});

describe("update from source", () => {
  it("writes the repaired document when Rust produced one", async () => {
    invokeMock.mockResolvedValue(REPAIRED);
    await expect(updateFromSource("Inbox/a.html", "https://e.com/p")).resolves.toBe("updated");
    expect(writeMock).toHaveBeenCalledWith("Inbox/a.html", REPAIRED);
  });

  it("inlines the spliced hero and drops the stale card", async () => {
    // The repaired article showed its OLD thumbnail — an inline screenshot —
    // while a freshly shared copy showed the hero. Same document, two cards.
    invokeMock.mockResolvedValue(REPAIRED);
    await updateFromSource("Inbox/a.html", "https://e.com/p");
    expect(inlineMock).toHaveBeenCalledWith("Inbox/a.html");
    expect(evictMock).toHaveBeenCalledWith("Inbox/a.html");
  });

  it("still counts as updated when the image sweep fails", async () => {
    // Offline, or every image oversized. The article is already repaired and
    // correct on screen; a failed sweep costs a stale card, not the fix.
    invokeMock.mockResolvedValue(REPAIRED);
    inlineMock.mockRejectedValue(new Error("offline"));
    await expect(updateFromSource("Inbox/a.html", "https://e.com/p")).resolves.toBe("updated");
  });

  it("does not sweep when nothing was written", async () => {
    invokeMock.mockResolvedValue(null);
    await updateFromSource("Inbox/a.html", "https://e.com/p");
    expect(inlineMock).not.toHaveBeenCalled();
  });

  it("leaves the file untouched when the refetch yields nothing", async () => {
    // A bot-block, a paywall, a deleted page, or an article that already has
    // its masthead. Rust says `null`; the file must not be rewritten.
    invokeMock.mockResolvedValue(null);
    await expect(updateFromSource("Inbox/a.html", "https://e.com/p")).resolves.toBe("unchanged");
    expect(writeMock).not.toHaveBeenCalled();
  });

  it("does not write when the page cannot be reached", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 403, text: async () => "" }));
    await expect(updateFromSource("Inbox/a.html", "https://e.com/p")).rejects.toThrow();
    expect(writeMock).not.toHaveBeenCalled();
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("does not write when the network throws", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    await expect(updateFromSource("Inbox/a.html", "https://e.com/p")).rejects.toThrow("offline");
    expect(writeMock).not.toHaveBeenCalled();
  });
});
