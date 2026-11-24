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
    setMockInvokeHandler("trash_paths", () => []);
    vi.useFakeTimers();
  });

  it("closes when any document becomes active — the recent cycle, the command bar, not only the sidebar", () => {
    useEditorStore.setState({ activeTabId: null });
    useInboxStore.getState().openInbox();
    useEditorStore.setState({ activeTabId: "tab-1" });
    expect(useInboxStore.getState().open).toBe(false);
    // Reopening over the same active document is not a change; the list stays.
    useInboxStore.getState().openInbox();
    useEditorStore.setState({ activeTabId: "tab-1" });
    expect(useInboxStore.getState().open).toBe(true);
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
    // The listing itself reads no header; the rows on screen ask for theirs.
    await vi.runAllTimersAsync();
    expect(useInboxStore.getState().meta).toEqual({});
    for (const item of s.items) s.ensureMeta(item);
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
    // Setting a filter is what asks for the headers it matches on.
    useInboxStore.getState().setFilter("di.se");
    await vi.runAllTimersAsync();
    expect(useInboxStore.getState().visible().map((i) => i.path)).toEqual([a]);
  });

  // -------------------------------------------------------------------------
  // What things cost (perf review 2026-11, Inbox section). N = 350, the size
  // of the Inbox the review was written against.
  // -------------------------------------------------------------------------

  function captures(count: number) {
    return Array.from({ length: count }, (_, i) => entry(`Article ${String(i).padStart(3, "0")}.html`, 1_756_000_000 + i));
  }

  it("I-H3: listing 350 captures is three calls and reads no capture; the badge needs only the sidecar", async () => {
    listing = captures(350);
    const opened: Record<string, { fraction: number; openedAt: string; updatedAt: string }> = {};
    for (const e of listing.slice(0, 100)) opened[e.name] = { fraction: 0.2, openedAt: "2026-09-02T21:14:07Z", updatedAt: "2026-09-02T21:14:07Z" };
    const calls: string[] = [];
    setMockInvokeHandler("allow_asset_dir", () => {
      calls.push("allow_asset_dir");
    });
    setMockInvokeHandler("list_files_shallow", () => {
      calls.push("list_files_shallow");
      return listing;
    });
    setMockInvokeHandler("read_file", () => {
      calls.push("read_file");
      return JSON.stringify({ version: 2, items: opened });
    });
    setMockInvokeHandler("inbox_card_meta", () => {
      calls.push("inbox_card_meta");
      return null;
    });
    await useInboxStore.getState().load();
    await vi.runAllTimersAsync();
    expect(calls).toEqual(["allow_asset_dir", "list_files_shallow", "read_file"]);
    expect(useInboxStore.getState().unreadCount()).toBe(250);
    expect(useInboxStore.getState().meta).toEqual({});
  });

  it("I-H3: headers are read once per capture and land in ONE store update, not one each", async () => {
    listing = captures(350);
    const read: string[] = [];
    setMockInvokeHandler("inbox_card_meta", (args) => {
      read.push((args as { path: string }).path);
      return { title: "T", excerpt: "E", minutes: 1, site: "s", sourceUrl: null };
    });
    await useInboxStore.getState().load();
    let metaUpdates = 0;
    const unsubscribe = useInboxStore.subscribe((s, p) => {
      if (s.meta !== p.meta) metaUpdates += 1;
    });
    const rows = useInboxStore.getState().items.slice(0, 40);
    // A row that re-renders asks again; that must not read or queue twice.
    for (const item of rows) useInboxStore.getState().ensureMeta(item);
    for (const item of rows) useInboxStore.getState().ensureMeta(item);
    await vi.runAllTimersAsync();
    unsubscribe();
    expect(read).toHaveLength(40);
    expect(new Set(read).size).toBe(40);
    expect(Object.keys(useInboxStore.getState().meta)).toHaveLength(40);
    expect(metaUpdates).toBe(1);
    // Known now: asking again costs nothing.
    for (const item of rows) useInboxStore.getState().ensureMeta(item);
    await vi.runAllTimersAsync();
    expect(read).toHaveLength(40);
  });

  it("I-H3: a capture rewritten in place gets its header read again", async () => {
    const read = vi.fn(() => ({ title: "Old", excerpt: "", minutes: 1, site: "s", sourceUrl: null }));
    setMockInvokeHandler("inbox_card_meta", read);
    await useInboxStore.getState().load();
    const path = `${INBOX}/Riksbanken.html`;
    useInboxStore.getState().ensureMeta(useInboxStore.getState().items[0]);
    await vi.runAllTimersAsync();
    expect(read).toHaveBeenCalledTimes(1);
    read.mockReturnValue({ title: "New", excerpt: "", minutes: 1, site: "s", sourceUrl: null });
    listing = [entry("Riksbanken.html", 1_756_900_001), ...listing.slice(1)];
    await useInboxStore.getState().load();
    useInboxStore.getState().ensureMeta(useInboxStore.getState().items[0]);
    await vi.runAllTimersAsync();
    expect(read).toHaveBeenCalledTimes(2);
    expect(useInboxStore.getState().meta[path]?.title).toBe("New");
  });

  it("I-H3: a filter matches titles, so setting one asks for every header — once", async () => {
    listing = captures(350);
    const read = vi.fn(() => ({ title: "T", excerpt: "", minutes: 1, site: "s", sourceUrl: null }));
    setMockInvokeHandler("inbox_card_meta", read);
    await useInboxStore.getState().load();
    useInboxStore.getState().setFilter("t");
    await vi.runAllTimersAsync();
    expect(read).toHaveBeenCalledTimes(350);
    useInboxStore.getState().setFilter("ti");
    useInboxStore.getState().setFilter("");
    await useInboxStore.getState().load();
    await vi.runAllTimersAsync();
    expect(read).toHaveBeenCalledTimes(350);
  });

  it("I-M1: a reload that changed nothing changes no identity", async () => {
    listing = captures(350);
    const sidecar: Record<string, { fraction: number; openedAt: string; updatedAt: string }> = {};
    for (const e of listing.slice(0, 50)) sidecar[e.name] = { fraction: 0.5, openedAt: "2026-09-02T21:14:07Z", updatedAt: "2026-09-02T21:14:07Z" };
    files[`${INBOX}/.notesage/reading-progress.json`] = JSON.stringify({ version: 2, items: sidecar });
    await useInboxStore.getState().load();
    const before = useInboxStore.getState();
    useInboxStore.getState().select(before.items[3].path);
    const selection = useInboxStore.getState().selection;
    // A fresh array of fresh objects from the backend, same content.
    listing = listing.map((e) => ({ ...e }));
    await useInboxStore.getState().load();
    const after = useInboxStore.getState();
    expect(after.items).toBe(before.items);
    expect(after.progress).toBe(before.progress);
    expect(after.selection).toBe(selection);
  });

  it("I-M1: one changed file and one changed entry replace exactly those two objects", async () => {
    listing = captures(350);
    const sidecar: Record<string, { fraction: number; openedAt: string; updatedAt: string }> = {};
    for (const e of listing.slice(0, 50)) sidecar[e.name] = { fraction: 0.5, openedAt: "2026-09-02T21:14:07Z", updatedAt: "2026-09-02T21:14:07Z" };
    files[`${INBOX}/.notesage/reading-progress.json`] = JSON.stringify({ version: 2, items: sidecar });
    await useInboxStore.getState().load();
    const before = useInboxStore.getState();
    listing = listing.map((e, i) => (i === 7 ? { ...e, modified: (e.modified ?? 0) + 5 } : { ...e }));
    // The phone read further in one article.
    sidecar[listing[9].name] = { fraction: 0.9, openedAt: "2026-09-02T21:14:07Z", updatedAt: "2026-09-05T08:00:00Z" };
    files[`${INBOX}/.notesage/reading-progress.json`] = JSON.stringify({ version: 2, items: sidecar });
    await useInboxStore.getState().load();
    const after = useInboxStore.getState();
    expect(after.items.filter((item, i) => item !== before.items[i]).map((i) => i.name)).toEqual([listing[7].name]);
    const changed = Object.keys(after.progress.items).filter((name) => after.progress.items[name] !== before.progress.items[name]);
    expect(changed).toEqual([listing[9].name]);
    expect(after.progress.items[listing[9].name].fraction).toBe(0.9);
  });

  it("I-M1: the sidecar write after a change leaves every other entry — and the file object — alone", async () => {
    files[`${INBOX}/.notesage/reading-progress.json`] = JSON.stringify({
      version: 2,
      items: { "UBS-AI.pdf": { fraction: 0.3, openedAt: "2026-09-02T21:14:07Z", updatedAt: "2026-09-02T21:14:07Z" } },
    });
    await useInboxStore.getState().load();
    useInboxStore.getState().recordProgress(`${INBOX}/Riksbanken.html`, 0.5);
    const before = useInboxStore.getState().progress;
    let progressUpdates = 0;
    const unsubscribe = useInboxStore.subscribe((s, p) => {
      if (s.progress !== p.progress) progressUpdates += 1;
    });
    await vi.runAllTimersAsync();
    unsubscribe();
    expect(written[`${INBOX}/.notesage/reading-progress.json`]).toBeTruthy();
    // The read-merge-write found nothing new on disk: nothing is replaced.
    expect(progressUpdates).toBe(0);
    expect(useInboxStore.getState().progress).toBe(before);
  });

  it("I-M3: a batched filing moves every file itself and refreshes the tree ONCE", async () => {
    await useInboxStore.getState().load();
    const paths = [`${INBOX}/Riksbanken.html`, `${INBOX}/UBS-AI.pdf`, `${INBOX}/shot.png`];
    const renames: Array<[string, string]> = [];
    const marks: string[] = [];
    setMockInvokeHandler("rename_path", (args) => {
      const a = args as { oldPath: string; newPath: string };
      renames.push([a.oldPath, a.newPath]);
    });
    setMockInvokeHandler("mark_self_write", (args) => {
      marks.push((args as { path: string }).path);
    });
    const renamePath = vi.fn(async () => true);
    const refreshFileTree = vi.fn(async () => undefined);
    const refreshGit = vi.fn();
    useInboxStore.getState().recordProgress(paths[0], 0.4);
    const moved = await useInboxStore.getState().fileTo(paths, `${ROOT}/Research`, { renamePath, refreshFileTree, refreshGit });
    expect(moved).toEqual(paths);
    // Not through the per-file primitive, which refreshes two trees per call.
    expect(renamePath).not.toHaveBeenCalled();
    expect(renames).toEqual(paths.map((p) => [p, `${ROOT}/Research/${p.slice(p.lastIndexOf("/") + 1)}`]));
    expect(marks.filter((p) => !p.endsWith("reading-progress.json"))).toHaveLength(6);
    // The project is in the library the Inbox is in: one refresh covers both.
    expect(refreshFileTree).toHaveBeenCalledTimes(1);
    expect(refreshFileTree).toHaveBeenCalledWith(`${ROOT}/Research`);
    expect(refreshGit.mock.calls.map((c) => c[0])).toEqual([`${ROOT}/Research`, INBOX]);
    expect(useInboxStore.getState().items).toEqual([]);
    const carried = parseReadingProgress(written[`${ROOT}/Research/.notesage/reading-progress.json`]);
    expect(carried.items["Riksbanken.html"].fraction).toBe(0.4);
  });

  it("I-M3: a project outside the library refreshes the Inbox's tree as well — two refreshes, not two per file", async () => {
    await useInboxStore.getState().load();
    setMockInvokeHandler("rename_path", () => undefined);
    const refreshFileTree = vi.fn(async (_targetPath?: string) => undefined);
    await useInboxStore
      .getState()
      .fileTo([`${INBOX}/Riksbanken.html`, `${INBOX}/UBS-AI.pdf`], "/Users/peter/Code/site", { renamePath: vi.fn(async () => true), refreshFileTree });
    expect(refreshFileTree.mock.calls.map((c) => c[0])).toEqual(["/Users/peter/Code/site", INBOX]);
  });

  it("I-M3: rows leave the list before the files have moved, and a failed move puts its row back where it was", async () => {
    await useInboxStore.getState().load();
    const a = `${INBOX}/Riksbanken.html`, b = `${INBOX}/UBS-AI.pdf`;
    useInboxStore.getState().setCursor(a);
    const settle: Array<{ path: string; resolve: () => void; reject: (e: Error) => void }> = [];
    setMockInvokeHandler("rename_path", (args) => {
      const path = (args as { oldPath: string }).oldPath;
      return new Promise<void>((resolve, reject) => settle.push({ path, resolve, reject }));
    });
    const filing = useInboxStore.getState().fileTo([a, b], `${ROOT}/Research`, { renamePath: vi.fn(async () => true), refreshFileTree: vi.fn(async () => undefined) });
    await vi.advanceTimersByTimeAsync(1);
    // Both renames are in flight, neither has answered — the rows are gone.
    expect(settle.map((s) => s.path)).toEqual([a, b]);
    expect(useInboxStore.getState().items.map((i) => i.name)).toEqual(["shot.png"]);
    expect(useInboxStore.getState().cursor).toBe(`${INBOX}/shot.png`);
    settle[0].resolve();
    settle[1].reject(new Error("EACCES"));
    const moved = await filing;
    expect(moved).toEqual([a]);
    expect(useInboxStore.getState().items.map((i) => i.name)).toEqual(["UBS-AI.pdf", "shot.png"]);
    expect(useInboxStore.getState().progress.items["Riksbanken.html"].deleted).toBe(true);
    expect(useInboxStore.getState().progress.items["UBS-AI.pdf"]?.deleted).toBeUndefined();
  });

  it("I-M3: names are deduped against the destination AND against the rest of the batch", async () => {
    listing = [entry("x.html", 3), entry("x-1.html", 2), entry("y.html", 1)];
    await useInboxStore.getState().load();
    const asked: string[] = [];
    setMockInvokeHandler("path_exists", (args) => {
      const path = (args as { path: string }).path;
      asked.push(path);
      return path === `${ROOT}/Research/x.html`;
    });
    const renamePath = vi.fn(async () => true);
    await useInboxStore.getState().fileTo([`${INBOX}/x.html`, `${INBOX}/x-1.html`, `${INBOX}/y.html`], `${ROOT}/Research`, { renamePath });
    expect(renamePath.mock.calls).toEqual([
      [`${INBOX}/x.html`, `${ROOT}/Research/x-1.html`],
      [`${INBOX}/x-1.html`, `${ROOT}/Research/x-1-1.html`],
      [`${INBOX}/y.html`, `${ROOT}/Research/y.html`],
    ]);
  });

  it("I-M4: trashing a selection is ONE call; what could not be moved stays in the list", async () => {
    await useInboxStore.getState().load();
    const paths = useInboxStore.getState().items.map((i) => i.path);
    const calls: string[][] = [];
    setMockInvokeHandler("trash_paths", (args) => {
      calls.push((args as { paths: string[] }).paths);
      return [paths[1]];
    });
    await useInboxStore.getState().trash(paths);
    expect(calls).toEqual([paths]);
    expect(useInboxStore.getState().items.map((i) => i.path)).toEqual([paths[1]]);
    expect(useInboxStore.getState().progress.items["UBS-AI.pdf"]?.deleted).toBeUndefined();
    expect(useInboxStore.getState().progress.items["shot.png"].deleted).toBe(true);
  });

  it("I-M4: a trash call that fails outright removes nothing", async () => {
    await useInboxStore.getState().load();
    setMockInvokeHandler("trash_paths", () => {
      throw new Error("Finder is not answering");
    });
    await useInboxStore.getState().trash(useInboxStore.getState().items.map((i) => i.path));
    expect(useInboxStore.getState().items).toHaveLength(3);
  });
});

// ---------------------------------------------------------------------------
// Failed reads are not "empty" (audit 2026-11-22 §10)
// ---------------------------------------------------------------------------

describe("inbox-store — a read that fails is not an empty Inbox", () => {
  const SIDECAR = `${INBOX}/.notesage/reading-progress.json`;
  let written: Record<string, string>;
  let listing: ReturnType<typeof entry>[];
  /** What the OTHER device wrote: an item this Mac has never opened. */
  const PHONE = JSON.stringify({
    version: 1,
    items: { "UBS-AI.pdf": { fraction: 0.9, openedAt: 1, updatedAt: 2 } },
  });

  beforeEach(() => {
    resetInboxCaches();
    written = {};
    listing = [entry("Riksbanken.html", 1_756_900_000), entry("UBS-AI.pdf", 1_756_800_000)];
    useInboxStore.setState({
      open: false, dir: null, items: [], loading: false, error: null,
      progress: { version: 1, items: {} }, meta: {}, filter: "", selection: [], cursor: null, anchor: null,
      lastDestination: null, activeItem: null,
    });
    useSettingsStore.setState({ notesRootPath: "~/Notesage", homeDir: "/Users/peter" });
    setMockInvokeHandler("list_files_shallow", () => listing);
    setMockInvokeHandler("write_file", (args) => {
      const a = args as { path: string; content: string };
      written[a.path] = a.content;
    });
    setMockInvokeHandler("create_directory", () => undefined);
    setMockInvokeHandler("mark_self_write", () => undefined);
    setMockInvokeHandler("inbox_card_meta", () => null);
    setMockInvokeHandler("icloud_ensure_downloaded", () => "downloading");
    vi.useFakeTimers();
  });

  it("does not write over a progress file that exists but could not be read", async () => {
    // There, and unreadable: a permission error, an I/O error.
    setMockInvokeHandler("read_file", () => {
      throw new Error("Operation not permitted");
    });
    setMockInvokeHandler("path_exists", (args) => (args as { path: string }).path === SIDECAR);

    await useInboxStore.getState().load();
    useInboxStore.getState().recordProgress(`${INBOX}/Riksbanken.html`, 0.5);
    await vi.advanceTimersByTimeAsync(2000);

    // Merging with "empty" and writing would have dropped the phone's entry.
    expect(written[SIDECAR]).toBeUndefined();
    // This device's progress is kept in memory for the next attempt.
    expect(useInboxStore.getState().entryFor(`${INBOX}/Riksbanken.html`)?.fraction).toBe(0.5);
  });

  it("does not write over a progress file iCloud has not downloaded yet", async () => {
    setMockInvokeHandler("read_file", () => {
      throw new Error("No such file or directory");
    });
    // `pathExists` is false for the evicted file itself; only the
    // `.name.icloud` placeholder says it exists.
    setMockInvokeHandler(
      "path_exists",
      (args) => (args as { path: string }).path === `${INBOX}/.notesage/.reading-progress.json.icloud`,
    );

    await useInboxStore.getState().load();
    useInboxStore.getState().recordProgress(`${INBOX}/Riksbanken.html`, 0.5);
    await vi.advanceTimersByTimeAsync(2000);

    expect(written[SIDECAR]).toBeUndefined();
  });

  it("merges and writes once the file reads again, keeping the other device's entry", async () => {
    let readable = false;
    setMockInvokeHandler("read_file", () => {
      if (!readable) throw new Error("Operation not permitted");
      return PHONE;
    });
    setMockInvokeHandler("path_exists", (args) => (args as { path: string }).path === SIDECAR);

    await useInboxStore.getState().load();
    useInboxStore.getState().recordProgress(`${INBOX}/Riksbanken.html`, 0.5);
    await vi.advanceTimersByTimeAsync(2000);
    expect(written[SIDECAR]).toBeUndefined();

    readable = true;
    useInboxStore.getState().recordProgress(`${INBOX}/Riksbanken.html`, 0.6);
    await vi.advanceTimersByTimeAsync(2000);

    const merged = parseReadingProgress(written[SIDECAR]);
    expect(merged.items["Riksbanken.html"].fraction).toBe(0.6);
    expect(merged.items["UBS-AI.pdf"].fraction).toBe(0.9);
  });

  it("still starts a fresh progress file when there is none", async () => {
    setMockInvokeHandler("read_file", () => {
      throw new Error("No such file or directory");
    });
    setMockInvokeHandler("path_exists", () => false);

    await useInboxStore.getState().load();
    useInboxStore.getState().recordProgress(`${INBOX}/Riksbanken.html`, 0.5);
    await vi.advanceTimersByTimeAsync(2000);

    expect(parseReadingProgress(written[SIDECAR]).items["Riksbanken.html"].fraction).toBe(0.5);
  });

  it("keeps the rows shown and reports it when the Inbox folder cannot be listed", async () => {
    const toastError = vi.mocked((await import("sonner")).toast.error);
    toastError.mockClear();
    setMockInvokeHandler("read_file", () => {
      throw new Error("not found");
    });
    setMockInvokeHandler("path_exists", () => false);
    await useInboxStore.getState().load();
    expect(useInboxStore.getState().items).toHaveLength(2);

    // The folder is there; listing it fails.
    setMockInvokeHandler("list_files_shallow", () => {
      throw new Error("Operation timed out");
    });
    setMockInvokeHandler("path_exists", (args) => (args as { path: string }).path === INBOX);
    await useInboxStore.getState().load();

    expect(useInboxStore.getState().items).toHaveLength(2);
    expect(useInboxStore.getState().error).toContain("Operation timed out");
    expect(useInboxStore.getState().loading).toBe(false);
    expect(toastError).toHaveBeenCalledTimes(1);
  });
});
