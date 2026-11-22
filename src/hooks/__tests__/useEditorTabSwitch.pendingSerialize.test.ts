/**
 * Regression test for audit 2026-11-22 §2 (HIGH): the debounced markdown
 * serialize must never write one document's markdown under another
 * document's id.
 *
 * One editor instance is reused for every document. Typing schedules a
 * serialize 150 ms out; switching documents inside that window used to leave
 * the timer pending, so it fired after the NEW document had been loaded and
 * stored the new document's markdown as the OLD document's content — which
 * autosave then wrote to the old document's file.
 *
 * Exercised with a real Tiptap editor, the real editor store and the real
 * `useEditorTabSwitch`; the editor's `onUpdate` is wired exactly as
 * `useEditor` wires it.
 *
 * @vitest-environment jsdom
 */

import "@/test/tauri-mock";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { Markdown } from "tiptap-markdown";
import { EditorState } from "@tiptap/pm/state";
import { useEditorStore, type Tab } from "@/stores/editor-store";
import { useEditorTabSwitch } from "@/hooks/useEditorTabSwitch";
import {
  SERIALIZE_DEBOUNCE_MS,
  flushPendingSerialize,
  scheduleSerialize,
} from "@/lib/pending-serialize";
import type { EditorStateCache } from "@/lib/editor-state-cache";

vi.mock("@/lib/markdown-worker", () => ({
  parseInWorker: vi.fn(() => new Promise<never>(() => {})),
}));

vi.mock("@/lib/viewport-cache", () => ({
  getCachedViewport: vi.fn(async () => null),
  setCachedViewport: vi.fn(async () => {}),
  contentFingerprint: vi.fn(() => "fp"),
}));

vi.mock("@/components/editor/extensions", () => ({
  AISuggestionPluginKey: { getState: vi.fn(() => undefined) },
  setSuggestion: vi.fn(),
}));

type Props = Parameters<typeof useEditorTabSwitch>[0];

const tabA: Tab = {
  id: "tab-a",
  filePath: "/notes/a.md",
  fileName: "a.md",
  isDirty: false,
  content: "Alpha",
  frontmatter: null,
  fileType: "markdown",
  contentLoaded: true,
};

const tabB: Tab = {
  id: "tab-b",
  filePath: "/notes/b.md",
  fileName: "b.md",
  isDirty: false,
  content: "Bravo",
  frontmatter: null,
  fileType: "markdown",
  contentLoaded: true,
};

function storeTab(id: string): Tab | undefined {
  return useEditorStore.getState().openDocuments.find((t) => t.id === id);
}

/** Mirrors `handleUpdate` in Editor.tsx: write under the id the edit carries. */
function handleUpdate(content: string, documentId: string | null): void {
  if (!documentId) return;
  const tab = storeTab(documentId);
  if (!tab) return;
  useEditorStore.getState().updateTabContent(tab.id, content, content !== tab.content);
}

interface Harness {
  editor: Editor;
  lastLoadedTabId: { current: string | null };
  props: (tab: Tab) => Props;
}

function makeHarness(): Harness {
  // The editor starts out holding document A, as if A had been loaded.
  const lastLoadedTabId: { current: string | null } = { current: tabA.id };
  const element = document.createElement("div");
  document.body.appendChild(element);
  const editor = new Editor({
    element,
    extensions: [StarterKit, Markdown],
    content: "<p>Alpha</p>",
    // Same wiring as `useEditor`'s onUpdate.
    onUpdate: ({ editor: e, transaction }) => {
      if (transaction.getMeta("addToHistory") === false) return;
      scheduleSerialize(e, handleUpdate, lastLoadedTabId.current);
    },
  });

  // B is restored through the cached-EditorState path: a synchronous load
  // that dispatches no transaction, so nothing but an explicit flush can
  // clear A's pending timer.
  const bravoDoc = editor.schema.nodeFromJSON({
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "text", text: "Bravo" }] }],
  });
  const states = new Map<string, EditorState>([
    [tabB.filePath, EditorState.create({ doc: bravoDoc, plugins: editor.state.plugins })],
  ]);
  const cache = {
    get: (k: string) => states.get(k),
    set: (k: string, v: EditorState) => void states.set(k, v),
    delete: (k: string) => states.delete(k),
    has: (k: string) => states.has(k),
    clear: () => states.clear(),
    size: () => states.size,
  } as unknown as EditorStateCache;

  const shared: Omit<Props, "activeTab"> = {
    editor,
    cachedEditorStatesRef: { current: cache },
    savedSuggestionsRef: { current: new Map() },
    scrollAreaRef: { current: document.createElement("div") },
    isProgrammaticScroll: { current: false },
    lastLoadedTabId,
    saveOutgoingTabScroll: vi.fn(),
    restoreScrollRatio: vi.fn(),
    externalChanges: {},
    updateTabContent: useEditorStore.getState().updateTabContent,
    clearExternalChange: vi.fn(),
    setImageDialogOpen: vi.fn(),
    isPaperMode: false,
    marginTop: 0,
    marginBottom: 0,
    pageHeight: undefined,
  };
  return { editor, lastLoadedTabId, props: (tab: Tab) => ({ ...shared, activeTab: tab }) };
}

describe("document switch inside the serialize debounce window", () => {
  let harness: Harness;

  beforeEach(() => {
    vi.useFakeTimers();
    useEditorStore.setState({
      openDocuments: [tabA, tabB],
      activeTabId: tabA.id,
      scrollPositions: {},
      externalChanges: {},
    });
    harness = makeHarness();
  });

  afterEach(() => {
    harness.editor.destroy();
    vi.useRealTimers();
  });

  it("keeps A's content A's when the user types in A and switches to B within the debounce", () => {
    const { editor } = harness;
    const { rerender } = renderHook((p: Props) => useEditorTabSwitch(p), {
      initialProps: harness.props(tabA),
    });

    // Type in A …
    editor.commands.insertContentAt(editor.state.doc.content.size - 1, " typed");
    // … and the serialize is still pending: nothing has reached the store.
    expect(storeTab(tabA.id)?.content).toBe("Alpha");

    // Switch to B well inside the debounce window.
    vi.advanceTimersByTime(SERIALIZE_DEBOUNCE_MS / 3);
    useEditorStore.setState({ activeTabId: tabB.id });
    rerender(harness.props(tabB));
    expect(editor.getText()).toBe("Bravo");

    // Let the debounce window (and then some) elapse.
    vi.advanceTimersByTime(SERIALIZE_DEBOUNCE_MS * 4);

    // A holds what was typed into A — not B's text — and B is untouched.
    expect(storeTab(tabA.id)?.content).toBe("Alpha typed");
    expect(storeTab(tabA.id)?.isDirty).toBe(true);
    expect(storeTab(tabB.id)?.content).toBe("Bravo");
    expect(storeTab(tabB.id)?.isDirty).toBe(false);
  });

  it("writes an edit under the document it was typed into, not the one current when it runs", () => {
    const { editor, lastLoadedTabId } = harness;
    editor.commands.insertContentAt(editor.state.doc.content.size - 1, " typed");
    // The loaded-document pointer moves on before the serialize runs.
    lastLoadedTabId.current = tabB.id;
    vi.advanceTimersByTime(SERIALIZE_DEBOUNCE_MS);

    expect(storeTab(tabA.id)?.content).toBe("Alpha typed");
    expect(storeTab(tabB.id)?.content).toBe("Bravo");
  });

  it("flushes once and leaves no timer behind", () => {
    const { editor } = harness;
    const onUpdate = vi.fn();
    scheduleSerialize(editor, onUpdate, tabA.id);
    flushPendingSerialize(editor);
    expect(onUpdate).toHaveBeenCalledTimes(1);
    expect(onUpdate).toHaveBeenCalledWith("Alpha", tabA.id);

    vi.advanceTimersByTime(SERIALIZE_DEBOUNCE_MS * 4);
    expect(onUpdate).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not serialize a destroyed editor", () => {
    const { editor } = harness;
    const onUpdate = vi.fn();
    scheduleSerialize(editor, onUpdate, tabA.id);
    editor.destroy();
    vi.advanceTimersByTime(SERIALIZE_DEBOUNCE_MS * 4);
    expect(onUpdate).not.toHaveBeenCalled();
  });
});
