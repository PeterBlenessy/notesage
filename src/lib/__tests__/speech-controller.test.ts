// @vitest-environment jsdom
import "@/test/tauri-mock";
import { describe, it, expect, beforeEach } from "vitest";
import { setMockInvokeHandler } from "@/test/tauri-mock";
import { useMobileStore } from "@/stores/mobile-store";
import {
  onSpeechRange,
  pauseSpeech,
  resumeSpeech,
  startSpeech,
  startSpeechEvents,
  stopSpeech,
  toggleSpeech,
} from "@/lib/speech-controller";

const emit = (detail: Record<string, unknown>) =>
  window.dispatchEvent(new CustomEvent("notesage:speech", { detail }));
const flush = () => new Promise((r) => setTimeout(r, 0));

describe("speech-controller (read aloud belongs to the app)", () => {
  let started: Array<{ text: string; title: string; startIndex: number }>;
  let calls: string[];
  let stopEvents = () => {};

  beforeEach(() => {
    stopEvents();
    started = [];
    calls = [];
    useMobileStore.setState({ speech: null, speechPositions: {}, speechVoices: {}, openDoc: null });
    setMockInvokeHandler("ios_read_file", () => "<html><body><h1>Q3</h1><p>Revenue grew.</p></body></html>");
    setMockInvokeHandler("ios_article_thumbnail", () => {
      throw new Error("no image");
    });
    setMockInvokeHandler("ios_article_card_meta", () => ({ title: "Quarterly results", excerpt: null, minutes: 3, site: "x.com" }));
    setMockInvokeHandler("ios_speech_start", (args) => {
      started.push(args as { text: string; title: string; startIndex: number });
      return { language: "en" };
    });
    for (const c of ["ios_speech_pause", "ios_speech_resume", "ios_speech_stop"]) {
      setMockInvokeHandler(c, () => {
        calls.push(c);
      });
    }
    stopEvents = startSpeechEvents();
  });

  it("starts from a list entry: reads the file, speaks its prose, opens nothing", async () => {
    useMobileStore.setState({ speechPositions: { "Inbox/q3.html": 2 } });
    await startSpeech({ relPath: "Inbox/q3.html", name: "q3.html" });
    await flush();
    expect(started).toHaveLength(1);
    expect(started[0].text).toContain("Revenue grew");
    expect(started[0].text).not.toContain("<");
    expect(started[0].title).toBe("Quarterly results");
    expect(started[0].startIndex).toBe(2);
    expect(useMobileStore.getState().openDoc).toBeNull();
    expect(useMobileStore.getState().speech).toMatchObject({ relPath: "Inbox/q3.html", playing: true, index: 2, language: "en" });
  });

  it("the row's one gesture: start, then pause, then resume — the session stays", async () => {
    const entry = { path: "Inbox/q3.html", name: "q3.html" };
    toggleSpeech(entry);
    await flush();
    expect(started).toHaveLength(1);
    toggleSpeech(entry);
    expect(calls).toEqual(["ios_speech_pause"]);
    expect(useMobileStore.getState().speech?.playing).toBe(false);
    toggleSpeech(entry);
    expect(calls).toEqual(["ios_speech_pause", "ios_speech_resume"]);
    expect(useMobileStore.getState().speech?.playing).toBe(true);
    expect(started).toHaveLength(1); // never restarted
  });

  it("progress feeds the ring and the resume position; finishing retires the session at the top", async () => {
    await startSpeech({ relPath: "Inbox/q3.html", name: "q3.html", text: "one\n\ntwo\n\nthree", title: "T" });
    await flush();
    emit({ event: "progress", index: 1, total: 3 });
    expect(useMobileStore.getState().speech).toMatchObject({ index: 1, total: 3 });
    expect(useMobileStore.getState().speechPositions["Inbox/q3.html"]).toBe(1);
    emit({ event: "playing", playing: false }); // lock screen
    expect(useMobileStore.getState().speech?.playing).toBe(false);
    emit({ event: "finished" });
    expect(useMobileStore.getState().speech).toBeNull();
    expect(useMobileStore.getState().speechPositions["Inbox/q3.html"]).toBe(0);
  });

  it("starting a second article replaces the first; the first keeps its position", async () => {
    await startSpeech({ relPath: "Inbox/a.html", name: "a.html", text: "a one\n\na two", title: "A" });
    await flush();
    emit({ event: "progress", index: 1, total: 2 });
    await startSpeech({ relPath: "Inbox/b.html", name: "b.html", text: "b one", title: "B" });
    await flush();
    expect(useMobileStore.getState().speech?.relPath).toBe("Inbox/b.html");
    emit({ event: "progress", index: 0, total: 1 });
    expect(useMobileStore.getState().speechPositions["Inbox/a.html"]).toBe(1);
    expect(started.map((s) => s.title)).toEqual(["A", "B"]);
  });

  it("a document with no prose says so and starts nothing", async () => {
    setMockInvokeHandler("ios_read_file", () => "<html><body><img src=\"x\"></body></html>");
    const { toast } = await import("sonner");
    await startSpeech({ relPath: "Inbox/empty.html", name: "empty.html" });
    expect(started).toHaveLength(0);
    expect(useMobileStore.getState().speech).toBeNull();
    expect(toast.error).toHaveBeenCalledWith("Nothing to read aloud in this document");
    await startSpeech({ relPath: "Inbox/scan.pdf", name: "scan.pdf" });
    expect(started).toHaveLength(0);
  });

  it("two taps before the file is read start the article once", async () => {
    let release: (v: string) => void = () => {};
    setMockInvokeHandler("ios_read_file", () => new Promise<string>((r) => (release = r)));
    const entry = { path: "Inbox/q3.html", name: "q3.html" };
    toggleSpeech(entry);
    toggleSpeech(entry);
    release("<p>Once.</p>");
    await flush();
    await flush();
    expect(started).toHaveLength(1);
  });

  it("writes the session only once the prose is in hand — the old article's progress cannot land on the new one", async () => {
    await startSpeech({ relPath: "Inbox/a.html", name: "a.html", text: "a one\n\na two", title: "A" });
    await flush();
    let release: (v: string) => void = () => {};
    setMockInvokeHandler("ios_read_file", () => new Promise<string>((r) => (release = r)));
    const second = startSpeech({ relPath: "Inbox/b.html", name: "b.html" });
    // Still A while B's file is being read: A's paragraph events stay A's.
    emit({ event: "progress", index: 1, total: 2 });
    expect(useMobileStore.getState().speech?.relPath).toBe("Inbox/a.html");
    expect(useMobileStore.getState().speechPositions["Inbox/b.html"]).toBeUndefined();
    release("<p>B one.</p>");
    await second;
    await flush();
    expect(useMobileStore.getState().speech?.relPath).toBe("Inbox/b.html");
    expect(useMobileStore.getState().speechPositions["Inbox/a.html"]).toBe(1);
  });

  it("word ranges reach listeners with the playing document, and never the store", async () => {
    await startSpeech({ relPath: "Inbox/q3.html", name: "q3.html", text: "one two", title: "T" });
    await flush();
    const seen: unknown[] = [];
    const off = onSpeechRange((r) => seen.push(r));
    const before = useMobileStore.getState().speech;
    emit({ event: "range", index: 0, location: 4, length: 3 });
    expect(seen).toEqual([{ relPath: "Inbox/q3.html", index: 0, location: 4, length: 3 }]);
    expect(useMobileStore.getState().speech).toBe(before);
    off();
    emit({ event: "range", index: 0, location: 0, length: 3 });
    expect(seen).toHaveLength(1);
  });

  it("pause / resume / stop drive the native player and the session", async () => {
    await startSpeech({ relPath: "Inbox/q3.html", name: "q3.html", text: "x", title: "T" });
    await flush();
    pauseSpeech();
    resumeSpeech();
    stopSpeech();
    expect(calls).toEqual(["ios_speech_pause", "ios_speech_resume", "ios_speech_stop"]);
    expect(useMobileStore.getState().speech).toBeNull();
  });
});
