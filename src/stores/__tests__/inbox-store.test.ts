// @vitest-environment jsdom
import "@/test/tauri-mock";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { setMockInvokeHandler } from "@/test/tauri-mock";
import { useInboxStore, resetInboxCaches } from "@/stores/inbox-store";
import { useSettingsStore } from "@/stores/settings-store";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { useEditorStore } from "@/stores/editor-store";
import { parseReadingProgress } from "@/lib/reading-progress-file";

const ROOT = "/Users/peter/Notesage";
const INBOX = `${ROOT}/Inbox`;

function entry(name: string, modified?: number) {
  return { name, path: `${INBOX}/${name}`, is_directory: false, hidden: false, modified };
}

describe("inbox-store", () => {
  let written: Record<string, string>;
  let files: Record<string, string>;
  let listing: ReturnType<typeof entry>[];

  beforeEach(() => {
    resetInboxCaches();
    written = {};
    files = {};
    listing = [entry("Riksbanken.html", 1_756_900_000), entry("UBS-AI.pdf", 1_756_800_000), entry("shot.png")];
    useInboxStore.setState({
      open: false, dir: null, items: [], loading: false, error: null,
      progress: { version: 1, items: {} }, meta: {}, filter: "", selection: [], cursor: null, anchor: null,
      lastDestination: null, activeItem: null,
    });
    useSettingsStore.setState({ notesRootPath: "~/Notesage", homeDir: "/Users/peter" });
    useWorkspaceStore.setState({ pinnedFiles: [] });
    setMockInvokeHandler("list_files_shallow", (args) => {
      const a = args as { path: string };
      if (a.path !== INBOX) throw new Error(`Path does not exist: ${a.path}`);
      return listing;
    });
    setMockInvokeHandler("read_file", (args) => {
      const a = args as { path: string };
      if (a.path in files) return files[a.path];
      throw new Error("not found");
    });
    setMockInvokeHandler("write_file", (args) => {
      const a = args as { path: string; content: string };
      written[a.path] = a.content;
    });
    setMockInvokeHandler("create_directory", () => undefined);
    setMockInvokeHandler("mark_self_write", () => undefined);
    setMockInvokeHandler("path_exists", () => false);
    setMockInvokeHandler("inbox_card_meta", (args) => {
      const a = args as { path: string };
      return a.path.endsWith(".html")
        ? { title: "Riksbanken lämnar räntan oförändrad", excerpt: "Beskedet var väntat", minutes: 4, site: "di.se", sourceUrl: "https://di.se/x" }
        : null;
    });
    setMockInvokeHandler("trash_path", () => undefined);
    vi.useFakeTimers();
  });

  it("lists the Inbox, merges the sidecar, and reads article headers", async () => {
    files[`${INBOX}/.notesage/reading-progress.json`] = JSON.stringify({
      version: 1,
      items: { "Riksbanken.html": { fraction: 0.5, openedAt: "2026-09-02T21:14:07Z" }, "gone.html": { fraction: 1, openedAt: null } },
    });
    await useInboxStore.getState().load();
    const s = useInboxStore.getState();
    expect(s.dir).toBe(INBOX);
    expect(s.items.map((i) => i.kind)).toEqual(["html", "pdf", "image"]);
    // Entries for items no longer present are kept at load (the other
    // device's knowledge); they are pruned where the file is rewritten.
    expect(Object.keys(s.progress.items).sort()).toEqual(["Riksbanken.html", "gone.html"]);
    expect(s.unreadCount()).toBe(2);
    await vi.runAllTimersAsync();
    expect(useInboxStore.getState().meta[`${INBOX}/Riksbanken.html`]?.site).toBe("di.se");
  });

  it("prefers the synced (iCloud) library root when there is one", async () => {
    const synced = "/Users/peter/Library/Mobile Documents/com~apple~CloudDocs/Notesage";
    useSettingsStore.setState({ icloudNotesagePath: synced });
    setMockInvokeHandler("list_files_shallow", (args) => {
      expect((args as { path: string }).path).toBe(`${synced}/Inbox`);
      return [];
    });
    await useInboxStore.getState().load();
    expect(useInboxStore.getState().dir).toBe(`${synced}/Inbox`);
    useSettingsStore.setState({ icloudNotesagePath: null });
  });

  it("a root override beats both settings (the E2E suite's throw-away library)", async () => {
    useSettingsStore.setState({ icloudNotesagePath: "/synced/Notesage" });
    useInboxStore.setState({ rootOverride: "/tmp/lib" });
    setMockInvokeHandler("list_files_shallow", (args) => {
      expect((args as { path: string }).path).toBe("/tmp/lib/Inbox");
      return [];
    });
    await useInboxStore.getState().load();
    expect(useInboxStore.getState().dir).toBe("/tmp/lib/Inbox");
    useInboxStore.setState({ rootOverride: null });
    useSettingsStore.setState({ icloudNotesagePath: null });
  });

  it("a slow, superseded load never clobbers a newer one", async () => {
    let releaseSlow: (() => void) | null = null;
    setMockInvokeHandler("list_files_shallow", (args) => {
      const a = args as { path: string };
      if (a.path === INBOX) return new Promise((resolve) => { releaseSlow = () => resolve(listing); });
      return [entry("only.pdf")].map((e) => ({ ...e, path: "/tmp/lib/Inbox/only.pdf" }));
    });
    const slow = useInboxStore.getState().load();            // real root, hangs on the listing
    useInboxStore.setState({ rootOverride: "/tmp/lib" });
    await useInboxStore.getState().load();                   // newer root, resolves first
    expect(useInboxStore.getState().dir).toBe("/tmp/lib/Inbox");
    releaseSlow!();
    await slow;
    expect(useInboxStore.getState().dir).toBe("/tmp/lib/Inbox");
    expect(useInboxStore.getState().items.map((i) => i.name)).toEqual(["only.pdf"]);
    useInboxStore.setState({ rootOverride: null });
  });

  it("treats a missing Inbox folder as empty, not an error", async () => {
    setMockInvokeHandler("list_files_shallow", () => {
      throw new Error("Path does not exist");
    });
    await useInboxStore.getState().load();
    expect(useInboxStore.getState().items).toEqual([]);
    expect(useInboxStore.getState().error).toBeNull();
  });

  it("records progress forward-only and writes the sidecar once per burst", async () => {
    await useInboxStore.getState().load();
    const path = `${INBOX}/Riksbanken.html`;
    useInboxStore.getState().markOpened(path);
    useInboxStore.getState().recordProgress(path, 0.3);
    useInboxStore.getState().recordProgress(path, 0.2); // backwards: ignored
    useInboxStore.getState().recordProgress(path, 0.6);
    expect(useInboxStore.getState().entryFor(path)?.fraction).toBe(0.6);
    expect(useInboxStore.getState().unreadCount()).toBe(2);
    await vi.runAllTimersAsync();
    const file = written[`${INBOX}/.notesage/reading-progress.json`];
    expect(file).toBeDefined();
    const parsed = parseReadingProgress(file);
    expect(parsed.items["Riksbanken.html"].fraction).toBe(0.6);
    expect(parsed.items["Riksbanken.html"].openedAt).not.toBeNull();
    expect(Object.keys(written)).toHaveLength(1);
  });

  it("writing the sidecar merges what another device wrote in the meantime", async () => {
    await useInboxStore.getState().load();
    // The phone finishes UBS-AI.pdf while the Mac reads Riksbanken.
    files[`${INBOX}/.notesage/reading-progress.json`] = JSON.stringify({
      version: 1,
      items: { "UBS-AI.pdf": { fraction: 1, openedAt: "2026-09-03T20:00:00Z", device: "iPhone" } },
    });
    useInboxStore.getState().recordProgress(`${INBOX}/Riksbanken.html`, 0.5);
    await vi.runAllTimersAsync();
    const onDisk = parseReadingProgress(written[`${INBOX}/.notesage/reading-progress.json`]);
    expect(onDisk.items["UBS-AI.pdf"].fraction).toBe(1); // not clobbered
    expect(onDisk.items["Riksbanken.html"].fraction).toBe(0.5);
    // …and memory learned it too, so the badge is right without a reload.
    expect(useInboxStore.getState().entryFor(`${INBOX}/UBS-AI.pdf`)?.fraction).toBe(1);
  });

  it("trash leaves a tombstone that survives the next write and the other device's copy", async () => {
    await useInboxStore.getState().load();
    const path = `${INBOX}/shot.png`;
    useInboxStore.getState().recordProgress(path, 0.5);
    await vi.runAllTimersAsync();
    // The phone still carries the old entry.
    files[`${INBOX}/.notesage/reading-progress.json`] = JSON.stringify({
      version: 2, items: { "shot.png": { fraction: 0.5, openedAt: "2026-09-03T20:00:00Z", updatedAt: "2026-09-03T20:00:00Z" } },
    });
    await useInboxStore.getState().trash([path]);
    await vi.runAllTimersAsync();
    const onDisk = parseReadingProgress(written[`${INBOX}/.notesage/reading-progress.json`]);
    expect(onDisk.items["shot.png"].deleted).toBe(true);
    expect(useInboxStore.getState().entryFor(path)).toBeUndefined();
    // Re-shared under the same name later: the listing has it again, and it
    // is unread — the stone is older than its first open.
    listing = [...listing];
    files[`${INBOX}/.notesage/reading-progress.json`] = written[`${INBOX}/.notesage/reading-progress.json`];
    await useInboxStore.getState().load();
    expect(useInboxStore.getState().items.map((i) => i.name)).toContain("shot.png");
    expect(useInboxStore.getState().unreadCount()).toBe(3);
  });

  it("mark as unread survives the merge with the other device's copy", async () => {
    await useInboxStore.getState().load();
    const path = `${INBOX}/UBS-AI.pdf`;
    files[`${INBOX}/.notesage/reading-progress.json`] = JSON.stringify({
      version: 2, items: { "UBS-AI.pdf": { fraction: 1, openedAt: "2026-09-01T00:00:00Z", updatedAt: "2026-09-01T00:00:00Z" } },
    });
    useInboxStore.getState().markUnread([path]);
    await vi.runAllTimersAsync();
    const onDisk = parseReadingProgress(written[`${INBOX}/.notesage/reading-progress.json`]);
    expect(onDisk.items["UBS-AI.pdf"].fraction).toBe(0);
    expect(onDisk.items["UBS-AI.pdf"].openedAt).toBeNull();
    expect(onDisk.items["UBS-AI.pdf"].resetAt).toBeTruthy();
    expect(useInboxStore.getState().unreadCount()).toBe(3);
  });

  it("mark read / unread / all read", async () => {
    await useInboxStore.getState().load();
    const s = useInboxStore.getState();
    s.markRead([`${INBOX}/UBS-AI.pdf`]);
    expect(useInboxStore.getState().unreadCount()).toBe(2);
    s.markUnread([`${INBOX}/UBS-AI.pdf`]);
    expect(useInboxStore.getState().unreadCount()).toBe(3);
    s.markAllRead();
    expect(useInboxStore.getState().unreadCount()).toBe(0);
  });

  it("selection: click, ⌘-click toggles, ⇧-click ranges; targets fall back to the cursor", async () => {
    await useInboxStore.getState().load();
    const [a, b, c] = useInboxStore.getState().items.map((i) => i.path);
    const s = useInboxStore.getState();
    s.select(a);
    s.select(c, { shift: true });
    expect(useInboxStore.getState().selection).toEqual([a, b, c]);
    s.select(b, { meta: true });
    expect(useInboxStore.getState().selection).toEqual([a, c]);
    s.clearSelection();
    s.setCursor(b);
    expect(useInboxStore.getState().targets()).toEqual([b]);
  });

  it("files items into a project, carrying their state into the project's sidecar", async () => {
    await useInboxStore.getState().load();
    const path = `${INBOX}/Riksbanken.html`;
    useInboxStore.getState().recordProgress(path, 0.4);
    useInboxStore.getState().setCursor(path);
    const renamePath = vi.fn(async () => true);
    const moved = await useInboxStore.getState().fileTo([path], `${ROOT}/Research`, { renamePath });
    expect(moved).toEqual([path]);
    expect(renamePath).toHaveBeenCalledWith(path, `${ROOT}/Research/Riksbanken.html`);
    const s = useInboxStore.getState();
    expect(s.items.map((i) => i.name)).toEqual(["UBS-AI.pdf", "shot.png"]);
    expect(s.entryFor(path)).toBeUndefined();
    expect(s.progress.items["Riksbanken.html"].deleted).toBe(true);
    expect(s.lastDestination).toBe(`${ROOT}/Research`);
    // The cursor keeps its place: the next item slid up into it.
    expect(s.cursor).toBe(`${INBOX}/UBS-AI.pdf`);
    const carried = parseReadingProgress(written[`${ROOT}/Research/.notesage/reading-progress.json`]);
    expect(carried.items["Riksbanken.html"].fraction).toBe(0.4);
  });

  it("two filings to the same project in quick succession both carry their state", async () => {
    await useInboxStore.getState().load();
    const a = `${INBOX}/Riksbanken.html`, b = `${INBOX}/UBS-AI.pdf`;
    useInboxStore.getState().recordProgress(a, 0.3);
    useInboxStore.getState().recordProgress(b, 0.7);
    // The project sidecar is read back from what was written — the race
    // is only visible when writes feed the next read.
    setMockInvokeHandler("read_file", (args) => {
      const p = (args as { path: string }).path;
      if (p in written) return written[p];
      if (p in files) return files[p];
      throw new Error("not found");
    });
    setMockInvokeHandler("write_file", async (args) => {
      const w = args as { path: string; content: string };
      await new Promise((r) => setTimeout(r, 5));
      written[w.path] = w.content;
    });
    const renamePath = vi.fn(async () => true);
    const p1 = useInboxStore.getState().fileTo([a], `${ROOT}/Research`, { renamePath });
    const p2 = useInboxStore.getState().fileTo([b], `${ROOT}/Research`, { renamePath });
    await vi.advanceTimersByTimeAsync(50);
    await Promise.all([p1, p2]);
    const carried = parseReadingProgress(written[`${ROOT}/Research/.notesage/reading-progress.json`]);
    expect(carried.items["Riksbanken.html"].fraction).toBe(0.3);
    expect(carried.items["UBS-AI.pdf"].fraction).toBe(0.7);
  });

  it("dedupes a name that already exists at the destination", async () => {
    await useInboxStore.getState().load();
    setMockInvokeHandler("path_exists", (args) => (args as { path: string }).path === `${ROOT}/Research/UBS-AI.pdf`);
    const renamePath = vi.fn(async () => true);
    await useInboxStore.getState().fileTo([`${INBOX}/UBS-AI.pdf`], `${ROOT}/Research`, { renamePath });
    expect(renamePath).toHaveBeenCalledWith(`${INBOX}/UBS-AI.pdf`, `${ROOT}/Research/UBS-AI-1.pdf`);
  });

  it("a failed move leaves the item in place", async () => {
    await useInboxStore.getState().load();
    const renamePath = vi.fn(async () => {
      throw new Error("EACCES");
    });
    const moved = await useInboxStore.getState().fileTo([`${INBOX}/UBS-AI.pdf`], `${ROOT}/Research`, { renamePath });
    expect(moved).toEqual([]);
    expect(useInboxStore.getState().items).toHaveLength(3);
  });

  it("trash removes the item, its state, its pin and its recent entry", async () => {
    await useInboxStore.getState().load();
    const path = `${INBOX}/shot.png`;
    useWorkspaceStore.setState({ pinnedFiles: [path] });
    useEditorStore.setState({ recentFiles: [{ path, name: "shot.png", lastAccessedAt: 1 }] });
    useInboxStore.getState().markRead([path]);
    await useInboxStore.getState().trash([path]);
    expect(useInboxStore.getState().items.map((i) => i.name)).toEqual(["Riksbanken.html", "UBS-AI.pdf"]);
    expect(useInboxStore.getState().entryFor(path)).toBeUndefined();
    expect(useInboxStore.getState().progress.items["shot.png"].deleted).toBe(true);
    expect(useWorkspaceStore.getState().pinnedFiles).toEqual([]);
    expect(useEditorStore.getState().recentFiles).toEqual([]);
  });

  it("neighbour follows listing order and respects the filter", async () => {
    await useInboxStore.getState().load();
    await vi.runAllTimersAsync();
    const [a, b, c] = useInboxStore.getState().items.map((i) => i.path);
    expect(useInboxStore.getState().neighbour(a, 1)?.path).toBe(b);
    expect(useInboxStore.getState().neighbour(c, 1)).toBeNull();
    useInboxStore.getState().setFilter("di.se");
    expect(useInboxStore.getState().visible().map((i) => i.path)).toEqual([a]);
  });
});
