import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Editor } from "@tiptap/core";

vi.mock("@/lib/markdown", () => ({
  getMarkdownFromEditor: (editor: { markdown: string }) => editor.markdown,
}));

import {
  SERIALIZE_DEBOUNCE_MS,
  flushAllPendingSerializes,
  scheduleSerialize,
} from "../pending-serialize";

function fakeEditor(markdown: string, isDestroyed = false): Editor {
  return { markdown, isDestroyed } as unknown as Editor;
}

describe("flushAllPendingSerializes", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it("delivers a pending serialize now, under the document it was scheduled for", () => {
    const onUpdate = vi.fn();
    scheduleSerialize(fakeEditor("typed"), onUpdate, "doc-a");
    expect(onUpdate).not.toHaveBeenCalled();

    flushAllPendingSerializes();

    expect(onUpdate).toHaveBeenCalledTimes(1);
    expect(onUpdate).toHaveBeenCalledWith("typed", "doc-a");
  });

  it("does not deliver it a second time when the debounce later elapses", () => {
    const onUpdate = vi.fn();
    scheduleSerialize(fakeEditor("typed"), onUpdate, "doc-a");
    flushAllPendingSerializes();
    vi.advanceTimersByTime(SERIALIZE_DEBOUNCE_MS * 2);
    flushAllPendingSerializes();
    expect(onUpdate).toHaveBeenCalledTimes(1);
  });

  it("flushes every editor with a pending serialize", () => {
    const a = vi.fn();
    const b = vi.fn();
    scheduleSerialize(fakeEditor("A"), a, "doc-a");
    scheduleSerialize(fakeEditor("B"), b, "doc-b");
    flushAllPendingSerializes();
    expect(a).toHaveBeenCalledWith("A", "doc-a");
    expect(b).toHaveBeenCalledWith("B", "doc-b");
  });

  it("is a no-op once the debounce has already run", () => {
    const onUpdate = vi.fn();
    scheduleSerialize(fakeEditor("typed"), onUpdate, "doc-a");
    vi.advanceTimersByTime(SERIALIZE_DEBOUNCE_MS);
    expect(onUpdate).toHaveBeenCalledTimes(1);
    flushAllPendingSerializes();
    expect(onUpdate).toHaveBeenCalledTimes(1);
  });

  it("skips a destroyed editor", () => {
    const onUpdate = vi.fn();
    scheduleSerialize(fakeEditor("gone", true), onUpdate, "doc-a");
    flushAllPendingSerializes();
    expect(onUpdate).not.toHaveBeenCalled();
  });
});
